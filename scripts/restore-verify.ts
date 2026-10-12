import Database from "better-sqlite3";
import { isDeepStrictEqual } from "node:util";
import { migrate } from "../apps/api/src/db/migrate.js";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { copyVerified, emptyDirectory, type BackupManifest } from "./backup.js";
import {
  safeDirectory,
  hashFile,
  syncDirectory,
} from "../apps/api/src/attachments/files.js";
import { getTask } from "../apps/api/src/tasks/service.js";
import { getBug } from "../apps/api/src/bugs/service.js";
import { getRequirement } from "../apps/api/src/requirements/service.js";
import { getReport } from "../apps/api/src/reports/service.js";
import { renderReport } from "../apps/api/src/reports/render.js";
export interface VerificationResult {
  integrityCheck: string;
  foreignKeyCheck: unknown[];
  missingAttachments: string[];
  attachmentsVerified: number;
  objectsVerified: number;
  reportsVerified: number;
  reportText: string;
  reportTexts: { id: string; text: string }[];
}
function inside(parent: string, child: string) {
  const rel = relative(parent, child);
  return !rel || (!rel.startsWith("..") && !isAbsolute(rel));
}
// Compare definitions, not just names: a same-name no-op trigger is unsupported.
// Page locations and ANALYZE statistics are physical/planner details, not schema.
// Keep sqlite_sequence and implicit sqlite_autoindex definitions in the comparison.
function schema(db: Database.Database): unknown[] {
  return db
    .prepare(
      `SELECT type,name,tbl_name,sql FROM main.sqlite_schema
    WHERE name NOT IN ('sqlite_stat1','sqlite_stat2','sqlite_stat3','sqlite_stat4')
    ORDER BY type,name,tbl_name`,
    )
    .all();
}
function requireSupportedSchema(
  db: Database.Database,
  schemaVersion: number,
): void {
  const reference = new Database(":memory:");
  try {
    reference.pragma("foreign_keys = ON");
    // Only the trusted, independent reference receives packaged migrations.
    // The restored database is opened read-only and is never repaired here.
    migrate(reference);
    if (!isDeepStrictEqual(schema(db), schema(reference)))
      throw new Error("Unsupported database schema definitions");
    const expected = reference
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as { version: number }[];
    const actual = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all();
    if (
      expected.at(-1)?.version !== schemaVersion ||
      !isDeepStrictEqual(actual, expected)
    )
      throw new Error("Unsupported database migration ledger");
  } finally {
    reference.close();
  }
}
export async function restoreVerify(
  manifestPath: string,
  scratchDir: string,
): Promise<VerificationResult> {
  const source = await safeDirectory(dirname(manifestPath)),
    scratch = resolve(scratchDir);
  if (inside(source, scratch) || inside(scratch, source))
    throw new Error("Restore must be isolated from backup");
  const input = await open(
    resolve(manifestPath),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let manifest: BackupManifest;
  try {
    if (
      !(await input.stat()).isFile() ||
      (await input.stat()).size > 32 * 1024 ** 2
    )
      throw new Error("Invalid manifest");
    manifest = JSON.parse(await input.readFile("utf8"));
  } finally {
    await input.close();
  }
  if (
    !manifest ||
    manifest.schemaVersion !== 10 ||
    typeof manifest.sqliteVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(manifest.sqliteVersion) ||
    typeof manifest.createdAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length < 1 ||
    manifest.files.length > 100001
  )
    throw new Error("Invalid manifest");
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      !/^(database\.sqlite|attachments\/[a-f0-9]{64})$/.test(file.path) ||
      seen.has(file.path) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error("Invalid manifest file");
    seen.add(file.path);
  }
  if (!seen.has("database.sqlite")) throw new Error("Missing database");
  const destination = await emptyDirectory(scratch);
  for (const file of manifest.files) {
    await safeDirectory(dirname(join(source, file.path)));
    await safeDirectory(dirname(join(destination, file.path)), true);
    await copyVerified(
      join(source, file.path),
      join(destination, file.path),
      file,
    );
  }
  const db = new Database(join(destination, "database.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    db.pragma("trusted_schema = OFF");
    db.pragma("query_only = ON");
    requireSupportedSchema(db, manifest.schemaVersion);
    const integrityCheck = db.pragma("integrity_check", {
        simple: true,
      }) as string,
      foreignKeyCheck = db.pragma("foreign_key_check") as unknown[];
    if (integrityCheck !== "ok" || foreignKeyCheck.length)
      throw new Error("Database consistency check failed");
    const attachments = db
      .prepare("SELECT storage_key,sha256,size FROM attachments ORDER BY seq")
      .all() as { storage_key: string; sha256: string; size: number }[];
    if (seen.size !== attachments.length + 1)
      throw new Error("Manifest attachment inventory mismatch");
    for (const a of attachments) {
      const path = `attachments/${a.storage_key}`;
      if (!seen.has(path)) throw new Error("Missing attachment");
      const hash = await hashFile(join(destination, path));
      if (hash.sha256 !== a.sha256 || hash.size !== a.size)
        throw new Error("Attachment database hash mismatch");
    }
    const objects = db
      .prepare("SELECT id,kind FROM objects ORDER BY id")
      .all() as { id: string; kind: string }[];
    for (const o of objects) {
      const value =
        o.kind === "task"
          ? getTask(db, o.id)
          : o.kind === "bug"
            ? getBug(db, o.id)
            : getRequirement(db, o.id);
      if (value.id !== o.id) throw new Error("Domain query failed");
    }
    const reports = db
      .prepare("SELECT id,source_snapshot FROM report_versions ORDER BY seq")
      .all() as { id: string; source_snapshot: string }[];
    const reportTexts = reports.map((r) => {
      const report = getReport(db, r.id);
      if (
        !report.edited &&
        renderReport(JSON.parse(r.source_snapshot)) !== report.text
      )
        throw new Error("Report text replay mismatch");
      return { id: r.id, text: report.text };
    });
    await syncDirectory(destination);
    return {
      integrityCheck,
      foreignKeyCheck,
      missingAttachments: [],
      attachmentsVerified: attachments.length,
      objectsVerified: objects.length,
      reportsVerified: reports.length,
      reportText: reportTexts.at(-1)?.text ?? "",
      reportTexts,
    };
  } finally {
    db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  try {
    if (
      args.length !== 4 ||
      args[0] !== "--manifest" ||
      args[2] !== "--scratch"
    )
      throw new Error(
        "Usage: restore:verify --manifest <file> --scratch <empty-directory>",
      );
    console.log(
      JSON.stringify(await restoreVerify(args[1]!, args[3]!), null, 2),
    );
  } catch {
    console.error(
      "Restore verification failed; use an empty isolated directory and check manifest, files and database integrity.",
    );
    process.exitCode = 1;
  }
}

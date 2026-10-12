import Database from "better-sqlite3";
import type { Database as Connection } from "better-sqlite3";
import { constants } from "node:fs";
import { open, readdir, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  safeDirectory,
  storagePath,
  hashFile,
  syncDirectory,
} from "../apps/api/src/attachments/files.js";
import { config } from "../apps/api/src/config.js";
export interface BackupFile {
  path: string;
  sha256: string;
  size: number;
}
export interface BackupManifest {
  createdAt: string;
  schemaVersion: number;
  sqliteVersion: string;
  files: BackupFile[];
}
export interface BackupOptions {
  db: Connection;
  attachmentDirectory: string;
}
export async function emptyDirectory(path: string): Promise<string> {
  const directory = await safeDirectory(path, true);
  if ((await readdir(directory)).length)
    throw new Error("An empty isolated directory is required");
  await chmod(directory, 0o700);
  return directory;
}
export async function copyVerified(
  source: string,
  dest: string,
  expected?: Pick<BackupFile, "sha256" | "size">,
): Promise<Pick<BackupFile, "sha256" | "size">> {
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await input.stat()).isFile()) throw new Error("Not a regular file");
    const output = await open(dest, "wx", 0o600);
    try {
      for await (const chunk of input.createReadStream({ autoClose: false }))
        await output.writeFile(chunk);
      await output.sync();
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
  const actual = await hashFile(dest);
  if (
    expected &&
    (actual.sha256 !== expected.sha256 || actual.size !== expected.size)
  )
    throw new Error("Backup file hash or size mismatch");
  return actual;
}
export async function backup(
  outputDir: string,
  options?: BackupOptions,
): Promise<BackupManifest> {
  const settings = config();
  const own = !options,
    db =
      options?.db ??
      new Database(settings.databasePath, { fileMustExist: true });
  try {
    const directory = await emptyDirectory(outputDir);
    const dbPath = join(directory, "database.sqlite");
    const reserved = await open(dbPath, "wx", 0o600);
    await reserved.close();
    // SQLite's online backup includes committed WAL data. Never copy the live .db file.
    await db.backup(dbPath);
    const snapshot = new Database(dbPath, {
      fileMustExist: true,
    });
    let rows: { storage_key: string; sha256: string; size: number }[],
      schemaVersion: number,
      sqliteVersion: string;
    try {
      // Normalize only the completed snapshot to a self-contained database file.
      // The live connection remains in WAL mode.
      snapshot.pragma("journal_mode = DELETE");
      schemaVersion = (
        snapshot
          .prepare("SELECT max(version) n FROM schema_migrations")
          .get() as { n: number }
      ).n;
      sqliteVersion = (
        snapshot.prepare("SELECT sqlite_version() n").get() as { n: string }
      ).n;
      rows = snapshot
        .prepare("SELECT storage_key,sha256,size FROM attachments ORDER BY seq")
        .all() as typeof rows;
    } finally {
      snapshot.close();
    }
    const files: BackupFile[] = [
      { path: "database.sqlite", ...(await hashFile(dbPath)) },
    ];
    if (rows.length) {
      const images = await safeDirectory(
        options?.attachmentDirectory ?? settings.attachmentDirectory,
      );
      const destination = await safeDirectory(
        join(directory, "attachments"),
        true,
      );
      for (const row of rows) {
        const filename = `attachments/${row.storage_key}`;
        files.push({
          path: filename,
          ...(await copyVerified(
            storagePath(images, row.storage_key),
            storagePath(destination, row.storage_key),
            row,
          )),
        });
      }
      await syncDirectory(destination);
    }
    const manifest: BackupManifest = {
      createdAt: new Date().toISOString(),
      schemaVersion,
      sqliteVersion,
      files,
    };
    const handle = await open(join(directory, "manifest.json"), "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(manifest, null, 2) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(directory);
    return manifest;
  } finally {
    if (own) db.close();
  }
}
if (import.meta.main) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 2 || args[0] !== "--output")
      throw new Error("Usage: backup --output <empty-directory>");
    const manifest = await backup(args[1]!);
    console.log(
      JSON.stringify({ status: "local-backup-complete", ...manifest }),
    );
  } catch {
    console.error(
      "Backup failed; check configuration, permissions, free space and input integrity.",
    );
    process.exitCode = 1;
  }
}

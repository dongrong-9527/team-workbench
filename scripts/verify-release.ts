import { isMain } from "./cli-main.js";
import { readFile, writeFile, mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileHash, verifyRuntime } from "./verify-runtime.js";
export function loadFailures(load: any): string[] {
  const failures: string[] = [];
  for (const [ok, name] of [
    [
      load.durationSec >= 1800 && load.elapsedSec >= 1800,
      "genuine 1800 second duration",
    ],
    [
      load.users === 9 &&
        load.seedObjects >= 10000 &&
        load.seedEvents >= 100000,
      "representative fixture",
    ],
    [
      load.lostWrites === 0 && load.duplicateEvents === 0 && load.errors === 0,
      "write reconciliation/errors",
    ],
    [Number.isFinite(load.p95Ms) && load.p95Ms < 800, "p95"],
    [
      load.oomCount === 0 &&
        load.memoryMax === 2147483648 &&
        load.cpuMax === "200000 100000",
      "resource bounds/OOM",
    ],
    [
      load.minAvailableBytes >= 300 * 1024 * 1024 &&
        load.minDiskFreeFraction >= 0.2,
      "headroom",
    ],
    [
      load.requests > 0 && load.writes > 0 && load.writes < load.requests,
      "mixed actual requests",
    ],
    [
      load.integrity === "ok" &&
        Array.isArray(load.foreignKeys) &&
        load.foreignKeys.length === 0,
      "database integrity",
    ],
  ] as const)
    if (!ok) failures.push(name);
  return failures;
}
interface Checks {
  commit: string;
  nodeVersion: string;
  createdAt: string;
  checks: { name: string; exitCode: number; log: string; sha256: string }[];
}
export async function recordChecks(output: string) {
  if (
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()
  )
    throw Error("Commit the reviewed source before recording release evidence");
  await mkdir(output, { recursive: true });
  const record: Checks = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    nodeVersion: process.versions.node,
    createdAt: new Date().toISOString(),
    checks: [],
  };
  for (const [name, args] of [
    ["unit", ["test", "--", "--maxWorkers=1"]],
    ["typecheck", ["run", "typecheck"]],
    ["build", ["run", "build"]],
    ["e2e", ["run", "e2e"]],
  ] as const) {
    const log = join(resolve(output), name + ".log"),
      file = await open(log, "wx", 0o600);
    let exitCode: number;
    try {
      exitCode = await new Promise<number>((done, reject) => {
        const child = spawn("npm", [...args], {
          stdio: ["ignore", file.fd, file.fd],
        });
        child.on("error", reject);
        child.on("exit", (code) => done(code ?? 1));
      });
    } finally {
      await file.close();
    }
    record.checks.push({ name, exitCode, log, sha256: await fileHash(log) });
    await writeFile(
      join(output, "checks.json"),
      JSON.stringify(record, null, 2),
      { mode: 0o600 },
    );
    if (exitCode !== 0) throw Error(`${name} failed; see retained log`);
  }
  return record;
}
export async function verifyRelease(
  evidenceDirectory: string,
  packageRoot: string,
  loadPath: string,
  drillPath: string,
) {
  const current = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()
  )
    throw Error("Dirty source cannot be certified");
  const checks: Checks = JSON.parse(
    await readFile(join(evidenceDirectory, "checks.json"), "utf8"),
  );
  const manifestPath = join(packageRoot, "release-manifest.json"),
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const failures: string[] = [];
  if (
    checks.commit !== current ||
    manifest.commit !== current ||
    checks.nodeVersion !== process.versions.node
  )
    failures.push("commit/runtime evidence mismatch");
  const fresh = (time: string) =>
    Number.isFinite(Date.parse(time)) &&
    Date.now() - Date.parse(time) >= 0 &&
    Date.now() - Date.parse(time) < 7 * 86400000;
  if (!fresh(checks.createdAt)) failures.push("checks expired");
  for (const name of ["unit", "typecheck", "build", "e2e"]) {
    const c = checks.checks.find((c) => c.name === name);
    if (!c || c.exitCode !== 0 || (await fileHash(c.log)) !== c.sha256)
      failures.push(`${name} evidence missing/failed/hash mismatch`);
  }
  const packageHash = await fileHash(manifestPath);
  for (const [path, kind] of [
    [loadPath, "load"],
    [drillPath, "drill"],
  ] as const) {
    const report = JSON.parse(await readFile(path, "utf8"));
    if (
      (await fileHash(path)) !==
      (await readFile(path + ".sha256", "utf8")).trim()
    )
      failures.push(`${kind} evidence hash mismatch`);
    if (
      report.commit !== current ||
      report.packageManifestSha256 !== packageHash
    )
      failures.push(`${kind} package/commit mismatch`);
    if (!fresh(report.finishedAt ?? report.createdAt))
      failures.push(`${kind} evidence expired`);
    if (kind === "load") {
      failures.push(...loadFailures(report));
      if (
        report.runtime?.node !== manifest.nodeVersion ||
        report.runtime?.arch !== manifest.arch
      )
        failures.push("load runtime mismatch");
    } else if (
      report.ok !== true ||
      report.enospc !== "ENOSPC" ||
      !report.rollback?.newWritesPreserved ||
      report.crash?.lostWrites !== 0 ||
      report.crash?.duplicateEvents !== 0 ||
      report.crash?.acknowledgedObjectsVerified !== report.crash?.acknowledged ||
      report.crash?.acknowledgedEventsVerified !== report.crash?.acknowledged ||
      !(report.crash?.acknowledged > 0) ||
      !(report.crash?.inFlightAtKill > 0) ||
      report.nodeVersion !== manifest.nodeVersion ||
      !report.restoredBusinessWrite
    )
      failures.push("fault/recovery checks failed");
  }
  failures.push(...(await verifyRuntime(manifest, packageRoot)).failures);
  return {
    ok: failures.length === 0,
    failures,
    scope: "cloud candidate only",
    deployment:
      "PENDING target platform, off-host restore and user authorization",
  };
}
if (isMain(import.meta.url)) {
  try {
    if (process.argv[2] === "--record-checks")
      console.log(JSON.stringify(await recordChecks(resolve(process.argv[3]))));
    else {
      const [evidence, pkg, load, drill] = process.argv.slice(2);
      if (!evidence || !pkg || !load || !drill)
        throw Error(
          "Usage: verify:release CHECKS_DIR PACKAGE_DIR LOAD_JSON DRILL_JSON (all required)",
        );
      const result = await verifyRelease(evidence, pkg, load, drill);
      console.log(JSON.stringify(result));
      if (!result.ok) process.exitCode = 1;
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}

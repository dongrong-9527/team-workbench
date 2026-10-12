import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
export interface ReleaseManifest {
  version: string;
  commit?: string;
  buildImage?: string;
  nodeVersion: string;
  arch: string;
  platform: string;
  nodeABI: string;
  glibc: string;
  buildGlibc?: string;
  glibcxx?: string;
  cpu?: string;
  sqliteVersion: string;
  schemaVersion: number;
  sha256: string;
  files: { path: string; sha256: string; size: number }[];
}
export function manifestHash(manifest: ReleaseManifest): string {
  const { sha256: _, ...body } = manifest;
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
export async function fileHash(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest("hex");
}
export async function inventory(
  root: string,
  prefix = "",
): Promise<ReleaseManifest["files"]> {
  const result: ReleaseManifest["files"] = [];
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (path === "release-manifest.json") continue;
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink()) throw Error("Package symlink rejected");
    if (stat.isDirectory()) result.push(...(await inventory(root, path)));
    else if (stat.isFile())
      result.push({
        path,
        sha256: await fileHash(join(root, path)),
        size: stat.size,
      });
    else throw Error("Special package file rejected");
  }
  return result;
}
const atLeast = (actual: string, minimum: string) => {
  const a = actual.split(".").map(Number),
    b = minimum.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
};
export async function verifyRuntime(
  manifest: ReleaseManifest,
  root = process.cwd(),
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];
  if (manifest.arch !== process.arch) failures.push("arch mismatch");
  if (manifest.platform !== "linux" || process.platform !== "linux")
    failures.push("platform mismatch");
  if (
    manifest.nodeVersion !== process.versions.node ||
    manifest.nodeVersion !== "24.21.0"
  )
    failures.push("Node version mismatch");
  if (manifest.nodeABI !== process.versions.modules)
    failures.push("Node ABI mismatch");
  if (manifest.schemaVersion !== 10) failures.push("schema mismatch");
  const report = process.report.getReport() as {
    header: { glibcVersionRuntime?: string };
  };
  if (
    !/^\d+\.\d+$/.test(manifest.glibc) ||
    !report.header.glibcVersionRuntime ||
    !atLeast(report.header.glibcVersionRuntime, manifest.glibc)
  )
    failures.push("glibc mismatch");
  if (manifest.sha256 !== manifestHash(manifest))
    failures.push("manifest checksum mismatch");
  try {
    if (
      !Array.isArray(manifest.files) ||
      !manifest.files.length ||
      manifest.files.some(
        (f) =>
          !/^[-a-zA-Z0-9_@.+/]+$/.test(f.path) ||
          f.path.split("/").some((p) => p === ".." || p === "") ||
          f.path.startsWith("/"),
      )
    )
      throw Error();
    if (
      JSON.stringify(await inventory(root)) !== JSON.stringify(manifest.files)
    )
      failures.push("file inventory/hash mismatch");
  } catch {
    failures.push("invalid package inventory");
  }
  if (manifest.cpu === "sse4_2")
    try {
      if (!(await readFile("/proc/cpuinfo", "utf8")).includes("sse4_2"))
        failures.push("CPU SSE4.2 missing");
    } catch {
      failures.push("CPU validation unavailable");
    }
  if (failures.length) return { ok: false, failures };
  try {
    const require = createRequire(join(resolve(root), "package.json"));
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    try {
      if (
        db.prepare("SELECT sqlite_version() v").get().v !==
        manifest.sqliteVersion
      )
        failures.push("SQLite mismatch");
    } finally {
      db.close();
    }
    const sharp = require("sharp");
    await sharp({
      create: { width: 1, height: 1, channels: 3, background: "#000000" },
    })
      .png()
      .toBuffer();
  } catch {
    failures.push("native load failed");
  }
  return { ok: failures.length === 0, failures };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const root = resolve(process.argv[2] ?? ".");
    const result = await verifyRuntime(
      JSON.parse(await readFile(join(root, "release-manifest.json"), "utf8")),
      root,
    );
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error("Runtime verification failed");
    process.exitCode = 1;
  }
}

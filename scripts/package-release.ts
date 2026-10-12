import {
  cp,
  mkdir,
  readFile,
  writeFile,
  chmod,
  readdir,
  realpath,
  lstat,
} from "node:fs/promises";
import {
  resolve,
  join,
  relative,
  isAbsolute,
  dirname,
  basename,
} from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  inventory,
  manifestHash,
  type ReleaseManifest,
} from "./verify-runtime.js";
export async function packageRelease(
  source: string,
  output: string,
  dependencies: string,
  nodeBinary: string,
  version: string,
): Promise<ReleaseManifest> {
  source = await realpath(resolve(source));
  output = join(await realpath(dirname(resolve(output))), basename(output));
  const rel = relative(source, output);
  if (!rel || (!rel.startsWith("..") && !isAbsolute(rel)))
    throw Error("Output must be outside source");
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(version))
    throw Error("Invalid release version");
  await mkdir(output, { mode: 0o755 });
  await cp(join(source, "apps/api/dist"), join(output, "apps/api/dist"), {
    recursive: true,
    filter: async (p) =>
      (await lstat(p)).isDirectory() ||
      ((p.endsWith(".js") || /\/migrations\/\d{3}_[a-z_]+\.sql$/.test(p)) &&
        !/\/(release-load|release-drill|release-seed|verify-release|package-release)\.js$/.test(
          p,
        )),
  });
  await cp(join(source, "apps/web/dist"), join(output, "public"), {
    recursive: true,
    filter: async (p) =>
      (await lstat(p)).isDirectory() ||
      /\.(html|js|css|png|jpg|jpeg|webp|svg|ico|woff2?)$/.test(p),
  });
  await cp(join(dependencies, "node_modules"), join(output, "node_modules"), {
    recursive: true,
    filter: (p) => {
      const parts = p.split("/");
      if (
        parts.some((x) =>
          [".bin", "test", "tests", "__tests__", ".cache"].includes(x),
        )
      )
        return false;
      if (
        p.includes("/better-sqlite3/build") ||
        p.includes("/better-sqlite3/deps") ||
        p.includes("/better-sqlite3/src")
      )
        return false;
      if (p.endsWith(".node") && p.includes("/better-sqlite3/prebuilds/"))
        return p.endsWith("/linux-" + process.arch + ".node");
      return true;
    },
  });
  await mkdir(join(output, "runtime"), { mode: 0o755 });
  await cp(nodeBinary, join(output, "runtime/node"));
  await cp(join(dependencies, "node-LICENSE"), join(output, "runtime/LICENSE"));
  await chmod(join(output, "runtime/node"), 0o755);
  await writeFile(
    join(output, "package.json"),
    JSON.stringify({
      name: "workbench-release",
      version,
      type: "module",
      private: true,
    }),
  );
  const normalize = async (directory: string): Promise<void> => {
    await chmod(directory, 0o755);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await normalize(path);
      else if (entry.isFile())
        await chmod(
          path,
          path === join(output, "runtime/node") ? 0o755 : 0o644,
        );
      else throw Error("Package must contain regular files");
    }
  };
  await normalize(output);
  const provenance = JSON.parse(
    await readFile(join(dependencies, "runtime-provenance.json"), "utf8"),
  );
  const script = `const D=require('better-sqlite3');const d=new D(':memory:');console.log(JSON.stringify({nodeVersion:process.versions.node,nodeABI:process.versions.modules,arch:process.arch,platform:process.platform,sqliteVersion:d.prepare('select sqlite_version() v').get().v,buildGlibc:process.report.getReport().header.glibcVersionRuntime}));d.close()`;
  const runtime = JSON.parse(
    execFileSync(nodeBinary, ["-e", script], { cwd: output, encoding: "utf8" }),
  );
  // Inspect symbol requirements of every native binary AND the shipped Node executable.
  const files = await inventory(output);
  let glibc = "0.0",
    glibcxx = "0.0";
  const greater = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true }) > 0;
  for (const f of files.filter(
    (f) =>
      f.path.endsWith(".node") ||
      f.path.includes(".so") ||
      f.path === "runtime/node",
  )) {
    const symbols = execFileSync(
      "readelf",
      ["--version-info", join(output, f.path)],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    for (const m of symbols.matchAll(/\bGLIBC_(\d+\.\d+(?:\.\d+)?)/g))
      if (greater(m[1], glibc)) glibc = m[1];
    for (const m of symbols.matchAll(/\bGLIBCXX_(\d+\.\d+(?:\.\d+)?)/g))
      if (greater(m[1], glibcxx)) glibcxx = m[1];
  }
  if (
    ["nodeVersion", "nodeABI", "arch", "platform"].some(
      (k) => provenance[k] !== runtime[k],
    )
  )
    throw Error("Dependency build provenance mismatch");
  const manifest: ReleaseManifest = {
    version,
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).trim(),
    ...runtime,
    buildGlibc: provenance.buildGlibc,
    buildImage: provenance.buildImage,
    glibc,
    glibcxx,
    cpu: runtime.arch === "x64" ? "sse4_2" : "target verification required",
    schemaVersion: 10,
    files,
    sha256: "",
  };
  manifest.sha256 = manifestHash(manifest);
  await writeFile(
    join(output, "release-manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  return manifest;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [source, output, dependencies, nodeBinary, version] =
    process.argv.slice(2);
  if (!source || !output || !dependencies || !nodeBinary || !version)
    throw Error(
      "Usage: package-release SOURCE FRESH_OUTPUT PROD_DEPS NODE_BINARY VERSION",
    );
  console.log(
    JSON.stringify(
      await packageRelease(source, output, dependencies, nodeBinary, version),
    ),
  );
}

import { expect, test } from "vitest";
import {
  verifyRuntime,
  type ReleaseManifest,
} from "../scripts/verify-runtime.js";
const invalid: ReleaseManifest = {
  version: "test",
  nodeVersion: process.versions.node,
  arch: "wrong",
  glibc: "2.28",
  sqliteVersion: "3.53.4",
  schemaVersion: 10,
  sha256: "0".repeat(64),
  nodeABI: process.versions.modules,
  platform: "linux",
  files: [],
};
test("runtime rejects wrong architecture and absent package inventory", async () => {
  const result = await verifyRuntime(invalid);
  expect(result.ok).toBe(false);
  expect(result.failures.join(" ")).toMatch(/arch/);
});
test("runtime rejects wrong ABI, schema and checksum", async () => {
  const result = await verifyRuntime({
    ...invalid,
    arch: process.arch,
    nodeABI: "0",
    schemaVersion: 999,
  });
  expect(result.ok).toBe(false);
  expect(result.failures.join(" ")).toMatch(/ABI/);
  expect(result.failures.join(" ")).toMatch(/schema/);
});
import { packageRelease } from "../scripts/package-release.js";
import { createTestKit } from "./helpers.js";
test("packaging refuses writing into source tree", async () => {
  await expect(
    packageRelease(
      process.cwd(),
      process.cwd() + "/candidate",
      process.cwd(),
      process.execPath,
      "test",
    ),
  ).rejects.toThrow(/outside source/);
});
test("actual SQLITE_FULL rolls back object event and idempotency as one transaction", async () => {
  const f = await createTestKit();
  try {
    await f.api("POST", "/test/mutation", { title: "before" });
    f.db.pragma("wal_checkpoint(TRUNCATE)");
    const pages = f.db.pragma("page_count", { simple: true }) as number;
    f.db.pragma(`max_page_count=${pages}`);
    const before = {
      object: f.db.prepare("SELECT * FROM objects WHERE id='t1'").get(),
      events: f.events().length,
      keys: f.db.prepare("SELECT count(*) n FROM idempotency").get(),
    };
    let code = "";
    try {
      f.db
        .transaction(() => {
          f.db
            .prepare(
              "UPDATE objects SET current=?,version=version+1 WHERE id='t1'",
            )
            .run(
              JSON.stringify({ title: "changed inside failing transaction" }),
            );
          f.db
            .prepare(
              "INSERT INTO idempotency VALUES('admin','full','/full','full','{}')",
            )
            .run();
          f.db
            .prepare(
              "INSERT INTO events(time,action,actor_id,target_kind,target_id,after_snapshot) VALUES(?,'full','admin','task','t1',?)",
            )
            .run(
              new Date().toISOString(),
              JSON.stringify({ large: "x".repeat(2 * 1024 * 1024) }),
            );
        })
        .immediate();
    } catch (e) {
      code = (e as { code: string }).code;
    }
    expect(code).toBe("SQLITE_FULL");
    expect(f.db.prepare("SELECT * FROM objects WHERE id='t1'").get()).toEqual(
      before.object,
    );
    expect(f.events()).toHaveLength(before.events);
    expect(f.db.prepare("SELECT count(*) n FROM idempotency").get()).toEqual(
      before.keys,
    );
  } finally {
    await f.close();
  }
});
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("packaging resolves parent symlinks before rejecting output inside source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "package-boundary-"));
  try {
    const source = join(dir, "source");
    await mkdir(source);
    await symlink(source, join(dir, "alias"));
    await expect(
      packageRelease(
        source,
        join(dir, "alias/candidate"),
        dir,
        process.execPath,
        "test",
      ),
    ).rejects.toThrow(/outside source/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
import { writeReleaseManifest } from "../scripts/package-release.js";
import { stat } from "node:fs/promises";
test("manifest remains readable by the service account after a restrictive build umask", async () => {
  const dir = await mkdtemp(join(tmpdir(), "manifest-mode-"));
  const previous = process.umask(0o077);
  try {
    await writeReleaseManifest(dir, invalid);
    expect((await stat(join(dir, "release-manifest.json"))).mode & 0o444).toBe(
      0o444,
    );
  } finally {
    process.umask(previous);
    await rm(dir, { recursive: true, force: true });
  }
});

import { spawnSync } from "node:child_process";
test("CLI entry detection follows current symlink and stays inert when imported", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cli-current-"));
  try {
    const release = join(dir, "release");
    await mkdir(release);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(release,"probe.mjs"),
      `import {isMain} from ${JSON.stringify(join(process.cwd(),"scripts/cli-main.ts"))};if(isMain(import.meta.url)){console.log('executed');process.exitCode=17;}`);
    await symlink(release, join(dir, "current"));
    const script = join(dir, "current/probe.mjs");
    for (const path of [script,join(release,"probe.mjs")]) {
      const direct = spawnSync(process.execPath, [path], { encoding: "utf8" });
      expect(direct.status, direct.stderr).toBe(17);
      expect(direct.stdout.trim()).toBe("executed");
    }
    const imported = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(script)});console.log('imported')`], { encoding: "utf8" });
    expect(imported.status, imported.stderr).toBe(0);
    expect(imported.stdout.trim()).toBe("imported");
    expect(imported.stderr).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

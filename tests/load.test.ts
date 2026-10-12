import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rehearseRollback, runLoadScenario } from "../scripts/release-load.js";
test("rollback rehearsal preserves acknowledged writes made after old snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rollback-"));
  try {
    expect(await rehearseRollback(dir)).toEqual({ newWritesPreserved: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("load cannot pass without real authenticated fixture and resource measurements", async () => {
  await expect(runLoadScenario("http://127.0.0.1:1", 9, 0)).rejects.toThrow(
    /duration/,
  );
});
import { loadFailures } from "../scripts/verify-release.js";
test("release refuses short, unbounded, missing or failing measured load", () => {
  expect(loadFailures({ durationSec: 1, elapsedSec: 1 })).not.toEqual([]);
  expect(
    loadFailures({
      durationSec: 1800,
      elapsedSec: 1800,
      users: 9,
      seedObjects: 10000,
      seedEvents: 100000,
      lostWrites: 0,
      duplicateEvents: 0,
      p95Ms: 1,
      oomCount: 0,
      errors: 0,
      memoryMax: 2147483648,
      cpuMax: "200000 100000",
      minAvailableBytes: 400 * 1024 * 1024,
      minDiskFreeFraction: 0.3,
      requests: 100,
      writes: 0,
      integrity: "ok",
      foreignKeys: [],
    }),
  ).not.toEqual([]);
});

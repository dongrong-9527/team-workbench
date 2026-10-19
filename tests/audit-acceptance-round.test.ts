import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
let f: TestKit;
beforeEach(async () => { f = await createTestKit(); });
afterEach(async () => { await f.close(); });
async function currentRound() {
  let r = (await f.api<any>("POST", "/api/requirements", { projectId: "p1", title: "Synthetic return scope", source: { description: "Source" }, description: "Behavior", acceptorId: "product", priority: "medium", criteria: [{ id: "a", text: "Behavior", required: true }] }, "product")).body;
  for (const command of [{ action: "refine", description: "Behavior" }, { action: "makeReady", source: { description: "Source", status: "checked", checkedAt: new Date().toISOString() } }, { action: "start", reason: "Execute" }]) {
    const result = await f.api<any>("POST", `/api/requirements/${r.id}/actions`, { ...command, expectedVersion: r.version }, "product");
    expect(result.status).toBe(200); r = result.body;
  }
  expect((await f.api("POST", "/api/tests", { target: { kind: "requirement", id: r.id }, expectedVersion: r.version, revision: r.revision, targetVersion: "build-1", environment: "Synthetic", checks: [{ checkId: "a", result: "pass" }] }, "tester")).status).toBe(200);
  r = (await f.api<any>("GET", `/api/requirements/${r.id}`)).body;
  const submitted = await f.api<any>("POST", `/api/requirements/${r.id}/submit-acceptance`, { expectedVersion: r.version, revision: r.revision, targetVersion: "build-1" }, "product");
  expect(submitted.status).toBe(200);
  return submitted.body;
}
it("read projection proves a submitted current scope after regression without writing domain history", async () => {
  let r = await currentRound();
  const bug = await f.api<any>("POST", "/api/bugs", { projectId: "p1", requirementId: r.id, title: "Synthetic rework", role: "backend", expected: "Pass", actual: "Fail", reproduction: "Check", environment: "Synthetic", severity: "critical", priority: "high" }, "product");
  expect(bug.status).toBe(200);
  const eventsBefore = f.events().length;
  const result = await f.api<any>("GET", `/api/requirements/${r.id}`);
  expect(result.body).toMatchObject({ state: "active", acceptanceRound: { revision: 1, targetVersion: "build-1", submittedSeq: expect.any(Number) } });
  expect(f.events()).toHaveLength(eventsBefore);
  r = result.body;
  const revised = await f.api<any>("POST", `/api/requirements/${r.id}/actions`, { action: "revise", expectedVersion: r.version, kind: "behavior", reason: "Change behavior", impactConfirmed: true, affectedTaskIds: [], affectedCheckIds: ["a"] }, "product");
  expect(revised.status).toBe(200);
  expect((await f.api<any>("GET", `/api/requirements/${r.id}`)).body).not.toHaveProperty("acceptanceRound");
  const stored = JSON.parse((f.db.prepare("SELECT current FROM objects WHERE id=?").get(r.id) as any).current);
  expect(stored).not.toHaveProperty("acceptanceRound");
});

import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
let f: TestKit;
beforeEach(async () => { f = await createTestKit(); });
afterEach(async () => { await f.close(); });
async function command(t: any, action: string, actor: "dev" | "product" | "tester", extra = {}) {
  const result = await f.api<any>("POST", `/api/tasks/${t.id}/actions`, { action, expectedVersion: t.version, ...extra }, actor);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body;
}
async function requirementAction(r: any, extra: any) {
  r = (await f.api<any>("GET", `/api/requirements/${r.id}`)).body;
  const result = await f.api<any>("POST", `/api/requirements/${r.id}/actions`, { expectedVersion: r.version, ...extra }, "product");
  expect(result.status, JSON.stringify(result.body)).toBe(200); return result.body;
}
async function impacted(canonical = true) {
  let r = (await f.api<any>("POST", "/api/requirements", { projectId: "p1", title: "Synthetic revision display", description: "Behavior", source: { description: "Source" }, acceptorId: "product", priority: "medium", criteria: [{ id: "a", text: "Behavior", required: true }] }, "product")).body;
  r = await requirementAction(r, { action: "refine", description: "Behavior" });
  r = await requirementAction(r, { action: "makeReady", source: { description: "Source", status: "checked", checkedAt: new Date().toISOString() } });
  let t = (await f.api<any>("POST", "/api/tasks", { projectId: "p1", requirementId: r.id, title: "Synthetic affected task", kind: "backend", definitionOfDone: "Check behavior", ownerId: "dev", reviewerId: "tester", priority: "medium" }, "product")).body;
  if (canonical) t = await command(t, "defineChecks", "product", { checks: [{ id: "completion", text: "Check behavior", required: true }, { id: "edge", text: "Check boundary", required: true }] });
  t = await command(t, "start", "dev");
  t = await finish(t, 1, canonical);
  r = await requirementAction(r, { action: "revise", kind: "behavior", reason: "New behavior", impactConfirmed: true, affectedTaskIds: [t.id], affectedCheckIds: ["a"] });
  r = await requirementAction(r, { action: "makeReady", source: { description: "Source", status: "checked", checkedAt: new Date().toISOString() } });
  t = (await f.api<any>("GET", `/api/tasks/${t.id}`)).body;
  return { r, t };
}
async function finish(t: any, revision: number, canonical = true) {
  t = await command(t, "submit", "dev", { evidence: { done: "Actual revision work", selfCheck: "Checked", environment: "Synthetic", ...(canonical ? { targetVersion: `build-${revision}` } : {}) } });
  if (!canonical) {
    await command(t, "checkPass", "tester", { evidence: { result: "pass", environment: "Synthetic" } });
    return (await f.api<any>("GET", `/api/tasks/${t.id}`)).body;
  }
  for (const checkId of ["completion", "edge"]) {
    const result = await f.api<any>("POST", "/api/tests", { target: { kind: "task", id: t.id }, expectedVersion: t.version, revision, targetVersion: `build-${revision}`, environment: "Synthetic", checks: [{ checkId, result: "pass" }] }, "tester");
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    t = (await f.api<any>("GET", `/api/tasks/${t.id}`)).body;
  }
  expect(t.state).toBe("done"); return t;
}
it("canonical recheck display agrees across reads and preserves marker, events and raw task", async () => {
  const { r, t } = await impacted();
  const done = await finish(t, 2);
  expect(done.revisionImpact).toMatchObject({ status: "rechecked", needsAttention: false, impactRevision: 2, currentRevision: 2, evidenceRevision: 2, targetVersion: "build-2" });
  const before = f.db.prepare("SELECT current,version FROM objects WHERE id=?").get(t.id);
  const events = f.events().length;
  const row = (await f.api<any>("GET", `/api/tasks?projectId=p1`, {}, "dev")).body.items.find((x: any) => x.id === t.id);
  expect(row.revisionImpact).toEqual(done.revisionImpact);
  expect(row.flags.pendingRevision).toBe(false);
  expect(f.db.prepare("SELECT current,version FROM objects WHERE id=?").get(t.id)).toEqual(before);
  expect(f.events()).toHaveLength(events);
  expect(JSON.parse((before as any).current)).toMatchObject({ pendingChange: { requirementId: r.id, revision: 2 } });
  expect(JSON.parse((before as any).current)).not.toHaveProperty("revisionImpact");
});
it("legacy done remains an accurate completed task with revision recheck evidence to verify", async () => {
  const { t } = await impacted(false);
  const done = await finish(t, 2, false);
  expect(done.revisionImpact).toMatchObject({ status: "evidence_required", needsAttention: true, impactRevision: 2 });
  expect(done.revisionImpact.message).toContain("证据待核对");
});
it("cancelled impact is historical and reopened work is pending until canonical checking", async () => {
  let { t } = await impacted();
  t = await command(t, "cancel", "product", { reason: "Stop work" });
  expect((await f.api<any>("GET", `/api/tasks/${t.id}`)).body.revisionImpact).toMatchObject({ status: "cancelled", needsAttention: false });
  t = await command(t, "reopen", "product", { reason: "Resume work" });
  expect((await f.api<any>("GET", `/api/tasks/${t.id}`)).body.revisionImpact.needsAttention).toBe(true);
  if (t.state === "pending") t = await command(t, "start", "dev");
  expect((await finish(t, 2)).revisionImpact.status).toBe("rechecked");
});
it("unaffected later revision labels historical evidence and a new impact invalidates that display", async () => {
  let { r, t } = await impacted();
  t = await finish(t, 2);
  r = await requirementAction(r, { action: "revise", kind: "behavior", reason: "Unrelated change", impactConfirmed: true, affectedTaskIds: [], affectedCheckIds: [] });
  let view = (await f.api<any>("GET", `/api/tasks/${t.id}`)).body;
  expect(view.revisionImpact).toMatchObject({ status: "rechecked", impactRevision: 2, evidenceRevision: 2, currentRevision: 3 });
  expect(view.revisionImpact.message).toContain("历史证据");
  r = await requirementAction(r, { action: "revise", kind: "behavior", reason: "Affected again", impactConfirmed: true, affectedTaskIds: [t.id], affectedCheckIds: ["a"] });
  view = (await f.api<any>("GET", `/api/tasks/${t.id}`)).body;
  expect(view.revisionImpact).toMatchObject({ status: "pending", needsAttention: true, impactRevision: 4 });
});
it("detached work retains the original impact as history without treating independent tests as resolution", async () => {
  const { r, t } = await impacted();
  await requirementAction(r, { action: "cancel", reason: "Keep independent work", taskDisposition: [{ taskId: t.id, disposition: "detach" }] });
  const view = (await f.api<any>("GET", `/api/tasks/${t.id}`)).body;
  expect(view.requirementId).toBeNull();
  expect(view.pendingChange.requirementId).toBe(r.id);
  expect(view.revisionImpact).toMatchObject({ status: "detached", needsAttention: false });
});

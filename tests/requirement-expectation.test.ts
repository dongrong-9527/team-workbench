import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
import { migrate } from "../apps/api/src/db/migrate.js";

let f: TestKit;
beforeEach(async () => { f = await createTestKit(); });
afterEach(async () => { await f.close(); });
const input = {
  projectId: "p1", title: "Synthetic expected completion", source: { description: "Confirmed synthetic background" },
  description: "Existing workflow", acceptorId: "product", criteria: [{ id: "stable-c1", text: "Existing criterion", required: true }], priority: "medium",
};
const create = async (extra: Record<string, unknown> = {}, key?: string) =>
  f.api<any>("POST", "/api/requirements", { ...input, ...extra }, "product", key);
const change = async (r: any, extra: Record<string, unknown>, key?: string) =>
  f.api<any>("POST", `/api/requirements/${r.id}/actions`, { expectedVersion: r.version, ...extra }, "product", key);

it("persists optional prose unchanged in reads, lists, events and immutable scope", async () => {
  const expectedCompletion = "  本周五前\n下个版本 👩🏽‍💻 <img src=x onerror=alert(1)>  ";
  const result = await create({ expectedCompletion });
  expect(result.status).toBe(200);
  const r = result.body;
  expect(r).toMatchObject({ expectedCompletion, state: "draft", version: 1, revision: 1 });
  expect((await f.api<any>("GET", `/api/requirements/${r.id}`, {}, "dev")).body.expectedCompletion).toBe(expectedCompletion);
  const list = await f.api<any>("GET", "/api/requirements?projectId=p1", {}, "dev");
  expect(list.body.items.find((o: any) => o.id === r.id).expectedCompletion).toBe(expectedCompletion);
  expect(f.events("requirement", r.id)[0].after?.expectedCompletion).toBe(expectedCompletion);
  const scopes = await f.api<any>("GET", `/api/requirements/${r.id}/revision-history`, {}, "tester");
  expect(scopes.body.items[0].snapshot.expectedCompletion).toBe(expectedCompletion);
});

it("keeps old records and history unchanged on idempotent migrate and omitted client edits", async () => {
  const { body: old, status } = await create();
  expect(status).toBe(200);
  const before = f.db.prepare("SELECT current FROM objects WHERE id=?").get(old.id);
  const migrations = f.db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
  const originalScope = f.db.prepare("SELECT snapshot FROM requirement_scopes WHERE requirement_id=?").get(old.id);
  migrate(f.db); migrate(f.db);
  expect(f.db.prepare("SELECT * FROM schema_migrations ORDER BY version").all()).toEqual(migrations);
  expect(f.db.prepare("SELECT current FROM objects WHERE id=?").get(old.id)).toEqual(before);
  const updated = await change(old, { action: "refine", expectedCompletion: "下个版本" });
  expect(updated.status).toBe(200);
  expect(updated.body.expectedCompletion).toBe("下个版本");
  const omitted = await change(updated.body, { action: "refine", description: "Old client changes prose only" });
  expect(omitted.status).toBe(200);
  expect(omitted.body.expectedCompletion).toBe("下个版本");
  expect(f.db.prepare("SELECT snapshot FROM requirement_scopes WHERE requirement_id=? AND version=1").get(old.id)).toEqual(originalScope);
});

it("supports metadata in editorial and behavior revisions without relaxing editorial guards", async () => {
  let r = (await create()).body;
  const editorial = await change(r, { action: "revise", kind: "editorial", reason: "Metadata wording only", expectedCompletion: "本周五前" });
  expect(editorial.status).toBe(200);
  expect(editorial.body).toMatchObject({ expectedCompletion: "本周五前", revision: r.revision, version: r.version + 1 });
  r = editorial.body;
  expect((await change(r, { action: "revise", kind: "editorial", reason: "Cannot change priority", expectedCompletion: "晚些时候", priority: "high" })).status).toBe(422);
  const behavior = await change(r, { action: "revise", kind: "behavior", reason: "Explicit existing impact confirmation", affectedTaskIds: [], affectedCheckIds: [], impactConfirmed: true, expectedCompletion: "下个版本" });
  expect(behavior.status).toBe(200);
  expect(behavior.body).toMatchObject({ expectedCompletion: "下个版本", revision: r.revision + 1 });
});

it("accepts empty and exact Unicode bounds but rejects over-bound prose, types and unsafe controls", async () => {
  for (const expectedCompletion of ["", "  \n\t ", "😀".repeat(1000)]) {
    const result = await create({ expectedCompletion });
    expect(result.status).toBe(200);
    expect(result.body.expectedCompletion).toBe(expectedCompletion);
  }
  for (const expectedCompletion of ["x".repeat(2001), "😀".repeat(1000) + "x", "bad\u0000value", "bad\u0085value", "\ud800", null, 42, {}, []])
    expect((await create({ expectedCompletion })).status).toBe(400);
});

it("retains normal version conflicts, stable replay and immutable audit for expectation changes", async () => {
  const first = await create({ expectedCompletion: "本周五前" }, "expected-create-command");
  expect(first.status).toBe(200);
  expect(await create({ expectedCompletion: "本周五前" }, "expected-create-command")).toEqual(first);
  expect((await create({ expectedCompletion: "下个版本" }, "expected-create-command")).status).toBe(409);
  const cmd = { action: "revise", kind: "editorial", reason: "Synthetic metadata correction", expectedCompletion: "" };
  const update = await change(first.body, cmd, "expected-change-command");
  expect(update.status).toBe(200);
  expect(update.body.expectedCompletion).toBe("");
  expect(await change(first.body, cmd, "expected-change-command")).toEqual(update);
  const stale = await change(first.body, { ...cmd, expectedCompletion: "Later" });
  expect(stale.status).toBe(409);
  expect(stale.body.latest.expectedCompletion).toBe("");
  expect(f.events("requirement", first.body.id)).toHaveLength(2);
});

it("does not grant metadata writes to readers or archived projects", async () => {
  const result = await create({ expectedCompletion: "本周五前" });
  expect(result.status).toBe(200);
  const r = result.body;
  expect((await f.api("POST", `/api/requirements/${r.id}/actions`, { action: "refine", expectedVersion: r.version, expectedCompletion: "明天" }, "dev")).status).toBe(403);
  const project = await f.api<any>("GET", "/api/projects/p1", {}, "admin");
  expect((await f.api("POST", "/api/projects/p1/archive", { expectedVersion: project.body.version }, "admin")).status).toBe(200);
  expect((await change(r, { action: "refine", expectedCompletion: "明天" })).status).toBe(409);
  expect((await f.api<any>("GET", `/api/requirements/${r.id}`, {}, "dev")).body.expectedCompletion).toBe("本周五前");
  expect(f.events("requirement", r.id)).toHaveLength(1);
});

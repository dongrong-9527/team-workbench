import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";

let f: TestKit;
beforeEach(async () => { f = await createTestKit(); });
afterEach(async () => { await f.close(); });
async function task(title = "Synthetic completed contribution") {
  const result = await f.api<any>("POST", "/api/tasks", { projectId: "p1", title, kind: "backend",
    definitionOfDone: "Actually check", priority: "medium", ownerId: "dev", reviewerId: "tester" }, "product");
  expect(result.status).toBe(200);
  return result.body;
}
async function act(t: any, action: string, actor: "dev" | "tester", extra = {}) {
  const result = await f.api<any>("POST", `/api/tasks/${t.id}/actions`, { action, expectedVersion: t.version, ...extra }, actor);
  expect(result.status).toBe(200);
  return result.body;
}

it("progress selection includes completed related work without changing the outstanding queue", async () => {
  let t = await task();
  t = await act(t, "start", "dev");
  t = await act(t, "submit", "dev", { evidence: { done: "Actual contribution", selfCheck: "Checked", environment: "Synthetic" } });
  t = await act(t, "checkPass", "tester", { evidence: { result: "pass", environment: "Synthetic" } });
  expect(t.state).toBe("done");
  const outstanding = await f.api<any>("GET", "/api/my-work", {}, "dev");
  expect(outstanding.body.items.some((x: any) => x.id === t.id)).toBe(false);
  const progress = await f.api<any>("GET", "/api/my-progress?q=contribution&limit=1", {}, "dev");
  expect(progress.status).toBe(200);
  expect(progress.body.items).toEqual([expect.objectContaining({ id: t.id, state: "done", responsibility: "owner", flags: expect.objectContaining({ missingUpdate: true }) })]);
  expect((await f.api<any>("GET", "/api/my-progress", {}, "dev2")).body.items).toEqual([]);
  const p = (await f.api<any>("GET", "/api/projects/p1")).body;
  await f.api("POST", "/api/projects/p1/archive", { expectedVersion: p.version }, "admin");
  expect((await f.api<any>("GET", "/api/my-progress", {}, "dev")).body.items).toEqual([]);
});

it("progress reads reject invalid filters and prevent cursor reuse across scopes and people", async () => {
  await task("Synthetic one");
  await task("Synthetic two");
  const page = await f.api<any>("GET", "/api/my-progress?limit=1", {}, "dev");
  expect(page.status).toBe(200);
  expect(page.body.nextCursor).toBeTypeOf("string");
  const cursor = encodeURIComponent(page.body.nextCursor);
  for (const path of [`/api/my-work?limit=1&cursor=${cursor}`, `/api/my-progress?q=other&limit=1&cursor=${cursor}`, "/api/my-progress?unknown=1", "/api/my-progress?limit=101"])
    expect((await f.api("GET", path, {}, "dev")).status).toBe(400);
  expect((await f.api("GET", `/api/my-progress?limit=1&cursor=${cursor}`, {}, "tester")).status).toBe(400);
  expect((await f.api("GET", "/api/my-progress", {}, "anonymous")).status).toBe(401);
});

it("revoked owner scope is visible to product and the matching lead while execution stays forbidden", async () => {
  let t = await task();
  t = await act(t, "start", "dev");
  let p = (await f.api<any>("GET", "/api/projects/p1")).body;
  p = (await f.api<any>("PUT", "/api/projects/p1/roles", { memberId: "dev2", roles: ["frontend"], leads: ["frontend"], expectedVersion: p.version }, "admin")).body;
  const change = await f.api<any>("PUT", "/api/projects/p1/roles", { memberId: "dev", roles: [], leads: [], expectedVersion: p.version }, "admin");
  expect(change.status).toBe(200);
  const row = (await f.api<any>("GET", `/api/tasks?projectId=p1&ownerId=dev`, {}, "product")).body.items[0];
  expect(row.flags).toMatchObject({ inactiveOwner: false, invalidOwner: true });
  expect((await f.api<any>("GET", "/api/my-work", {}, "product")).body.items.map((x: any) => x.id)).toContain(t.id);
  expect((await f.api<any>("GET", "/api/my-work", {}, "dev2")).body.items.map((x: any) => x.id)).not.toContain(t.id);
  const denied = await f.api("POST", `/api/tasks/${t.id}/actions`, { action: "submit", expectedVersion: t.version,
    evidence: { done: "Cannot execute", selfCheck: "No role", environment: "Synthetic" } }, "dev");
  expect(denied.status).toBe(403);
});

it("safe directory distinguishes a pending activation without returning login or credential material", async () => {
  const created = await f.api<any>("POST", "/api/members", { login: "synthetic-pending", displayName: "Synthetic same name" }, "admin");
  expect(created.status).toBe(200);
  const directory = await f.api<any>("GET", "/api/members", {}, "dev");
  const pending = directory.body.items.find((m: any) => m.displayName === "Synthetic same name");
  expect(pending).toMatchObject({ active: true, activated: false });
  expect(pending.id).toBeTypeOf("string");
  expect(Object.keys(pending).sort()).toEqual(["active", "activated", "displayName", "id", "isAdmin", "version"].sort());
  expect(JSON.stringify(directory.body)).not.toMatch(/password|digest|ticket|token|login/);
});

it("an unassigned draft acceptor is not mislabeled as a revoked owner", async () => {
  const r = await f.api<any>("POST", "/api/requirements", { projectId: "p1", title: "Synthetic unassigned draft", source: { description: "To refine" }, description: "", criteria: [], priority: "medium" }, "product");
  expect(r.status).toBe(200);
  const row = (await f.api<any>("GET", "/api/requirements", {}, "dev")).body.items.find((x: any) => x.id === r.body.id);
  expect(row.flags.invalidOwner).toBe(false);
});

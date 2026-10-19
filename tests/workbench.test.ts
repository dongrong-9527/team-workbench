import { beforeEach, afterEach, it, expect } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
let f: TestKit;
beforeEach(async () => {
  f = await createTestKit();
});
afterEach(async () => {
  await f.close();
});
it("task_10 safe authenticated directory and bounded overview", async () => {
  const r = await f.api<any>("GET", "/api/members?limit=2");
  expect(r.status).toBe(200);
  expect(r.body.items).toHaveLength(2);
  expect(r.body.nextCursor).toBeTypeOf("string");
  expect(JSON.stringify(r.body)).not.toMatch(/password|digest|token|login/);
  expect((await f.api("GET", "/api/my-work", {}, "anonymous")).status).toBe(
    401,
  );
  expect(
    (await f.api<any>("GET", "/api/projects/p1/overview")).body.project.name,
  ).toBe("Project One");
});
it("task_10 filtered pagination is bounded and rejects malformed or foreign-query cursor", async () => {
  for (let i = 0; i < 23; i++)
    expect(
      (
        await f.api(
          "POST",
          "/api/tasks",
          {
            projectId: "p1",
            title: `Example ${i}`,
            kind: "backend",
            definitionOfDone: "Verified",
            priority: "medium",
          },
          "product",
        )
      ).status,
    ).toBe(200);
  const first = await f.api<any>("GET", "/api/tasks?projectId=p1&limit=2");
  expect(first.body.items).toHaveLength(2);
  const next = await f.api<any>(
    "GET",
    `/api/tasks?projectId=p1&limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
  );
  expect(next.body.items).toHaveLength(2);
  expect(next.body.items[0].id).not.toBe(first.body.items[0].id);
  expect(
    (
      await f.api(
        "GET",
        `/api/tasks?projectId=p2&limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      )
    ).status,
  ).toBe(400);
  for (const q of ["limit=101", "blocked=maybe", "surprise=1", "limit=-1"])
    expect((await f.api("GET", `/api/my-work?${q}`)).status).toBe(400);
  expect((await f.api<any>("GET", "/api/tasks")).body.items).toHaveLength(20);
  expect(
    (await f.api<any>("GET", "/api/search?q=Example&limit=2")).body.items,
  ).toHaveLength(2);
});
it("task_10 cursor freezes creation traversal, aliases cannot silently change kind, and invalid filter states reject", async () => {
  const create = () =>
    f.api<any>(
      "POST",
      "/api/tasks",
      {
        projectId: "p1",
        title: "Bounded item",
        kind: "backend",
        definitionOfDone: "done",
        priority: "medium",
      },
      "product",
    );
  const a = await create(),
    b = await create();
  const first = await f.api<any>("GET", "/api/tasks?limit=1");
  const later = await create();
  const second = await f.api<any>(
    "GET",
    "/api/tasks?limit=1&cursor=" + encodeURIComponent(first.body.nextCursor),
  );
  expect(second.body.items.map((x: any) => x.id)).toEqual([b.body.id]);
  expect(second.body.nextCursor).toBeNull();
  expect((await f.api("GET", "/api/my-work?state=made_up")).status).toBe(400);
  expect((await f.api("GET", "/api/tasks?kind=bug")).status).toBe(400);
  expect(later.body.id).not.toBe(a.body.id);
});
it("task_10 ownership, reviewer and unassigned responsibility are explicit and inactive auth cannot read", async () => {
  const t = await f.api<any>(
    "POST",
    "/api/tasks",
    {
      projectId: "p1",
      title: "Review item",
      kind: "backend",
      definitionOfDone: "done",
      priority: "high",
      ownerId: "dev",
      reviewerId: "tester",
    },
    "product",
  );
  const mine = await f.api<any>("GET", "/api/my-work", {}, "dev");
  expect(mine.body.items[0]).toMatchObject({
    id: t.body.id,
    responsibility: "owner",
    flags: { missingUpdate: true },
  });
  expect(
    (await f.api<any>("GET", "/api/my-work", {}, "tester")).body.items[0]
      .responsibility,
  ).toBe("reviewer");
  expect(
    (await f.api("GET", "/api/projects/p2/overview", {}, "dev")).status,
  ).toBe(200);
  f.db
    .prepare("UPDATE members SET active=0,version=version+1 WHERE id='dev'")
    .run();
  for (const path of [
    "/api/members",
    "/api/my-work",
    "/api/search?q=Review",
    "/api/projects/p1/overview",
    "/api/tasks",
  ])
    expect((await f.api("GET", path, {}, "dev")).status).toBe(401);
});
it("task_10 directory role reads are safe and read failures never become successful empty lists", async () => {
  const d = await f.api<any>("GET", "/api/members?projectId=p1");
  expect(d.body.items.find((m: any) => m.id === "dev").roles).toEqual([
    { role: "backend", lead: 0 },
  ]);
  f.db.exec("ALTER TABLE updates RENAME TO unavailable_updates");
  const t = await f.api<any>(
    "POST",
    "/api/tasks",
    {
      projectId: "p1",
      title: "Read failure target",
      kind: "backend",
      definitionOfDone: "done",
      priority: "medium",
    },
    "product",
  );
  expect(t.status).toBe(200);
  try {
    const r = await f.api("GET", "/api/tasks");
    expect(r.status).toBe(500);
    expect(r.body).not.toHaveProperty("items");
  } finally {
    f.db.exec("ALTER TABLE unavailable_updates RENAME TO updates");
  }
});
it("task_10 evidence and administrative histories expose bounded pages without credentials", async () => {
  const t = await f.api<any>(
    "POST",
    "/api/tasks",
    {
      projectId: "p1",
      title: "Evidence reader",
      kind: "backend",
      definitionOfDone: "done",
      priority: "medium",
    },
    "product",
  );
  const tests = await f.api<any>(
    "GET",
    `/api/tests?kind=task&id=${t.body.id}&limit=1`,
  );
  expect(tests.body).toEqual({
    items: [],
    cutoffSeq: expect.any(Number),
    nextAfterSeq: null,
  });
  expect((await f.api("GET", "/api/tests?unknown=yes")).status).toBe(400);
  await f.api(
    "POST",
    "/api/members/dev/rename",
    { expectedVersion: 1, displayName: "Safe Name" },
    "admin",
  );
  const history = await f.api<any>(
    "GET",
    "/api/audit/member/dev?limit=1",
    {},
    "dev",
  );
  expect(history.status).toBe(200);
  expect(history.body.items).toHaveLength(1);
  expect(history.body.items[0].after.displayName).toBe("Safe Name");
  expect(JSON.stringify(history.body)).not.toMatch(/password|token|digest/);
  expect(
    (await f.api("GET", "/api/audit/member/dev", {}, "anonymous")).status,
  ).toBe(401);
});
it("task_10 revision scope history pages preserve each saved scope and reject unknown queries", async () => {
  const r = await f.api<any>(
    "POST",
    "/api/requirements",
    {
      projectId: "p1",
      title: "Revision history",
      source: { description: "Synthetic" },
      description: "Details",
      criteria: [{ id: "c1", text: "Check", required: true }],
      priority: "medium",
      acceptorId: "product",
    },
    "product",
  );
  await f.api(
    "POST",
    `/api/requirements/${r.body.id}/actions`,
    { action: "refine", expectedVersion: 1, description: "Updated details" },
    "product",
  );
  const one = await f.api<any>(
    "GET",
    `/api/requirements/${r.body.id}/revision-history?limit=1`,
  );
  expect(one.status).toBe(200);
  expect(one.body.items).toHaveLength(1);
  expect(one.body.items[0].snapshot.description).toBe("Details");
  expect(one.body.nextAfterSeq).toBe(1);
  const next = await f.api<any>(
    "GET",
    `/api/requirements/${r.body.id}/revision-history?limit=1&afterSeq=1&cutoffSeq=${one.body.cutoffSeq}`,
  );
  expect(next.body.items[0].snapshot.description).toBe("Updated details");
  expect(
    (await f.api("GET", `/api/requirements/${r.body.id}/revisions?unknown=1`))
      .status,
  ).toBe(400);
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
let f: TestKit;
beforeEach(async () => {
  f = await createTestKit();
});
afterEach(async () => {
  vi.useRealTimers();
  await f.close();
});
it("revision scopes retain their actor name across later same-time renames without rewriting rows", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T02:00:00Z"));
  const created = await f.api<any>(
    "POST",
    "/api/requirements",
    {
      projectId: "p1",
      title: "历史范围",
      source: { description: "来源" },
      description: "说明",
      criteria: [{ id: "c", text: "条目" }],
      priority: "medium",
      acceptorId: "product",
    },
    "product",
  );
  expect(created.status).toBe(200);
  const id = created.body.id;
  expect(
    (
      await f.api(
        "POST",
        `/api/requirements/${id}/actions`,
        { action: "refine", expectedVersion: 1, description: "修订内容" },
        "product",
      )
    ).status,
  ).toBe(200);
  const before = f.db.prepare("SELECT * FROM requirement_scopes").all();
  const events = f.events("requirement", id);
  expect(
    (
      await f.api(
        "POST",
        "/api/members/product/rename",
        { expectedVersion: 1, displayName: "后来名称" },
        "admin",
      )
    ).status,
  ).toBe(200);
  const rename = f.events("member", "product").at(-1)!;
  expect(rename.time).toBe(events.at(-1)!.time);
  expect(rename.seq).toBeGreaterThan(events.at(-1)!.seq);
  const history = await f.api<any>(
    "GET",
    `/api/requirements/${id}/revision-history`,
  );
  expect(history.status).toBe(200);
  expect(history.body.items.map((r: any) => r.actorName)).toEqual([
    "product",
    "product",
  ]);
  expect(f.db.prepare("SELECT * FROM requirement_scopes").all()).toEqual(
    before,
  );
  expect(f.events("requirement", id)).toEqual(events);
});
it("scope history without immutable name evidence uses a stable actor ID", async () => {
  f.seed("failedTest");
  expect(
    (
      await f.api(
        "POST",
        "/api/members/admin/rename",
        { expectedVersion: 1, displayName: "当前管理员名" },
        "admin",
      )
    ).status,
  ).toBe(200);
  const history = await f.api<any>(
    "GET",
    "/api/requirements/r1/revision-history",
  );
  expect(history.body.items[0].actorName).toBe("admin");
});
it("unrelated later work-update versions cannot supply a missing scope actor name", async () => {
  f.seed("failedTest");
  expect(
    (
      await f.api(
        "POST",
        "/api/members/admin/rename",
        { expectedVersion: 1, displayName: "后来名称" },
        "admin",
      )
    ).status,
  ).toBe(200);
  const update = await f.api(
    "POST",
    "/api/updates",
    {
      target: { kind: "requirement", id: "r1" },
      workDate: "2026-10-11",
      done: "管理说明",
      contributionType: "coordination",
    },
    "admin",
  );
  expect(update.status).toBe(200);
  const history = await f.api<any>(
    "GET",
    "/api/requirements/r1/revision-history",
  );
  expect(history.body.items[0].actorName).toBe("admin");
});

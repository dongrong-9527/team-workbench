import { beforeEach, afterEach, it, expect } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
let f: TestKit;
beforeEach(async () => {
  f = await createTestKit();
});
afterEach(async () => {
  await f.close();
});
it("task_03 reads across projects and denies ordinary member management", async () => {
  expect((await f.api("GET", "/api/projects/p2", {}, "dev")).status).toBe(200);
  expect(
    (
      await f.api(
        "PUT",
        "/api/projects/p2/roles",
        { memberId: "dev", roles: ["backend"], leads: [], expectedVersion: 1 },
        "dev",
      )
    ).status,
  ).toBe(403);
});
it("task_03 archives with immutable versioned events and restores", async () => {
  expect(
    (
      await f.api(
        "POST",
        "/api/projects/p1/archive",
        { expectedVersion: 1 },
        "admin",
        "archive",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        "/api/projects/p1/archive",
        { expectedVersion: 1 },
        "admin",
        "archive",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api("PUT", "/api/projects/p1/roles", {
        memberId: "dev",
        roles: [],
        leads: [],
        expectedVersion: 2,
      })
    ).status,
  ).toBe(409);
  expect(
    (await f.api("POST", "/api/projects/p1/restore", { expectedVersion: 2 }))
      .status,
  ).toBe(200);
  expect(f.events(undefined, "p1")).toHaveLength(2);
});
import { createPolicy } from "../apps/api/src/access/policy.js";
import { migrate } from "../apps/api/src/db/migrate.js";
import { readFileSync } from "node:fs";
import { openDb } from "../apps/api/src/db/open.js";
it("task_03 enforces functional role, same-role lead, ownership and multiple roles", () => {
  const policy = createPolicy(f.db);
  const target = { kind: "task" as const, id: "work" };
  f.db.prepare("INSERT INTO objects VALUES (?,?,?,?,?)").run(
    "work",
    "task",
    "p1",
    1,
    JSON.stringify({
      role: "backend",
      ownerId: "dev",
      authorId: "dev",
      participantIds: ["dev"],
      creatorId: "dev",
    }),
  );
  for (const action of ["claim", "execute", "writeUpdate"] as const)
    expect(() => policy.authorize("dev", action, target)).not.toThrow();
  for (const action of ["assign", "refine", "test", "accept"] as const)
    expect(() => policy.authorize("dev", action, target)).toThrow(
      "Permission denied",
    );
  expect(() => policy.authorize("dev2", "execute", target)).toThrow();
  expect(() => policy.authorize("dev2", "writeUpdate", target)).toThrow();
  f.db.prepare("UPDATE roles SET lead=1 WHERE member_id='dev2'").run();
  expect(() => policy.authorize("dev2", "assign", target)).toThrow();
  f.db.prepare("UPDATE roles SET lead=1 WHERE member_id='dev'").run();
  expect(() => policy.authorize("dev", "assign", target)).not.toThrow();
  expect(() => policy.authorize("product", "assign", target)).not.toThrow();
  f.db
    .prepare(
      "INSERT INTO roles (project_id,member_id,role) VALUES ('p1','dev','test')",
    )
    .run();
  expect(() => policy.authorize("dev", "test", target)).not.toThrow();
  expect(policy.canWrite("dev", "p2", "backend")).toBe(false);
  f.db.prepare("DELETE FROM roles WHERE member_id='admin'").run();
  expect(() => policy.authorize("admin", "execute", target)).toThrow();
  expect(() => policy.authorize("admin", "accept", target)).toThrow();
  expect(() =>
    policy.authorize("admin", "read", { kind: "project", id: "p2" }),
  ).not.toThrow();
  expect(() =>
    policy.authorize("admin", "manageReport", { kind: "project", id: "p2" }),
  ).not.toThrow();
  expect(() => policy.authorize("dev2", "manageReport", target)).toThrow();
  f.db.prepare("UPDATE members SET active=0 WHERE id='dev'").run();
  expect(policy.canWrite("dev", "p1", "backend")).toBe(false);
  expect(() => policy.authorize("dev", "read", target)).toThrow();
});
it("task_03 restricts acceptance to designated product and refuses archived business writes", async () => {
  f.db
    .prepare("INSERT INTO objects VALUES (?,?,?,?,?)")
    .run(
      "req",
      "requirement",
      "p1",
      1,
      JSON.stringify({ acceptorId: "product" }),
    );
  const p = createPolicy(f.db),
    ref = { kind: "requirement" as const, id: "req" };
  expect(() => p.authorize("product", "accept", ref)).not.toThrow();
  expect(() => p.authorize("admin", "accept", ref)).toThrow();
  await f.api("POST", "/api/projects/p1/archive", { expectedVersion: 1 });
  for (const action of [
    "refine",
    "assign",
    "claim",
    "execute",
    "test",
    "accept",
    "writeUpdate",
    "manageReport",
  ] as const)
    expect(() => p.authorize("product", action, ref)).toThrow("ARCHIVED");
  expect(p.canWrite("product", "p1", "product")).toBe(false);
  expect(() => p.authorize("product", "read", ref)).not.toThrow();
  await f.api("POST", "/api/projects/p1/restore", { expectedVersion: 2 });
  expect(p.canWrite("product", "p1", "product")).toBe(true);
});
it("task_03 validates roles versions and payloads and rechecks admin before replay", async () => {
  const b = {
    memberId: "dev",
    roles: ["backend", "test"],
    leads: ["backend"],
    expectedVersion: 1,
  };
  expect(
    (await f.api("PUT", "/api/projects/p1/roles", b, "admin", "roles")).status,
  ).toBe(200);
  expect(
    (await f.api("PUT", "/api/projects/p1/roles", b, "admin", "roles")).status,
  ).toBe(200);
  expect(f.events("project", "p1")).toHaveLength(1);
  expect(
    (
      await f.api("PUT", "/api/projects/p1/roles", {
        ...b,
        leads: ["frontend"],
        expectedVersion: 2,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await f.api("PUT", "/api/projects/p1/roles", {
        ...b,
        actorId: "dev",
        expectedVersion: 2,
      })
    ).status,
  ).toBe(400);
  expect((await f.api("PUT", "/api/projects/p1/roles", b)).status).toBe(409);
  f.db.prepare("UPDATE members SET is_admin=0 WHERE id='admin'").run();
  expect(
    (await f.api("PUT", "/api/projects/p1/roles", b, "admin", "roles")).status,
  ).toBe(403);
});
it("task_03 creates safe snapshots and rolls current state back when event fails", async () => {
  expect(
    (
      await f.api(
        "POST",
        "/api/projects",
        { name: "Sample", description: "Example" },
        "dev",
      )
    ).status,
  ).toBe(403);
  const made = await f.api<{ id: string }>("POST", "/api/projects", {
    name: "Sample",
    description: "Example",
  });
  expect(made.status).toBe(200);
  expect(f.events("project", made.body.id)[0]?.after).toMatchObject({
    name: "Sample",
    version: 1,
    actorName: "admin",
  });
  await f.failNextEvent();
  expect(
    (await f.api("POST", "/api/projects/p1/archive", { expectedVersion: 1 }))
      .status,
  ).toBe(500);
  expect(
    f.db.prepare("SELECT archived,version FROM projects WHERE id='p1'").get(),
  ).toEqual({ archived: 0, version: 1 });
});
it("task_03 upgrades populated schema preserving event seq and append-only constraints", () => {
  const db = openDb(":memory:");
  try {
    db.exec(readFileSync("apps/api/migrations/001_core.sql", "utf8"));
    db.exec(readFileSync("apps/api/migrations/002_auth.sql", "utf8"));
    db.exec(
      "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES (1,'old'),(2,'old'); INSERT INTO members(id,name) VALUES ('a','Historic'); INSERT INTO projects(id,name) VALUES ('p','Historic project'); INSERT INTO roles VALUES ('p','a','backend'); INSERT INTO events(time,action,actor_id,target_kind,target_id,after_snapshot) VALUES ('2026-10-01T00:00:00.000Z','created','a','member','a','{\"name\":\"Historic\"}');",
    );
    const old = db.prepare("SELECT * FROM events").all();
    migrate(db);
    migrate(db);
    expect(db.prepare("SELECT * FROM events").all()).toEqual(old);
    expect(db.prepare("SELECT lead FROM roles").get()).toEqual({ lead: 0 });
    expect(() => db.exec("DELETE FROM events")).toThrow("append-only");
    expect(() => db.exec("UPDATE events SET action='changed'")).toThrow(
      "append-only",
    );
  } finally {
    db.close();
  }
});
it("task_03 forbids execution and claiming of requirements despite owner-shaped fields", () => {
  f.db
    .prepare("INSERT INTO objects VALUES (?,?,?,?,?)")
    .run(
      "scope",
      "requirement",
      "p1",
      1,
      JSON.stringify({ role: "backend", ownerId: "dev" }),
    );
  const p = createPolicy(f.db);
  for (const a of ["claim", "execute"] as const)
    expect(() =>
      p.authorize("dev", a, { kind: "requirement", id: "scope" }),
    ).toThrow("Permission denied");
});
import { mutate } from "../apps/api/src/db/mutate.js";
it("task_03 rechecks revoked role and archive before replay and isolates policy databases", async () => {
  f.db
    .prepare("INSERT INTO objects VALUES (?,?,?,?,?)")
    .run(
      "owned",
      "task",
      "p1",
      1,
      JSON.stringify({ role: "backend", ownerId: "dev" }),
    );
  const p = createPolicy(f.db),
    target = { kind: "task" as const, id: "owned" };
  const ctx = {
    actorId: "dev",
    requestId: "business",
    route: "/trusted-test",
    bodyHash: "fixed",
    authorize: () => p.authorize("dev", "execute", target),
  };
  expect(mutate(f.db, ctx, () => ({ ok: true }))).toEqual({ ok: true });
  f.db.prepare("DELETE FROM roles WHERE member_id='dev'").run();
  expect(() => mutate(f.db, ctx, () => ({ ok: true }))).toThrow(
    "Permission denied",
  );
  f.db
    .prepare(
      "INSERT INTO roles(project_id,member_id,role) VALUES ('p1','dev','backend')",
    )
    .run();
  await f.api("POST", "/api/projects/p1/archive", { expectedVersion: 1 });
  expect(() => mutate(f.db, ctx, () => ({ ok: true }))).toThrow("ARCHIVED");
  const other = await createTestKit();
  try {
    expect(createPolicy(other.db).canWrite("dev", "p1", "backend")).toBe(true);
    expect(p.canWrite("dev", "p1", "backend")).toBe(false);
  } finally {
    await other.close();
  }
});
it("task_03 denies disabled role assignments and missing versions and anonymous reads", async () => {
  expect((await f.api("GET", "/api/projects", {}, "anonymous")).status).toBe(
    401,
  );
  expect((await f.api("POST", "/api/projects/p1/archive", {})).status).toBe(
    400,
  );
  f.db.prepare("UPDATE members SET active=0 WHERE id='dev'").run();
  expect(
    (
      await f.api("PUT", "/api/projects/p1/roles", {
        memberId: "dev",
        roles: ["backend"],
        leads: [],
        expectedVersion: 1,
      })
    ).status,
  ).toBe(422);
  expect((await f.api("GET", "/api/projects/p2", {}, "dev")).status).toBe(401);
});
it("task_03 revoked checker and acceptor roles stop actions immediately", () => {
  f.db
    .prepare("INSERT INTO objects VALUES (?,?,?,?,?)")
    .run(
      "accept",
      "requirement",
      "p1",
      1,
      JSON.stringify({ acceptorId: "product" }),
    );
  const p = createPolicy(f.db),
    target = { kind: "requirement" as const, id: "accept" };
  expect(() => p.authorize("tester", "test", target)).not.toThrow();
  expect(() => p.authorize("product", "accept", target)).not.toThrow();
  f.db
    .prepare("DELETE FROM roles WHERE member_id IN ('tester','product')")
    .run();
  expect(() => p.authorize("tester", "test", target)).toThrow();
  expect(() => p.authorize("product", "accept", target)).toThrow();
});
it("task_03 recognizes task functional kind without a redundant role field", () => {
  f.db
    .prepare("INSERT INTO objects VALUES (?,?,?,?,?)")
    .run(
      "front",
      "task",
      "p1",
      1,
      JSON.stringify({ kind: "frontend", role: "backend", ownerId: "dev2" }),
    );
  expect(() =>
    createPolicy(f.db).authorize("dev2", "claim", {
      kind: "task",
      id: "front",
    }),
  ).not.toThrow();
  expect(() =>
    createPolicy(f.db).authorize("dev2", "execute", {
      kind: "task",
      id: "front",
    }),
  ).not.toThrow();
});
it("task_03 requires persisted valid scope for Bug and other task scoped writes", () => {
  for (const [id, kind, current] of [
    ["bug-scope", "bug", { ownerId: "dev" }],
    ["other-scope", "task", { kind: "other", ownerId: "dev", role: "invalid" }],
  ] as const) {
    f.db
      .prepare("INSERT INTO objects VALUES (?,?,?,?,?)")
      .run(id, kind, "p1", 1, JSON.stringify(current));
    const target = { kind, id };
    for (const a of ["claim", "execute"] as const)
      expect(() => createPolicy(f.db).authorize("dev", a, target)).toThrow();
  }
  f.db
    .prepare("INSERT INTO objects VALUES (?,?,?,?,?)")
    .run(
      "repair",
      "bug",
      "p1",
      1,
      JSON.stringify({ role: "backend", ownerId: "dev" }),
    );
  expect(() =>
    createPolicy(f.db).authorize("dev", "execute", {
      kind: "bug",
      id: "repair",
    }),
  ).not.toThrow();
});

it("unchanged role sets preserve version and events while real changes emit once", async () => {
  const assign = (roles: string[], leads: string[], expectedVersion: number, memberId = "dev", key = f.fresh("roles")) =>
    f.api("PUT", "/api/projects/p1/roles", { memberId, roles, leads, expectedVersion }, "admin", key);
  expect((await assign(["backend"], [], 1)).body).toMatchObject({ version: 1 });
  expect(f.events("project", "p1")).toHaveLength(0);
  expect((await assign([], [], 1, "dev2")).body).toMatchObject({ version: 2 });
  expect((await assign([], [], 2, "dev2")).body).toMatchObject({ version: 2 });
  expect((await assign(["backend", "test"], ["backend"], 2)).body).toMatchObject({ version: 3 });
  expect((await assign(["test", "backend"], ["backend"], 3)).body).toMatchObject({ version: 3 });
  expect(f.events("project", "p1")).toHaveLength(2);
  expect((await assign(["backend", "test"], ["test"], 3)).body).toMatchObject({ version: 4 });
  expect(f.events("project", "p1")).toHaveLength(3);
  expect((await assign(["test", "backend"], ["test"], 3)).status).toBe(409);
  const key = "noop-replay";
  expect((await assign(["test", "backend"], ["test"], 4, "dev", key)).body).toMatchObject({ version: 4 });
  expect((await assign(["test", "backend"], ["test"], 4, "dev", key)).status).toBe(200);
  f.db.prepare("UPDATE members SET active=0 WHERE id='dev'").run();
  expect((await assign(["test", "backend"], ["test"], 4)).status).toBe(422);
  f.db.prepare("UPDATE members SET is_admin=0 WHERE id='admin'").run();
  expect((await assign(["test", "backend"], ["test"], 4, "dev", key)).status).toBe(403);
  f.db.prepare("UPDATE members SET is_admin=1 WHERE id='admin'").run();
  expect((await f.api("POST", "/api/projects/p1/archive", { expectedVersion: 4 })).status).toBe(200);
  expect((await assign(["test", "backend"], ["test"], 4, "dev", key)).status).toBe(409);
});

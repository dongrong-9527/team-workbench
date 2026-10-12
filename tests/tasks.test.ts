import { beforeEach, afterEach, it, expect } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
import { openDb } from "../apps/api/src/db/open.js";
import { buildApp } from "../apps/api/src/app.js";
import { issueSession } from "../apps/api/src/auth/session.js";
let f: TestKit;
beforeEach(async () => {
  f = await createTestKit();
  f.db.prepare("INSERT INTO roles VALUES ('p1','dev2','backend',0)").run();
});
afterEach(async () => {
  await f.close();
});
const input = {
  projectId: "p1",
  title: "Implement validation",
  kind: "backend",
  definitionOfDone: "Validation rejects invalid input",
  priority: "medium",
};
async function create(extra: any = {}) {
  const r = await f.api<any>(
    "POST",
    "/api/tasks",
    { ...input, ...extra },
    "product",
  );
  expect(r.status).toBe(200);
  return r.body;
}
async function act(
  t: any,
  action: string,
  extra: any = {},
  actor: any = "product",
  key?: string,
) {
  return f.api<any>(
    "POST",
    `/api/tasks/${t.id}/actions`,
    { action, expectedVersion: t.version, ...extra },
    actor,
    key,
  );
}
async function owned(extra: any = {}) {
  return create({ ownerId: "dev", reviewerId: "tester", ...extra });
}
const evidence = {
  done: "Implemented validation",
  selfCheck: "Unit cases pass",
  environment: "build-1",
};
it("task_05 two independent connections permit exactly one HTTP claim and replay does not start", async () => {
  const t = await create();
  const session1 = issueSession(f.db, "dev");
  const db2 = openDb(f.path);
  const app2 = buildApp(db2, { origin: "https://workbench.test" });
  const session = issueSession(db2, "dev2");
  await app2.listen({ host: "127.0.0.1", port: 0 });
  const post = async (base: string, s: any, key: string) => {
    const r = await fetch(`${base}/api/tasks/${t.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: "claim", expectedVersion: 1 }),
      headers: {
        "content-type": "application/json",
        origin: "https://workbench.test",
        "idempotency-key": key,
        cookie: `session=${s.token}`,
        "x-csrf-token": s.csrfToken,
      },
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  try {
    const rs = await Promise.all([
      post(f.baseUrl, session1, "claim"),
      post(app2.listeningOrigin, session, "claim2"),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      f.events("task", t.id).filter((e) => e.action === "claim"),
    ).toHaveLength(1);
    expect(rs.find((r) => r.status === 200)!.body.state).toBe("pending");
    expect(rs.find((r) => r.status === 409)!.body.latest.ownerId).toBeTruthy();
    if (rs[0].status === 200)
      expect((await act(t, "claim", {}, "dev", "claim")).body).toEqual(
        rs[0].body,
      );
  } finally {
    await app2.close();
    db2.close();
  }
});
it("task_05 execution evidence and independent self-test check are immutable", async () => {
  f.db.prepare("INSERT INTO roles VALUES ('p1','dev','test',0)").run();
  let t = await owned({ reviewerId: "dev" });
  t = (await act(t, "start", {}, "dev")).body;
  t = (await act(t, "submit", { evidence }, "dev")).body;
  const r = await act(
    t,
    "checkPass",
    { evidence: { result: "All checks pass", environment: "build-1" } },
    "dev",
  );
  expect(r.status).toBe(200);
  expect(r.body.state).toBe("done");
  expect(
    f.db
      .prepare("SELECT * FROM execution_participations WHERE object_id=?")
      .all(t.id),
  ).toHaveLength(2);
  const rows = f.db
    .prepare("SELECT * FROM task_checks WHERE task_id=?")
    .all(t.id) as any[];
  expect(rows).toHaveLength(1);
  expect(rows[0].self_test).toBe(1);
  expect(() =>
    f.db.prepare("UPDATE task_checks SET self_test=0").run(),
  ).toThrow();
});
it("task_05 transfer preserves state and immutable original contributors", async () => {
  let t = await owned();
  t = (await act(t, "start", {}, "dev")).body;
  expect(
    (
      await act(
        t,
        "transfer",
        { ownerId: "dev2", reason: "handover", handoff: "current changes" },
        "dev",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await act(
        t,
        "requestTransfer",
        { reason: "schedule", handoff: "current changes" },
        "dev",
      )
    ).status,
  ).toBe(200);
  t = (await f.api<any>("GET", `/api/tasks/${t.id}`)).body;
  const r = await act(t, "transfer", {
    ownerId: "dev2",
    reason: "schedule",
    handoff: "current changes",
  });
  expect(r.body.state).toBe("active");
  expect(r.body.ownerId).toBe("dev2");
  expect(
    (
      await act(t, "transfer", {
        ownerId: "dev",
        reason: "again",
        handoff: "notes",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      f.db
        .prepare("SELECT member_id FROM execution_participations")
        .all() as any[]
    )[0].member_id,
  ).toBe("dev");
});
it("task_05 fresh authority precedes replay and invalid assignees/reviewers are rejected", async () => {
  const t = await create();
  const r = await act(t, "claim", {}, "dev", "old");
  expect(r.status).toBe(200);
  f.db
    .prepare("DELETE FROM roles WHERE member_id='dev' AND role='backend'")
    .run();
  expect((await act(t, "claim", {}, "dev", "old")).status).toBe(403);
  f.db.prepare("UPDATE members SET active=0 WHERE id='dev2'").run();
  expect(
    (
      await act(r.body, "assign", {
        ownerId: "dev2",
        reason: "assign",
        handoff: "notes",
      })
    ).status,
  ).toBe(422);
  const o = await owned({ ownerId: undefined });
  expect(
    (await act(o, "designateReviewer", { reviewerId: "product" })).status,
  ).toBe(422);
  f.db
    .prepare("UPDATE projects SET archived=1,version=version+1 WHERE id='p1'")
    .run();
  expect((await act(t, "claim", {}, "dev", "old")).status).toBe(409);
});
it("task_05 drafts need completion standard and checks need reviewer/evidence/unblocked state", async () => {
  let t = await owned({ definitionOfDone: "" });
  expect((await act(t, "start", {}, "dev")).status).toBe(422);
  t = (await act(t, "refine", { definitionOfDone: "complete validation" }))
    .body;
  t = (await act(t, "start", {}, "dev")).body;
  expect((await act(t, "submit", {}, "dev")).status).toBe(400);
  t = (
    await act(
      t,
      "block",
      { reason: "environment", assistance: "tester" },
      "dev",
    )
  ).body;
  expect((await act(t, "submit", { evidence }, "dev")).status).toBe(422);
  t = (await act(t, "unblock", { reason: "available" }, "dev")).body;
  t = (await act(t, "submit", { evidence }, "dev")).body;
  f.db.prepare("DELETE FROM roles WHERE member_id='tester'").run();
  expect(
    (
      await act(
        t,
        "checkPass",
        { evidence: { result: "pass", environment: "build-1" } },
        "tester",
      )
    ).status,
  ).toBe(403);
});
it("task_05 dependency cycles and cross-project links reject; parallel work requires current lead approval", async () => {
  let a = await owned(),
    b = await owned();
  expect(
    (await act(a, "setDependencies", { dependencyIds: [a.id] })).status,
  ).toBe(422);
  a = (await act(a, "setDependencies", { dependencyIds: [b.id] })).body;
  expect(
    (await act(b, "setDependencies", { dependencyIds: [a.id] })).status,
  ).toBe(422);
  expect((await act(a, "start", {}, "dev")).status).toBe(422);
  expect(
    (await act(a, "approveParallel", { reason: "separate interfaces" }, "dev"))
      .status,
  ).toBe(403);
  f.db
    .prepare("UPDATE roles SET lead=1 WHERE member_id='dev' AND role='backend'")
    .run();
  a = (
    await act(a, "approveParallel", { reason: "separate interfaces" }, "dev")
  ).body;
  expect((await act(a, "start", {}, "dev")).status).toBe(200);
  f.db.prepare("INSERT INTO roles VALUES ('p2','product','product',0)").run();
  const c = await create({ projectId: "p2" });
  expect(
    (await act(b, "setDependencies", { dependencyIds: [c.id] })).status,
  ).toBe(422);
});
it("task_05 product alone excludes required work with persisted reason", async () => {
  f.db
    .prepare("UPDATE roles SET lead=1 WHERE member_id='dev' AND role='backend'")
    .run();
  expect(
    (
      await f.api(
        "POST",
        "/api/tasks",
        { ...input, required: false, exclusionReason: "optional" },
        "dev",
      )
    ).status,
  ).toBe(403);
  const t = await create();
  expect(t.required).toBe(true);
  expect(
    (
      await act(
        t,
        "setRequired",
        { required: false, reason: "optional" },
        "dev",
      )
    ).status,
  ).toBe(403);
  const r = await act(t, "setRequired", {
    required: false,
    reason: "optional",
  });
  expect(r.body.exclusionReason).toBe("optional");
});
it("task_05 linked first start and required reopen are atomic; cancelled parent rejects replay", async () => {
  const rr = await f.api<any>(
    "POST",
    "/api/requirements",
    {
      projectId: "p1",
      title: "Feature",
      source: { description: "Source" },
      description: "Scope",
      criteria: [{ id: "c1", text: "works", required: true }],
      priority: "medium",
      acceptorId: "product",
    },
    "product",
  );
  const id = rr.body.id;
  await f.api(
    "POST",
    `/api/requirements/${id}/actions`,
    { action: "refine", expectedVersion: 1 },
    "product",
  );
  await f.api(
    "POST",
    `/api/requirements/${id}/actions`,
    {
      action: "makeReady",
      expectedVersion: 2,
      source: { description: "Source", status: "unable", reason: "offline" },
    },
    "product",
  );
  let t = await owned({ requirementId: id });
  await f.failNextEvent();
  expect((await act(t, "start", {}, "dev")).status).toBe(500);
  expect((await f.api<any>("GET", `/api/requirements/${id}`)).body.state).toBe(
    "ready",
  );
  expect((await f.api<any>("GET", `/api/tasks/${t.id}`)).body.state).toBe(
    "pending",
  );
  t = (await act(t, "start", {}, "dev", "start-key")).body;
  t = (await act(t, "submit", { evidence }, "dev")).body;
  t = (
    await act(
      t,
      "checkFail",
      { evidence: { result: "Missing case", environment: "build-1" } },
      "tester",
    )
  ).body;
  expect(t.state).toBe("active");
  t = (await act(t, "submit", { evidence }, "dev")).body;
  t = (
    await act(
      t,
      "checkPass",
      { evidence: { result: "pass", environment: "build-1" } },
      "tester",
    )
  ).body;
  const row = f.db
    .prepare("SELECT current FROM objects WHERE id=?")
    .get(id) as any;
  f.db
    .prepare("UPDATE objects SET current=?,version=version+1 WHERE id=?")
    .run(JSON.stringify({ ...JSON.parse(row.current), state: "accepted" }), id);
  await f.failNextEvent();
  expect((await act(t, "reopen", { reason: "new failure" })).status).toBe(500);
  expect((await f.api<any>("GET", `/api/tasks/${t.id}`)).body.state).toBe(
    "done",
  );
  expect((await f.api<any>("GET", `/api/requirements/${id}`)).body.state).toBe(
    "accepted",
  );
  expect((await act(t, "reopen", { reason: "new failure" })).status).toBe(200);
  expect((await f.api<any>("GET", `/api/requirements/${id}`)).body.state).toBe(
    "active",
  );
  const r = f.db
    .prepare("SELECT current FROM objects WHERE id=?")
    .get(id) as any;
  f.db
    .prepare("UPDATE objects SET current=?,version=version+1 WHERE id=?")
    .run(JSON.stringify({ ...JSON.parse(r.current), state: "cancelled" }), id);
  expect(
    (
      await f.api(
        "POST",
        `/api/tasks/${t.id}/actions`,
        { action: "start", expectedVersion: 1 },
        "dev",
        "start-key",
      )
    ).status,
  ).toBe(409);
});
it("task_05 parallel approval expires when task definition changes or lead is revoked", async () => {
  f.db
    .prepare("UPDATE roles SET lead=1 WHERE member_id='dev' AND role='backend'")
    .run();
  const b = await owned();
  let a = await owned();
  a = (await act(a, "setDependencies", { dependencyIds: [b.id] })).body;
  a = (await act(a, "approveParallel", { reason: "separate work" }, "dev"))
    .body;
  a = (await act(a, "refine", { definitionOfDone: "new acceptance standard" }))
    .body;
  expect((await act(a, "start", {}, "dev")).status).toBe(422);
  a = (
    await act(a, "approveParallel", { reason: "reconfirm new standard" }, "dev")
  ).body;
  f.db
    .prepare("UPDATE roles SET lead=0 WHERE member_id='dev' AND role='backend'")
    .run();
  expect((await act(a, "start", {}, "dev")).status).toBe(422);
});
it("task_05 missing reviewer, current owner role and old sessions cannot complete or replay", async () => {
  let t = await owned({ reviewerId: undefined });
  t = (await act(t, "start", {}, "dev", "start")).body;
  expect((await act(t, "submit", { evidence }, "dev")).status).toBe(422);
  t = (await act(t, "designateReviewer", { reviewerId: "tester" })).body;
  t = (await act(t, "submit", { evidence }, "dev")).body;
  f.db
    .prepare("DELETE FROM roles WHERE member_id='dev' AND role='backend'")
    .run();
  expect(
    (
      await act(
        t,
        "checkPass",
        { evidence: { result: "pass", environment: "build" } },
        "tester",
      )
    ).status,
  ).toBe(422);
  f.db.prepare("UPDATE members SET active=0 WHERE id='dev'").run();
  expect(
    (
      await f.api(
        "POST",
        `/api/tasks/${t.id}/actions`,
        { action: "start", expectedVersion: 1 },
        "dev",
        "start",
      )
    ).status,
  ).toBe(401);
});
it("task_05 test execution differs from development; task evidence and work cannot be removed", async () => {
  let t = await create({
    kind: "test",
    ownerId: "tester",
    reviewerId: "product",
  });
  t = (await act(t, "start", {}, "tester")).body;
  t = (await act(t, "submit", { evidence }, "tester")).body;
  t = (
    await act(
      t,
      "checkPass",
      { evidence: { result: "pass", environment: "build-1" } },
      "product",
    )
  ).body;
  expect(t.state).toBe("done");
  expect(
    f.db.prepare("SELECT * FROM execution_participations").all(),
  ).toHaveLength(0);
  expect(
    (f.db.prepare("SELECT activity FROM task_work").all() as any[]).map(
      (r) => r.activity,
    ),
  ).toEqual(["testing", "testing"]);
  expect(() => f.db.prepare("DELETE FROM task_work").run()).toThrow();
  expect(() => f.db.prepare("DELETE FROM task_checks").run()).toThrow();
});
it("task_05 reset transfer is explicit and block prevents check completion without deleting history", async () => {
  let t = await owned();
  t = (await act(t, "start", {}, "dev")).body;
  t = (await act(t, "submit", { evidence }, "dev")).body;
  t = (
    await act(t, "block", {
      reason: "broken environment",
      assistance: "product",
    })
  ).body;
  expect(
    (
      await act(
        t,
        "checkPass",
        { evidence: { result: "pass", environment: "build" } },
        "tester",
      )
    ).status,
  ).toBe(422);
  t = (await act(t, "unblock", { reason: "restored" })).body;
  expect(t.state).toBe("pending_check");
  t = (
    await act(t, "transfer", {
      ownerId: null,
      resetToPending: true,
      reason: "reschedule",
      handoff: "changes saved",
    })
  ).body;
  expect(t.state).toBe("pending");
  expect(t.ownerId).toBeNull();
  expect(f.db.prepare("SELECT * FROM task_work").all()).toHaveLength(2);
});
it("task_05 historical evidence snapshots preserve original actor and task names", async () => {
  let t = await owned();
  t = (await act(t, "start", {}, "dev")).body;
  t = (await act(t, "submit", { evidence }, "dev")).body;
  await act(
    t,
    "checkPass",
    { evidence: { result: "pass", environment: "build-1" } },
    "tester",
  );
  f.db.prepare("UPDATE members SET name='Renamed' WHERE id='dev'").run();
  const work = f.db
    .prepare("SELECT evidence FROM task_work WHERE task_id=? ORDER BY rowid")
    .all(t.id) as any[];
  expect(JSON.parse(work[0].evidence).actorName).toBe("dev");
  expect(JSON.parse(work[0].evidence).taskTitle).toBe(input.title);
  const c = f.db
    .prepare("SELECT evidence FROM task_checks WHERE task_id=?")
    .get(t.id) as any;
  expect(JSON.parse(c.evidence).actorName).toBe("tester");
});
it("task_05 task requirement and dependency references are guarded in SQLite", async () => {
  const r = await f.api<any>(
    "POST",
    "/api/requirements",
    {
      projectId: "p1",
      title: "Scope",
      source: { description: "Source" },
      description: "Scope",
      criteria: [],
      priority: "medium",
    },
    "product",
  );
  f.db.prepare("INSERT INTO roles VALUES ('p2','product','product',0)").run();
  expect(
    (
      await f.api(
        "POST",
        "/api/tasks",
        { ...input, projectId: "p2", requirementId: r.body.id },
        "product",
      )
    ).status,
  ).toBe(422);
  expect(() =>
    f.db
      .prepare("INSERT INTO objects VALUES ('bad','task','p2',1,?)")
      .run(JSON.stringify({ requirementId: r.body.id })),
  ).toThrow("invalid task parent");
  const a = await owned(),
    b = await create({ projectId: "p2" });
  expect(() =>
    f.db
      .prepare("INSERT INTO task_dependencies VALUES (?,?,?)")
      .run("p1", a.id, b.id),
  ).toThrow();
});
it("task_05 changed unconfirmed parent scope stops pending checks and old execution replays", async () => {
  const r = await f.api<any>(
    "POST",
    "/api/requirements",
    {
      projectId: "p1",
      title: "Scope",
      source: { description: "Source" },
      description: "Scope",
      criteria: [{ id: "c1", text: "pass", required: true }],
      priority: "medium",
      acceptorId: "product",
    },
    "product",
  );
  const id = r.body.id;
  await f.api(
    "POST",
    `/api/requirements/${id}/actions`,
    { action: "refine", expectedVersion: 1 },
    "product",
  );
  await f.api(
    "POST",
    `/api/requirements/${id}/actions`,
    {
      action: "makeReady",
      expectedVersion: 2,
      source: { description: "Source", status: "unable", reason: "offline" },
    },
    "product",
  );
  let t = await owned({ requirementId: id });
  t = (await act(t, "start", {}, "dev", "initial-start")).body;
  t = (await act(t, "submit", { evidence }, "dev")).body;
  await f.api(
    "POST",
    `/api/requirements/${id}/actions`,
    {
      action: "revise",
      expectedVersion: 4,
      kind: "behavior",
      reason: "new scope",
      affectedTaskIds: [t.id],
      affectedCheckIds: ["c1"],
      impactConfirmed: true,
      criteria: [{ id: "c1", text: "new check", required: true }],
    },
    "product",
  );
  t = (await f.api<any>("GET", `/api/tasks/${t.id}`)).body;
  expect(
    (
      await act(
        t,
        "checkPass",
        { evidence: { result: "old pass", environment: "build-1" } },
        "tester",
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await f.api(
        "POST",
        `/api/tasks/${t.id}/actions`,
        { action: "start", expectedVersion: 1 },
        "dev",
        "initial-start",
      )
    ).status,
  ).toBe(422);
  expect(f.db.prepare("SELECT * FROM task_checks").all()).toHaveLength(0);
});
it("task_05 parallel approval expires after confirmed requirement business revision", async () => {
  f.db
    .prepare("UPDATE roles SET lead=1 WHERE member_id='dev' AND role='backend'")
    .run();
  const rr = await f.api<any>(
    "POST",
    "/api/requirements",
    {
      projectId: "p1",
      title: "Scope",
      source: { description: "Source" },
      description: "Scope",
      criteria: [{ id: "c1", text: "first scope", required: true }],
      priority: "medium",
      acceptorId: "product",
    },
    "product",
  );
  const id = rr.body.id;
  await f.api(
    "POST",
    `/api/requirements/${id}/actions`,
    { action: "refine", expectedVersion: 1 },
    "product",
  );
  const source = { description: "Source", status: "unable", reason: "offline" };
  await f.api(
    "POST",
    `/api/requirements/${id}/actions`,
    { action: "makeReady", expectedVersion: 2, source },
    "product",
  );
  const b = await owned();
  let a = await owned({ requirementId: id });
  a = (await act(a, "setDependencies", { dependencyIds: [b.id] })).body;
  a = (await act(a, "approveParallel", { reason: "current scope" }, "dev"))
    .body;
  const revised = await f.api<any>(
    "POST",
    `/api/requirements/${id}/actions`,
    {
      action: "revise",
      expectedVersion: 3,
      kind: "behavior",
      reason: "new scope",
      affectedTaskIds: [a.id],
      affectedCheckIds: ["c1"],
      impactConfirmed: true,
      criteria: [{ id: "c1", text: "new scope", required: true }],
    },
    "product",
  );
  expect(revised.status).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        `/api/requirements/${id}/actions`,
        { action: "makeReady", expectedVersion: 4, source },
        "product",
      )
    ).status,
  ).toBe(200);
  a = (await f.api<any>("GET", `/api/tasks/${a.id}`)).body;
  expect((await act(a, "start", {}, "dev")).status).toBe(422);
});
it("task_05 replayed completion checks current assignee eligibility and assignment replay checks recipient", async () => {
  let t = await owned();
  t = (await act(t, "start", {}, "dev")).body;
  t = (await act(t, "submit", { evidence }, "dev")).body;
  const body = { evidence: { result: "pass", environment: "build-1" } };
  expect((await act(t, "checkPass", body, "tester", "check-key")).status).toBe(
    200,
  );
  f.db
    .prepare("DELETE FROM roles WHERE member_id='dev' AND role='backend'")
    .run();
  expect((await act(t, "checkPass", body, "tester", "check-key")).status).toBe(
    422,
  );
  const a = await create();
  const assign = { ownerId: "dev2", reason: "assign", handoff: "work scope" };
  expect((await act(a, "assign", assign, "product", "assign-key")).status).toBe(
    200,
  );
  f.db.prepare("UPDATE members SET active=0 WHERE id='dev2'").run();
  expect((await act(a, "assign", assign, "product", "assign-key")).status).toBe(
    422,
  );
});
it("task_05 other-kind tasks retain explicit functional execution scope and cannot hide developer participation", async () => {
  let t = await create({
    kind: "other",
    role: "backend",
    ownerId: "dev",
    reviewerId: "tester",
  });
  t = (await act(t, "start", {}, "dev")).body;
  expect(t.state).toBe("active");
  expect(
    f.db
      .prepare(
        "SELECT activity,role FROM execution_participations WHERE object_id=?",
      )
      .get(t.id),
  ).toEqual({ activity: "development", role: "backend" });
  expect(
    (await f.api("POST", "/api/tasks", { ...input, kind: "other" }, "product"))
      .status,
  ).toBe(422);
  expect(
    (
      await f.api(
        "POST",
        "/api/tasks",
        { ...input, role: "frontend" },
        "product",
      )
    ).status,
  ).toBe(422);
});
it("task_05 explicit transfer reset of required completed work atomically regresses accepted parent", async () => {
  const rr = await f.api<any>(
    "POST",
    "/api/requirements",
    {
      projectId: "p1",
      title: "Scope",
      source: { description: "Source" },
      description: "Scope",
      criteria: [{ id: "c1", text: "pass", required: true }],
      priority: "medium",
      acceptorId: "product",
    },
    "product",
  );
  const id = rr.body.id;
  await f.api(
    "POST",
    `/api/requirements/${id}/actions`,
    { action: "refine", expectedVersion: 1 },
    "product",
  );
  await f.api(
    "POST",
    `/api/requirements/${id}/actions`,
    {
      action: "makeReady",
      expectedVersion: 2,
      source: { description: "Source", status: "unable", reason: "offline" },
    },
    "product",
  );
  let t = await owned({ requirementId: id });
  t = (await act(t, "start", {}, "dev")).body;
  t = (await act(t, "submit", { evidence }, "dev")).body;
  t = (
    await act(
      t,
      "checkPass",
      { evidence: { result: "pass", environment: "build" } },
      "tester",
    )
  ).body;
  const row = f.db
    .prepare("SELECT current FROM objects WHERE id=?")
    .get(id) as any;
  f.db
    .prepare("UPDATE objects SET current=?,version=version+1 WHERE id=?")
    .run(JSON.stringify({ ...JSON.parse(row.current), state: "accepted" }), id);
  const transfer = {
    ownerId: "dev2",
    resetToPending: true,
    reason: "redo with new owner",
    handoff: "changes saved",
  };
  await f.failNextEvent();
  expect((await act(t, "transfer", transfer)).status).toBe(500);
  expect((await f.api<any>("GET", `/api/tasks/${t.id}`)).body.state).toBe(
    "done",
  );
  expect((await f.api<any>("GET", `/api/requirements/${id}`)).body.state).toBe(
    "accepted",
  );
  expect((await act(t, "transfer", transfer)).status).toBe(200);
  expect((await f.api<any>("GET", `/api/requirements/${id}`)).body.state).toBe(
    "active",
  );
});
it.each([
  ["backend", "dev"],
  ["frontend", "dev2"],
])(
  "task_05 review F1 other/%s requires test-role reviewer across create designation submission and completion",
  async (role, owner) => {
    f.db
      .prepare(
        "UPDATE roles SET lead=1 WHERE project_id=? AND member_id=? AND role=?",
      )
      .run("p1", owner, role);
    const body = { ...input, kind: "other", role, ownerId: owner };
    for (const reviewerId of ["product", owner])
      expect(
        (await f.api("POST", "/api/tasks", { ...body, reviewerId }, "product"))
          .status,
      ).toBe(422);
    let t = await create({ kind: "other", role, ownerId: owner });
    for (const reviewerId of ["product", owner])
      expect((await act(t, "designateReviewer", { reviewerId })).status).toBe(
        422,
      );
    const designated = await act(t, "designateReviewer", {
      reviewerId: "tester",
    });
    expect(designated.status).toBe(200);
    t = designated.body;
    t = (await act(t, "start", {}, owner)).body;
    f.db
      .prepare("DELETE FROM roles WHERE member_id='tester' AND role='test'")
      .run();
    expect((await act(t, "submit", { evidence }, owner)).status).toBe(422);
    f.db.prepare("INSERT INTO roles VALUES ('p1','tester','test',0)").run();
    const submitted = await act(t, "submit", { evidence }, owner);
    expect(submitted.status).toBe(200);
    t = submitted.body;
    f.db
      .prepare("DELETE FROM roles WHERE member_id='tester' AND role='test'")
      .run();
    expect(
      (
        await act(
          t,
          "checkPass",
          { evidence: { result: "pass", environment: "build-1" } },
          "tester",
        )
      ).status,
    ).toBe(403);
    f.db.prepare("INSERT INTO roles VALUES ('p1','tester','test',0)").run();
    const checked = await act(
      t,
      "checkPass",
      { evidence: { result: "pass", environment: "build-1" } },
      "tester",
    );
    expect(checked.status).toBe(200);
    expect(checked.body.state).toBe("done");
    expect(
      f.db
        .prepare(
          "SELECT reviewer_id,self_test FROM task_checks WHERE task_id=?",
        )
        .get(t.id),
    ).toEqual({ reviewer_id: "tester", self_test: 0 });
  },
);
it.each([
  ["backend", "dev"],
  ["frontend", "dev2"],
])(
  "task_05 review F1 dual-role other/%s developer may check with immutable self-test marker",
  async (role, owner) => {
    f.db
      .prepare(
        "INSERT INTO roles (project_id,member_id,role,lead) VALUES ('p1',?,'test',0)",
      )
      .run(owner);
    let t = await create({
      kind: "other",
      role,
      ownerId: owner,
      reviewerId: owner,
    });
    t = (await act(t, "start", {}, owner)).body;
    t = (await act(t, "submit", { evidence }, owner)).body;
    const r = await act(
      t,
      "checkPass",
      { evidence: { result: "self-test pass", environment: "build-1" } },
      owner,
    );
    expect(r.status).toBe(200);
    expect(
      f.db
        .prepare(
          "SELECT reviewer_id,self_test FROM task_checks WHERE task_id=?",
        )
        .get(t.id),
    ).toEqual({ reviewer_id: owner, self_test: 1 });
  },
);
it.each(["product", "tester"])(
  "task_05 review F1 other/test retains %s product or functional-lead review without development participation",
  async (reviewer) => {
    f.db
      .prepare(
        "UPDATE roles SET lead=1 WHERE member_id='tester' AND role='test'",
      )
      .run();
    let t = await create({
      kind: "other",
      role: "test",
      ownerId: "tester",
      reviewerId: reviewer,
    });
    t = (await act(t, "start", {}, "tester")).body;
    t = (await act(t, "submit", { evidence }, "tester")).body;
    expect(
      (
        await act(
          t,
          "checkPass",
          { evidence: { result: "pass", environment: "build-1" } },
          reviewer,
        )
      ).status,
    ).toBe(200);
    expect(
      f.db
        .prepare("SELECT * FROM execution_participations WHERE object_id=?")
        .all(t.id),
    ).toHaveLength(0);
    expect(
      f.db
        .prepare("SELECT self_test FROM task_checks WHERE task_id=?")
        .get(t.id),
    ).toEqual({ self_test: 0 });
  },
);

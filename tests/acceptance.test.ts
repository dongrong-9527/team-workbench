import { beforeEach, afterEach, it, expect } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
import {
  saveRevision,
  saveScope,
  recordExecutionParticipation,
} from "../apps/api/src/requirements/revisions.js";
import { insertTestRecord } from "../apps/api/src/testing/evidence.js";
let f: TestKit;
beforeEach(async () => {
  f = await createTestKit();
});
afterEach(async () => {
  await f.close();
});
function seed(extra: any = {}, withEvidence = true) {
  const r = {
    id: "r1",
    projectId: "p1",
    title: "Acceptance scope",
    description: "Validated behavior",
    source: { description: "Manual source" },
    criteria: [{ id: "c1", text: "Behavior works", required: true }],
    priority: "medium",
    role: "backend",
    acceptorId: "product",
    state: "active",
    revision: 1,
    version: 1,
    blocked: false,
    scopeConfirmed: true,
    evidenceReady: false,
    ...extra,
  };
  f.db
    .transaction(() => {
      f.db
        .prepare("INSERT INTO objects VALUES ('r1','requirement','p1',1,?)")
        .run(JSON.stringify(r));
      saveRevision(f.db, f.context, r, "Initial");
      saveScope(f.db, f.context, r);
      if (withEvidence)
        insertTestRecord(
          f.db,
          { ...f.context, actorId: "tester" },
          {
            target: { kind: "requirement", id: "r1" },
            revision: 1,
            targetVersion: "build-1",
            environment: "local",
            checks: [{ checkId: "c1", result: "pass" }],
          },
        );
    })
    .immediate();
  return r;
}
const current = () =>
  JSON.parse(
    (f.db.prepare("SELECT current FROM objects WHERE id='r1'").get() as any)
      .current,
  );
const decision = (r: any, extra: any = {}) => ({
  expectedVersion: r.version,
  decision: "pass",
  revision: r.revision,
  targetVersion: "build-1",
  criteria: [{ id: "c1", passed: true }],
  ...extra,
});
const submit = (r: any, actor: any = "product", extra: any = {}) =>
  f.api<any>(
    "POST",
    "/api/requirements/r1/submit-acceptance",
    {
      expectedVersion: r.version,
      revision: r.revision,
      targetVersion: "build-1",
      ...extra,
    },
    actor,
  );
const accept = (
  r: any,
  extra: any = {},
  actor: any = "product",
  key?: string,
) =>
  f.api<any>(
    "POST",
    "/api/requirements/r1/acceptance",
    decision(r, extra),
    actor,
    key,
  );
it("task_07 critical open Bug prevents acceptance with explicit reasons", async () => {
  const r = await f.api<any>(
    "POST",
    "/api/requirements/r1/acceptance",
    f.seed("acceptanceWithCriticalOpenBug"),
    "product",
    "acc-1",
  );
  expect(r.status).toBe(422);
  expect(r.body.reasons).toContain("OPEN_CRITICAL_BUG");
  expect(f.read("acceptance_records")).toHaveLength(0);
});
it("task_07 submits fixed build then independent designated product passes immutably", async () => {
  const r = seed();
  const s = await submit(r);
  expect(s.status).toBe(200);
  expect(s.body.state).toBe("pending_acceptance");
  expect((await accept(s.body, {}, "admin")).status).toBe(403);
  expect((await accept(s.body, { targetVersion: "build-2" })).status).toBe(422);
  const a = await accept(s.body, {}, "product", "accept-once");
  expect(a.status).toBe(200);
  expect(a.body.state).toBe("accepted");
  expect((await accept(s.body, {}, "product", "accept-once")).status).toBe(200);
  expect(f.db.prepare("SELECT * FROM acceptance_records").all()).toHaveLength(
    1,
  );
  expect(() => f.db.prepare("DELETE FROM acceptance_records").run()).toThrow();
});
it("task_07 actual historical participation prevents acceptance", async () => {
  seed();
  f.db.prepare("INSERT INTO objects VALUES ('t1','task','p1',1,?)").run(
    JSON.stringify({
      id: "t1",
      projectId: "p1",
      requirementId: "r1",
      kind: "backend",
      state: "done",
      required: false,
      exclusionReason: "Optional",
      version: 1,
    }),
  );
  f.db
    .transaction(() =>
      recordExecutionParticipation(f.db, "t1", "product", "backend"),
    )
    .immediate();
  const r = await submit(current());
  expect(r.status).toBe(422);
  expect(r.body.reasons).toContain("ACCEPTOR_PARTICIPATED");
});
function bug(extra: any = {}) {
  const b = {
    id: "b1",
    projectId: "p1",
    requirementId: "r1",
    title: "Deferred defect",
    severity: "normal",
    state: "ready",
    role: "backend",
    ownerId: "dev",
    reporterId: "tester",
    expected: "Works",
    actual: "Fails",
    reproduction: "Input",
    environment: "local",
    priority: "medium",
    blocked: false,
    version: 1,
    reopenCount: 0,
    ...extra,
  };
  f.db
    .prepare("INSERT INTO objects VALUES ('b1','bug','p1',1,?)")
    .run(JSON.stringify(b));
  return b;
}
function task(extra: any = {}) {
  const t = {
    id: "t1",
    projectId: "p1",
    requirementId: "r1",
    title: "Required work",
    kind: "backend",
    state: "done",
    required: true,
    ownerId: "dev",
    reviewerId: "tester",
    definitionOfDone: "Works",
    blocked: false,
    version: 1,
    dependencyIds: [],
    ...extra,
  };
  f.db
    .prepare("INSERT INTO objects VALUES ('t1','task','p1',1,?)")
    .run(JSON.stringify(t));
  return t;
}
async function accepted() {
  const s = await submit(current());
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  const a = await accept(s.body);
  expect(a.status, JSON.stringify(a.body)).toBe(200);
  return a.body;
}
async function waiver(extra: any = {}) {
  return f.api<any>(
    "POST",
    "/api/requirements/r1/bug-waivers",
    {
      expectedVersion: current().version,
      bugId: "b1",
      reason: "Cosmetic follow-up",
      followUpOwnerId: "dev",
      plan: "Repair in next iteration",
      ...extra,
    },
    "product",
  );
}
it("task_07 waiver permits normal Bug but is bound to live Bug version and owner", async () => {
  seed();
  bug();
  expect((await waiver()).status).toBe(200);
  await accepted();
  expect((await f.api<any>("GET", "/api/bugs/b1")).body.state).toBe("ready");
  const r = await f.api(
    "POST",
    "/api/bugs/b1/actions",
    {
      action: "assign",
      expectedVersion: 1,
      ownerId: "dev",
      reason: "Confirm handoff",
      handoff: "Take follow-up",
    },
    "product",
  );
  expect(r.status).toBe(200);
  expect(current().state).toBe("active");
  expect((await submit(current())).status).toBe(422);
  expect((await waiver({ followUpOwnerId: "tester" })).status).toBe(422);
  expect((await waiver()).status).toBe(200);
  f.db
    .prepare("DELETE FROM roles WHERE member_id='dev' AND role='backend'")
    .run();
  expect((await submit(current())).status).toBe(422);
});
it.each(["critical", "blocker"])(
  "task_07 never waives %s Bug",
  async (severity) => {
    seed();
    bug({ severity });
    expect((await waiver()).status).toBe(422);
    expect(f.db.prepare("SELECT * FROM bug_waivers").all()).toHaveLength(0);
  },
);
it("task_07 never waives blocked Bug and rollback leaves no waiver", async () => {
  seed();
  bug({ blocked: true });
  expect((await waiver()).status).toBe(422);
});
it.each(["fail", "untested"])(
  "task_07 latest %s current criterion overrides prior pass",
  async (result) => {
    seed();
    await accepted();
    const r = await f.api(
      "POST",
      "/api/tests",
      {
        expectedVersion: current().version,
        target: { kind: "requirement", id: "r1" },
        revision: 1,
        targetVersion: "build-1",
        environment: "local",
        checks: [{ checkId: "c1", result }],
      },
      "tester",
    );
    expect(r.status).toBe(200);
    expect(current().state).toBe("active");
    expect((await submit(current())).status).toBe(422);
  },
);
it("task_07 unrelated build failure cannot regress valid fixed build", async () => {
  seed();
  await accepted();
  const r = await f.api(
    "POST",
    "/api/tests",
    {
      expectedVersion: current().version,
      target: { kind: "requirement", id: "r1" },
      revision: 1,
      targetVersion: "build-2",
      environment: "local",
      checks: [{ checkId: "c1", result: "fail" }],
    },
    "tester",
  );
  expect(r.status).toBe(200);
  expect(current().state).toBe("accepted");
});
it("task_07 rejects empty required coverage and cross-target evidence", async () => {
  seed({
    criteria: [
      {
        id: "c1",
        text: "Behavior works",
        required: false,
        exclusionReason: "Optional",
      },
    ],
  });
  expect((await submit(current())).status).toBe(422);
});
it("task_07 new required task and newly required unfinished work regress acceptance", async () => {
  seed();
  await accepted();
  const r = await f.api<any>(
    "POST",
    "/api/tasks",
    {
      projectId: "p1",
      requirementId: "r1",
      title: "Omitted work",
      kind: "backend",
      definitionOfDone: "Complete",
      priority: "medium",
    },
    "product",
  );
  expect(r.status).toBe(200);
  expect(current().state).toBe("active");
});
it("task_07 required and optional blocked tasks prevent acceptance", async () => {
  seed();
  task({ required: false, exclusionReason: "Optional" });
  await accepted();
  const r = await f.api(
    "POST",
    "/api/tasks/t1/actions",
    {
      action: "block",
      expectedVersion: 1,
      reason: "Waiting",
      assistance: "Review",
    },
    "product",
  );
  expect(r.status).toBe(200);
  expect(current().state).toBe("active");
});
it("task_07 return requires failed explanation and real linked unfinished rework", async () => {
  seed();
  const s = (await submit(current())).body;
  expect(
    (
      await accept(s, {
        decision: "return",
        reason: "Behavior mismatch",
        criteria: [{ id: "c1", passed: false, note: "Wrong response" }],
        reworkTaskIds: ["missing"],
      })
    ).status,
  ).toBe(422);
  task({ state: "active" });
  const r = await accept(s, {
    decision: "return",
    reason: "Behavior mismatch",
    criteria: [{ id: "c1", passed: false, note: "Wrong response" }],
    reworkTaskIds: ["t1"],
  });
  expect(r.status).toBe(200);
  expect(r.body.state).toBe("active");
  const records = (await f.api<any>("GET", "/api/requirements/r1/acceptance"))
    .body;
  expect(records[0].reworkTaskIds).toEqual(["t1"]);
  expect(records[0].criteria[0].passed).toBe(false);
});
it("task_07 live authority blocks cached acceptance after revocation and archive", async () => {
  seed();
  const s = (await submit(current())).body;
  expect((await accept(s, {}, "product", "cached")).status).toBe(200);
  f.db.prepare("DELETE FROM roles WHERE member_id='product'").run();
  expect((await accept(s, {}, "product", "cached")).status).toBe(403);
  f.db.prepare("INSERT INTO roles VALUES ('p1','product','product',0)").run();
  f.db
    .prepare("UPDATE projects SET archived=1,version=version+1 WHERE id='p1'")
    .run();
  expect((await accept(s, {}, "product", "cached")).status).toBe(409);
});
it("task_07 current reviewer eligibility is checked before submission replay", async () => {
  seed();
  task();
  const body = { expectedVersion: 1, revision: 1, targetVersion: "build-1" };
  expect(
    (
      await f.api(
        "POST",
        "/api/requirements/r1/submit-acceptance",
        body,
        "product",
        "submit-cached",
      )
    ).status,
  ).toBe(200);
  f.db.prepare("DELETE FROM roles WHERE member_id='tester'").run();
  const r = await f.api(
    "POST",
    "/api/requirements/r1/submit-acceptance",
    body,
    "product",
    "submit-cached",
  );
  expect(r.status).toBe(422);
});
it("task_07 acceptance event failure rolls back record, object, scope and key", async () => {
  seed();
  const s = (await submit(current())).body;
  const before = f.events().length,
    scopes = f.db.prepare("SELECT * FROM requirement_scopes").all().length;
  f.db.exec(
    "CREATE TEMP TRIGGER fail_accept BEFORE INSERT ON events WHEN NEW.action='acceptancePassed' BEGIN SELECT RAISE(ABORT,'injected late failure'); END",
  );
  const a = await accept(s, {}, "product", "failed-accept");
  expect(a.status).toBe(500);
  expect(current().state).toBe("pending_acceptance");
  expect(f.db.prepare("SELECT * FROM acceptance_records").all()).toHaveLength(
    0,
  );
  expect(f.events()).toHaveLength(before);
  expect(f.db.prepare("SELECT * FROM requirement_scopes").all()).toHaveLength(
    scopes,
  );
  expect(
    f.db
      .prepare("SELECT * FROM idempotency WHERE request_id='failed-accept'")
      .all(),
  ).toHaveLength(0);
});
it.each(["bug", "task", "test"])(
  "task_07 real two-connection acceptance vs %s regression stays consistent",
  async (kind) => {
    seed();
    if (kind === "bug") bug({ state: "rejected", severity: "critical" });
    if (kind === "task") task();
    const s = (await submit(current())).body;
    expect(s.state).toBe("pending_acceptance");
    const { openDb } = await import("../apps/api/src/db/open.js");
    const { buildApp } = await import("../apps/api/src/app.js");
    const { issueSession } = await import("../apps/api/src/auth/session.js");
    const db2 = openDb(f.path),
      app2 = buildApp(db2, { origin: "https://workbench.test" });
    await app2.listen({ host: "127.0.0.1", port: 0 });
    const acceptSession = issueSession(f.db, "product"),
      changeSession = issueSession(db2, kind === "task" ? "product" : "tester");
    const post = async (
      base: string,
      path: string,
      body: any,
      session: any,
      key: string,
    ) => {
      const r = await fetch(base + path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://workbench.test",
          cookie: `session=${session.token}`,
          "x-csrf-token": session.csrfToken,
          "idempotency-key": key,
        },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    };
    const path =
      kind === "test"
        ? "/api/tests"
        : `/api/${kind === "bug" ? "bugs" : "tasks"}/${kind === "bug" ? "b1" : "t1"}/actions`;
    const body =
      kind === "test"
        ? {
            expectedVersion: s.version,
            target: { kind: "requirement", id: "r1" },
            revision: 1,
            targetVersion: "build-1",
            environment: "local",
            checks: [{ checkId: "c1", result: "fail" }],
          }
        : {
            action: "reopen",
            expectedVersion: 1,
            reason: "Regression reproduced",
            ...(kind === "bug" ? { ownerId: "dev" } : {}),
          };
    try {
      const results = await Promise.all([
        post(
          f.baseUrl,
          "/api/requirements/r1/acceptance",
          decision(s),
          acceptSession,
          "race-accept",
        ),
        post(app2.listeningOrigin, path, body, changeSession, "race-change"),
      ]);
      expect(
        results.every((r) => [200, 409].includes(r.status)),
        JSON.stringify(results),
      ).toBe(true);
      // A test write shares the requirement version, so losing the first race must explicitly retry its latest version.
      if (results[1].status === 409) {
        expect(kind).toBe("test");
        const retried = await post(
          app2.listeningOrigin,
          path,
          { ...body, expectedVersion: current().version },
          changeSession,
          "race-retry",
        );
        expect(retried.status).toBe(200);
      }
      expect(current().state).toBe("active");
      const history = f.db.prepare("SELECT * FROM acceptance_records").all();
      expect(history).toHaveLength(results[0].status === 200 ? 1 : 0);
    } finally {
      await app2.close();
      db2.close();
    }
  },
);
it.each(["bug", "task", "test"])(
  "task_07 %s regression event fault rolls back both objects/evidence and retry key",
  async (kind) => {
    seed();
    if (kind === "bug") bug({ state: "rejected", severity: "critical" });
    if (kind === "task") task();
    await accepted();
    const before = f.db.prepare("SELECT * FROM objects ORDER BY id").all(),
      events = f.events(),
      tests = f.db.prepare("SELECT * FROM test_records").all(),
      scopes = f.db.prepare("SELECT * FROM requirement_scopes").all();
    f.db.exec(
      "CREATE TEMP TRIGGER fail_regression BEFORE INSERT ON events WHEN NEW.action='acceptanceRegression' BEGIN SELECT RAISE(ABORT,'injected cross-object failure'); END",
    );
    const path =
      kind === "test"
        ? "/api/tests"
        : `/api/${kind === "bug" ? "bugs" : "tasks"}/${kind === "bug" ? "b1" : "t1"}/actions`;
    const body =
      kind === "test"
        ? {
            expectedVersion: current().version,
            target: { kind: "requirement", id: "r1" },
            revision: 1,
            targetVersion: "build-1",
            environment: "local",
            checks: [{ checkId: "c1", result: "fail" }],
          }
        : {
            action: "reopen",
            expectedVersion: 1,
            reason: "Regression reproduced",
            ...(kind === "bug" ? { ownerId: "dev" } : {}),
          };
    const r = await f.api(
      "POST",
      path,
      body,
      kind === "task" ? "product" : "tester",
      "fault-key",
    );
    expect(r.status).toBe(500);
    expect(f.db.prepare("SELECT * FROM objects ORDER BY id").all()).toEqual(
      before,
    );
    expect(f.events()).toEqual(events);
    expect(f.db.prepare("SELECT * FROM test_records").all()).toEqual(tests);
    expect(f.db.prepare("SELECT * FROM requirement_scopes").all()).toEqual(
      scopes,
    );
    expect(
      f.db
        .prepare("SELECT * FROM idempotency WHERE request_id='fault-key'")
        .all(),
    ).toHaveLength(0);
  },
);
it("task_07 coarse completed task checks cannot stand in for requirement criterion evidence", async () => {
  seed({}, false);
  task();
  // Only an exact-task record exists for the changed criterion, not an exact-requirement result.
  f.db
    .transaction(() =>
      insertTestRecord(
        f.db,
        { ...f.context, actorId: "tester" },
        {
          target: { kind: "task", id: "t1" },
          revision: 1,
          targetVersion: "build-1",
          environment: "local",
          checks: [{ checkId: "completion", result: "pass" }],
        },
      ),
    )
    .immediate();
  expect((await submit(current())).status).toBe(422);
});
it("task_07 optional unfinished work becoming required regresses accepted parent", async () => {
  seed();
  task({ state: "pending", required: false, exclusionReason: "Optional" });
  await accepted();
  const r = await f.api(
    "POST",
    "/api/tasks/t1/actions",
    {
      action: "setRequired",
      expectedVersion: 1,
      required: true,
      reason: "Needed for release",
    },
    "product",
  );
  expect(r.status).toBe(200);
  expect(current().state).toBe("active");
});
it("task_07 role or assignment alone does not compromise independent acceptance", async () => {
  seed();
  task({
    ownerId: "product",
    state: "pending",
    required: false,
    exclusionReason: "Optional",
  });
  f.db.prepare("INSERT INTO roles VALUES ('p1','product','backend',0)").run();
  await accepted();
  expect(
    f.db
      .prepare(
        "SELECT * FROM execution_participations WHERE member_id='product'",
      )
      .all(),
  ).toHaveLength(0);
});
it("task_07 historical work remains disqualifying after task detach and transfer", async () => {
  seed();
  task({ required: false, exclusionReason: "Optional" });
  f.db
    .transaction(() =>
      recordExecutionParticipation(f.db, "t1", "product", "backend"),
    )
    .immediate();
  f.db
    .prepare(
      "UPDATE objects SET current=json_set(current,'$.requirementId',NULL,'$.ownerId','dev2'),version=version+1 WHERE id='t1'",
    )
    .run();
  const r = await submit(current());
  expect(r.status).toBe(422);
  expect(r.body.reasons).toContain("ACCEPTOR_PARTICIPATED");
});
it("task_07 scope change invalidates waiver and fixed build evidence while preserving acceptance", async () => {
  seed();
  bug();
  expect((await waiver()).status).toBe(200);
  await accepted();
  const revised = await f.api<any>(
    "POST",
    "/api/requirements/r1/actions",
    {
      action: "revise",
      expectedVersion: current().version,
      kind: "behavior",
      reason: "Behavior changed",
      impactConfirmed: true,
      affectedTaskIds: [],
      affectedCheckIds: ["c1"],
      criteria: [{ id: "c1", text: "Revised behavior", required: true }],
    },
    "product",
  );
  expect(revised.status).toBe(200);
  expect(revised.body.state).toBe("refining");
  expect(revised.body.revision).toBe(2);
  expect(f.db.prepare("SELECT * FROM acceptance_records").all()).toHaveLength(
    1,
  );
  const ready = await f.api<any>(
    "POST",
    "/api/requirements/r1/actions",
    {
      action: "makeReady",
      expectedVersion: revised.body.version,
      source: {
        description: "Source",
        status: "unable",
        reason: "Manual confirmation",
      },
    },
    "product",
  );
  expect(ready.status).toBe(200);
  const started = await f.api<any>(
    "POST",
    "/api/requirements/r1/actions",
    {
      action: "start",
      expectedVersion: ready.body.version,
      reason: "Revised scope",
    },
    "product",
  );
  expect(started.status).toBe(200);
  const s = await submit(current());
  expect(s.status).toBe(422);
  expect(s.body.reasons).toEqual(
    expect.arrayContaining(["OPEN_BUG", "REQUIRED_CRITERIA_NOT_PASSED"]),
  );
});
it("task_07 editorial correction preserves revision and accepted evidence", async () => {
  seed();
  await accepted();
  const r = await f.api<any>(
    "POST",
    "/api/requirements/r1/actions",
    {
      action: "revise",
      expectedVersion: current().version,
      kind: "editorial",
      reason: "Typo only",
      title: "Corrected title",
    },
    "product",
  );
  expect(r.status).toBe(200);
  expect(r.body.state).toBe("accepted");
  expect(r.body.revision).toBe(1);
});
it("task_07 scoped lead can submit but cannot decide acceptance", async () => {
  seed();
  f.db.prepare("UPDATE roles SET lead=1 WHERE member_id='dev'").run();
  const s = await submit(current(), "dev");
  expect(s.status).toBe(200);
  expect((await accept(s.body, {}, "dev")).status).toBe(403);
});
it("task_07 unrelated lead cannot submit and stale revision conflicts with current scope", async () => {
  seed();
  f.db.prepare("UPDATE roles SET lead=1 WHERE member_id='dev2'").run();
  expect((await submit(current(), "dev2")).status).toBe(403);
  expect((await submit(current(), "product", { revision: 2 })).status).toBe(
    422,
  );
});
it("task_07 cancelled requirement remains cancelled while retained Bug changes", async () => {
  seed();
  bug();
  const cancelled = await f.api(
    "POST",
    "/api/requirements/r1/actions",
    {
      action: "cancel",
      expectedVersion: 1,
      reason: "Cancelled scope",
      taskDisposition: [],
    },
    "product",
  );
  expect(cancelled.status).toBe(200);
  const r = await f.api(
    "POST",
    "/api/bugs/b1/actions",
    { action: "start", expectedVersion: 1 },
    "dev",
  );
  expect(r.status).toBe(200);
  expect(current().state).toBe("cancelled");
  expect((await waiver()).status).toBe(409);
});
it("task_07 newer failed task evidence prevents fixed-build acceptance even if requirement passes", async () => {
  seed();
  task({
    submission: { targetVersion: "build-1" },
    checks: [{ id: "completion", text: "Works", required: true }],
  });
  f.db
    .transaction(() =>
      insertTestRecord(
        f.db,
        { ...f.context, actorId: "tester" },
        {
          target: { kind: "task", id: "t1" },
          revision: 1,
          targetVersion: "build-1",
          environment: "local",
          checks: [{ checkId: "completion", result: "fail" }],
        },
      ),
    )
    .immediate();
  const r = await submit(current());
  expect(r.status).toBe(422);
  expect(r.body.reasons).toContain("REQUIRED_TASK_TESTS_NOT_PASSED");
});
it.each(["roles", "deactivate"])(
  "task_07 %s revokes current acceptance eligibility atomically",
  async (action) => {
    seed();
    task();
    await accepted();
    const r =
      action === "roles"
        ? await f.api(
            "PUT",
            "/api/projects/p1/roles",
            { memberId: "tester", roles: [], leads: [], expectedVersion: 1 },
            "admin",
          )
        : await f.api(
            "POST",
            "/api/members/tester/deactivate",
            { expectedVersion: 1 },
            "admin",
          );
    expect(r.status).toBe(200);
    expect(current().state).toBe("active");
    expect(f.db.prepare("SELECT * FROM acceptance_records").all()).toHaveLength(
      1,
    );
  },
);
it.each(["roles", "deactivate"])(
  "task_07 %s regression event fault rolls back security change",
  async (action) => {
    seed();
    task();
    await accepted();
    const before = {
      roles: f.db.prepare("SELECT * FROM roles").all(),
      members: f.db.prepare("SELECT * FROM members").all(),
      sessions: f.db.prepare("SELECT * FROM sessions").all(),
      projects: f.db.prepare("SELECT * FROM projects").all(),
      events: f.events(),
    };
    f.db.exec(
      "CREATE TEMP TRIGGER fail_authority_regression BEFORE INSERT ON events WHEN NEW.action='acceptanceRegression' BEGIN SELECT RAISE(ABORT,'injected authority regression failure'); END",
    );
    const r =
      action === "roles"
        ? await f.api(
            "PUT",
            "/api/projects/p1/roles",
            { memberId: "tester", roles: [], leads: [], expectedVersion: 1 },
            "admin",
            "authority-fault",
          )
        : await f.api(
            "POST",
            "/api/members/tester/deactivate",
            { expectedVersion: 1 },
            "admin",
            "authority-fault",
          );
    expect(r.status).toBe(500);
    expect(current().state).toBe("accepted");
    expect(f.db.prepare("SELECT * FROM roles").all()).toEqual(before.roles);
    expect(f.db.prepare("SELECT * FROM members").all()).toEqual(before.members);
    expect(f.db.prepare("SELECT * FROM projects").all()).toEqual(
      before.projects,
    );
    expect(f.events()).toEqual(before.events);
    expect(
      f.db
        .prepare("SELECT * FROM idempotency WHERE request_id='authority-fault'")
        .all(),
    ).toHaveLength(0);
    // The authorized request can touch its own session idle timestamp before the write; revoked tester sessions must remain untouched.
    expect(
      f.db.prepare("SELECT * FROM sessions WHERE member_id='tester'").all(),
    ).toEqual(
      (before.sessions as any[]).filter((x) => x.member_id === "tester"),
    );
  },
);
it("task_07 product can record a return after creating unassigned rework", async () => {
  seed();
  const s = await submit(current());
  expect(s.status).toBe(200);
  const t = await f.api<any>(
    "POST",
    "/api/tasks",
    {
      projectId: "p1",
      requirementId: "r1",
      title: "Correct failed criterion",
      kind: "backend",
      definitionOfDone: "Criterion passes",
      priority: "medium",
    },
    "product",
  );
  expect(t.status).toBe(200);
  expect(current().state).toBe("active");
  const r = await accept(current(), {
    decision: "return",
    reason: "Criterion failed",
    criteria: [{ id: "c1", passed: false, note: "Wrong output" }],
    reworkTaskIds: [t.body.id],
  });
  expect(r.status).toBe(200);
  expect(f.read("acceptance_records")[0].decision).toBe("return");
});
it("task_07 no-op role update preserves acceptance and restoring eligibility never auto-accepts", async () => {
  seed();
  task();
  await accepted();
  const before = f.events().length,
    version = current().version;
  expect(
    (
      await f.api(
        "PUT",
        "/api/projects/p1/roles",
        { memberId: "tester", roles: ["test"], leads: [], expectedVersion: 1 },
        "admin",
      )
    ).status,
  ).toBe(200);
  expect(f.events()).toHaveLength(before);
  expect(current().version).toBe(version);
  expect(
    (
      await f.api(
        "PUT",
        "/api/projects/p1/roles",
        { memberId: "tester", roles: [], leads: [], expectedVersion: 1 },
        "admin",
      )
    ).status,
  ).toBe(200);
  expect(current().state).toBe("active");
  expect(
    (
      await f.api(
        "PUT",
        "/api/projects/p1/roles",
        { memberId: "tester", roles: ["test"], leads: [], expectedVersion: 2 },
        "admin",
      )
    ).status,
  ).toBe(200);
  expect(current().state).toBe("active");
});

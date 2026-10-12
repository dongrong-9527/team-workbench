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
  title: "Validation defect",
  role: "backend",
  expected: "Reject invalid input",
  actual: "Input accepted",
  reproduction: "Submit invalid input",
  environment: "local",
  severity: "normal",
  priority: "high",
};
async function create(extra: any = {}) {
  const r = await f.api<any>(
    "POST",
    "/api/bugs",
    { ...input, ...extra },
    extra.ownerId !== undefined ? "product" : "tester",
  );
  expect(r.status).toBe(200);
  return r.body;
}
async function act(
  b: any,
  action: string,
  extra: any = {},
  actor: any = "tester",
  key?: string,
) {
  return f.api<any>(
    "POST",
    `/api/bugs/${b.id}/actions`,
    { action, expectedVersion: b.version, ...extra },
    actor,
    key,
  );
}
async function pending(extra: any = {}) {
  let b = await create(extra);
  b = (await act(b, "confirm", { reason: "Reproduced" })).body;
  b = (await act(b, "claim", {}, "dev")).body;
  b = (await act(b, "start", {}, "dev")).body;
  b = (
    await act(
      b,
      "submit",
      {
        evidence: {
          fix: "Validation fixed",
          impact: "Input path",
          selfCheck: "Local cases pass",
          targetVersion: "build-1",
          environment: "local",
        },
      },
      "dev",
    )
  ).body;
  expect(b.state).toBe("pending_verify");
  return b;
}
const testInput = (b: any, result = "pass", checks?: any[]) => ({
  target: { kind: "bug", id: b.id },
  targetVersion: "build-1",
  environment: "local",
  checks: checks ?? [
    { checkId: "reproduction", result, note: "Observed result" },
  ],
});
it("task_06 verification fail preserves prior pass evidence and reopen count", async () => {
  let b = await pending();
  let r = await act(b, "verifyPass", { test: testInput(b) });
  expect(r.status).toBe(200);
  b = r.body;
  expect(b.state).toBe("closed");
  b = (await act(b, "reopen", { reason: "Reproduced again", ownerId: "dev" }))
    .body;
  expect(b.reopenCount).toBe(1);
  b = (await act(b, "start", {}, "dev")).body;
  b = (
    await act(
      b,
      "submit",
      {
        evidence: {
          fix: "Second fix",
          impact: "Input",
          selfCheck: "Pass",
          targetVersion: "build-1",
          environment: "local",
        },
      },
      "dev",
    )
  ).body;
  r = await act(b, "verifyFail", { test: testInput(b, "fail") });
  expect(r.status).toBe(200);
  expect(r.body.state).toBe("fixing");
  const rows = (await f.api<any>("GET", `/api/tests?kind=bug&id=${b.id}`)).body;
  expect(rows.map((x: any) => x.checks[0].result)).toEqual(["pass", "fail"]);
  expect(rows[1].recordedSeq).toBeGreaterThan(rows[0].recordedSeq);
  expect(() => f.db.prepare("DELETE FROM test_records").run()).toThrow();
});
it("task_06 two SQLite connections serialize claim without starting repair", async () => {
  let b = await create();
  b = (await act(b, "confirm", { reason: "Reproduced" })).body;
  const db2 = openDb(f.path),
    app2 = buildApp(db2, { origin: "https://workbench.test" });
  await app2.listen({ host: "127.0.0.1", port: 0 });
  const s1 = issueSession(f.db, "dev"),
    s2 = issueSession(db2, "dev2");
  const post = async (base: string, s: any, key: string) => {
    const r = await fetch(`${base}/api/bugs/${b.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: "claim", expectedVersion: b.version }),
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
      post(f.baseUrl, s1, "race1"),
      post(app2.listeningOrigin, s2, "race2"),
    ]);
    expect(rs.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(rs.find((x) => x.status === 200)!.body.state).toBe("ready");
    expect(
      f.db.prepare("SELECT * FROM execution_participations").all(),
    ).toHaveLength(0);
  } finally {
    await app2.close();
    db2.close();
  }
});
it("task_06 actual repair participation derives selfTest and caller cannot forge provenance", async () => {
  f.db.prepare("INSERT INTO roles VALUES ('p1','dev','test',0)").run();
  const b = await pending();
  const r = await act(b, "verifyPass", { test: testInput(b) }, "dev");
  expect(r.status).toBe(200);
  const rows = (await f.api<any>("GET", "/api/tests")).body;
  expect(rows[0].testerId).toBe("dev");
  expect(rows[0].selfTest).toBe(true);
  expect(
    f.db
      .prepare("SELECT * FROM execution_participations WHERE activity='repair'")
      .all(),
  ).toHaveLength(2);
  expect(
    (
      await f.api(
        "POST",
        "/api/tests",
        {
          ...testInput(r.body),
          expectedVersion: r.body.version,
          testerId: "tester",
        },
        "dev",
      )
    ).status,
  ).toBe(400);
});
it("task_06 missing mandatory checks and newer untested never close via partial evidence", async () => {
  let b = await pending();
  b = (
    await act(
      b,
      "defineChecks",
      {
        checks: [
          { id: "reproduction", text: "Original case", required: true },
          { id: "edge", text: "Edge case", required: true },
        ],
      },
      "product",
    )
  ).body;
  let r = await f.api<any>(
    "POST",
    "/api/tests",
    { ...testInput(b), expectedVersion: b.version },
    "tester",
  );
  expect(r.status).toBe(200);
  expect((await f.api<any>("GET", `/api/bugs/${b.id}`)).body.state).toBe(
    "pending_verify",
  );
  b = (await f.api<any>("GET", `/api/bugs/${b.id}`)).body;
  r = await act(b, "verifyPass", {
    test: testInput(b, "pass", [{ checkId: "edge", result: "untested" }]),
  });
  expect(r.status).toBe(422);
  expect((await f.api<any>("GET", "/api/tests")).body).toHaveLength(1);
});
it("task_06 direct tests enforce pending state, explicit role, current session and archive before replay", async () => {
  const fresh = await create({ ownerId: "dev" });
  expect(
    (
      await f.api(
        "POST",
        "/api/tests",
        { ...testInput(fresh), expectedVersion: fresh.version },
        "tester",
      )
    ).status,
  ).toBe(409);
  expect(
    (await f.api("POST", "/api/bugs", { ...input, role: undefined }, "tester"))
      .status,
  ).toBe(400);
  let b = await pending();
  const body = { ...testInput(b), expectedVersion: b.version };
  expect(
    (await f.api("POST", "/api/tests", body, "tester", "test-key")).status,
  ).toBe(200);
  f.db
    .prepare("DELETE FROM roles WHERE member_id='tester' AND role='test'")
    .run();
  expect(
    (await f.api("POST", "/api/tests", body, "tester", "test-key")).status,
  ).toBe(403);
  f.db.prepare("INSERT INTO roles VALUES ('p1','tester','test',0)").run();
  f.db
    .prepare("UPDATE projects SET archived=1,version=version+1 WHERE id='p1'")
    .run();
  expect(
    (await f.api("POST", "/api/tests", body, "tester", "test-key")).status,
  ).toBe(409);
});
it("task_06 cross-project and inconsistent links reject, independent severity and priority remain", async () => {
  f.db.prepare("INSERT INTO roles VALUES ('p2','tester','test',0)").run();
  const r = await f.api<any>(
    "POST",
    "/api/requirements",
    {
      projectId: "p1",
      title: "Requirement",
      source: { description: "Source" },
      description: "Scope",
      criteria: [],
      priority: "medium",
    },
    "product",
  );
  expect(
    (
      await f.api(
        "POST",
        "/api/bugs",
        { ...input, projectId: "p2", requirementId: r.body.id },
        "tester",
      )
    ).status,
  ).toBe(422);
  const b = await create({ severity: "minor", priority: "high" });
  expect(b.severity).toBe("minor");
  expect(b.priority).toBe("high");
  expect(
    (
      await act(b, "reject", {
        reason: "duplicate",
        explanation: "Same issue",
        duplicateOfId: b.id,
      })
    ).status,
  ).toBe(422);
});
it("task_06 submit needs exact build and test event failure rolls back every effect", async () => {
  let b = await create();
  b = (await act(b, "confirm", { reason: "Reproduced" })).body;
  b = (await act(b, "claim", {}, "dev")).body;
  b = (await act(b, "start", {}, "dev")).body;
  expect(
    (
      await act(
        b,
        "submit",
        {
          evidence: {
            fix: "fix",
            impact: "path",
            selfCheck: "pass",
            environment: "local",
          },
        },
        "dev",
      )
    ).status,
  ).toBe(422);
  b = (
    await act(
      b,
      "submit",
      {
        evidence: {
          fix: "fix",
          impact: "path",
          selfCheck: "pass",
          environment: "local",
          targetVersion: "build-1",
        },
      },
      "dev",
    )
  ).body;
  await f.failNextEvent();
  expect((await act(b, "verifyPass", { test: testInput(b) })).status).toBe(500);
  expect((await f.api<any>("GET", `/api/bugs/${b.id}`)).body.state).toBe(
    "pending_verify",
  );
  expect((await f.api<any>("GET", "/api/tests")).body).toHaveLength(0);
  expect((await act(b, "verifyPass", { test: testInput(b) })).status).toBe(200);
});
async function requirement() {
  const r = await f.api<any>(
    "POST",
    "/api/requirements",
    {
      projectId: "p1",
      title: "Scope",
      source: { description: "Source" },
      description: "Scope",
      criteria: [
        { id: "c1", text: "Main case", required: true },
        { id: "c2", text: "Other case", required: true },
      ],
      priority: "medium",
      acceptorId: "product",
    },
    "product",
  );
  expect(r.status).toBe(200);
  let x = (
    await f.api<any>(
      "POST",
      `/api/requirements/${r.body.id}/actions`,
      { action: "refine", expectedVersion: 1 },
      "product",
    )
  ).body;
  x = (
    await f.api<any>(
      "POST",
      `/api/requirements/${x.id}/actions`,
      {
        action: "makeReady",
        expectedVersion: x.version,
        source: { description: "Source", status: "unable", reason: "offline" },
      },
      "product",
    )
  ).body;
  expect(x.state).toBe("ready");
  return x;
}
it("task_06 requirement latest per-check exact revision and build never implies missing pass", async () => {
  const r = await requirement();
  const post = async (result: string, build = "build-1", checks?: any[]) => {
    const x = (await f.api<any>("GET", `/api/requirements/${r.id}`)).body;
    return f.api<any>(
      "POST",
      "/api/tests",
      {
        target: { kind: "requirement", id: r.id },
        revision: 1,
        targetVersion: build,
        environment: "local",
        expectedVersion: x.version,
        checks: checks ?? [{ checkId: "c1", result }],
      },
      "tester",
    );
  };
  expect((await post("pass")).status).toBe(200);
  expect((await post("fail")).status).toBe(200);
  expect((await post("untested")).status).toBe(200);
  const gate = await f.api<any>(
    "GET",
    `/api/tests/coverage?kind=requirement&id=${r.id}&revision=1&targetVersion=build-1`,
  );
  expect(gate.body.passed).toBe(false);
  expect(gate.body.checks.map((x: any) => x.result)).toEqual([
    "untested",
    "untested",
  ]);
  expect(
    (
      await post("pass", "build-2", [
        { checkId: "c1", result: "pass" },
        { checkId: "c2", result: "pass" },
      ])
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api<any>(
        "GET",
        `/api/tests/coverage?kind=requirement&id=${r.id}&revision=1&targetVersion=build-1`,
      )
    ).body.passed,
  ).toBe(false);
  expect(
    (await post("pass", "build-1", [{ checkId: "unknown", result: "pass" }]))
      .status,
  ).toBe(422);
});
it("task_06 cancelled requirement keeps Bug repair lineage without reviving parent", async () => {
  const r = await requirement();
  let b = await create({ requirementId: r.id });
  expect(
    (
      await f.api(
        "POST",
        `/api/requirements/${r.id}/actions`,
        {
          action: "cancel",
          expectedVersion: r.version,
          reason: "Stop scope",
          taskDisposition: [],
        },
        "product",
      )
    ).status,
  ).toBe(200);
  b = (await act(b, "confirm", { reason: "Still project issue" })).body;
  b = (await act(b, "claim", {}, "dev")).body;
  b = (await act(b, "start", {}, "dev")).body;
  b = (
    await act(
      b,
      "submit",
      {
        evidence: {
          fix: "fix",
          impact: "path",
          selfCheck: "pass",
          environment: "local",
          targetVersion: "build-1",
        },
      },
      "dev",
    )
  ).body;
  expect(
    (await act(b, "verifyPass", { test: { ...testInput(b), revision: 1 } }))
      .status,
  ).toBe(200);
  expect(
    (await f.api<any>("GET", `/api/requirements/${r.id}`)).body.state,
  ).toBe("cancelled");
  expect(
    (
      f.db
        .prepare(
          "SELECT requirement_id FROM execution_participations WHERE object_id=?",
        )
        .all(b.id) as any[]
    ).map((x) => x.requirement_id),
  ).toEqual([r.id, r.id]);
});
it("task_06 direct task canonical tests require designated reviewer and actual submitted build", async () => {
  let t = (
    await f.api<any>(
      "POST",
      "/api/tasks",
      {
        projectId: "p1",
        title: "Implement",
        kind: "backend",
        definitionOfDone: "Check completion",
        priority: "medium",
        ownerId: "dev",
        reviewerId: "tester",
      },
      "product",
    )
  ).body;
  const ti = {
    target: { kind: "task", id: t.id },
    targetVersion: "build-1",
    environment: "local",
    checks: [{ checkId: "completion", result: "pass" }],
  };
  expect(
    (
      await f.api(
        "POST",
        "/api/tests",
        { ...ti, expectedVersion: t.version },
        "tester",
      )
    ).status,
  ).toBe(409);
  t = (
    await f.api<any>(
      "POST",
      `/api/tasks/${t.id}/actions`,
      { action: "start", expectedVersion: t.version },
      "dev",
    )
  ).body;
  t = (
    await f.api<any>(
      "POST",
      `/api/tasks/${t.id}/actions`,
      {
        action: "submit",
        expectedVersion: t.version,
        evidence: {
          done: "done",
          selfCheck: "pass",
          environment: "local",
          targetVersion: "build-1",
        },
      },
      "dev",
    )
  ).body;
  expect(t.state).toBe("pending_check");
  expect(
    (
      await f.api(
        "POST",
        "/api/tests",
        { ...ti, targetVersion: "build-2", expectedVersion: t.version },
        "tester",
      )
    ).status,
  ).toBe(422);
  f.db.prepare("INSERT INTO roles VALUES ('p1','product','test',0)").run();
  expect(
    (
      await f.api(
        "POST",
        "/api/tests",
        { ...ti, expectedVersion: t.version },
        "product",
      )
    ).status,
  ).toBe(403);
  const resp = await f.api<any>(
    "POST",
    "/api/tests",
    { ...ti, expectedVersion: t.version },
    "tester",
  );
  expect(resp.status).toBe(200);
  expect((await f.api<any>("GET", `/api/tasks/${t.id}`)).body.state).toBe(
    "done",
  );
  expect(f.db.prepare("SELECT * FROM task_checks").all()).toHaveLength(1);
});
it("task_06 reuse rejects changed check across intervening revisions and wrong source check or build", async () => {
  let r = await requirement();
  const source = await f.api<any>(
    "POST",
    "/api/tests",
    {
      target: { kind: "requirement", id: r.id },
      revision: 1,
      targetVersion: "build-1",
      environment: "local",
      expectedVersion: r.version,
      checks: [
        { checkId: "c1", result: "pass" },
        { checkId: "c2", result: "pass" },
      ],
    },
    "tester",
  );
  expect(source.status).toBe(200);
  r = (await f.api<any>("GET", `/api/requirements/${r.id}`)).body;
  let rev = await f.api<any>(
    "POST",
    `/api/requirements/${r.id}/actions`,
    {
      action: "revise",
      expectedVersion: r.version,
      kind: "behavior",
      reason: "New behavior",
      affectedTaskIds: [],
      affectedCheckIds: ["c1"],
      impactConfirmed: true,
      criteria: [
        { id: "c1", text: "Changed case", required: true },
        { id: "c2", text: "Other case", required: true },
      ],
    },
    "product",
  );
  expect(rev.status).toBe(200);
  r = (
    await f.api<any>(
      "POST",
      `/api/requirements/${r.id}/actions`,
      {
        action: "makeReady",
        expectedVersion: rev.body.version,
        source: { description: "Source", status: "unable", reason: "offline" },
      },
      "product",
    )
  ).body;
  const reuse = (checkId: string, build = "build-1") =>
    f.api<any>(
      "POST",
      "/api/tests",
      {
        target: { kind: "requirement", id: r.id },
        revision: r.revision,
        targetVersion: build,
        environment: "local",
        expectedVersion: r.version,
        checks: [{ checkId, result: "pass" }],
        reusedFromId: source.body.id,
        reuseReason: "Unaffected same build",
      },
      "tester",
    );
  expect((await reuse("c1")).status).toBe(422);
  expect((await reuse("c2", "build-2")).status).toBe(422);
  expect((await reuse("c2")).status).toBe(200);
});
it("task_06 same-ID definition changes invalidate old passing coverage", async () => {
  let b = await pending();
  b = (await act(b, "verifyPass", { test: testInput(b) })).body;
  expect(
    (
      await f.api<any>(
        "GET",
        `/api/tests/coverage?kind=bug&id=${b.id}&targetVersion=build-1`,
      )
    ).body.passed,
  ).toBe(true);
  b = (
    await act(
      b,
      "defineChecks",
      {
        checks: [
          { id: "reproduction", text: "New expected behavior", required: true },
        ],
      },
      "product",
    )
  ).body;
  expect(
    (
      await f.api<any>(
        "GET",
        `/api/tests/coverage?kind=bug&id=${b.id}&targetVersion=build-1`,
      )
    ).body.passed,
  ).toBe(false);
});
it("task_06 canonical failure on completed task regresses accepted parent atomically", async () => {
  const r = await requirement();
  let t = (
    await f.api<any>(
      "POST",
      "/api/tasks",
      {
        projectId: "p1",
        requirementId: r.id,
        title: "Implement",
        kind: "backend",
        definitionOfDone: "Check completion",
        priority: "medium",
        ownerId: "dev",
        reviewerId: "tester",
      },
      "product",
    )
  ).body;
  t = (
    await f.api<any>(
      "POST",
      `/api/tasks/${t.id}/actions`,
      { action: "start", expectedVersion: t.version },
      "dev",
    )
  ).body;
  t = (
    await f.api<any>(
      "POST",
      `/api/tasks/${t.id}/actions`,
      {
        action: "submit",
        expectedVersion: t.version,
        evidence: {
          done: "done",
          selfCheck: "pass",
          environment: "local",
          targetVersion: "build-1",
        },
      },
      "dev",
    )
  ).body;
  const ti = {
    target: { kind: "task", id: t.id },
    revision: 1,
    targetVersion: "build-1",
    environment: "local",
    checks: [{ checkId: "completion", result: "pass" }],
  };
  expect(
    (
      await f.api(
        "POST",
        "/api/tests",
        { ...ti, expectedVersion: t.version },
        "tester",
      )
    ).status,
  ).toBe(200);
  t = (await f.api<any>("GET", `/api/tasks/${t.id}`)).body;
  const row = f.db
    .prepare("SELECT current FROM objects WHERE id=?")
    .get(r.id) as any;
  f.db
    .prepare("UPDATE objects SET current=?,version=version+1 WHERE id=?")
    .run(
      JSON.stringify({ ...JSON.parse(row.current), state: "accepted" }),
      r.id,
    );
  const fail = {
    ...ti,
    checks: [{ checkId: "completion", result: "fail", note: "Regression" }],
    expectedVersion: t.version,
  };
  await f.failNextEvent();
  expect((await f.api("POST", "/api/tests", fail, "tester")).status).toBe(500);
  expect(
    (await f.api<any>("GET", `/api/requirements/${r.id}`)).body.state,
  ).toBe("accepted");
  expect((await f.api("POST", "/api/tests", fail, "tester")).status).toBe(200);
  expect((await f.api<any>("GET", `/api/tasks/${t.id}`)).body.state).toBe(
    "active",
  );
  expect(
    (await f.api<any>("GET", `/api/requirements/${r.id}`)).body.state,
  ).toBe("active");
});
it("task_06 required checks default true and exclusions need product confirmation and reason", async () => {
  const body = {
    projectId: "p1",
    title: "Scope",
    source: { description: "Source" },
    description: "Scope",
    criteria: [{ id: "c1", text: "Required by default" }],
    priority: "medium",
  };
  const r = await f.api<any>("POST", "/api/requirements", body, "product");
  expect(r.status).toBe(200);
  expect(r.body.criteria[0].required).toBe(true);
  expect(
    (
      await f.api(
        "POST",
        "/api/requirements",
        { ...body, criteria: [{ id: "c1", text: "Scope", required: false }] },
        "product",
      )
    ).status,
  ).toBe(400);
  f.db
    .prepare("UPDATE roles SET lead=1 WHERE member_id='dev' AND role='backend'")
    .run();
  expect(
    (
      await f.api(
        "POST",
        "/api/requirements",
        {
          ...body,
          role: "backend",
          criteria: [
            {
              id: "c1",
              text: "Scope",
              required: false,
              exclusionReason: "Out of scope",
            },
          ],
        },
        "dev",
      )
    ).status,
  ).toBe(403);
  const b = await pending();
  expect(
    (
      await act(
        b,
        "defineChecks",
        {
          checks: [
            {
              id: "reproduction",
              text: "Case",
              required: false,
              exclusionReason: "Deferred",
            },
          ],
        },
        "tester",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await act(
        b,
        "defineChecks",
        { checks: [{ id: "reproduction", text: "Case", required: false }] },
        "product",
      )
    ).status,
  ).toBe(400);
});
it("task_06 obsolete source pass cannot overwrite a newer fail by reuse", async () => {
  let r = await requirement();
  const input = {
    target: { kind: "requirement", id: r.id },
    revision: 1,
    targetVersion: "build-1",
    environment: "local",
    checks: [{ checkId: "c1", result: "pass" }],
  };
  const source = await f.api<any>(
    "POST",
    "/api/tests",
    { ...input, expectedVersion: r.version },
    "tester",
  );
  expect(source.status).toBe(200);
  r = (await f.api<any>("GET", `/api/requirements/${r.id}`)).body;
  expect(
    (
      await f.api(
        "POST",
        "/api/tests",
        {
          ...input,
          expectedVersion: r.version,
          checks: [{ checkId: "c1", result: "fail" }],
        },
        "tester",
      )
    ).status,
  ).toBe(200);
  r = (await f.api<any>("GET", `/api/requirements/${r.id}`)).body;
  expect(
    (
      await f.api(
        "POST",
        "/api/tests",
        {
          ...input,
          expectedVersion: r.version,
          reusedFromId: source.body.id,
          reuseReason: "Earlier pass",
        },
        "tester",
      )
    ).status,
  ).toBe(422);
});
it("task_06 new linked open Bug regresses accepted parent and creation failure rolls back", async () => {
  const r = await requirement();
  const row = f.db
    .prepare("SELECT current FROM objects WHERE id=?")
    .get(r.id) as any;
  f.db
    .prepare("UPDATE objects SET current=?,version=version+1 WHERE id=?")
    .run(
      JSON.stringify({ ...JSON.parse(row.current), state: "accepted" }),
      r.id,
    );
  await f.failNextEvent();
  expect(
    (
      await f.api(
        "POST",
        "/api/bugs",
        { ...input, requirementId: r.id },
        "tester",
      )
    ).status,
  ).toBe(500);
  expect(
    (await f.api<any>("GET", `/api/requirements/${r.id}`)).body.state,
  ).toBe("accepted");
  await create({ requirementId: r.id });
  expect(
    (await f.api<any>("GET", `/api/requirements/${r.id}`)).body.state,
  ).toBe("active");
});
it("task_06 excluded-only checklist cannot close with untested evidence", async () => {
  let b = await pending();
  b = (
    await act(
      b,
      "defineChecks",
      {
        checks: [
          {
            id: "reproduction",
            text: "Case",
            required: false,
            exclusionReason: "Deferred",
          },
        ],
      },
      "product",
    )
  ).body;
  expect(
    (await act(b, "verifyPass", { test: testInput(b, "untested") })).status,
  ).toBe(422);
});
it("task_06 reporter cannot assign repair ownership during registration", async () => {
  expect(
    (await f.api("POST", "/api/bugs", { ...input, ownerId: "dev" }, "tester"))
      .status,
  ).toBe(403);
  const r = await f.api<any>(
    "POST",
    "/api/bugs",
    { ...input, ownerId: "dev" },
    "product",
  );
  expect(r.status).toBe(200);
  expect(r.body.ownerId).toBe("dev");
});
it("task_06 stale tests and archived or disabled sessions cannot mutate or replay", async () => {
  const b = await pending();
  const body = { ...testInput(b), expectedVersion: b.version };
  const first = await f.api<any>(
    "POST",
    "/api/tests",
    body,
    "tester",
    "repeat",
  );
  expect(first.status).toBe(200);
  expect(
    (await f.api("POST", "/api/tests", body, "tester", "stale")).status,
  ).toBe(409);
  expect((await f.api<any>("GET", "/api/tests")).body).toHaveLength(1);
  f.db.prepare("UPDATE members SET active=0 WHERE id='tester'").run();
  expect(
    (await f.api("POST", "/api/tests", body, "tester", "repeat")).status,
  ).toBe(401);
});
it("task_06 requirement self-test derives actual historical linked work rather than owner", async () => {
  const r = await requirement();
  f.db.prepare("INSERT INTO roles VALUES ('p1','dev','test',0)").run();
  let t = (
    await f.api<any>(
      "POST",
      "/api/tasks",
      {
        projectId: "p1",
        requirementId: r.id,
        title: "Implement",
        kind: "backend",
        definitionOfDone: "Done",
        priority: "medium",
        ownerId: "dev",
        reviewerId: "tester",
      },
      "product",
    )
  ).body;
  t = (
    await f.api<any>(
      "POST",
      `/api/tasks/${t.id}/actions`,
      { action: "start", expectedVersion: t.version },
      "dev",
    )
  ).body;
  const current = (await f.api<any>("GET", `/api/requirements/${r.id}`)).body;
  const result = await f.api<any>(
    "POST",
    "/api/tests",
    {
      target: { kind: "requirement", id: r.id },
      revision: 1,
      targetVersion: "build-1",
      environment: "local",
      checks: [{ checkId: "c1", result: "pass" }],
      expectedVersion: current.version,
    },
    "dev",
  );
  expect(result.status).toBe(200);
  expect(result.body.selfTest).toBe(true);
});
it("task_06 canonical failedTest fixture retains old pass and verifies fail through real route", async () => {
  const input = f.seed("failedTest");
  const r = await f.api<any>(
    "POST",
    "/api/bugs/b1/actions",
    { action: "verifyFail", expectedVersion: 4, test: input },
    "tester",
    "vf-1",
  );
  expect(r.status).toBe(200);
  expect(r.body.state).toBe("fixing");
  expect(f.read("test_records").at(-1)?.checks[0].result).toBe("fail");
  expect(f.read("test_records")).toHaveLength(2);
});
it("task_06 unaffected later revisions permit reuse of a fresh pass after earlier impact", async () => {
  let r = await requirement();
  const revise = async (checkId: string, text: string) => {
    r = (await f.api<any>("GET", `/api/requirements/${r.id}`)).body;
    const next = await f.api<any>(
      "POST",
      `/api/requirements/${r.id}/actions`,
      {
        action: "revise",
        expectedVersion: r.version,
        kind: "behavior",
        reason: "Behavior changes",
        affectedTaskIds: [],
        affectedCheckIds: [checkId],
        impactConfirmed: true,
        criteria: r.criteria.map((c: any) =>
          c.id === checkId ? { ...c, text } : c,
        ),
      },
      "product",
    );
    expect(next.status).toBe(200);
    r = (
      await f.api<any>(
        "POST",
        `/api/requirements/${r.id}/actions`,
        {
          action: "makeReady",
          expectedVersion: next.body.version,
          source: {
            description: "Source",
            status: "unable",
            reason: "offline",
          },
        },
        "product",
      )
    ).body;
  };
  await revise("c1", "Changed main case");
  const source = await f.api<any>(
    "POST",
    "/api/tests",
    {
      target: { kind: "requirement", id: r.id },
      revision: r.revision,
      targetVersion: "build-1",
      environment: "local",
      expectedVersion: r.version,
      checks: [{ checkId: "c1", result: "pass" }],
    },
    "tester",
  );
  expect(source.status).toBe(200);
  await revise("c2", "Changed other case");
  const result = await f.api(
    "POST",
    "/api/tests",
    {
      target: { kind: "requirement", id: r.id },
      revision: r.revision,
      targetVersion: "build-1",
      environment: "local",
      expectedVersion: r.version,
      checks: [{ checkId: "c1", result: "pass" }],
      reusedFromId: source.body.id,
      reuseReason: "Fresh main-case pass unaffected by other-case change",
    },
    "tester",
  );
  expect(result.status).toBe(200);
});
it("task_06 failure on product-excluded check does not invalidate mandatory passing evidence", async () => {
  let r = await requirement();
  r = (
    await f.api<any>(
      "POST",
      `/api/requirements/${r.id}/actions`,
      {
        action: "revise",
        expectedVersion: r.version,
        kind: "behavior",
        reason: "Exclude optional case",
        affectedTaskIds: [],
        affectedCheckIds: ["c2"],
        impactConfirmed: true,
        criteria: [
          { id: "c1", text: "Main case", required: true },
          {
            id: "c2",
            text: "Other case",
            required: false,
            exclusionReason: "Outside release scope",
          },
        ],
      },
      "product",
    )
  ).body;
  r = (
    await f.api<any>(
      "POST",
      `/api/requirements/${r.id}/actions`,
      {
        action: "makeReady",
        expectedVersion: r.version,
        source: { description: "Source", status: "unable", reason: "offline" },
      },
      "product",
    )
  ).body;
  expect(
    (
      await f.api(
        "POST",
        "/api/tests",
        {
          target: { kind: "requirement", id: r.id },
          revision: r.revision,
          targetVersion: "build-1",
          environment: "local",
          checks: [{ checkId: "c1", result: "pass" }],
          expectedVersion: r.version,
        },
        "tester",
      )
    ).status,
  ).toBe(200);
  await establishAcceptance(r.id);
  r = (await f.api<any>("GET", `/api/requirements/${r.id}`)).body;
  expect(
    (
      await f.api(
        "POST",
        "/api/tests",
        {
          target: { kind: "requirement", id: r.id },
          revision: r.revision,
          targetVersion: "build-1",
          environment: "local",
          checks: [{ checkId: "c2", result: "fail" }],
          expectedVersion: r.version,
        },
        "tester",
      )
    ).status,
  ).toBe(200);
  expect(
    (await f.api<any>("GET", `/api/requirements/${r.id}`)).body.state,
  ).toBe("accepted");
});
it("task_06 optional task failure reopens task without regressing accepted requirement", async () => {
  const r = await requirement();
  let t = (
    await f.api<any>(
      "POST",
      "/api/tasks",
      {
        projectId: "p1",
        requirementId: r.id,
        title: "Optional improvement",
        kind: "backend",
        definitionOfDone: "Done",
        priority: "medium",
        ownerId: "dev",
        reviewerId: "tester",
        required: false,
        exclusionReason: "Outside release",
      },
      "product",
    )
  ).body;
  t = (
    await f.api<any>(
      "POST",
      `/api/tasks/${t.id}/actions`,
      { action: "start", expectedVersion: t.version },
      "dev",
    )
  ).body;
  t = (
    await f.api<any>(
      "POST",
      `/api/tasks/${t.id}/actions`,
      {
        action: "submit",
        expectedVersion: t.version,
        evidence: {
          done: "done",
          selfCheck: "pass",
          environment: "local",
          targetVersion: "build-1",
        },
      },
      "dev",
    )
  ).body;
  const ti = {
    target: { kind: "task", id: t.id },
    revision: 1,
    targetVersion: "build-1",
    environment: "local",
    checks: [{ checkId: "completion", result: "pass" }],
  };
  expect(
    (
      await f.api(
        "POST",
        "/api/tests",
        { ...ti, expectedVersion: t.version },
        "tester",
      )
    ).status,
  ).toBe(200);
  t = (await f.api<any>("GET", `/api/tasks/${t.id}`)).body;
  await establishAcceptance(r.id);
  expect(
    (
      await f.api(
        "POST",
        "/api/tests",
        {
          ...ti,
          expectedVersion: t.version,
          checks: [{ checkId: "completion", result: "fail" }],
        },
        "tester",
      )
    ).status,
  ).toBe(200);
  expect((await f.api<any>("GET", `/api/tasks/${t.id}`)).body.state).toBe(
    "active",
  );
  expect(
    (await f.api<any>("GET", `/api/requirements/${r.id}`)).body.state,
  ).toBe("accepted");
});
it("task_06 verifyPass honors product-excluded checks while retaining their failures", async () => {
  let b = await pending();
  b = (
    await act(
      b,
      "defineChecks",
      {
        checks: [
          { id: "reproduction", text: "Original case", required: true },
          {
            id: "optional",
            text: "Optional case",
            required: false,
            exclusionReason: "Separate issue",
          },
        ],
      },
      "product",
    )
  ).body;
  const r = await act(b, "verifyPass", {
    test: testInput(b, "pass", [
      { checkId: "reproduction", result: "pass" },
      { checkId: "optional", result: "fail", note: "Separate finding" },
    ]),
  });
  expect(r.status).toBe(200);
  expect(r.body.state).toBe("closed");
  expect((await f.api<any>("GET", "/api/tests")).body[0].checks[1].result).toBe(
    "fail",
  );
});
it("task_06 review F1 cancelled task detachment preserves full Bug repair and original lineage", async () => {
  const r = await requirement();
  const tr = await f.api<any>(
    "POST",
    "/api/tasks",
    {
      projectId: "p1",
      requirementId: r.id,
      title: "Linked work",
      kind: "backend",
      definitionOfDone: "Done",
      priority: "medium",
      ownerId: "dev",
      reviewerId: "tester",
    },
    "product",
  );
  expect(tr.status).toBe(200);
  const t = tr.body;
  let b = await create({ requirementId: r.id, taskId: t.id });
  expect(
    (
      await f.api(
        "POST",
        `/api/requirements/${r.id}/actions`,
        {
          action: "cancel",
          expectedVersion: r.version,
          reason: "Stop scope",
          taskDisposition: [{ taskId: t.id, disposition: "detach" }],
        },
        "product",
      )
    ).status,
  ).toBe(200);
  expect(
    (await f.api<any>("GET", `/api/tasks/${t.id}`)).body.requirementId,
  ).toBeNull();
  const confirmed = await act(b, "confirm", {
    reason: "Still a project defect",
  });
  expect(confirmed.status).toBe(200);
  b = confirmed.body;
  b = (await act(b, "claim", {}, "dev")).body;
  b = (await act(b, "start", {}, "dev")).body;
  b = (
    await act(
      b,
      "submit",
      {
        evidence: {
          fix: "First fix",
          impact: "Input path",
          selfCheck: "Passed",
          environment: "local",
          targetVersion: "build-1",
        },
      },
      "dev",
    )
  ).body;
  const ti = { ...testInput(b, "fail"), revision: 1 };
  const fail = await f.api<any>(
    "POST",
    "/api/tests",
    { ...ti, expectedVersion: b.version },
    "tester",
  );
  expect(fail.status).toBe(200);
  b = (await f.api<any>("GET", `/api/bugs/${b.id}`)).body;
  expect(b.state).toBe("fixing");
  b = (
    await act(
      b,
      "submit",
      {
        evidence: {
          fix: "Second fix",
          impact: "Input path",
          selfCheck: "Passed",
          environment: "local",
          targetVersion: "build-1",
        },
      },
      "dev",
    )
  ).body;
  const verified = await act(b, "verifyPass", {
    test: { ...testInput(b), revision: 1 },
  });
  expect(verified.status).toBe(200);
  b = verified.body;
  expect(b.state).toBe("closed");
  expect(b.requirementId).toBe(r.id);
  expect(b.taskId).toBe(t.id);
  const reopened = await act(b, "reopen", {
    reason: "New reproduction",
    ownerId: "dev",
  });
  expect(reopened.status).toBe(200);
  expect(reopened.body.state).toBe("ready");
  expect(
    (await f.api<any>("GET", `/api/requirements/${r.id}`)).body.state,
  ).toBe("cancelled");
  expect(
    (
      f.db
        .prepare(
          "SELECT requirement_id FROM execution_participations WHERE object_id=?",
        )
        .all(b.id) as any[]
    ).every((x) => x.requirement_id === r.id),
  ).toBe(true);
  // A new Bug cannot claim this formerly valid pair; only the existing immutable source qualifies.
  expect(
    (
      await f.api(
        "POST",
        "/api/bugs",
        { ...input, requirementId: r.id, taskId: t.id },
        "tester",
      )
    ).status,
  ).toBe(422);
});
it("task_06 review F1 unrelated detached-looking and cross-project task links remain invalid", async () => {
  const r = await requirement();
  const tr = await f.api<any>(
    "POST",
    "/api/tasks",
    {
      projectId: "p1",
      title: "Independent work",
      kind: "backend",
      definitionOfDone: "Done",
      priority: "medium",
    },
    "product",
  );
  expect(tr.status).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        "/api/bugs",
        { ...input, requirementId: r.id, taskId: tr.body.id },
        "tester",
      )
    ).status,
  ).toBe(422);
  f.db.prepare("INSERT INTO roles VALUES ('p2','product','product',0)").run();
  const other = await f.api<any>(
    "POST",
    "/api/tasks",
    {
      projectId: "p2",
      title: "Other project",
      kind: "backend",
      definitionOfDone: "Done",
      priority: "medium",
    },
    "product",
  );
  expect(other.status).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        "/api/bugs",
        { ...input, requirementId: r.id, taskId: other.body.id },
        "tester",
      )
    ).status,
  ).toBe(422);
  // A corrupted same-project pair with no source/detachment events must not gain the exception.
  const b = await create({ requirementId: r.id });
  f.db
    .prepare("UPDATE objects SET current=?,version=version+1 WHERE id=?")
    .run(
      JSON.stringify({ ...b, taskId: tr.body.id, version: b.version + 1 }),
      b.id,
    );
  expect(
    (
      await act({ ...b, version: b.version + 1 }, "confirm", {
        reason: "Reproduced",
      })
    ).status,
  ).toBe(422);
});
it.each([
  ["assign", "product"],
  ["transfer", "product"],
  ["assign", "dev"],
  ["transfer", "dev"],
] as const)(
  "task_06 review F2 %s by %s cannot promote incomplete unconfirmed Bug through unassignment",
  async (action, actor) => {
    f.db
      .prepare(
        "UPDATE roles SET lead=1 WHERE member_id='dev' AND role='backend'",
      )
      .run();
    let b = await create({
      expected: "",
      actual: "",
      reproduction: "",
      environment: "",
    });
    const r = await act(
      b,
      action,
      {
        ownerId: null,
        resetToReady: true,
        reason: "Release assignment",
        handoff: "No repair started",
      },
      actor,
    );
    expect(r.status).toBe(200);
    b = r.body;
    expect(b.state).toBe("unconfirmed");
    expect((await act(b, "claim", {}, "dev")).status).toBe(409);
    expect(
      (await act(b, "confirm", { reason: "No evidence" }, "dev")).status,
    ).toBe(403);
    expect(
      (await act(b, "confirm", { reason: "No evidence" }, "product")).status,
    ).toBe(422);
  },
);

// Task7 now establishes the real gate for earlier acceptance-preservation assertions.
async function establishAcceptance(id: string) {
 let r=(await f.api<any>('GET',`/api/requirements/${id}`)).body;
 if(r.state==='ready') r=(await f.api<any>('POST',`/api/requirements/${id}/actions`,{action:'start',expectedVersion:r.version,reason:'Begin scope'},'product')).body;
 const tested=await f.api('POST','/api/tests',{target:{kind:'requirement',id},revision:r.revision,targetVersion:'build-1',environment:'local',checks:r.criteria.filter((c:any)=>c.required).map((c:any)=>({checkId:c.id,result:'pass'})),expectedVersion:r.version},'tester');
 expect(tested.status).toBe(200);
 r=(await f.api<any>('GET',`/api/requirements/${id}`)).body;
 const s=await f.api<any>('POST',`/api/requirements/${id}/submit-acceptance`,{revision:r.revision,targetVersion:'build-1',expectedVersion:r.version},'product');expect(s.status).toBe(200);
 const a=await f.api('POST',`/api/requirements/${id}/acceptance`,{decision:'pass',revision:r.revision,targetVersion:'build-1',criteria:r.criteria.map((c:any)=>({id:c.id,passed:true})),expectedVersion:s.body.version},'product');expect(a.status).toBe(200);
}

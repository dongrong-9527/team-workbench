import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
import { acceptanceGate } from "../apps/api/src/acceptance/gate.js";
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

function ready(extra: Record<string, unknown> = {}) {
  const r = {
    id: "readiness-r",
    projectId: "p1",
    title: "Synthetic authoritative readiness",
    description: "Current business acceptance scope",
    source: { description: "Manual source" },
    criteria: [{ id: "c1", text: "Current behavior works", required: true }],
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
        .prepare("INSERT INTO objects VALUES (?, 'requirement', 'p1', 1, ?)")
        .run(r.id, JSON.stringify(r));
      saveRevision(f.db, f.context, r as any, "Initial synthetic scope");
      saveScope(f.db, f.context, r as any);
      insertTestRecord(
        f.db,
        { ...f.context, actorId: "tester" },
        {
          target: { kind: "requirement", id: r.id },
          revision: 1,
          targetVersion: "build-1",
          environment: "Synthetic test environment",
          checks: [{ checkId: "c1", result: "pass" }],
        },
      );
    })
    .immediate();
  return r;
}
function counts() {
  return Object.fromEntries(
    [
      "events",
      "objects",
      "acceptance_records",
      "bug_waivers",
      "idempotency",
    ].map((table) => [
      table,
      (f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as any).n,
    ]),
  );
}
async function read(
  id = "readiness-r",
  target = "build-1",
  actor: Parameters<TestKit["api"]>[3] = "product",
) {
  return f.api<any>(
    "GET",
    `/api/requirements/${id}/acceptance-readiness?targetVersion=${encodeURIComponent(target)}`,
    undefined,
    actor,
  );
}

it("readiness is a read-only snapshot of the same authoritative gate used by submit", async () => {
  const r = ready();
  const before = counts();
  const result = await read();
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({
    requirementId: r.id,
    requirementVersion: 1,
    revision: 1,
    targetVersion: "build-1",
    ok: true,
    reasons: [],
    satisfied: 5,
    total: 5,
  });
  expect(result.body.conditions).toHaveLength(5);
  expect(result.body.conditions.every((c: any) => c.passed)).toBe(true);
  expect(counts()).toEqual(before);
  const gate = acceptanceGate(f.db, r.id, "build-1");
  expect({ ok: result.body.ok, reasons: result.body.reasons }).toEqual(gate);
  const submit = await f.api<any>(
    "POST",
    `/api/requirements/${r.id}/submit-acceptance`,
    { expectedVersion: 1, revision: 1, targetVersion: "build-1" },
    "product",
  );
  expect(submit.status).toBe(200);
  expect(submit.body.state).toBe("pending_acceptance");
});

it("critical Bugs produce the same reasons and matching failed condition as the write gate", async () => {
  f.seed("acceptanceWithCriticalOpenBug");
  const result = await read("r1");
  expect(result.status).toBe(200);
  const gate = acceptanceGate(f.db, "r1", "build-1");
  expect({ ok: result.body.ok, reasons: result.body.reasons }).toEqual(gate);
  expect(
    result.body.conditions.find((c: any) => c.id === "bugs"),
  ).toMatchObject({ passed: false, reasons: ["OPEN_CRITICAL_BUG"] });
  expect(result.body.satisfied).toBe(4);
  expect(result.body.bugs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "b1",
        severity: "critical",
        state: "ready",
      }),
    ]),
  );
});

it("readiness never grants a role and is readable by an active member without project roles", async () => {
  ready();
  f.db.prepare("DELETE FROM roles WHERE member_id='dev2'").run();
  expect((await read("readiness-r", "build-1", "dev2")).status).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        "/api/requirements/readiness-r/submit-acceptance",
        { expectedVersion: 1, revision: 1, targetVersion: "build-1" },
        "dev2",
      )
    ).status,
  ).toBe(403);
  expect((await read("readiness-r", "build-1", "anonymous")).status).toBe(401);
  f.db.prepare("UPDATE members SET active=0 WHERE id='dev2'").run();
  expect([401, 403]).toContain(
    (await read("readiness-r", "build-1", "dev2")).status,
  );
});

it("readiness is bound to the requested build and current requirement revision", async () => {
  ready();
  const wrongBuild = await read("readiness-r", "build-2");
  expect(wrongBuild.status).toBe(200);
  expect(wrongBuild.body).toMatchObject({
    targetVersion: "build-2",
    ok: false,
  });
  expect(wrongBuild.body.reasons).toContain("REQUIRED_CRITERIA_NOT_PASSED");
  const row = f.db
    .prepare("SELECT current FROM objects WHERE id='readiness-r'")
    .get() as any;
  const r = { ...JSON.parse(row.current), revision: 2, version: 2 };
  f.db
    .prepare("UPDATE objects SET version=2,current=? WHERE id='readiness-r'")
    .run(JSON.stringify(r));
  const revised = await read();
  expect(revised.body).toMatchObject({
    revision: 2,
    requirementVersion: 2,
    ok: false,
  });
  expect(revised.body.reasons).toContain("REQUIRED_CRITERIA_NOT_PASSED");
});

it("task ownership, review and test failures remain visible in the exact gate reasons", async () => {
  ready();
  const t = {
    id: "readiness-task",
    projectId: "p1",
    requirementId: "readiness-r",
    kind: "backend",
    state: "active",
    version: 1,
    required: true,
    blocked: true,
    ownerId: "dev2",
    reviewerId: "dev",
    definitionOfDone: "Synthetic completion",
    checks: [{ id: "task-check", text: "Task behavior", required: true }],
  };
  f.db
    .prepare("INSERT INTO objects VALUES (?, 'task', 'p1', 1, ?)")
    .run(t.id, JSON.stringify(t));
  const result = await read();
  expect(result.status).toBe(200);
  expect(result.body.reasons).toEqual(
    acceptanceGate(f.db, "readiness-r", "build-1").reasons,
  );
  expect(result.body.reasons).toEqual(
    expect.arrayContaining([
      "REQUIRED_TASK_NOT_DONE",
      "INVALID_TASK_OWNER",
      "INVALID_TASK_REVIEWER",
      "REQUIRED_TASK_TESTS_NOT_PASSED",
      "BLOCKED",
    ]),
  );
  expect(result.body.tasks).toMatchObject({ required: 1, completed: 0 });
  expect(result.body.conditions.find((c: any) => c.id === "tasks").passed).toBe(
    false,
  );
  expect(
    result.body.conditions.find((c: any) => c.id === "unblocked").passed,
  ).toBe(false);
});

it("acceptor role and historical execution independence use the existing policy", async () => {
  ready();
  f.db
    .transaction(() => {
      const task = {
        id: "participation-task",
        projectId: "p1",
        requirementId: "readiness-r",
        kind: "backend",
        state: "done",
        required: false,
        exclusionReason: "Optional synthetic work",
        version: 1,
      };
      f.db
        .prepare("INSERT INTO objects VALUES (?, 'task', 'p1', 1, ?)")
        .run(task.id, JSON.stringify(task));
      recordExecutionParticipation(f.db, task.id, "product", "backend");
    })
    .immediate();
  const result = await read();
  expect(result.status).toBe(200);
  expect(result.body.reasons).toContain("ACCEPTOR_PARTICIPATED");
  expect(
    result.body.conditions.find((c: any) => c.id === "acceptor").passed,
  ).toBe(false);
});

it("a green snapshot cannot authorize a later write after a critical Bug appears", async () => {
  const r = ready();
  expect((await read()).body.ok).toBe(true);
  const b = {
    id: "new-critical",
    projectId: "p1",
    requirementId: r.id,
    role: "backend",
    severity: "critical",
    state: "ready",
    version: 1,
    blocked: false,
  };
  f.db
    .prepare("INSERT INTO objects VALUES (?, 'bug', 'p1', 1, ?)")
    .run(b.id, JSON.stringify(b));
  const result = await f.api<any>(
    "POST",
    `/api/requirements/${r.id}/submit-acceptance`,
    { expectedVersion: 1, revision: 1, targetVersion: "build-1" },
    "product",
  );
  expect(result.status).toBe(422);
  expect(result.body.reasons).toContain("OPEN_CRITICAL_BUG");
  expect((await read()).body.ok).toBe(false);
  expect(f.read("acceptance_records")).toHaveLength(0);
});

it("readiness honors version-bound waivers and current follow-up owner roles", async () => {
  f.seed("acceptanceWithCriticalOpenBug");
  const row = f.db
    .prepare("SELECT current FROM objects WHERE id='b1'")
    .get() as any;
  const bug = { ...JSON.parse(row.current), severity: "normal", version: 5 };
  f.db
    .prepare("UPDATE objects SET version=5,current=? WHERE id='b1'")
    .run(JSON.stringify(bug));
  const waived = await f.api<any>(
    "POST",
    "/api/requirements/r1/bug-waivers",
    {
      expectedVersion: 1,
      bugId: "b1",
      reason: "Explicit synthetic deferral",
      followUpOwnerId: "dev",
      plan: "Repair and independently verify next build",
    },
    "product",
  );
  expect(waived.status).toBe(200);
  expect((await read("r1")).body).toMatchObject({
    ok: true,
    bugSummary: { open: 1, criticalOpen: 0, waived: 1 },
  });
  f.db
    .prepare("DELETE FROM roles WHERE member_id='dev' AND role='backend'")
    .run();
  expect((await read("r1")).body.reasons).toContain("OPEN_BUG");
  f.db
    .prepare(
      "INSERT INTO roles(project_id,member_id,role) VALUES ('p1','dev','backend')",
    )
    .run();
  expect((await read("r1")).body.ok).toBe(true);
  f.db
    .prepare("UPDATE objects SET version=6,current=? WHERE id='b1'")
    .run(JSON.stringify({ ...bug, version: 6 }));
  expect((await read("r1")).body).toMatchObject({
    ok: false,
    bugSummary: { waived: 0 },
  });
  expect((await read("r1")).body.reasons).toContain("OPEN_BUG");
});

it("archived project readiness remains readable without making writes eligible", async () => {
  ready();
  f.db
    .prepare("UPDATE projects SET archived=1,version=version+1 WHERE id='p1'")
    .run();
  const result = await read("readiness-r", "build-1", "dev2");
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ archived: true, ok: false });
  expect(result.body.reasons).toEqual(
    acceptanceGate(f.db, "readiness-r", "build-1").reasons,
  );
});

it("unknown ids and malformed query parameters are rejected", async () => {
  ready();
  expect((await read("missing")).status).toBe(404);
  expect(
    (
      await f.api(
        "GET",
        "/api/requirements/readiness-r/acceptance-readiness?unexpected=1",
      )
    ).status,
  ).toBe(400);
  expect((await read("readiness-r", "x".repeat(201))).status).toBe(400);
});

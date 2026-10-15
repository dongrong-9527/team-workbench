import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
import { issueSession } from "../apps/api/src/auth/session.js";
let f: TestKit;
beforeEach(async () => {
  f = await createTestKit();
});
afterEach(async () => {
  await f.close();
});
const prose = "  完成输入校验\n第二段\r\n\t补充边界用例  ";
const taskInput = {
  projectId: "p1",
  title: "多行工作",
  kind: "backend",
  definitionOfDone: "完成",
  priority: "medium",
  ownerId: "dev",
  reviewerId: "tester",
};
async function task() {
  const r = await f.api<any>("POST", "/api/tasks", taskInput, "product");
  expect(r.status).toBe(200);
  return r.body;
}
const update = (id: string, extra: any = {}) => ({
  target: { kind: "task", id },
  workDate: "2026-10-11",
  done: prose,
  next: prose,
  obstacle: prose,
  contributionType: "coordination",
  ...extra,
});
it("preserves multiline update content in corrections, history and report sources without duplicate replay", async () => {
  const t = await task();
  const a = await f.api<any>(
    "POST",
    "/api/updates",
    update(t.id),
    "dev",
    "paragraph",
  );
  expect(a.status).toBe(200);
  expect(a.body.done).toBe(prose);
  const before = f.db.prepare("SELECT * FROM updates").all();
  const correction = update(t.id, {
    correctsId: a.body.id,
    expectedVersion: 1,
    reason: prose,
    done: prose + "更正",
  });
  const b = await f.api<any>(
    "POST",
    "/api/updates",
    correction,
    "dev",
    "correct-paragraph",
  );
  expect(b.status).toBe(200);
  expect(
    await f.api("POST", "/api/updates", correction, "dev", "correct-paragraph"),
  ).toEqual(b);
  expect(
    f.db.prepare("SELECT * FROM updates ORDER BY recorded_seq").all(),
  ).toEqual([before[0], expect.anything()]);
  expect(
    f.events("task", t.id).filter((e) => e.action.startsWith("update")),
  ).toHaveLength(2);
  expect(JSON.stringify(f.events("task", t.id))).toContain(
    JSON.stringify(prose).slice(1, -1),
  );
  const report = await f.api<any>(
    "POST",
    "/api/reports",
    {
      date: "2026-10-11",
      timeZone: "Asia/Shanghai",
      memberIds: ["dev"],
      projectIds: ["p1"],
    },
    "dev",
  );
  expect(report.status).toBe(200);
  const sources = await f.api<any>(
    "GET",
    `/api/reports/${report.body.id}/sources`,
  );
  expect(JSON.stringify(sources.body)).toContain(
    JSON.stringify(prose + "更正").slice(1, -1),
  );
});
it("accepts paragraph requirements, Bug steps and task submission and reasons", async () => {
  const requirement = await f.api<any>(
    "POST",
    "/api/requirements",
    {
      projectId: "p1",
      title: "需求",
      source: { description: prose },
      description: prose,
      criteria: [{ id: "c", text: prose }],
      priority: "medium",
      acceptorId: "product",
    },
    "product",
  );
  expect(requirement.status).toBe(200);
  expect(requirement.body.description).toBe(prose);
  const bug = await f.api<any>(
    "POST",
    "/api/bugs",
    {
      projectId: "p1",
      title: "复现",
      role: "backend",
      expected: prose,
      actual: prose,
      reproduction: prose,
      environment: "local",
      severity: "normal",
      priority: "medium",
    },
    "tester",
  );
  expect(bug.status).toBe(200);
  expect(bug.body.reproduction).toBe(prose);
  const t = await task();
  expect(
    (
      await f.api(
        "POST",
        `/api/tasks/${t.id}/actions`,
        { action: "start", expectedVersion: 1 },
        "dev",
      )
    ).status,
  ).toBe(200);
  const submitted = await f.api<any>(
    "POST",
    `/api/tasks/${t.id}/actions`,
    {
      action: "submit",
      expectedVersion: 2,
      evidence: {
        done: prose,
        selfCheck: prose,
        environment: "local",
        targetVersion: "build",
      },
    },
    "dev",
  );
  expect(submitted.status).toBe(200);
  expect(submitted.body.submission.done).toBe(prose);
  expect(
    (
      await f.api(
        "POST",
        `/api/tasks/${t.id}/actions`,
        {
          action: "block",
          expectedVersion: 3,
          reason: prose,
          assistance: prose,
        },
        "dev",
      )
    ).status,
  ).toBe(200);
});
it.each([
  "\ud800",
  "\udfff",
  "bad\u0000",
  "bad\u000b",
  "bad\u001b",
  "bad\u007f",
  "bad\u0085",
  " \n\t\r ",
])(
  "rejects malformed or blank required prose %j without writing",
  async (done) => {
    const t = await task();
    const before = f.events();
    expect(
      (
        await f.api(
          "POST",
          "/api/updates",
          update(t.id, { done, next: "", obstacle: "" }),
          "dev",
        )
      ).status,
    ).toBe(400);
    expect(f.read("updates")).toHaveLength(0);
    expect(f.events()).toEqual(before);
  },
);
it.each([" padded", "two\nlines", "bad\tname", "\ud800"])(
  "keeps names and identifiers strict %j",
  async (title) => {
    expect(
      (await f.api("POST", "/api/tasks", { ...taskInput, title }, "product"))
        .status,
    ).toBe(400);
    expect(f.events()).toHaveLength(0);
  },
);
it("accepts combined Chinese fields at their limits and rejects one unit over atomically", async () => {
  const t = await task();
  const first = await f.api<any>(
    "POST",
    "/api/updates",
    update(t.id, {
      done: "验".repeat(6000),
      next: "验".repeat(6000),
      obstacle: "验".repeat(6000),
    }),
    "dev",
  );
  expect(first.status).toBe(200);
  const correction = update(t.id, {
    done: "验".repeat(6000),
    next: "验".repeat(6000),
    obstacle: "验".repeat(6000),
    correctsId: first.body.id,
    expectedVersion: 1,
    reason: "验".repeat(2000),
  });
  expect((await f.api("POST", "/api/updates", correction, "dev")).status).toBe(
    200,
  );
  const before = f.events();
  expect(
    (
      await f.api(
        "POST",
        "/api/updates",
        update(t.id, { done: "验".repeat(6001) }),
        "dev",
      )
    ).status,
  ).toBe(400);
  expect(f.events()).toEqual(before);
  expect(f.read("updates")).toHaveLength(2);
});
it("accepts full criterion, test-note and acceptance-note arrays inside a bounded body budget", async () => {
  const criteria = Array.from({ length: 100 }, (_, i) => ({
    id: `c${i}`,
    text: "验".repeat(2000),
    required: i === 0,
    exclusionReason: "验".repeat(2000),
  }));
  let r = await f.api<any>(
    "POST",
    "/api/requirements",
    {
      projectId: "p1",
      title: "完整检查",
      source: { description: "验".repeat(2000) },
      description: "验".repeat(6000),
      criteria,
      priority: "medium",
      acceptorId: "product",
    },
    "product",
  );
  expect(r.status).toBe(200);
  const id = r.body.id;
  r = await f.api<any>(
    "POST",
    `/api/requirements/${id}/actions`,
    { action: "refine", expectedVersion: 1, description: "验".repeat(6000) },
    "product",
  );
  expect(r.status).toBe(200);
  r = await f.api<any>(
    "POST",
    `/api/requirements/${id}/actions`,
    {
      action: "makeReady",
      expectedVersion: 2,
      source: {
        description: "来源",
        status: "checked",
        checkedAt: new Date().toISOString(),
      },
    },
    "product",
  );
  expect(r.status).toBe(200);
  r = await f.api<any>(
    "POST",
    `/api/requirements/${id}/actions`,
    { action: "start", expectedVersion: r.body.version, reason: "进入执行" },
    "product",
  );
  expect(r.status).toBe(200);
  const checks = criteria.map((c) => ({
    checkId: c.id,
    result: "pass",
    note: "验".repeat(4000),
  }));
  const test = await f.api<any>(
    "POST",
    "/api/tests",
    {
      target: { kind: "requirement", id },
      expectedVersion: r.body.version,
      revision: 1,
      targetVersion: "build",
      environment: "local",
      checks,
    },
    "tester",
  );
  expect(test.status).toBe(200);
  const current = await f.api<any>("GET", `/api/requirements/${id}`);
  r = await f.api<any>(
    "POST",
    `/api/requirements/${id}/submit-acceptance`,
    {
      expectedVersion: current.body.version,
      revision: 1,
      targetVersion: "build",
    },
    "product",
  );
  expect(r.status).toBe(200);
  const accepted = await f.api<any>(
    "POST",
    `/api/requirements/${id}/acceptance`,
    {
      expectedVersion: r.body.version,
      revision: 1,
      targetVersion: "build",
      decision: "pass",
      reason: "验".repeat(4000),
      criteria: criteria.map((c) => ({
        id: c.id,
        passed: true,
        note: "验".repeat(4000),
      })),
    },
    "product",
  );
  expect(accepted.status).toBe(200);
  const immutable = {
    tests: f.db.prepare("SELECT * FROM test_records").all(),
    acceptance: f.db.prepare("SELECT * FROM acceptance_records").all(),
    scopes: f.db.prepare("SELECT * FROM requirement_scopes").all(),
  };
  for (const actor of ["tester", "product"])
    expect(
      (
        await f.api(
          "POST",
          `/api/members/${actor}/rename`,
          { expectedVersion: 1, displayName: `renamed-${actor}` },
          "admin",
        )
      ).status,
    ).toBe(200);
  expect(f.db.prepare("SELECT * FROM test_records").all()).toEqual(
    immutable.tests,
  );
  expect(f.db.prepare("SELECT * FROM acceptance_records").all()).toEqual(
    immutable.acceptance,
  );
  expect(f.db.prepare("SELECT * FROM requirement_scopes").all()).toEqual(
    immutable.scopes,
  );

  const before = f.events();
  expect(
    (
      await f.api(
        "POST",
        "/api/requirements",
        {
          projectId: "p1",
          title: "too many",
          source: { description: "source" },
          description: "text",
          criteria: [...criteria, { id: "extra", text: "extra" }],
          priority: "medium",
        },
        "product",
      )
    ).status,
  ).toBe(400);
  expect(
    (await f.api("POST", "/api/updates", { done: "验".repeat(1500000) }, "dev"))
      .status,
  ).toBe(413);
  expect(
    (
      await f.api(
        "POST",
        "/api/auth/login",
        { login: "dev", password: "a".repeat(17000) },
        "anonymous",
      )
    ).status,
  ).toBe(413);
  expect(f.events()).toEqual(before);
});
it("rejects exactly one byte above the business body limit before any route writes", async () => {
  const limit = 4 * 1024 * 1024;
  const body = {
    done: "a".repeat(
      limit - Buffer.byteLength(JSON.stringify({ done: "" })) + 1,
    ),
  };
  expect(Buffer.byteLength(JSON.stringify(body))).toBe(limit + 1);
  const before = f.events();
  for (const path of [
    "/api/updates",
    "/api/requirements",
    "/api/requirements/missing/actions",
    "/api/tasks",
    "/api/tasks/missing/actions",
    "/api/bugs",
    "/api/bugs/missing/actions",
    "/api/tests",
    "/api/requirements/missing/acceptance",
    "/api/requirements/missing/bug-waivers",
    "/api/projects",
  ])
    expect((await f.api("POST", path, body, "admin")).status, path).toBe(413);
  expect(f.events()).toEqual(before);
  expect(f.read("updates")).toHaveLength(0);
  expect(f.db.prepare("SELECT * FROM objects").all()).toHaveLength(0);
});

it("accepts the maximum criterion envelope when Unicode uses six-byte JSON escapes", async () => {
  const criteria = Array.from({ length: 100 }, (_, i) => ({
    id: `c${i}`,
    text: "验".repeat(2000),
    required: false,
    exclusionReason: "验".repeat(2000),
  }));
  const payload = {
    projectId: "p1",
    title: "escaped Unicode",
    source: { description: "验".repeat(2000), reason: "验".repeat(2000) },
    description: "验".repeat(6000),
    criteria,
    priority: "medium",
    acceptorId: "product",
  };
  const body = JSON.stringify(payload).replace(/验/g, "\\u9a8c");
  expect(Buffer.byteLength(body)).toBeGreaterThan(2400000);
  const session = issueSession(f.db, "product");
  const response = await fetch(f.baseUrl + "/api/requirements", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://workbench.test",
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrfToken,
      "idempotency-key": "escaped-envelope",
    },
    body,
  });
  expect(response.status).toBe(200);
  expect(((await response.json()) as any).criteria).toEqual(criteria);
});

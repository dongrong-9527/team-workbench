import { beforeEach, afterEach, it, expect } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
let f: TestKit;
beforeEach(async () => {
  f = await createTestKit();
});
afterEach(async () => {
  await f.close();
});
async function task() {
  const r = await f.api<any>(
    "POST",
    "/api/tasks",
    {
      projectId: "p1",
      title: "Original task",
      kind: "backend",
      definitionOfDone: "Checked",
      priority: "medium",
      ownerId: "dev",
      reviewerId: "tester",
    },
    "product",
  );
  expect(r.status).toBe(200);
  return r.body;
}
const update = (t: any, extra: any = {}) => ({
  target: { kind: "task", id: t.id },
  workDate: "2026-10-11",
  done: "完成",
  next: "",
  obstacle: "Waiting for help",
  contributionType: "coordination",
  ...extra,
});
it("task_08 saves immutable authored contributions without changing workflow, and replays exactly", async () => {
  const t = await task(),
    input = update(t);
  const a = await f.api<any>("POST", "/api/updates", input, "dev", "u-1");
  expect(a.status).toBe(200);
  expect(a.body).toMatchObject({
    authorId: "dev",
    version: 1,
    lateEntry: true,
    done: "完成",
    next: "",
    snapshot: {
      ownerId: "dev",
      ownerName: "dev",
      projectName: "Project One",
      title: "Original task",
    },
  });
  expect(
    (await f.api("POST", "/api/updates", input, "dev", "u-1")).body,
  ).toEqual(a.body);
  const current = await f.api<any>("GET", `/api/tasks/${t.id}`);
  expect(current.body).toMatchObject({
    state: "pending",
    blocked: false,
    version: 1,
  });
  expect(f.db.prepare("SELECT * FROM updates").all()).toHaveLength(1);
});
it("task_08 only author corrects latest version with reason; originals and separate entries survive", async () => {
  const t = await task(),
    a = await f.api<any>("POST", "/api/updates", update(t), "dev");
  expect(a.status).toBe(200);
  const correction = update(t, {
    correctsId: a.body.id,
    expectedVersion: 1,
    reason: "More detail",
    done: "Corrected",
  });
  expect(
    (await f.api("POST", "/api/updates", correction, "product")).status,
  ).toBe(403);
  expect(
    (await f.api("POST", "/api/updates", { ...correction, reason: "" }, "dev"))
      .status,
  ).toBe(400);
  const b = await f.api<any>(
    "POST",
    "/api/updates",
    correction,
    "dev",
    "correction",
  );
  expect(b.status).toBe(200);
  expect(b.body).toMatchObject({
    logicalId: a.body.id,
    version: 2,
    correctsId: a.body.id,
  });
  expect((await f.api("POST", "/api/updates", correction, "dev")).status).toBe(
    409,
  );
  expect(
    (await f.api("POST", "/api/updates", correction, "dev", "correction")).body,
  ).toEqual(b.body);
  const c = await f.api<any>(
    "POST",
    "/api/updates",
    update(t, { done: "Separate contribution" }),
    "dev",
  );
  expect(c.status).toBe(200);
  const { effectiveUpdatesAt } = await import(
    "../apps/api/src/updates/service.js"
  );
  expect(
    effectiveUpdatesAt(f.db, a.body.recordedSeq).map((x) => x.done),
  ).toEqual(["完成"]);
  expect(
    effectiveUpdatesAt(f.db, c.body.recordedSeq).map((x) => x.done),
  ).toEqual(["Corrected", "Separate contribution"]);
  expect(f.db.prepare("SELECT * FROM updates").all()).toHaveLength(3);
  expect(() => f.db.prepare("DELETE FROM updates").run()).toThrow();
});
it.each(["2026-02-30", "2025-02-29", "2026-13-01", "9999-01-01"])(
  "task_08 rejects invalid or future work date %s",
  async (workDate) => {
    const t = await task();
    expect(
      (await f.api("POST", "/api/updates", update(t, { workDate }), "dev"))
        .status,
    ).toBe(422);
  },
);
it("task_08 rejects forged author/time and cross-target corrections", async () => {
  const t = await task();
  for (const field of [
    "authorId",
    "recordedAt",
    "recordedSeq",
    "participantIds",
  ])
    expect(
      (
        await f.api(
          "POST",
          "/api/updates",
          update(t, { [field]: "forged" }),
          "dev",
        )
      ).status,
    ).toBe(400);
  const a = await f.api<any>("POST", "/api/updates", update(t), "dev");
  expect(a.status).toBe(200);
  const other = await task();
  expect(
    (
      await f.api(
        "POST",
        "/api/updates",
        update(other, {
          correctsId: a.body.id,
          expectedVersion: 1,
          reason: "wrong target",
        }),
        "dev",
      )
    ).status,
  ).toBe(422);
});
it("task_08 live roles/archive/session block replay; active readers can read archived history", async () => {
  const t = await task(),
    input = update(t);
  const a = await f.api<any>("POST", "/api/updates", input, "dev", "retry");
  expect(a.status).toBe(200);
  f.db.prepare("DELETE FROM roles WHERE member_id='dev'").run();
  expect(
    (await f.api("POST", "/api/updates", input, "dev", "retry")).status,
  ).toBe(403);
  expect(
    (await f.api("GET", `/api/objects/task/${t.id}/history`, {}, "dev")).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        "/api/projects/p1/archive",
        { expectedVersion: 1 },
        "admin",
      )
    ).status,
  ).toBe(200);
  expect((await f.api("POST", "/api/updates", input, "tester")).status).toBe(
    409,
  );
  expect(
    (await f.api("GET", `/api/objects/task/${t.id}/history`, {}, "dev")).status,
  ).toBe(200);
  expect(
    (await f.api("GET", `/api/objects/task/${t.id}/history`, {}, "anonymous"))
      .status,
  ).toBe(401);
});
it("task_08 event failure rolls back update, participation and idempotency", async () => {
  const t = await task();
  await f.failNextEvent();
  expect(
    (
      await f.api(
        "POST",
        "/api/updates",
        update(t, { contributionType: "development" }),
        "dev",
        "fail",
      )
    ).status,
  ).toBe(500);
  expect(f.db.prepare("SELECT * FROM updates").all()).toHaveLength(0);
  expect(
    f.db.prepare("SELECT * FROM idempotency WHERE request_id='fail'").all(),
  ).toHaveLength(0);
  expect(
    f.db.prepare("SELECT * FROM execution_participations").all(),
  ).toHaveLength(0);
});
it("task_08 history provides stable bounded seq pages, actor/time and fails visibly on read error", async () => {
  const t = await task();
  const a = await f.api<any>("POST", "/api/updates", update(t), "dev");
  expect(a.status).toBe(200);
  const first = await f.api<any>(
    "GET",
    `/api/objects/task/${t.id}/history?limit=1`,
  );
  expect(first.status).toBe(200);
  expect(first.body.items).toHaveLength(1);
  expect(first.body.items[0]).toMatchObject({
    actorId: "product",
    actorName: "product",
    localTime: expect.any(String),
  });
  const second = await f.api<any>(
    "GET",
    `/api/objects/task/${t.id}/history?limit=1&afterSeq=${first.body.nextAfterSeq}&cutoffSeq=${first.body.cutoffSeq}`,
  );
  expect(second.body.items[0].action).toBe("updateRecorded");
  for (const q of [
    "limit=0",
    "limit=101",
    "afterSeq=-1",
    "limit=1.2",
    "unknown=x",
  ])
    expect(
      (await f.api("GET", `/api/objects/task/${t.id}/history?${q}`)).status,
    ).toBe(400);
  f.db.exec("ALTER TABLE events RENAME TO events_unavailable");
  expect((await f.api("GET", `/api/objects/task/${t.id}/history`)).status).toBe(
    500,
  );
});
it("task_08 stateAt ignores evidence events and preserves names and ownership across later rename/transfer", async () => {
  const t = await task(),
    initial = f.events("task", t.id)[0]!;
  const a = await f.api<any>("POST", "/api/updates", update(t), "dev");
  expect(a.status).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        "/api/members/dev/rename",
        { expectedVersion: 1, displayName: "Renamed developer" },
        "admin",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        "/api/projects/p1/rename",
        { expectedVersion: 1, name: "Renamed project" },
        "admin",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        `/api/tasks/${t.id}/actions`,
        {
          action: "transfer",
          expectedVersion: 1,
          ownerId: null,
          resetToPending: true,
          reason: "Move",
          handoff: "Notes",
        },
        "product",
      )
    ).status,
  ).toBe(200);
  const { stateAt } = await import("../apps/api/src/history/query.js");
  expect(
    stateAt(
      f.db,
      { kind: "task", id: t.id },
      { time: initial.time, seq: initial.seq },
    ),
  ).toMatchObject({
    title: "Original task",
    projectName: "Project One",
    ownerId: "dev",
    ownerName: "dev",
    state: "pending",
    blocked: false,
  });
  expect(
    stateAt(
      f.db,
      { kind: "task", id: t.id },
      { time: initial.time, seq: initial.seq - 1 },
    ),
  ).toBeNull();
  expect(
    stateAt(
      f.db,
      { kind: "task", id: t.id },
      { time: a.body.recordedAt, seq: a.body.recordedSeq },
    ),
  ).toMatchObject({ title: "Original task", ownerName: "dev" });
  expect(
    stateAt(
      f.db,
      { kind: "task", id: t.id },
      { time: "9999-01-01T00:00:00.000Z", seq: Number.MAX_SAFE_INTEGER },
    ),
  ).toMatchObject({
    projectName: "Renamed project",
    ownerId: null,
    ownerName: null,
  });
  const own = await f.api<any>("GET", "/api/updates?limit=10", {}, "dev");
  expect(own.status).toBe(200);
  expect(own.body.items[0].snapshot.ownerName).toBe("dev");
});
it("task_08 first-time helpers self-record explicit work; roles/prose never imply development", async () => {
  const t = await task();
  expect(
    (
      await f.api(
        "POST",
        "/api/updates",
        update(t, { contributionType: "development" }),
        "dev2",
      )
    ).status,
  ).toBe(403);
  f.db
    .prepare(
      "INSERT INTO roles(project_id,member_id,role) VALUES ('p1','dev2','backend')",
    )
    .run();
  const a = await f.api<any>(
    "POST",
    "/api/updates",
    update(t, { contributionType: "development" }),
    "dev2",
  );
  expect(a.status).toBe(200);
  expect(
    f.db
      .prepare("SELECT member_id,activity FROM execution_participations")
      .all(),
  ).toEqual([{ member_id: "dev2", activity: "development" }]);
  expect(
    (
      await f.api(
        "POST",
        "/api/updates",
        update(t, { done: "I developed all code" }),
        "product",
      )
    ).status,
  ).toBe(200);
  expect(
    f.db.prepare("SELECT * FROM execution_participations").all(),
  ).toHaveLength(1);
  expect(
    (
      await f.api(
        "POST",
        "/api/updates",
        update(t, {
          correctsId: a.body.id,
          expectedVersion: 1,
          reason: "Erase development",
          contributionType: "coordination",
        }),
        "dev2",
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await f.api(
        "POST",
        "/api/updates",
        update(t, { contributionType: "testing" }),
        "tester",
      )
    ).status,
  ).toBe(200);
  expect((await f.api("GET", `/api/tasks/${t.id}`)).body).toMatchObject({
    state: "pending",
    version: 1,
    ownerId: "dev",
  });
});
it.each(["pending_acceptance", "accepted"])(
  "task_08 rejects independence collision in %s atomically without changing state",
  async (state) => {
    f.seed("acceptanceWithCriticalOpenBug");
    f.db
      .prepare(
        "INSERT INTO roles(project_id,member_id,role) VALUES ('p1','product','backend')",
      )
      .run();
    f.db
      .prepare(
        "UPDATE objects SET current=json_set(current,'$.state',?),version=version+1 WHERE id='r1'",
      )
      .run(state);
    const before = f.events().length;
    const r = await f.api(
      "POST",
      "/api/updates",
      {
        target: { kind: "bug", id: "b1" },
        workDate: "2026-10-11",
        done: "Repaired",
        contributionType: "repair",
      },
      "product",
      "collision",
    );
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/independence/i);
    expect(f.db.prepare("SELECT * FROM updates").all()).toHaveLength(0);
    expect(f.events()).toHaveLength(before);
    expect(
      f.db
        .prepare(
          "SELECT * FROM execution_participations WHERE member_id='product'",
        )
        .all(),
    ).toHaveLength(0);
    expect(
      f.db
        .prepare("SELECT * FROM idempotency WHERE request_id='collision'")
        .all(),
    ).toHaveLength(0);
    expect((await f.api("GET", "/api/requirements/r1")).body).toMatchObject({
      state,
    });
  },
);
it("task_08 injected server clock distinguishes Shanghai midnight and replay preserves original timestamp", async () => {
  const t = await task();
  const { saveUpdate } = await import("../apps/api/src/updates/service.js");
  const ctx = {
    ...f.context,
    actorId: "dev",
    requestId: "clock",
    bodyHash: "clock",
  };
  const input = update(t, { workDate: "2026-10-12" });
  expect(() =>
    saveUpdate(f.db, ctx, input, () => new Date("2026-10-11T15:59:59.999Z")),
  ).toThrow(/Future/);
  const a = saveUpdate(
    f.db,
    ctx,
    input,
    () => new Date("2026-10-11T16:00:00.000Z"),
  );
  expect(a).toMatchObject({
    lateEntry: false,
    recordedAt: "2026-10-11T16:00:00.000Z",
  });
  expect(
    saveUpdate(f.db, ctx, input, () => new Date("2026-10-12T16:00:00.000Z")),
  ).toEqual(a);
  const b = saveUpdate(
    f.db,
    { ...ctx, requestId: "clock2" },
    input,
    () => new Date("2026-10-12T16:00:00.000Z"),
  );
  expect(b.lateEntry).toBe(true);
});
it("task_08 helper development is visible to existing coarse self-test audit", async () => {
  const t = await task();
  f.db
    .prepare(
      "INSERT INTO roles(project_id,member_id,role) VALUES ('p1','dev2','backend'),('p1','dev2','test')",
    )
    .run();
  expect(
    (
      await f.api(
        "POST",
        "/api/updates",
        update(t, { contributionType: "development" }),
        "dev2",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        `/api/tasks/${t.id}/actions`,
        { action: "designateReviewer", expectedVersion: 1, reviewerId: "dev2" },
        "product",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        `/api/tasks/${t.id}/actions`,
        { action: "start", expectedVersion: 2 },
        "dev",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        `/api/tasks/${t.id}/actions`,
        {
          action: "submit",
          expectedVersion: 3,
          evidence: {
            done: "Code",
            selfCheck: "Verified",
            environment: "local",
          },
        },
        "dev",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        `/api/tasks/${t.id}/actions`,
        {
          action: "checkPass",
          expectedVersion: 4,
          evidence: { result: "pass", environment: "local" },
        },
        "dev2",
      )
    ).status,
  ).toBe(200);
  expect(
    f.db.prepare("SELECT self_test FROM task_checks WHERE task_id=?").get(t.id),
  ).toEqual({ self_test: 1 });
});
it("task_08 canonical evidence events cannot replace an object state at their exact cutoff", async () => {
  const t = await task();
  expect(
    (
      await f.api(
        "POST",
        `/api/tasks/${t.id}/actions`,
        {
          action: "defineChecks",
          expectedVersion: 1,
          checks: [{ id: "c1", text: "Works", required: true }],
        },
        "product",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        `/api/tasks/${t.id}/actions`,
        { action: "start", expectedVersion: 2 },
        "dev",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        `/api/tasks/${t.id}/actions`,
        {
          action: "submit",
          expectedVersion: 3,
          evidence: {
            done: "Code",
            selfCheck: "Works",
            environment: "local",
            targetVersion: "build-1",
          },
        },
        "dev",
      )
    ).status,
  ).toBe(200);
  const r = await f.api<any>(
    "POST",
    "/api/tests",
    {
      target: { kind: "task", id: t.id },
      expectedVersion: 4,
      targetVersion: "build-1",
      environment: "local",
      checks: [{ checkId: "c1", result: "pass" }],
    },
    "tester",
  );
  expect(r.status).toBe(200);
  const { stateAt } = await import("../apps/api/src/history/query.js");
  expect(
    stateAt(
      f.db,
      { kind: "task", id: t.id },
      { time: r.body.recordedAt, seq: r.body.recordedSeq },
    ),
  ).toMatchObject({
    title: "Original task",
    state: "pending_check",
    ownerId: "dev",
    version: 4,
  });
  const last = f.events("task", t.id).at(-1)!;
  expect(
    stateAt(
      f.db,
      { kind: "task", id: t.id },
      { time: last.time, seq: last.seq },
    ),
  ).toMatchObject({ state: "done", version: 5 });
});
it("task_08 rename preserves old name snapshots, permits no-op/replay, and enforces current admin/archive", async () => {
  const t = await task(),
    initial = f.events("task", t.id)[0]!;
  expect(
    (
      await f.api(
        "POST",
        "/api/members/dev/rename",
        { expectedVersion: 1, displayName: "new" },
        "dev",
      )
    ).status,
  ).toBe(403);
  const before = f.events().length;
  expect(
    (
      await f.api(
        "POST",
        "/api/members/dev/rename",
        { expectedVersion: 1, displayName: "dev" },
        "admin",
      )
    ).status,
  ).toBe(200);
  expect(f.events()).toHaveLength(before);
  const input = { expectedVersion: 1, displayName: "Renamed" };
  const a = await f.api(
    "POST",
    "/api/members/dev/rename",
    input,
    "admin",
    "rename",
  );
  expect(a.status).toBe(200);
  expect(
    (await f.api("POST", "/api/members/dev/rename", input, "admin", "rename"))
      .body,
  ).toEqual(a.body);
  expect(
    (await f.api("POST", "/api/members/dev/rename", input, "admin")).status,
  ).toBe(409);
  expect(
    (
      await f.api(
        "POST",
        "/api/projects/p1/rename",
        { expectedVersion: 1, name: "New project" },
        "admin",
      )
    ).status,
  ).toBe(200);
  const { stateAt } = await import("../apps/api/src/history/query.js");
  const latest = f.events().at(-1)!;
  expect(
    stateAt(
      f.db,
      { kind: "task", id: t.id },
      { time: latest.time, seq: latest.seq },
    ),
  ).toMatchObject({ ownerName: "Renamed", projectName: "New project" });
  expect(
    stateAt(
      f.db,
      { kind: "task", id: t.id },
      { time: initial.time, seq: initial.seq },
    ),
  ).toMatchObject({ ownerName: "dev", projectName: "Project One" });
  expect(
    (
      await f.api(
        "POST",
        "/api/projects/p1/archive",
        { expectedVersion: 2 },
        "admin",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        "/api/projects/p1/rename",
        { expectedVersion: 3, name: "No" },
        "admin",
      )
    ).status,
  ).toBe(409);
});
it("task_08 Bug creation snapshots include the original owner display name", async () => {
  const b = await f.api<any>(
    "POST",
    "/api/bugs",
    {
      projectId: "p1",
      title: "Defect",
      role: "backend",
      expected: "Works",
      actual: "Fails",
      reproduction: "Click",
      environment: "local",
      severity: "normal",
      priority: "medium",
      ownerId: "dev",
    },
    "product",
  );
  expect(b.status).toBe(200);
  expect(f.events("bug", b.body.id)[0]!.after).toMatchObject({
    ownerId: "dev",
    ownerName: "dev",
  });
});
it("task_08 reconstructs missing historical names from later rename before-values without present-name fallback", async () => {
  f.db
    .prepare("INSERT INTO objects VALUES ('old-bug','bug','p1',1,?)")
    .run(JSON.stringify({ title: "Legacy", state: "ready" }));
  const old = f.db
    .prepare(
      "INSERT INTO events(time,action,actor_id,target_kind,target_id,after_snapshot) VALUES ('2026-10-01T00:00:00.000Z','created','product','bug','old-bug',?)",
    )
    .run(
      JSON.stringify({
        title: "Legacy",
        state: "ready",
        id: "old-bug",
        version: 1,
        projectId: "p1",
        ownerId: "dev",
      }),
    );
  expect(
    (
      await f.api(
        "POST",
        "/api/members/dev/rename",
        { expectedVersion: 1, displayName: "Changed" },
        "admin",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        "/api/projects/p1/rename",
        { expectedVersion: 1, name: "Changed project" },
        "admin",
      )
    ).status,
  ).toBe(200);
  const { stateAt } = await import("../apps/api/src/history/query.js");
  expect(
    stateAt(
      f.db,
      { kind: "bug", id: "old-bug" },
      { time: "2026-10-01T00:00:00.000Z", seq: Number(old.lastInsertRowid) },
    ),
  ).toMatchObject({ ownerName: "dev", projectName: "Project One" });
});
it("task_08 specified correction fixtures exercise real immutable update storage", async () => {
  const other = f.seed("correctionByOther");
  expect((await f.api("POST", "/api/updates", other, "product")).status).toBe(
    403,
  );
  expect(f.read("updates")).toHaveLength(1);
  const own = f.seed("ownCorrection");
  expect((await f.api("POST", "/api/updates", own, "dev")).status).toBe(200);
  expect(f.read("updates")).toHaveLength(2);
});
it("task_08 corrections replace content without moving the original logical entry in effective lists or pages", async () => {
  const t = await task();
  const a = await f.api<any>(
    "POST",
    "/api/updates",
    update(t, { done: "First" }),
    "dev",
  );
  const b = await f.api<any>(
    "POST",
    "/api/updates",
    update(t, { done: "Second" }),
    "dev",
  );
  const c = await f.api<any>(
    "POST",
    "/api/updates",
    update(t, {
      done: "First corrected",
      correctsId: a.body.id,
      reason: "Detail",
      expectedVersion: 1,
    }),
    "dev",
  );
  expect(c.status).toBe(200);
  const { effectiveUpdatesAt } = await import(
    "../apps/api/src/updates/service.js"
  );
  expect(
    effectiveUpdatesAt(f.db, c.body.recordedSeq).map((x) => x.done),
  ).toEqual(["First corrected", "Second"]);
  expect(c.body.originalSeq).toBe(a.body.recordedSeq);
  expect(
    effectiveUpdatesAt(f.db, b.body.recordedSeq).map((x) => x.done),
  ).toEqual(["First", "Second"]);
  const first = await f.api<any>("GET", "/api/updates?limit=1", {}, "dev");
  expect(first.body.items[0].done).toBe("First corrected");
  expect(first.body.nextAfterSeq).toBe(a.body.recordedSeq);
  const second = await f.api<any>(
    "GET",
    `/api/updates?limit=1&afterSeq=${first.body.nextAfterSeq}&cutoffSeq=${first.body.cutoffSeq}`,
    {},
    "dev",
  );
  expect(second.body.items[0].done).toBe("Second");
  expect(second.body.nextAfterSeq).toBeNull();
});
it("task_08 parent revision provenance follows cutoff-time links and survives later revision and detachment", async () => {
  const r = await f.api<any>(
    "POST",
    "/api/requirements",
    {
      projectId: "p1",
      title: "Parent",
      source: { description: "Source" },
      description: "Scope",
      acceptorId: "product",
      criteria: [{ id: "c1", text: "Works", required: true }],
      priority: "medium",
    },
    "product",
  );
  expect(r.status).toBe(200);
  const t = await f.api<any>(
    "POST",
    "/api/tasks",
    {
      projectId: "p1",
      requirementId: r.body.id,
      title: "Linked task",
      kind: "backend",
      definitionOfDone: "Checked",
      priority: "medium",
      ownerId: "dev",
    },
    "product",
  );
  expect(t.status).toBe(200);
  const a = await f.api<any>("POST", "/api/updates", update(t.body), "dev");
  expect(a.status).toBe(200);
  expect(a.body.snapshot).toMatchObject({
    requirementId: r.body.id,
    revision: 1,
    version: 1,
  });
  const revised = await f.api<any>(
    "POST",
    `/api/requirements/${r.body.id}/actions`,
    {
      action: "revise",
      expectedVersion: 1,
      kind: "behavior",
      impactConfirmed: true,
      affectedTaskIds: [],
      affectedCheckIds: [],
      reason: "Expanded scope",
    },
    "product",
  );
  expect(revised.status).toBe(200);
  const revisionEvent = f.events("requirement", r.body.id).at(-1)!;
  const { stateAt } = await import("../apps/api/src/history/query.js");
  expect(
    stateAt(
      f.db,
      { kind: "task", id: t.body.id },
      { time: revisionEvent.time, seq: revisionEvent.seq },
    ),
  ).toMatchObject({ requirementId: r.body.id, revision: 2, version: 1 });
  const b = await f.api<any>("POST", "/api/updates", update(t.body), "dev");
  expect(b.body.snapshot).toMatchObject({
    requirementId: r.body.id,
    revision: 2,
  });
  expect(
    (
      await f.api(
        "POST",
        `/api/requirements/${r.body.id}/actions`,
        {
          action: "cancel",
          expectedVersion: 2,
          reason: "Detached",
          taskDisposition: [{ taskId: t.body.id, disposition: "detach" }],
        },
        "product",
      )
    ).status,
  ).toBe(200);
  const last = f.events().at(-1)!;
  expect(
    stateAt(
      f.db,
      { kind: "task", id: t.body.id },
      { time: last.time, seq: last.seq },
    ),
  ).toMatchObject({ requirementId: null, revision: null });
  expect(
    stateAt(
      f.db,
      { kind: "task", id: t.body.id },
      { time: a.body.recordedAt, seq: a.body.recordedSeq },
    ),
  ).toMatchObject({ requirementId: r.body.id, revision: 1 });
  const c = await f.api<any>(
    "POST",
    "/api/updates",
    update(t.body, {
      correctsId: a.body.id,
      expectedVersion: 1,
      reason: "Text only",
    }),
    "dev",
  );
  expect(c.body.snapshot).toEqual(a.body.snapshot);
});

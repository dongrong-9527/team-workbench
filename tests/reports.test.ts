import { beforeEach, afterEach, it, expect } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
let f: TestKit;
let now: string;
beforeEach(async () => {
  now = "2026-10-12T02:00:00.000Z";
  f = await createTestKit({ clock: () => new Date(now) });
});
afterEach(async () => {
  await f.close();
});
const input = (extra: any = {}) => ({
  date: "2026-10-11",
  memberIds: ["dev", "dev2"],
  projectIds: ["p1", "p2"],
  ...extra,
});
function event(
  id = "t1",
  state = "active",
  time = "2026-10-11T01:00:00.000Z",
  actor = "dev",
  kind = "task",
  extra: any = {},
) {
  const row = f.db
    .prepare("SELECT current,version FROM objects WHERE id=?")
    .get(id) as any;
  const before = row ? JSON.parse(row.current) : null;
  const after = {
    id,
    projectId: "p1",
    projectName: "Project One",
    title: `Title ${id}`,
    kind: "backend",
    ownerId: "dev",
    ownerName: "dev",
    state,
    blocked: false,
    version: (row?.version ?? 0) + 1,
    ...extra,
  };
  if (row)
    f.db
      .prepare("UPDATE objects SET current=?,version=version+1 WHERE id=?")
      .run(JSON.stringify(after), id);
  else
    f.db
      .prepare("INSERT INTO objects VALUES (?,?,?,?,?)")
      .run(id, kind, after.projectId, 1, JSON.stringify(after));
  return Number(
    f.db
      .prepare(
        "INSERT INTO events(time,action,actor_id,target_kind,target_id,before_snapshot,after_snapshot) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        time,
        "fixtureState",
        actor,
        kind,
        id,
        before ? JSON.stringify(before) : null,
        JSON.stringify(after),
      ).lastInsertRowid,
  );
}
async function update(extra: any = {}, actor: any = "dev") {
  const r = await f.api<any>(
    "POST",
    "/api/updates",
    {
      target: { kind: "task", id: "t1" },
      workDate: "2026-10-11",
      done: "校验说明",
      contributionType: "coordination",
      ...extra,
    },
    actor,
  );
  expect(r.status).toBe(200);
  return r.body;
}
async function report(extra: any = {}, actor: any = "dev", key?: string) {
  const r = await f.api<any>("POST", "/api/reports", input(extra), actor, key);
  expect(r.status).toBe(200);
  return r.body;
}
it("task_09 historical report excludes later repair, counts reopened separately, and records missing input", async () => {
  event();
  event("t1", "done", "2026-10-11T02:00:00.000Z");
  event("t1", "active", "2026-10-11T03:00:00.000Z");
  event("t1", "done", "2026-10-11T16:00:00.000Z");
  await update();
  const r = await report();
  expect(r.text).toContain("未填写今日工作更新");
  expect(r.text).toContain("明日计划：未填写");
  expect(r.counts.tasksDone).toBe(0);
  expect(r.reopenedIds).toContain("t1");
  expect(r.text).not.toContain("已上线");
  expect(r.stateCutoff).toEqual({
    time: "2026-10-11T15:59:59.999Z",
    seq: r.sourceCutoffSeq,
  });
  const src = await f.api<any>("GET", `/api/reports/${r.id}/sources`);
  expect(src.status).toBe(200);
  expect(
    src.body.items.some(
      (x: any) => x.kind === "state" && x.snapshot.state === "active",
    ),
  ).toBe(true);
});
it("task_09 separate terminal counts deduplicate objects and only count entry on day with selected operator", async () => {
  event();
  event("t1", "done", "2026-10-11T02:00:00.000Z", "tester");
  event("t1", "done", "2026-10-11T03:00:00.000Z", "tester");
  event("b1", "active", "2026-10-11T01:00:00.000Z", "dev", "bug");
  event("b1", "closed", "2026-10-11T02:00:00.000Z", "tester", "bug");
  event("r1", "active", "2026-10-11T01:00:00.000Z", "dev", "requirement");
  event("r1", "accepted", "2026-10-11T02:00:00.000Z", "product", "requirement");
  event("old", "done", "2026-10-10T01:00:00.000Z");
  expect((await report({ memberIds: ["dev"] })).counts).toEqual({
    tasksDone: 0,
    bugsClosed: 0,
    requirementsAccepted: 0,
  });
  const r = await report({ memberIds: ["tester", "product"] });
  expect(r.counts).toEqual({
    tasksDone: 1,
    bugsClosed: 1,
    requirementsAccepted: 1,
  });
  expect(r.text).toContain("状态操作");
  expect(r.text).toContain("tester");
});
it("task_09 preserves logical updates and each author; project/member filters and selection order are stable", async () => {
  event();
  event("p2task", "active", "2026-10-11T01:00:00.000Z", "dev", "task", {
    projectId: "p2",
    projectName: "Project Two",
  });
  await update({ done: "first" });
  const second = await update({ done: "second" });
  await update({ done: "other contribution" }, "dev2");
  const r = await report({
    memberIds: ["dev2", "dev"],
    projectIds: ["p2", "p1"],
  });
  expect(r.text.indexOf("dev2")).toBeLessThan(r.text.indexOf("\ndev\n"));
  expect(r.text).toContain("first");
  expect(r.text).toContain("second");
  expect(r.text).toContain("other contribution");
  const filtered = await report({ memberIds: ["dev2"], projectIds: ["p2"] });
  expect(filtered.text).not.toContain("other contribution");
  await update({
    done: "second corrected",
    correctsId: second.id,
    expectedVersion: 1,
    reason: "detail",
  });
  const newer = await report();
  expect(newer.text.indexOf("first")).toBeLessThan(
    newer.text.indexOf("second corrected"),
  );
});
it("task_09 source changes detect late additions, corrections and moved-away work dates without changing old snapshot", async () => {
  event();
  const u = await update();
  const r = await report();
  const before = await f.api<any>("GET", `/api/reports/${r.id}`);
  expect(
    (await f.api<any>("GET", `/api/reports/${r.id}/source-changes`)).body
      .changed,
  ).toBe(false);
  await update({
    correctsId: u.id,
    expectedVersion: 1,
    reason: "date correction",
    workDate: "2026-10-10",
  });
  const changed = await f.api<any>(
    "GET",
    `/api/reports/${r.id}/source-changes`,
  );
  expect(changed.body.changed).toBe(true);
  expect(changed.body.removed).toContainEqual(
    expect.objectContaining({ kind: "update", id: u.id }),
  );
  await update({ done: "late added" });
  expect(
    (await f.api<any>("GET", `/api/reports/${r.id}/source-changes`)).body.added
      .length,
  ).toBeGreaterThan(0);
  expect((await f.api("GET", `/api/reports/${r.id}`)).body).toEqual(
    before.body,
  );
});
it("task_09 immutable edit and explicit regeneration preserve old drafts, use latest head, and do not write business events", async () => {
  event();
  await update();
  const r = await report();
  const events = f.events(),
    eventBytes = f.db.prepare("SELECT * FROM events ORDER BY seq").all(),
    updates = f.read("updates");
  const edit = await f.api<any>(
    "POST",
    `/api/reports/${r.id}/versions`,
    { text: "人工核对\n保留说明", expectedVersion: 1 },
    "dev",
    "edit",
  );
  expect(edit.status).toBe(200);
  expect(edit.body).toMatchObject({
    version: 2,
    seriesId: r.seriesId,
    edited: true,
    text: "人工核对\n保留说明",
  });
  expect(f.events()).toEqual(events);
  expect(f.db.prepare("SELECT * FROM events ORDER BY seq").all()).toEqual(
    eventBytes,
  );
  expect(f.read("updates")).toEqual(updates);
  expect(
    (await f.api<any>("GET", `/api/reports/${r.id}/source-changes`)).body
      .changed,
  ).toBe(false);
  expect(
    (
      await f.api(
        "POST",
        `/api/reports/${r.id}/versions`,
        { text: "stale", expectedVersion: 1 },
        "dev",
      )
    ).status,
  ).toBe(409);
  const regenerated = await report({
    previousReportId: edit.body.id,
    expectedVersion: 2,
  });
  expect(regenerated.version).toBe(3);
  expect(regenerated.edited).toBe(false);
  expect(regenerated.text).toBe(r.text);
  expect(
    (await f.api<any>("GET", `/api/reports/${edit.body.id}`)).body.text,
  ).toBe("人工核对\n保留说明");
  expect(() =>
    f.db.prepare("UPDATE report_versions SET record=record").run(),
  ).toThrow();
  expect(() => f.db.prepare("DELETE FROM report_versions").run()).toThrow();
});
it("task_09 active read-only members can generate archived selections; creator-only mutation is rechecked before replay", async () => {
  event();
  f.db.exec(
    "UPDATE projects SET archived=1,version=version+1 WHERE id='p1'; DELETE FROM roles WHERE member_id='dev'",
  );
  const r = await report({}, "dev", "generate");
  expect(
    (await f.api("GET", `/api/reports/${r.id}`, {}, "tester")).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        `/api/reports/${r.id}/versions`,
        { text: "stolen", expectedVersion: 1 },
        "tester",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await f.api(
        "POST",
        "/api/reports",
        input({ previousReportId: r.id, expectedVersion: 1 }),
        "tester",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await f.api(
        "POST",
        "/api/reports",
        input({
          previousReportId: r.id,
          expectedVersion: 1,
          memberIds: ["tester"],
        }),
        "dev",
      )
    ).status,
  ).toBe(422);
  expect(
    (await f.api("POST", "/api/reports", input(), "dev", "generate")).body,
  ).toEqual(r);
  f.db.exec("UPDATE members SET active=0,version=version+1 WHERE id='dev'");
  expect(
    (await f.api("POST", "/api/reports", input(), "dev", "generate")).status,
  ).toBe(401);
  expect(
    (await f.api("GET", `/api/reports/${r.id}`, {}, "anonymous")).status,
  ).toBe(401);
});
it("task_09 list, versions and sources have bounded stable pagination with immutable traversal cutoffs", async () => {
  event();
  await update();
  const a = await report();
  const b = await report();
  const page = await f.api<any>("GET", "/api/reports?limit=1");
  expect(page.status).toBe(200);
  expect(page.body.items[0].id).toBe(a.id);
  expect(page.body.nextAfterSeq).not.toBeNull();
  await report();
  const next = await f.api<any>(
    "GET",
    `/api/reports?limit=1&afterSeq=${page.body.nextAfterSeq}&cutoffSeq=${page.body.cutoffSeq}`,
  );
  expect(next.body.items.map((r: any) => r.id)).toEqual([b.id]);
  expect(next.body.nextAfterSeq).toBeNull();
  await f.api(
    "POST",
    `/api/reports/${a.id}/versions`,
    { text: "edit", expectedVersion: 1 },
    "dev",
  );
  const versions = await f.api<any>("GET", `/api/reports/${a.id}/versions`);
  expect(versions.body.items.map((x: any) => x.version)).toEqual([1, 2]);
  const sources = await f.api<any>(
    "GET",
    `/api/reports/${a.id}/sources?limit=1`,
  );
  expect(sources.body.items).toHaveLength(1);
  expect(sources.body.nextAfterSeq).not.toBeNull();
  for (const path of [
    "/api/reports?limit=0",
    `/api/reports/${a.id}/sources?unknown=1`,
    `/api/reports/${a.id}/versions?afterSeq=-1`,
  ])
    expect((await f.api("GET", path)).status).toBe(400);
});
it.each([
  { date: "2026-02-30" },
  { date: "2026-10-13" },
  { timeZone: "Mars/Nowhere" },
  { memberIds: [] },
  { memberIds: ["dev", "dev"] },
  { projectIds: ["missing"] },
  { memberIds: ["missing"] },
  { creatorId: "tester" },
  { expectedVersion: 1 },
])("task_09 rejects invalid report selection %j", async (extra) => {
  const r = await f.api("POST", "/api/reports", input(extra), "dev");
  expect(r.status).toBe(
    "creatorId" in extra ||
      "expectedVersion" in extra ||
      ("memberIds" in extra &&
        (!extra.memberIds?.length || extra.memberIds.length === 2))
      ? 400
      : "projectIds" in extra || "memberIds" in extra
        ? 404
        : 422,
  );
});
it("task_09 blocked owned work is separate attention, not an authored contribution", async () => {
  event("t1", "active", undefined, undefined, undefined, { blocked: true });
  const r = await report();
  expect(r.text).toContain("待关注");
  expect(r.text).toContain("未填写今日工作更新");
  expect(r.counts.tasksDone).toBe(0);
});
it.each([
  ["2026-03-08", "America/New_York", "2026-03-09T03:59:59.999Z"],
  ["2026-11-01", "America/New_York", "2026-11-02T04:59:59.999Z"],
  ["2026-10-11", "Asia/Kathmandu", "2026-10-11T18:14:59.999Z"],
])(
  "task_09 local-day end respects timezone and DST %s %s",
  async (date, timeZone, end) => {
    now = "2026-11-03T02:00:00.000Z";
    expect((await report({ date, timeZone })).stateCutoff.time).toBe(end);
  },
);
it("task_09 current-day cutoff is generation time, and equal timestamps respect captured sequence", async () => {
  now = "2026-10-11T15:59:59.999Z";
  event();
  const seq = event("t1", "done", now);
  const r = await report();
  expect(r.stateCutoff).toEqual({ time: now, seq });
  expect(r.counts.tasksDone).toBe(1);
  event("t1", "active", now);
  expect(
    (await f.api<any>("GET", `/api/reports/${r.id}/source-changes`)).body
      .changed,
  ).toBe(true);
  expect(
    (await f.api<any>("GET", `/api/reports/${r.id}`)).body.counts.tasksDone,
  ).toBe(1);
  now = "2026-10-11T16:00:00.000Z";
  expect((await report()).counts.tasksDone).toBe(0);
});
it("task_09 report persistence failures roll back artifact and replay key; read failures are errors", async () => {
  event();
  f.db.exec(
    "CREATE TEMP TRIGGER fail_report BEFORE INSERT ON report_versions BEGIN SELECT RAISE(ABORT,'full'); END",
  );
  expect(
    (await f.api("POST", "/api/reports", input(), "dev", "fail")).status,
  ).toBe(500);
  expect(
    f.db.prepare("SELECT * FROM idempotency WHERE request_id='fail'").all(),
  ).toHaveLength(0);
  f.db.exec("DROP TRIGGER fail_report");
  const r = await report({}, "dev", "fail");
  f.db.exec("ALTER TABLE report_versions RENAME TO unavailable_reports");
  expect((await f.api("GET", `/api/reports/${r.id}`)).status).toBe(500);
});
it("task_09 selected reopening operator is attributable only when terminal entry was on this day", async () => {
  event();
  event("t1", "done", "2026-10-11T02:00:00.000Z", "tester");
  event("t1", "active", "2026-10-11T03:00:00.000Z", "dev2");
  event("yesterday", "done", "2026-10-10T03:00:00.000Z", "tester");
  event("yesterday", "active", "2026-10-11T03:00:00.000Z", "dev2");
  const r = await report({ memberIds: ["dev2"] });
  expect(r.reopenedIds).toEqual(["t1"]);
  expect(r.counts.tasksDone).toBe(0);
  expect(r.text).toContain("yesterday");
});
it("task_09 immutable update provenance and report-day state remain distinct after rename and transfer", async () => {
  event();
  const u = await update();
  const r = await report();
  const initial = await f.api<any>("GET", `/api/reports/${r.id}/sources`);
  now = "2026-10-12T03:00:00.000Z";
  event("t1", "done", now, "tester", "task", {
    title: "New title",
    ownerId: "dev2",
    ownerName: "new dev2",
  });
  expect(
    (await f.api<any>("GET", `/api/reports/${r.id}/source-changes`)).body
      .changed,
  ).toBe(false);
  const c = await update({
    correctsId: u.id,
    expectedVersion: 1,
    reason: "detail",
    done: "corrected historical wording",
  });
  const newReport = await report();
  const newSource = (
    await f.api<any>("GET", `/api/reports/${newReport.id}/sources`)
  ).body.items;
  expect(
    newSource.find((x: any) => x.kind === "update").update.snapshot,
  ).toEqual(u.snapshot);
  expect(c.snapshot).toEqual(u.snapshot);
  expect(newSource.find((x: any) => x.kind === "state").snapshot).toMatchObject(
    { title: "Title t1", state: "active", ownerId: "dev" },
  );
  expect(
    (await f.api<any>("GET", `/api/reports/${r.id}/sources`)).body,
  ).toEqual(initial.body);
});
it("task_09 identical selected sources render byte-identically and sources pagination preserves every entry", async () => {
  event();
  await update({ done: "first" });
  await update({ done: "second" });
  const a = await report();
  now = "2026-10-12T03:00:00.000Z";
  const b = await report();
  expect(b.text).toBe(a.text);
  expect(b.sources).toEqual(a.sources);
  const all = (await f.api<any>("GET", `/api/reports/${a.id}/sources`)).body
    .items;
  let after = 0;
  const read: any[] = [];
  let cutoff: number | undefined;
  for (;;) {
    const p = (
      await f.api<any>(
        "GET",
        `/api/reports/${a.id}/sources?limit=1&afterSeq=${after}${cutoff === undefined ? "" : `&cutoffSeq=${cutoff}`}`,
      )
    ).body;
    read.push(...p.items);
    cutoff = p.cutoffSeq;
    if (p.nextAfterSeq === null) break;
    after = p.nextAfterSeq;
  }
  expect(read).toEqual(all);
});
it("task_09 real test evidence remains attributable to tester and cannot complete developer work by prose", async () => {
  event();
  await update({ done: "完成开发并通过测试" });
  const seq = Number(
    f.db
      .prepare(
        "INSERT INTO events(time,action,actor_id,target_kind,target_id,after_snapshot) VALUES (?,'testRecorded','tester','task','t1',?)",
      )
      .run(
        "2026-10-11T02:00:00.000Z",
        JSON.stringify({
          id: "test1",
          testerId: "tester",
          checks: [{ result: "pass" }],
          snapshot: {},
        }),
      ).lastInsertRowid,
  );
  const r = await report({ memberIds: ["tester"] });
  expect(r.counts.tasksDone).toBe(0);
  expect(r.text).toContain("记录测试结果");
  expect(r.text).not.toContain("完成开发");
  expect(r.sources).toContainEqual({
    kind: "event",
    id: String(seq),
    version: 1,
    seq,
  });
});
it("task_09 old versions cannot be used as regeneration bases; edit replay remains immutable", async () => {
  event();
  const r = await report();
  const payload = { text: "manual", expectedVersion: 1 };
  const e = await f.api<any>(
    "POST",
    `/api/reports/${r.id}/versions`,
    payload,
    "dev",
    "edit-replay",
  );
  expect(e.status).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        "/api/reports",
        input({ previousReportId: r.id, expectedVersion: 2 }),
        "dev",
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await f.api(
        "POST",
        "/api/reports",
        input({ previousReportId: e.body.id }),
        "dev",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await f.api(
        "POST",
        "/api/reports",
        input({
          previousReportId: e.body.id,
          expectedVersion: 2,
          projectIds: ["p2", "p1"],
        }),
        "dev",
      )
    ).status,
  ).toBe(422);
  f.db.exec(
    "DELETE FROM roles WHERE member_id='dev'; UPDATE projects SET archived=1,version=version+1 WHERE id='p1'",
  );
  expect(
    (
      await f.api(
        "POST",
        `/api/reports/${r.id}/versions`,
        payload,
        "dev",
        "edit-replay",
      )
    ).body,
  ).toEqual(e.body);
  f.db.exec("UPDATE members SET active=0,version=version+1 WHERE id='dev'");
  expect(
    (
      await f.api(
        "POST",
        `/api/reports/${r.id}/versions`,
        payload,
        "dev",
        "edit-replay",
      )
    ).status,
  ).toBe(401);
});
it("task_09 idempotency persistence failure rolls back the captured version atomically", async () => {
  event();
  f.db.exec(
    "CREATE TEMP TRIGGER fail_key BEFORE INSERT ON idempotency WHEN NEW.request_id='rollback' BEGIN SELECT RAISE(ABORT,'full'); END",
  );
  expect(
    (await f.api("POST", "/api/reports", input(), "dev", "rollback")).status,
  ).toBe(500);
  expect(f.db.prepare("SELECT * FROM report_versions").all()).toHaveLength(0);
  f.db.exec("DROP TRIGGER fail_key");
  const r = await report({}, "dev", "rollback");
  expect(r.version).toBe(1);
});
it("task_09 stores generation snapshot in the same transaction that holds the writer lock", async () => {
  event();
  const { generateReport } = await import("../apps/api/src/reports/service.js");
  const { openDb } = await import("../apps/api/src/db/open.js");
  const other = openDb(f.path);
  other.pragma("busy_timeout=0");
  try {
    const r = generateReport(
      f.db,
      { ...f.context, actorId: "dev", requestId: "locked-report" },
      input({ timeZone: "Asia/Shanghai" }),
      () => {
        expect(f.db.inTransaction).toBe(true);
        expect(() =>
          other
            .prepare(
              "INSERT INTO events(time,action,actor_id,target_kind,target_id) VALUES (?,'concurrent','dev','task','t1')",
            )
            .run(now),
        ).toThrow(/locked/);
        return new Date(now);
      },
    );
    expect(r.sourceCutoffSeq).toBe(f.events().at(-1)!.seq);
  } finally {
    other.close();
  }
});
it("task_09 allows editing a generated draft longer than the ordinary business request body limit", async () => {
  event();
  for (let i = 0; i < 4; i++) await update({ done: "a".repeat(5900) });
  const r = await report();
  expect(r.text.length).toBeGreaterThan(16000);
  expect(
    (
      await f.api(
        "POST",
        `/api/reports/${r.id}/versions`,
        { text: r.text + "\nchecked", expectedVersion: 1 },
        "dev",
      )
    ).status,
  ).toBe(200);
});
it("task_09 approved historicalReport fixture has fixed capture time and reopened task", async () => {
  const r = await f.api<any>(
    "POST",
    "/api/reports",
    f.seed("historicalReport"),
    "dev",
    "rep-1",
  );
  expect(r.status).toBe(200);
  expect(r.body.generatedAt).toBe("2026-10-12T02:00:00.000Z");
  expect(r.body.text).toContain("未填写今日工作更新");
  expect(r.body.counts.tasksDone).toBe(0);
  expect(r.body.reopenedIds).toContain("t1");
  expect(r.body.text).not.toContain("已上线");
});
it("task_09 rejects explicit null/offset timezone and skipped local calendar days", async () => {
  for (const [extra, status] of [
    [{ timeZone: null }, 400],
    [{ timeZone: "+08:00" }, 422],
    [{ date: "2011-12-30", timeZone: "Pacific/Apia" }, 422],
  ] as const) {
    expect(
      (await f.api("POST", "/api/reports", input(extra), "dev")).status,
    ).toBe(status);
  }
});
it("task_09 historical name display uses the day cutoff while retaining the late entry original source", async () => {
  event("t1", "active", undefined, undefined, undefined, {
    ownerName: "Earlier member",
    projectName: "Earlier project",
  });
  f.db
    .prepare(
      "INSERT INTO events(time,action,actor_id,target_kind,target_id,before_snapshot,after_snapshot) VALUES (?,'rename','admin','member','dev',?,?)",
    )
    .run(
      "2026-10-11T16:00:00.000Z",
      JSON.stringify({ displayName: "Earlier member" }),
      JSON.stringify({ displayName: "Later member" }),
    );
  f.db
    .prepare(
      "INSERT INTO events(time,action,actor_id,target_kind,target_id,before_snapshot,after_snapshot) VALUES (?,'rename','admin','project','p1',?,?)",
    )
    .run(
      "2026-10-11T16:00:00.000Z",
      JSON.stringify({ name: "Earlier project" }),
      JSON.stringify({ name: "Later project" }),
    );
  f.db.exec(
    "UPDATE members SET name='Later member',version=version+1 WHERE id='dev'; UPDATE projects SET name='Later project',version=version+1 WHERE id='p1'",
  );
  await update();
  const r = await report();
  expect(r.text).toContain("Earlier member");
  expect(r.text).toContain("Earlier project");
  expect(r.text).not.toContain("Later member");
  expect(r.text).not.toContain("Later project");
});
it("task_09 concurrent edits append exactly one latest version and stale writer receives latest draft", async () => {
  event();
  const r = await report();
  const results = await Promise.all(
    ["a", "b"].map((text) =>
      f.api<any>(
        "POST",
        `/api/reports/${r.id}/versions`,
        { text, expectedVersion: 1 },
        "dev",
      ),
    ),
  );
  expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
  expect(results.find((x) => x.status === 409)!.body.latest).toEqual(
    results.find((x) => x.status === 200)!.body,
  );
  expect(f.db.prepare("SELECT * FROM report_versions").all()).toHaveLength(2);
});

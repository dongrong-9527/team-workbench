import { beforeEach, afterEach, it, expect } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
let f: TestKit;
beforeEach(async () => {
  f = await createTestKit();
});
afterEach(async () => {
  await f.close();
});
const input = {
  projectId: "p1",
  title: "Deliver validation",
  source: { description: "Manual source" },
  description: "Validate input",
  acceptorId: "product",
  criteria: [{ id: "c1", text: "Input validated", required: true }],
  priority: "medium",
};
async function create() {
  const r = await f.api("POST", "/api/requirements", input, "product");
  expect(r.status).toBe(200);
  return r.body as any;
}
async function action(r: any, body: any, actor: any = "product", key?: string) {
  return f.api(
    "POST",
    `/api/requirements/${r.id}/actions`,
    { expectedVersion: r.version, ...body },
    actor,
    key,
  );
}
it("task_04 creates an inspectable requirement and immutable initial revision", async () => {
  const r = await create();
  expect(r).toMatchObject({
    state: "draft",
    revision: 1,
    version: 1,
    evidenceReady: false,
  });
  expect(
    (await f.api("GET", `/api/requirements/${r.id}`, {}, "dev")).body,
  ).toEqual(r);
  expect(
    (await f.api("GET", `/api/requirements/${r.id}/revisions`, {}, "tester"))
      .body,
  ).toHaveLength(1);
});
it("task_04 requires product confirmation, criteria and independent acceptor before ready", async () => {
  let r = await create();
  expect(
    (
      await action(r, {
        action: "makeReady",
        source: {
          description: "Manual",
          status: "checked",
          checkedAt: "2026-10-12T00:00:00.000Z",
        },
      })
    ).status,
  ).toBe(409);
  r = (await action(r, { action: "refine", description: "Complete detail" }))
    .body;
  expect(
    (
      await action(
        r,
        {
          action: "makeReady",
          source: {
            description: "Manual",
            status: "checked",
            checkedAt: "2026-10-12T00:00:00.000Z",
          },
        },
        "dev",
      )
    ).status,
  ).toBe(403);
  r = (
    await action(r, {
      action: "makeReady",
      source: {
        description: "Manual",
        status: "unable",
        reason: "Restricted access",
      },
    })
  ).body;
  expect(r.state).toBe("ready");
});
it("task_04 behavior revision invalidates evidence, reopens affected work, leaves unrelated work and immutable snapshots", async () => {
  let r = await create();
  f.db.prepare("UPDATE objects SET current=?,version=version+1 WHERE id=?").run(
    JSON.stringify({
      ...r,
      state: "accepted",
      evidenceReady: true,
      version: 2,
    }),
    r.id,
  );
  r = { ...r, version: 2 };
  for (const id of ["t1", "t2"])
    f.db.prepare("INSERT INTO objects VALUES (?,'task','p1',1,?)").run(
      id,
      JSON.stringify({
        id,
        projectId: "p1",
        title: id,
        requirementId: r.id,
        kind: "backend",
        ownerId: "dev",
        state: "done",
        version: 1,
        definitionOfDone: "Complete",
      }),
    );
  const result = await action(r, {
    action: "revise",
    kind: "behavior",
    reason: "New validation",
    impactConfirmed: true,
    affectedTaskIds: ["t1"],
    affectedCheckIds: ["c1"],
    criteria: [{ id: "c1", text: "New validation", required: true }],
  });
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({
    state: "refining",
    revision: 2,
    evidenceReady: false,
  });
  expect(
    JSON.parse(
      (f.db.prepare("SELECT current FROM objects WHERE id=?").get("t1") as any)
        .current,
    ).state,
  ).toBe("active");
  expect(
    JSON.parse(
      (f.db.prepare("SELECT current FROM objects WHERE id=?").get("t2") as any)
        .current,
    ).state,
  ).toBe("done");
  const revisions = (
    await f.api("GET", `/api/requirements/${r.id}/revisions`, {}, "dev")
  ).body as any;
  expect(revisions[0].snapshot.criteria[0].text).toBe("Input validated");
  expect(revisions[1].affectedCheckIds).toEqual(["c1"]);
  expect(() => f.db.exec("DELETE FROM requirement_revisions")).toThrow();
});
it("task_04 editorial changes preserve revision and reject behavioral edits", async () => {
  const r = await create();
  expect(
    (
      await action(r, {
        action: "revise",
        kind: "editorial",
        reason: "Typo",
        title: "Correct title",
      })
    ).body.revision,
  ).toBe(1);
  expect(
    (
      await action(
        { ...r, version: 2 },
        { action: "revise", kind: "editorial", reason: "Wrong", criteria: [] },
      )
    ).status,
  ).toBe(422);
});
it("task_04 cancellation requires exact disposition, keeps bugs and restore leaves tasks cancelled", async () => {
  let r = await create();
  f.db.prepare("INSERT INTO objects VALUES ('t1','task','p1',1,?)").run(
    JSON.stringify({
      id: "t1",
      projectId: "p1",
      requirementId: r.id,
      title: "Task",
      state: "active",
      kind: "backend",
      ownerId: "dev",
      version: 1,
    }),
  );
  f.db
    .prepare("INSERT INTO objects VALUES ('b1','bug','p1',1,?)")
    .run(
      JSON.stringify({ requirementId: r.id, state: "ready", role: "backend" }),
    );
  expect(
    (
      await action(r, {
        action: "cancel",
        reason: "Scope stopped",
        taskDisposition: [],
      })
    ).status,
  ).toBe(422);
  r = (
    await action(r, {
      action: "cancel",
      reason: "Scope stopped",
      taskDisposition: [{ taskId: "t1", disposition: "cancel" }],
    })
  ).body;
  expect(r.state).toBe("cancelled");
  r = (await action(r, { action: "restore", reason: "Resume review" })).body;
  expect(r.state).toBe("refining");
  expect(
    JSON.parse(
      (f.db.prepare("SELECT current FROM objects WHERE id='t1'").get() as any)
        .current,
    ).state,
  ).toBe("cancelled");
  expect(
    JSON.parse(
      (f.db.prepare("SELECT current FROM objects WHERE id='b1'").get() as any)
        .current,
    ).state,
  ).toBe("ready");
});
it("task_04 replay checks current permissions and all effects roll back on event failure", async () => {
  const r = await create();
  await f.failNextEvent();
  expect(
    (await action(r, { action: "refine", description: "Refined" })).status,
  ).toBe(500);
  expect(
    (await f.api("GET", `/api/requirements/${r.id}`, {}, "dev")).body.version,
  ).toBe(1);
  expect(
    (
      await action(
        r,
        { action: "suggestChange", reason: "Source changed" },
        "dev",
        "suggest",
      )
    ).status,
  ).toBe(200);
  f.db.prepare("DELETE FROM roles WHERE member_id='dev'").run();
  expect(
    (
      await action(
        r,
        { action: "suggestChange", reason: "Source changed" },
        "dev",
        "suggest",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await action(r, {
        action: "refine",
        description: "Refined",
        expectedVersion: 99,
      })
    ).status,
  ).toBe(409);
  f.db
    .prepare("UPDATE projects SET archived=1,version=version+1 WHERE id='p1'")
    .run();
  expect(
    (await action(r, { action: "refine", description: "Refined" })).status,
  ).toBe(409);
});
it("task_04 rejects omitted changed checks, cross-project impact and unconfirmed impact", async () => {
  const r = await create();
  const cmd = {
    action: "revise",
    kind: "behavior",
    reason: "Changed",
    impactConfirmed: true,
    affectedTaskIds: [],
    affectedCheckIds: [],
    criteria: [{ id: "c1", text: "Changed behavior", required: true }],
  };
  expect((await action(r, cmd)).status).toBe(422);
  expect(
    (
      await action(r, {
        ...cmd,
        criteria: input.criteria,
        impactConfirmed: false,
      })
    ).status,
  ).toBe(422);
  // Deliberately bypass Task5 SQL guard to exercise corrupted legacy-row defense.
  f.db.exec("DROP TRIGGER task_parent_insert");
  f.db
    .prepare("INSERT INTO objects VALUES ('foreign','task','p2',1,?)")
    .run(JSON.stringify({ requirementId: r.id, state: "done" }));
  expect(
    (
      await action(r, {
        ...cmd,
        affectedCheckIds: ["c1"],
        affectedTaskIds: ["foreign"],
      })
    ).status,
  ).toBe(422);
});
it("task_04 empty criteria and prior execution participation reject readiness", async () => {
  let r = await create();
  r = (await action(r, { action: "refine", criteria: [] })).body;
  expect(
    (
      await action(r, {
        action: "makeReady",
        source: {
          description: "Source",
          status: "unable",
          reason: "Restricted",
        },
      })
    ).status,
  ).toBe(422);
  r = (await action(r, { action: "refine", criteria: input.criteria })).body;
  f.db
    .prepare("INSERT INTO objects VALUES ('work','task','p1',1,?)")
    .run(JSON.stringify({ id: "work", requirementId: null, state: "done" }));
  f.db
    .prepare(
      "INSERT INTO execution_participations VALUES ('seed-work','work','p1','product',?,'backend','development','2026-10-12T00:00:00.000Z')",
    )
    .run(r.id);
  expect(
    (
      await action(r, {
        action: "makeReady",
        source: {
          description: "Source",
          status: "unable",
          reason: "Restricted",
        },
      })
    ).status,
  ).toBe(422);
  expect(() => f.db.exec("DELETE FROM execution_participations")).toThrow();
});
it("task_04 functional leads refine only their scope and cannot confirm readiness or revisions", async () => {
  const r = await f.api(
    "POST",
    "/api/requirements",
    { ...input, role: "backend" },
    "product",
  );
  f.db.prepare("UPDATE roles SET lead=1 WHERE member_id='dev'").run();
  const lead = await action(
    r.body,
    { action: "refine", description: "Technical detail" },
    "dev",
  );
  expect(lead.status).toBe(200);
  expect(
    (
      await action(
        lead.body,
        {
          action: "makeReady",
          source: {
            description: "Source",
            status: "unable",
            reason: "Restricted",
          },
        },
        "dev",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await action(
        lead.body,
        {
          action: "revise",
          kind: "editorial",
          reason: "Typo",
          title: "Changed",
        },
        "dev",
      )
    ).status,
  ).toBe(403);
});
it("task_04 creation and reads enforce identity, strict fields and replay sessions", async () => {
  const r = await create();
  expect(
    (await f.api("GET", `/api/requirements/${r.id}`, {}, "anonymous")).status,
  ).toBe(401);
  expect(
    (
      await f.api(
        "POST",
        "/api/requirements",
        { ...input, id: "forged" },
        "product",
      )
    ).status,
  ).toBe(400);
  const cmd = { action: "suggestChange", reason: "Changed source" };
  expect((await action(r, cmd, "dev", "replay")).status).toBe(200);
  expect((await action(r, cmd, "dev", "replay")).status).toBe(200);
  expect(f.events("requirement", r.id)).toHaveLength(2);
  f.db
    .prepare("UPDATE members SET active=0,version=version+1 WHERE id='dev'")
    .run();
  expect((await action(r, cmd, "dev", "replay")).status).toBe(401);
});
it("task_04 behavior revision rolls back task state and snapshot on event failure", async () => {
  const r = await create();
  f.db
    .prepare("INSERT INTO objects VALUES ('work','task','p1',1,?)")
    .run(JSON.stringify({ id: "work", requirementId: r.id, state: "done" }));
  await f.failNextEvent();
  expect(
    (
      await action(r, {
        action: "revise",
        kind: "behavior",
        reason: "Change",
        impactConfirmed: true,
        affectedTaskIds: ["work"],
        affectedCheckIds: ["c1"],
      })
    ).status,
  ).toBe(500);
  expect(
    (await f.api("GET", `/api/requirements/${r.id}/revisions`, {}, "dev")).body,
  ).toHaveLength(1);
  expect(
    (f.db.prepare("SELECT version FROM objects WHERE id='work'").get() as any)
      .version,
  ).toBe(1);
});
it("task_04 immutable work participation records project and requirement at work time", async () => {
  const { recordExecutionParticipation } = await import(
    "../apps/api/src/requirements/revisions.js"
  );
  const r = await create();
  f.db
    .prepare("INSERT INTO objects VALUES ('work','task','p1',1,?)")
    .run(JSON.stringify({ requirementId: r.id, state: "active" }));
  f.db
    .transaction(() =>
      recordExecutionParticipation(f.db, "work", "dev", "backend"),
    )
    .immediate();
  expect(
    f.db.prepare("SELECT * FROM execution_participations").get(),
  ).toMatchObject({
    object_id: "work",
    project_id: "p1",
    requirement_id: r.id,
    member_id: "dev",
    role: "backend",
  });
});
it("task_04 actual repair by test-scoped member is participation independently of role name", async () => {
  const { recordExecutionParticipation } = await import(
    "../apps/api/src/requirements/revisions.js"
  );
  const r = await create();
  f.db
    .prepare("INSERT INTO objects VALUES ('repair','bug','p1',1,?)")
    .run(
      JSON.stringify({ requirementId: r.id, role: "test", state: "fixing" }),
    );
  f.db
    .transaction(() =>
      recordExecutionParticipation(f.db, "repair", "tester", "test" as any),
    )
    .immediate();
  expect(
    f.db
      .prepare(
        "SELECT * FROM execution_participations WHERE object_id='repair'",
      )
      .get(),
  ).toMatchObject({ activity: "repair", role: "test", requirement_id: r.id });
});
it("task_04 refinement after a behavior revision records immutable scope and adds changed checks to impact", async () => {
  let r = await create();
  r = (
    await action(r, {
      action: "revise",
      kind: "behavior",
      reason: "Source change",
      impactConfirmed: true,
      affectedTaskIds: [],
      affectedCheckIds: [],
    })
  ).body;
  r = (
    await action(r, {
      action: "refine",
      criteria: [{ id: "c1", text: "Late scope change", required: true }],
    })
  ).body;
  expect(r.affectedCheckIds).toEqual(["c1"]);
  const revisions = (
    await f.api("GET", `/api/requirements/${r.id}/revisions`, {}, "dev")
  ).body as any;
  expect(revisions[1].scopes.at(-1).snapshot.criteria[0].text).toBe(
    "Late scope change",
  );
  expect(revisions[1].scopes[0].snapshot.criteria[0].text).toBe(
    "Input validated",
  );
});
it("task_04 coordinated requirement writes append scope history inside the same transaction", async () => {
  const { writeDomainObject } = await import(
    "../apps/api/src/requirements/service.js"
  );
  const r = await create();
  f.db
    .transaction(() =>
      writeDomainObject(
        f.db,
        f.context,
        r.id,
        { ...r, state: "active" },
        "executionStarted",
      ),
    )
    .immediate();
  const revisions = (
    await f.api("GET", `/api/requirements/${r.id}/revisions`, {}, "dev")
  ).body as any;
  expect(revisions[0].scopes.at(-1).snapshot.state).toBe("active");
});
it("task_04 unchanged refinement does not create a false version or event", async () => {
  let r = await create();
  r = (await action(r, { action: "refine", description: "Refined detail" }))
    .body;
  const again = await action(r, {
    action: "refine",
    description: "Refined detail",
  });
  expect(again.body.version).toBe(r.version);
  expect(f.events("requirement", r.id)).toHaveLength(2);
});
it("task_04 event snapshots preserve assigned acceptor display name and responsibility", async () => {
  const r = await create();
  expect(f.events("requirement", r.id)[0].after).toMatchObject({
    ownerId: "product",
    ownerName: "product",
    projectName: "Project One",
    actorName: "product",
    revision: 1,
    version: 1,
  });
});
it("task_04 review F1 lead cannot transfer scope or designate acceptor and denied writes leave no history", async () => {
  const r = (
    await f.api(
      "POST",
      "/api/requirements",
      { ...input, role: "backend" },
      "product",
    )
  ).body;
  f.db.prepare("UPDATE roles SET lead=1 WHERE member_id='dev'").run();
  for (const fields of [{ role: "frontend" }, { acceptorId: "admin" }]) {
    const before = f.events("requirement", String(r.id));
    expect(
      (await action(r, { action: "refine", ...fields }, "dev")).status,
    ).toBe(403);
    expect(
      (await f.api("GET", `/api/requirements/${r.id}`, {}, "product")).body,
    ).toEqual(r);
    expect(f.events("requirement", String(r.id))).toEqual(before);
  }
});
it("task_04 review F1 product field policy is rechecked before cached replay", async () => {
  const r = (
    await f.api(
      "POST",
      "/api/requirements",
      { ...input, role: "backend" },
      "product",
    )
  ).body;
  f.db
    .prepare(
      "INSERT INTO roles(project_id,member_id,role,lead) VALUES ('p1','dev','product',0)",
    )
    .run();
  f.db
    .prepare("UPDATE roles SET lead=1 WHERE member_id='dev' AND role='backend'")
    .run();
  const cmd = { action: "refine", acceptorId: "admin" };
  expect((await action(r, cmd, "dev", "field-replay")).status).toBe(200);
  f.db
    .prepare("DELETE FROM roles WHERE member_id='dev' AND role='product'")
    .run();
  expect((await action(r, cmd, "dev", "field-replay")).status).toBe(403);
});
it("task_04 review F2 all coordinated effects reject malformed cross-project links atomically", async () => {
  const r = await create();
  // Deliberately bypass Task5 SQL guard to exercise corrupted legacy-row defense.
  f.db.exec("DROP TRIGGER task_parent_insert");
  f.db
    .prepare("INSERT INTO objects VALUES ('foreign','task','p2',1,?)")
    .run(
      JSON.stringify({
        requirementId: r.id,
        state: "active",
        definitionOfDone: "Done",
      }),
    );
  const before = f.events();
  const scopes = f.db.prepare("SELECT * FROM requirement_scopes").all();
  expect(
    (
      await action(
        r,
        {
          action: "cancel",
          reason: "Stop",
          taskDisposition: [{ taskId: "foreign", disposition: "cancel" }],
        },
        "product",
        "cross-cancel",
      )
    ).status,
  ).toBe(422);
  expect(
    (await f.api("GET", `/api/requirements/${r.id}`, {}, "dev")).body,
  ).toEqual(r);
  expect(
    (
      f.db
        .prepare("SELECT version FROM objects WHERE id='foreign'")
        .get() as any
    ).version,
  ).toBe(1);
  expect(f.events()).toEqual(before);
  expect(f.db.prepare("SELECT * FROM requirement_scopes").all()).toEqual(
    scopes,
  );
  expect(
    f.db
      .prepare("SELECT 1 FROM idempotency WHERE request_id='cross-cancel'")
      .get(),
  ).toBeUndefined();
  expect(
    (
      await action(r, {
        action: "revise",
        kind: "behavior",
        reason: "Change",
        impactConfirmed: true,
        affectedTaskIds: [],
        affectedCheckIds: [],
      })
    ).status,
  ).toBe(422);
  const refined = await action(r, { action: "refine" });
  expect(
    (
      await action(refined.body, {
        action: "makeReady",
        source: {
          description: "Source",
          status: "unable",
          reason: "Restricted",
        },
      })
    ).status,
  ).toBe(422);
});
it("task_04 review F3 appends participation occurrences across independent and changed requirement links", async () => {
  const { recordExecutionParticipation } = await import(
    "../apps/api/src/requirements/revisions.js"
  );
  const a = await create();
  const b = await create();
  f.db
    .prepare("INSERT INTO objects VALUES ('work','task','p1',1,?)")
    .run(JSON.stringify({ state: "active", requirementId: null }));
  for (const requirementId of [null, a.id, b.id, b.id]) {
    f.db
      .prepare("UPDATE objects SET current=?,version=version+1 WHERE id='work'")
      .run(JSON.stringify({ requirementId, state: "active" }));
    f.db
      .transaction(() =>
        recordExecutionParticipation(f.db, "work", "product", "backend"),
      )
      .immediate();
  }
  const rows = f.db
    .prepare("SELECT * FROM execution_participations ORDER BY rowid")
    .all() as any[];
  expect(rows).toHaveLength(4);
  expect(rows.map((r) => r.requirement_id)).toEqual([null, a.id, b.id, b.id]);
  expect(new Set(rows.map((r) => r.id)).size).toBe(4);
  const refined = await action(b, { action: "refine" });
  expect(
    (
      await action(refined.body, {
        action: "makeReady",
        source: {
          description: "Source",
          status: "unable",
          reason: "Restricted",
        },
      })
    ).status,
  ).toBe(422);
});
it("task_04 approved task definitionOfDone is canonical readiness field", async () => {
  let r = await create();
  f.db
    .prepare("INSERT INTO objects VALUES ('work','task','p1',1,?)")
    .run(
      JSON.stringify({
        requirementId: r.id,
        state: "ready",
        definitionOfDone: "Validated behavior",
      }),
    );
  r = (await action(r, { action: "refine" })).body;
  expect(
    (
      await action(r, {
        action: "makeReady",
        source: {
          description: "Source",
          status: "unable",
          reason: "Restricted",
        },
      })
    ).status,
  ).toBe(200);
});
it("task_04 lead creates scoped draft without acceptor until product designates one", async () => {
  f.db.prepare("UPDATE roles SET lead=1 WHERE member_id='dev'").run();
  const { acceptorId, ...draft } = input;
  const created = await f.api(
    "POST",
    "/api/requirements",
    { ...draft, role: "backend" },
    "dev",
  );
  expect(created.status).toBe(200);
  expect(created.body.acceptorId).toBe("");
  const refined = await action(created.body, { action: "refine" }, "dev");
  const confirmedSource = {
    description: "Source",
    status: "unable",
    reason: "Restricted",
  };
  expect(
    (
      await action(
        refined.body,
        { action: "makeReady", source: confirmedSource },
        "product",
      )
    ).status,
  ).toBe(422);
  const designated = await action(
    refined.body,
    { action: "refine", acceptorId: "product" },
    "product",
  );
  expect(
    (
      await action(
        designated.body,
        { action: "makeReady", source: confirmedSource },
        "product",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        "/api/requirements",
        { ...input, role: "backend" },
        "dev",
      )
    ).status,
  ).toBe(403);
});

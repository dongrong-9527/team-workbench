import { saveUpdate } from "../apps/api/src/updates/service.js";
import { createTask } from "../apps/api/src/tasks/service.js";
import { acceptanceRecords } from "../apps/api/src/acceptance/service.js";
import { insertTestRecord, records } from "../apps/api/src/testing/evidence.js";
import {
  saveRevision,
  saveScope,
  recordExecutionParticipation,
} from "../apps/api/src/requirements/revisions.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import type {
  WorkUpdate,
  UpdateInput,
  Event,
  Ref,
  TestInput,
  TestRecord,
  AcceptanceInput,
  AcceptanceRecord,
} from "../packages/contracts/src/index.js";
import { openDb } from "../apps/api/src/db/open.js";
import { migrate } from "../apps/api/src/db/migrate.js";
import {
  mutate,
  changeObject,
  DomainError,
  type MutationContext,
} from "../apps/api/src/db/mutate.js";
import { issueSession } from "../apps/api/src/auth/session.js";
import { mutationContext } from "../apps/api/src/auth/guards.js";
import { buildApp } from "../apps/api/src/app.js";
export type Actor =
  | "anonymous"
  | "admin"
  | "product"
  | "dev"
  | "dev2"
  | "tester";
export type Method = "GET" | "POST" | "PUT" | "PATCH";
export interface TestTables {
  updates: WorkUpdate;
  acceptance_records: AcceptanceRecord;
  test_records: TestRecord;
  test_objects: {
    id: string;
    kind: string;
    project_id: string;
    version: number;
    current: string;
  };
}
// Later modules add their real input fixtures here rather than placeholder business models.
export interface FixtureMap {
  correctionByOther: UpdateInput & { expectedVersion: number };
  ownCorrection: UpdateInput & { expectedVersion: number };
  acceptanceWithCriticalOpenBug: AcceptanceInput & { expectedVersion: number };
  failedTest: TestInput;
  core: { projectId: string; objectId: string };
}
export interface TestKit {
  db: Database;
  path: string;
  context: MutationContext;
  baseUrl: string;
  api<T = Record<string, unknown>>(
    method: Method,
    path: string,
    body?: unknown,
    actor?: Actor,
    key?: string,
  ): Promise<{ status: number; body: T }>;
  read<K extends keyof TestTables>(table: K): TestTables[K][];
  events(kind?: Ref["kind"] | "member" | "project", id?: string): Event[];
  seed<K extends keyof FixtureMap>(name: K): FixtureMap[K];
  fresh(name: string): string;
  failNextEvent(): Promise<void>;
  close(): Promise<void>;
}
export async function createTestKit(): Promise<TestKit> {
  const dir = mkdtempSync(join(tmpdir(), "workbench-"));
  const path = join(dir, "test.db");
  const db = openDb(path);
  migrate(db);
  for (const actor of ["admin", "product", "dev", "dev2", "tester"])
    db.prepare(
      "INSERT INTO members (id,name,is_admin,login) VALUES (?,?,?,?)",
    ).run(actor, actor, actor === "admin" ? 1 : 0, actor);
  db.exec(
    "INSERT INTO projects (id,name) VALUES ('p1','Project One'),('p2','Project Two')",
  );
  for (const [member, role] of [
    ["admin", "product"],
    ["product", "product"],
    ["dev", "backend"],
    ["dev2", "frontend"],
    ["tester", "test"],
  ])
    db.prepare(
      "INSERT INTO roles (project_id,member_id,role) VALUES (?,?,?)",
    ).run("p1", member, role);
  const authorize = (connection: Database) => {
    if (
      !connection
        .prepare("SELECT 1 FROM roles WHERE member_id=? AND project_id=?")
        .get(activeActor, "p1")
    )
      throw new DomainError(403, "Permission denied");
  };
  let activeActor = "admin";
  const context: MutationContext = {
    actorId: "admin",
    requestId: "direct",
    route: "/direct",
    bodyHash: "direct",
    authorize,
  };
  const sessions = Object.fromEntries(
    ["admin", "product", "dev", "dev2", "tester"].map((actor) => [
      actor,
      issueSession(db, actor),
    ]),
  );
  const app = buildApp(db, { origin: "https://workbench.test" });
  app.addHook("onResponse", async () => {
    db.exec("DROP TRIGGER IF EXISTS temp.fail_event");
  });
  // Test-only mutation route uses the real session/CSRF guards and database authorization.
  // The route is never registered in the production application.
  app.post("/test/mutation", (request) => {
    const auth = mutationContext(db, request);
    const actor = auth.actorId;
    activeActor = actor;
    const body = request.body as { title?: string; expectedVersion?: number };
    const ctx: MutationContext = {
      actorId: actor,
      requestId: String(request.headers["idempotency-key"]),
      route: "/test/mutation",
      bodyHash: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
      expectedVersion: body.expectedVersion,
      authorize: (connection) => {
        auth.authorize(connection);
        authorize(connection);
      },
    };
    return mutate(db, ctx, () => {
      const current = { title: body.title ?? "Initial" };
      if (db.prepare("SELECT 1 FROM objects WHERE id=?").get("t1")) {
        changeObject(db, ctx, "t1", current, "updated");
      } else {
        db.prepare("INSERT INTO objects VALUES ('t1','task','p1',1,?)").run(
          JSON.stringify(current),
        );
        db.prepare(
          "INSERT INTO events (time,action,actor_id,target_kind,target_id,after_snapshot) VALUES (?,'created',?,'task','t1',?)",
        ).run(new Date().toISOString(), actor, JSON.stringify(current));
      }
      return {
        id: "t1",
        version: (
          db.prepare("SELECT version FROM objects WHERE id=?").get("t1") as {
            version: number;
          }
        ).version,
      };
    });
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  let correctionFixture: FixtureMap["ownCorrection"] | undefined;
  return {
    db,
    path,
    context,
    baseUrl: app.listeningOrigin,
    async api<T>(
      method: Method,
      url: string,
      body: unknown = {},
      actor: Actor = "admin",
      key: string = randomUUID(),
    ) {
      // Versioned fixture actions default to fixed version 1, never a latest-record read.
      // Explicit versions and unversioned auth/create payloads remain unchanged.
      const versioned =
        url === "/test/mutation" ||
        /^\/api\/members\/[^/]+\/(deactivate|reset)$/.test(url);
      const payload =
        versioned && typeof body === "object" && body !== null
          ? { expectedVersion: 1, ...body }
          : body;
      const session = sessions[actor];
      const response = await app.inject({
        method,
        url,
        payload: JSON.stringify(payload),
        headers: {
          "content-type": "application/json",
          origin: "https://workbench.test",
          "idempotency-key": key,
          ...(session
            ? {
                cookie: `session=${session.token}`,
                "x-csrf-token": session.csrfToken,
              }
            : {}),
        },
      });
      return { status: response.statusCode, body: response.json<T>() };
    },
    read(table) {
      if (table === "updates")
        return (
          db
            .prepare("SELECT record FROM updates ORDER BY recorded_seq")
            .all() as { record: string }[]
        ).map((x) => JSON.parse(x.record));
      if (table === "acceptance_records")
        return acceptanceRecords(db) as TestTables[typeof table][];
      if (table === "test_records")
        return records(db) as TestTables[typeof table][];
      if (table !== "test_objects") throw new Error("Unknown table");
      return db
        .prepare("SELECT * FROM objects ORDER BY id")
        .all() as TestTables[typeof table][];
    },
    events(kind, id) {
      const rows = db
        .prepare(
          "SELECT * FROM events WHERE (? IS NULL OR target_kind=?) AND (? IS NULL OR target_id=?) ORDER BY seq",
        )
        .all(kind ?? null, kind ?? null, id ?? null, id ?? null) as {
        seq: number;
        time: string;
        action: string;
        actor_id: string;
        target_kind: Event["target"]["kind"];
        target_id: string;
        before_snapshot: string | null;
        after_snapshot: string | null;
      }[];
      return rows.map((row) => ({
        seq: row.seq,
        time: row.time,
        action: row.action,
        actorId: row.actor_id,
        target: { kind: row.target_kind, id: row.target_id },
        before:
          row.before_snapshot === null ? null : JSON.parse(row.before_snapshot),
        after:
          row.after_snapshot === null ? null : JSON.parse(row.after_snapshot),
      }));
    },
    seed(name) {
      if (name === "ownCorrection" || name === "correctionByOther") {
        if (!correctionFixture) {
          const t = createTask(
            db,
            { ...context, actorId: "product", requestId: "fixture-task" },
            {
              projectId: "p1",
              title: "Fixture task",
              kind: "backend",
              definitionOfDone: "Checked",
              priority: "medium",
              ownerId: "dev",
            },
          );
          const input: UpdateInput = {
            target: { kind: "task", id: t.id },
            workDate: "2026-10-11",
            done: "Original validation",
            contributionType: "coordination",
          };
          const u = saveUpdate(
            db,
            { ...context, actorId: "dev", requestId: "fixture-update" },
            input,
            () => new Date("2026-10-12T02:00:00.000Z"),
          );
          correctionFixture = {
            ...input,
            done: "更正后的校验说明",
            reason: "补充细节",
            correctsId: u.id,
            expectedVersion: 1,
          };
        }
        return { ...correctionFixture } as FixtureMap[typeof name];
      }
      if (name === "failedTest" || name === "acceptanceWithCriticalOpenBug") {
        const input: TestInput = {
          target: { kind: "bug", id: "b1" },
          revision: 1,
          targetVersion: "build-1",
          environment: "local",
          checks: [
            { checkId: "c1", result: "fail", note: "Reproduction still fails" },
          ],
        };
        db.transaction(() => {
          const r = {
            id: "r1",
            projectId: "p1",
            title: "Fixture scope",
            description: "Validation",
            source: { description: "Source" },
            criteria: [{ id: "c1", text: "Validation passes", required: true }],
            priority: "medium",
            acceptorId: "product",
            state: name === "failedTest" ? "active" : "pending_acceptance",
            acceptanceTargetVersion: "build-1",
            revision: 1,
            version: 1,
            blocked: false,
            scopeConfirmed: true,
            evidenceReady: false,
          };
          db.prepare(
            "INSERT INTO objects VALUES ('r1','requirement','p1',1,?)",
          ).run(JSON.stringify(r));
          saveRevision(db, context, r as any, "Fixture scope");
          saveScope(db, context, r as any);
          const b = {
            id: "b1",
            projectId: "p1",
            title: "Fixture defect",
            requirementId: "r1",
            reporterId: "tester",
            ownerId: "dev",
            role: "backend",
            expected: "Validation passes",
            actual: "Validation fails",
            reproduction: "Submit input",
            environment: "local",
            severity: name === "failedTest" ? "normal" : "critical",
            priority: "medium",
            state: name === "failedTest" ? "pending_verify" : "ready",
            blocked: false,
            version: 4,
            reopenCount: 0,
            checks: [{ id: "c1", text: "Validation passes", required: true }],
            submission: {
              fix: "Validation repaired",
              impact: "Input path",
              selfCheck: "Local cases pass",
              environment: "local",
              targetVersion: "build-1",
            },
          };
          db.prepare("INSERT INTO objects VALUES ('b1','bug','p1',4,?)").run(
            JSON.stringify(b),
          );
          recordExecutionParticipation(db, "b1", "dev", "backend");
          if (name === "acceptanceWithCriticalOpenBug")
            insertTestRecord(
              db,
              { ...context, actorId: "tester" },
              {
                ...input,
                target: { kind: "requirement", id: "r1" },
                checks: [{ checkId: "c1", result: "pass" }],
              },
            );
          insertTestRecord(
            db,
            { ...context, actorId: "tester" },
            {
              ...input,
              checks: [
                {
                  checkId: "c1",
                  result: "pass",
                  note: "Earlier execution passed",
                },
              ],
            },
          );
        }).immediate();
        if (name === "acceptanceWithCriticalOpenBug")
          return {
            expectedVersion: 1,
            revision: 1,
            targetVersion: "build-1",
            decision: "pass",
            criteria: [{ id: "c1", passed: true }],
          } as FixtureMap[typeof name];
        return input as FixtureMap[typeof name];
      }
      if (name !== "core") throw new Error("Unknown fixture");
      return { projectId: "p1", objectId: "t1" } as FixtureMap[typeof name];
    },
    fresh(name) {
      return `${name}-${randomUUID()}`;
    },
    async failNextEvent() {
      db.exec(
        "CREATE TEMP TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'injected event failure'); END;",
      );
    },
    async close() {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

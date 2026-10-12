import type { Database } from "better-sqlite3";
import type {
  TestInput,
  TestRecord,
} from "../../../../packages/contracts/src/index.js";
import { mutate, DomainError, type MutationContext } from "../db/mutate.js";
import { createPolicy } from "../access/policy.js";
import { authorizeBug, recordBugTest, getBug } from "../bugs/service.js";
import {
  auth as taskAuth,
  getTask,
  recordCanonicalTaskTest,
} from "../tasks/service.js";
import {
  testTarget,
  insertTestRecord,
  reconcileTestRequirement,
} from "./evidence.js";
import { writeDomainObject } from "../requirements/service.js";
export function recordTest(
  db: Database,
  ctx: MutationContext,
  input: TestInput,
): TestRecord {
  const guarded = {
    ...ctx,
    authorize: (c: Database) => {
      if (input.target.kind === "bug")
        authorizeBug(c, ctx, getBug(c, input.target.id), "recordTest", {});
      else if (input.target.kind === "task")
        taskAuth(
          c,
          ctx,
          () => getTask(c, input.target.id),
          "recordTest",
          {},
        ).authorize(c);
      else {
        ctx.authorize(c);
        const t = testTarget(c, input.target);
        if (!createPolicy(c).canWrite(ctx.actorId, t.projectId, "test"))
          throw new DomainError(403, "Current tester required");
        const p = c
          .prepare("SELECT archived FROM projects WHERE id=?")
          .get(t.projectId) as any;
        if (p.archived) throw new DomainError(409, "ARCHIVED");
        if (t.state === "cancelled" || !t.scopeConfirmed || t.blocked)
          throw new DomainError(422, "Requirement scope not executable");
      }
    },
  };
  return mutate(db, guarded, () => {
    const t = testTarget(db, input.target);
    if (ctx.expectedVersion === undefined)
      throw new DomainError(400, "expectedVersion required");
    if (ctx.expectedVersion !== t.version)
      throw new DomainError(409, "Version conflict", t);
    if (input.target.kind === "bug") return recordBugTest(db, ctx, t, input);
    if (input.target.kind === "task")
      return recordCanonicalTaskTest(db, ctx, t, input);
    const record = insertTestRecord(db, ctx, input);
    reconcileTestRequirement(db, ctx, t.id);
    // Advance optimistic version even for partial requirement evidence, retaining functional revision.
    const current = testTarget(db, input.target);
    writeDomainObject(
      db,
      ctx,
      t.id,
      { ...current, lastTestId: record.id },
      "testProgress",
    );
    return record;
  });
}

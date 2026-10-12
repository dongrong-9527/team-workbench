import { reconcileRequirement } from "../requirements/reconcile.js";
import {
  insertTestRecord,
  coverage,
} from "../testing/evidence.js";
import type {
  TestInput,
  TestRecord,
} from "../../../../packages/contracts/src/index.js";
import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type {
  Task,
  TaskCommand,
  Role,
} from "../../../../packages/contracts/src/index.js";
import { DomainError, mutate, type MutationContext } from "../db/mutate.js";
import { createPolicy } from "../access/policy.js";
import { getRequirement, writeDomainObject } from "../requirements/service.js";
import { recordExecutionParticipation } from "../requirements/revisions.js";
import {
  dependencies,
  setDependencies,
  dependencySnapshot,
  requireParallel,
} from "./dependencies.js";
export function getTask(db: Database, id: string): Task {
  const o = db
    .prepare("SELECT * FROM objects WHERE id=? AND kind='task'")
    .get(id) as any;
  if (!o) throw new DomainError(404, "Task not found");
  return {
    ...JSON.parse(o.current),
    id: o.id,
    projectId: o.project_id,
    version: o.version,
    dependencyIds: dependencies(db, id),
  };
}
const scope = (t: Task): Role => (t.kind === "other" ? t.role : t.kind) as Role;
const isDevelopment = (t: Task): boolean =>
  ["frontend", "backend"].includes(scope(t));
function roles(db: Database, p: string, a: string) {
  return db
    .prepare("SELECT role,lead FROM roles WHERE project_id=? AND member_id=?")
    .all(p, a) as any[];
}
function validOwner(db: Database, t: Task, id: unknown) {
  if (
    id != null &&
    !createPolicy(db).canWrite(String(id), t.projectId, scope(t))
  )
    throw new DomainError(422, "Active functional assignee required");
}
export function validReviewer(db: Database, t: Task, id: unknown): boolean {
  if (typeof id !== "string") return false;
  if (isDevelopment(t))
    return createPolicy(db).canWrite(id, t.projectId, "test");
  return (
    createPolicy(db).canWrite(id, t.projectId, "product") ||
    (createPolicy(db).canWrite(id, t.projectId, scope(t)) &&
      roles(db, t.projectId, id).some(
        (r) => r.role === scope(t) && r.lead === 1,
      ))
  );
}
function parent(db: Database, t: Task, executable = false) {
  if (!t.requirementId) return;
  const r = getRequirement(db, t.requirementId);
  if (r.projectId !== t.projectId)
    throw new DomainError(422, "Cross-project requirement");
  if (r.state === "cancelled" || (r as any).archived)
    throw new DomainError(409, "Requirement unavailable");
  if (
    executable &&
    (!["ready", "active"].includes(r.state) || !r.scopeConfirmed || r.blocked)
  )
    throw new DomainError(422, "Requirement not executable");
  return r;
}
export function auth(
  db: Database,
  ctx: MutationContext,
  t: () => Task,
  action: string,
  cmd: any,
) {
  return {
    ...ctx,
    authorize: (c: Database) => {
      ctx.authorize(c);
      const x = t();
      createPolicy(c).authorize(ctx.actorId, "read", {
        kind: "project",
        id: x.projectId,
      });
      if (
        (
          c
            .prepare("SELECT archived FROM projects WHERE id=?")
            .get(x.projectId) as any
        ).archived
      )
        throw new DomainError(409, "ARCHIVED");
      const requirement = parent(c, x);
      if (
        ["claim", "start", "submit", "checkPass", "checkFail"].includes(action) &&
        requirement &&
        (!requirement.scopeConfirmed || requirement.blocked)
      )
        throw new DomainError(422, "Requirement not executable");
      if (action === "recordTest") {
        const r = parent(c, x);
        if (
          r &&
          (!["ready", "active", "pending_acceptance", "accepted"].includes(
            r.state,
          ) ||
            !r.scopeConfirmed ||
            r.blocked)
        )
          throw new DomainError(422, "Requirement not executable");
      }
      const rs = roles(c, x.projectId, ctx.actorId),
        lead = rs.some((r) => r.role === scope(x) && r.lead === 1),
        product = rs.some((r) => r.role === "product");
      let allowed = false;
      if (
        "required" in cmd ||
        action === "setRequired" ||
        action === "defineChecks"
      ) {
        if (!product)
          throw new DomainError(403, "Product required for required status");
      }
      if (action === "claim") allowed = rs.some((r) => r.role === scope(x));
      else if (["start", "submit", "requestTransfer"].includes(action))
        allowed =
          x.ownerId === ctx.actorId && rs.some((r) => r.role === scope(x));
      else if (["checkPass", "checkFail", "recordTest"].includes(action))
        allowed =
          x.reviewerId === ctx.actorId && validReviewer(c, x, ctx.actorId);
      else if (action === "approveParallel") allowed = lead;
      else if (["block", "unblock"].includes(action))
        allowed =
          product ||
          lead ||
          (x.ownerId === ctx.actorId && rs.some((r) => r.role === scope(x)));
      else allowed = product || lead;
      if (!allowed) throw new DomainError(403, "Permission denied");
      if (["create", "assign", "transfer"].includes(action))
        validOwner(c, x, cmd.ownerId);
      if (["checkPass", "checkFail", "recordTest"].includes(action))
        validOwner(c, x, x.ownerId);
      if (action === "submit" && !validReviewer(c, x, x.reviewerId))
        throw new DomainError(422, "Valid reviewer required");
      if (
        ((action === "create" && cmd.reviewerId != null) ||
          action === "designateReviewer") &&
        !validReviewer(c, x, cmd.reviewerId)
      )
        throw new DomainError(422, "Valid reviewer required");
    },
  };
}
export function createTask(
  db: Database,
  ctx: MutationContext,
  input: any,
): Task {
  const draft = {
    ...input,
    required: input.required ?? true,
    state: "pending",
    blocked: false,
    version: 1,
    id: randomUUID(),
    dependencyIds: [],
  } as Task;
  return mutate(
    db,
    auth(db, ctx, () => draft, "create", input),
    () => {
      if (
        input.kind === "other" &&
        !["frontend", "backend", "test"].includes(input.role)
      )
        throw new DomainError(422, "Other task requires functional role");
      if (
        input.kind !== "other" &&
        input.role !== undefined &&
        input.role !== input.kind
      )
        throw new DomainError(422, "Conflicting task scope");
      validOwner(db, draft, draft.ownerId);
      if (draft.reviewerId && !validReviewer(db, draft, draft.reviewerId))
        throw new DomainError(422, "Valid reviewer required");
      if (!draft.required && !String(input.exclusionReason ?? "").trim())
        throw new DomainError(422, "Exclusion reason required");
      parent(db, draft);
      db.prepare("INSERT INTO objects VALUES (?,'task',?,1,?)").run(
        draft.id,
        draft.projectId,
        JSON.stringify(draft),
      );
      const actor = db
        .prepare("SELECT name FROM members WHERE id=?")
        .get(ctx.actorId) as any;
      const project = db
        .prepare("SELECT name FROM projects WHERE id=?")
        .get(draft.projectId) as any;
      const owner = db
        .prepare("SELECT name FROM members WHERE id=?")
        .get(draft.ownerId ?? "") as any;
      db.prepare(
        "INSERT INTO events(time,action,actor_id,target_kind,target_id,after_snapshot) VALUES (?,'created',?,'task',?,?)",
      ).run(
        new Date().toISOString(),
        ctx.actorId,
        draft.id,
        JSON.stringify({
          ...draft,
          actorName: actor.name,
          projectName: project.name,
          ownerName: owner?.name ?? null,
        }),
      );
      reconcileRequirement(db, ctx, draft.requirementId);
      return draft;
    },
  );
}
function state(t: Task, ss: string[]) {
  if (!ss.includes(t.state))
    throw new DomainError(409, "Invalid task state", t);
}
function evidenceSnapshot(
  db: Database,
  ctx: MutationContext,
  t: Task,
  evidence: Record<string, unknown>,
): Record<string, unknown> {
  const actor = db
    .prepare("SELECT name FROM members WHERE id=?")
    .get(ctx.actorId) as { name: string };
  const project = db
    .prepare("SELECT name FROM projects WHERE id=?")
    .get(t.projectId) as { name: string };
  const owner = db
    .prepare("SELECT name FROM members WHERE id=?")
    .get(t.ownerId ?? "") as { name: string } | undefined;
  return {
    ...evidence,
    taskTitle: t.title,
    actorName: actor.name,
    projectName: project.name,
    ownerId: t.ownerId ?? null,
    ownerName: owner?.name ?? null,
  };
}
export function recordTaskWork(
  db: Database,
  ctx: MutationContext,
  t: Task,
  action: string,
  evidence: any,
): void {
  if (!db.inTransaction)
    throw new Error("Task work requires a mutation transaction");
  const activity = isDevelopment(t)
    ? "development"
    : scope(t) === "test"
      ? "testing"
      : "other";
  db.prepare("INSERT INTO task_work VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    randomUUID(),
    t.id,
    t.projectId,
    t.requirementId ?? null,
    ctx.actorId,
    scope(t),
    activity,
    action,
    JSON.stringify(evidenceSnapshot(db, ctx, t, evidence)),
    new Date().toISOString(),
  );
  if (activity === "development")
    recordExecutionParticipation(
      db,
      t.id,
      ctx.actorId,
      scope(t) as "frontend" | "backend",
    );
}
// Task6 may call inside its authorized mutate after validating tester/scope/version/evidence.
export function recordTaskCheck(
  db: Database,
  ctx: MutationContext,
  t: Task,
  result: "pass" | "fail",
  evidence: any,
): void {
  if (!db.inTransaction)
    throw new Error("Task checks require a mutation transaction");
  const r = t.requirementId ? getRequirement(db, t.requirementId) : undefined;
  const self = !!db
    .prepare(
      "SELECT 1 FROM task_work WHERE task_id=? AND actor_id=? AND activity='development'",
    )
    .get(t.id, ctx.actorId);
  db.prepare("INSERT INTO task_checks VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
    randomUUID(),
    t.id,
    t.projectId,
    t.requirementId ?? null,
    r?.revision ?? null,
    t.version,
    ctx.actorId,
    result,
    evidence.environment,
    JSON.stringify(evidenceSnapshot(db, ctx, t, evidence)),
    self ? 1 : 0,
    new Date().toISOString(),
  );
}
// Compatibility adapter: evaluates persisted current state within the existing transaction.
export function regressTaskRequirement(
  db: Database,
  ctx: MutationContext,
  t: Task,
): void {
  if (!db.inTransaction)
    throw new Error("Regression requires a mutation transaction");
  parent(db, t);
  reconcileRequirement(db, ctx, t.requirementId);
}
export function actTask(
  db: Database,
  ctx: MutationContext,
  id: string,
  cmd: TaskCommand,
): Task {
  return mutate(
    db,
    auth(
      db,
      ctx,
      () => getTask(db, id),
      cmd.test && ["checkPass", "checkFail"].includes(cmd.action)
        ? "recordTest"
        : cmd.action,
      cmd,
    ),
    () => {
      const t = getTask(db, id);
      // Execution state applies only to a new command, after successful replay lookup.
      if (
        ["claim", "start", "submit", "checkPass", "checkFail"].includes(cmd.action) &&
        !cmd.test
      )
        parent(db, t, true);
      if (ctx.expectedVersion === undefined)
        throw new DomainError(400, "expectedVersion required");
      if (t.version !== ctx.expectedVersion)
        throw new DomainError(409, "Version conflict", t);
      const n = { ...t };
      switch (cmd.action) {
        case "claim":
          state(t, ["pending"]);
          parent(db, t, true);
          if (t.ownerId) throw new DomainError(409, "Task already assigned", t);
          n.ownerId = ctx.actorId;
          break;
        case "assign":
        case "transfer":
          validOwner(db, t, cmd.ownerId);
          if (cmd.ownerId == null && !cmd.resetToPending)
            throw new DomainError(422, "Unassign requires resetToPending");
          n.ownerId = (cmd.ownerId ?? null) as any;
          if (cmd.resetToPending) {
            n.state = "pending";
            regressTaskRequirement(db, ctx, n);
          }
          n.transfer = {
            from: t.ownerId ?? null,
            to: n.ownerId,
            reason: cmd.reason,
            handoff: cmd.handoff,
            actorId: ctx.actorId,
            time: new Date().toISOString(),
          };
          break;
        case "requestTransfer":
          n.transferRequest = {
            actorId: ctx.actorId,
            reason: cmd.reason,
            handoff: cmd.handoff,
            time: new Date().toISOString(),
          };
          break;
        case "start":
          state(t, ["pending"]);
          parent(db, t, true);
          if (!t.definitionOfDone.trim())
            throw new DomainError(422, "Completion standard required");
          requireParallel(db, t);
          n.state = "active";
          recordTaskWork(db, ctx, t, "start", {
            definitionOfDone: t.definitionOfDone,
          });
          {
            const r = parent(db, t, true);
            if (r?.state === "ready")
              writeDomainObject(
                db,
                ctx,
                r.id,
                { ...r, state: "active" },
                "taskStarted",
              );
          }
          break;
        case "submit":
          state(t, ["active"]);
          parent(db, t, true);
          if (t.blocked || !t.definitionOfDone.trim())
            throw new DomainError(422, "Blocked or incomplete task");
          if (!validReviewer(db, t, t.reviewerId))
            throw new DomainError(422, "Valid reviewer required");
          validOwner(db, t, t.ownerId);
          requireParallel(db, t);
          n.state = "pending_check";
          n.submission = cmd.evidence;
          recordTaskWork(db, ctx, t, "submit", cmd.evidence);
          break;
        case "checkPass":
        case "checkFail":
          state(t, cmd.test ? ["pending_check", "done"] : ["pending_check"]);
          if (t.blocked) throw new DomainError(422, "Task blocked");
          validOwner(db, t, t.ownerId);
          if (!validReviewer(db, t, t.reviewerId))
            throw new DomainError(422, "Valid reviewer required");
          if (cmd.test) {
            recordCanonicalTaskTest(
              db,
              ctx,
              t,
              cmd.test as TestInput,
              cmd.action === "checkPass" ? "pass" : "fail",
            );
            return getTask(db, id);
          }
          if (t.checks || (t.submission as any)?.targetVersion)
            throw new DomainError(422, "Canonical test evidence required");
          recordTaskCheck(
            db,
            ctx,
            t,
            cmd.action === "checkPass" ? "pass" : "fail",
            cmd.evidence,
          );
          n.state = cmd.action === "checkPass" ? "done" : "active";
          if (cmd.action === "checkFail") regressTaskRequirement(db, ctx, t);
          break;
        case "reopen":
          state(t, ["done", "cancelled"]);
          {
            const r = parent(db, t);
            if (
              r &&
              (!["ready", "active", "pending_acceptance", "accepted"].includes(
                r.state,
              ) ||
                !r.scopeConfirmed ||
                r.blocked)
            )
              throw new DomainError(422, "Requirement not executable");
          }
          n.state = cmd.resetToPending ? "pending" : "active";
          regressTaskRequirement(db, ctx, t);
          break;
        case "cancel":
          state(t, ["pending", "active", "pending_check"]);
          n.state = "cancelled";
          break;
        case "block":
          n.blocked = true;
          n.blocking = {
            reason: cmd.reason,
            assistance: cmd.assistance,
            since: new Date().toISOString(),
          };
          break;
        case "unblock":
          n.blocked = false;
          n.unblockReason = cmd.reason;
          break;
        case "setDependencies":
          setDependencies(db, t, cmd.dependencyIds as string[]);
          n.dependencyIds = dependencies(db, id);
          break;
        case "approveParallel":
          db.prepare(
            "INSERT INTO task_parallel_approvals VALUES (?,?,?,?,?,?)",
          ).run(
            randomUUID(),
            id,
            ctx.actorId,
            cmd.reason,
            dependencySnapshot(db, t),
            new Date().toISOString(),
          );
          n.parallelApproval = {
            actorId: ctx.actorId,
            reason: cmd.reason,
            snapshot: dependencySnapshot(db, t),
          };
          break;
        case "designateReviewer":
          if (!validReviewer(db, t, cmd.reviewerId))
            throw new DomainError(422, "Valid reviewer required");
          n.reviewerId = String(cmd.reviewerId);
          break;
        case "setRequired":
          if (cmd.required === false && !String(cmd.reason ?? "").trim())
            throw new DomainError(422, "Exclusion reason required");
          n.required = cmd.required as boolean;
          n.exclusionReason = n.required ? undefined : String(cmd.reason);
          if (n.required && t.state !== "done")
            regressTaskRequirement(db, ctx, n);
          break;
        case "defineChecks":
          if (
            !roles(db, t.projectId, ctx.actorId).some(
              (r) => r.role === "product",
            )
          )
            throw new DomainError(403, "Product required");
          n.checks = cmd.checks;
          regressTaskRequirement(db, ctx, t);
          break;
        case "refine":
          state(t, ["pending"]);
          for (const k of ["title", "definitionOfDone", "priority"])
            if (k in cmd) (n as any)[k] = cmd[k];
          break;
      }
      writeDomainObject(
        db,
        ctx,
        id,
        { ...n, lastActionReason: cmd.reason ?? null },
        cmd.action,
        { unassigned: cmd.action === "claim" },
      );
      reconcileRequirement(db, ctx, n.requirementId);
      return getTask(db, id);
    },
  );
}

// Trusted transaction-only canonical adapter; callers enforce live designated reviewer, scope and version.
export function recordCanonicalTaskTest(
  db: Database,
  ctx: MutationContext,
  t: Task,
  input: TestInput,
  force?: "pass" | "fail",
): TestRecord {
  if (!db.inTransaction)
    throw new Error("Canonical task test requires mutation transaction");
  if (!["pending_check", "done"].includes(t.state))
    throw new DomainError(409, "Invalid task check state", t);
  if (t.blocked) throw new DomainError(422, "Task blocked");
  if (input.target.kind !== "task" || input.target.id !== t.id)
    throw new DomainError(422, "Wrong task test target");
  if (
    !(t.submission as any)?.targetVersion ||
    input.targetVersion !== (t.submission as any).targetVersion
  )
    throw new DomainError(422, "Submitted target version required");
  if (force === "fail" && !input.checks.some((x) => x.result === "fail"))
    throw new DomainError(422, "Failed check required");
  const record = insertTestRecord(db, ctx, input),
    gate = coverage(db, input.target, input.revision, input.targetVersion);
  if (force === "pass" && !gate.passed)
    throw new DomainError(422, "All required checks must pass");
  const fail =
      force === "fail" ||
      input.checks.some(
        (x) =>
          x.result === "fail" &&
          gate.checks.some((c) => c.id === x.checkId && c.required),
      ),
    untested = input.checks.some((x) => x.result === "untested");
  const next = fail
    ? "active"
    : gate.passed
      ? "done"
      : t.state === "done" && untested
        ? "pending_check"
        : t.state;
  recordTaskCheck(db, ctx, t, gate.passed ? "pass" : "fail", {
    environment: input.environment,
    result: gate.passed ? "pass" : fail ? "fail" : "untested",
    canonicalTestId: record.id,
  });
  writeDomainObject(
    db,
    ctx,
    t.id,
    { ...t, state: next, lastTestId: record.id },
    fail ? "checkFail" : gate.passed ? "checkPass" : "testProgress",
  );
  reconcileRequirement(db, ctx, t.requirementId);
  return record;
}

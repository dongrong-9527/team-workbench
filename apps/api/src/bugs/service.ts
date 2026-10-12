import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type {
  Bug,
  BugCommand,
  Ref,
  TestInput,
} from "../../../../packages/contracts/src/index.js";
import { mutate, DomainError, type MutationContext } from "../db/mutate.js";
import { createPolicy } from "../access/policy.js";
import { writeDomainObject, getRequirement } from "../requirements/service.js";
import { recordExecutionParticipation } from "../requirements/revisions.js";
import {
  testTarget,
  insertTestRecord,
  coverage,
  reconcileTestRequirement,
} from "../testing/evidence.js";
export function getBug(db: Database, id: string): Bug {
  return testTarget(db, { kind: "bug", id });
}
function rs(db: Database, p: string, id: string): any[] {
  return db
    .prepare("SELECT role,lead FROM roles WHERE project_id=? AND member_id=?")
    .all(p, id) as any[];
}
function validScope(b: Bug) {
  if (!["frontend", "backend", "test"].includes(b.role))
    throw new DomainError(422, "Explicit functional Bug role required");
}
function owner(db: Database, b: Bug, id: unknown) {
  validScope(b);
  if (id != null && !createPolicy(db).canWrite(String(id), b.projectId, b.role))
    throw new DomainError(422, "Active functional repair owner required");
}
// A retained source pair may outlive its task's current parent after authorized cancellation.
// Only immutable server events prove that exception; creation still requires current consistency.
function historicallyDetached(db: Database, b: Bug, t: any): boolean {
  if (!b.requirementId || t.requirementId != null) return false;
  const created = db
    .prepare(
      "SELECT seq,after_snapshot FROM events WHERE target_kind='bug' AND target_id=? AND action='created' ORDER BY seq LIMIT 1",
    )
    .get(b.id) as { seq: number; after_snapshot: string } | undefined;
  if (!created) return false;
  const source = JSON.parse(created.after_snapshot);
  if (
    source.projectId !== b.projectId ||
    source.requirementId !== b.requirementId ||
    source.taskId !== b.taskId
  )
    return false;
  const detachments = db
    .prepare(
      "SELECT before_snapshot,after_snapshot FROM events WHERE target_kind='task' AND target_id=? AND action='requirementCancel' AND seq>? ORDER BY seq",
    )
    .all(t.id, created.seq) as {
    before_snapshot: string;
    after_snapshot: string;
  }[];
  return detachments.some((event) => {
    const before = JSON.parse(event.before_snapshot),
      after = JSON.parse(event.after_snapshot);
    return (
      before.projectId === b.projectId &&
      after.projectId === b.projectId &&
      before.requirementId === b.requirementId &&
      after.requirementId === null
    );
  });
}
function links(db: Database, b: Bug, allowHistorical = false) {
  if (b.requirementId) {
    const r = getRequirement(db, b.requirementId);
    if (r.projectId !== b.projectId)
      throw new DomainError(422, "Cross-project requirement");
  }
  if (b.taskId) {
    const t = testTarget(db, { kind: "task", id: b.taskId });
    if (
      t.projectId !== b.projectId ||
      ((t.requirementId ?? null) !== (b.requirementId ?? null) &&
        !(allowHistorical && historicallyDetached(db, b, t)))
    )
      throw new DomainError(422, "Inconsistent task and requirement links");
  }
}
export function authorizeBug(
  db: Database,
  ctx: MutationContext,
  b: Bug,
  action: string,
  cmd: any,
): void {
  ctx.authorize(db);
  createPolicy(db).authorize(ctx.actorId, "read", {
    kind: "project",
    id: b.projectId,
  });
  const p = db
    .prepare("SELECT archived FROM projects WHERE id=?")
    .get(b.projectId) as any;
  if (p.archived) throw new DomainError(409, "ARCHIVED");
  validScope(b);
  links(db, b, action !== "create");
  const roles = rs(db, b.projectId, ctx.actorId),
    product = roles.some((x) => x.role === "product"),
    test = roles.some((x) => x.role === "test"),
    lead = roles.some((x) => x.role === b.role && x.lead === 1),
    own = b.ownerId === ctx.actorId && roles.some((x) => x.role === b.role);
  let allowed = false;
  if (action === "create") {
    allowed = roles.length > 0;
    if ("ownerId" in cmd && !product && !lead)
      throw new DomainError(403, "Management must assign repair ownership");
  } else if (["confirm", "reject", "reopen"].includes(action))
    allowed = product || test;
  else if (["verifyPass", "verifyFail", "recordTest"].includes(action))
    allowed = test;
  else if (action === "claim") allowed = roles.some((x) => x.role === b.role);
  else if (["start", "submit"].includes(action)) allowed = own;
  else if (action === "defineChecks") allowed = product;
  else if (action === "refine")
    allowed =
      product ||
      lead ||
      (b.state === "unconfirmed" &&
        b.reporterId === ctx.actorId &&
        roles.length > 0);
  else if (["block", "unblock"].includes(action))
    allowed = product || lead || own;
  else allowed = product || lead;
  if (!allowed) throw new DomainError(403, "Permission denied");
  if (["create", "assign", "transfer", "reopen"].includes(action))
    owner(db, b, cmd.ownerId);
  if (["submit", "verifyPass", "verifyFail", "recordTest"].includes(action)) {
    if (!b.ownerId) throw new DomainError(422, "Repair owner required");
    owner(db, b, b.ownerId);
  }
}
function state(b: Bug, states: string[]) {
  if (!states.includes(b.state))
    throw new DomainError(409, "Invalid Bug state", b);
}
export function createBug(db: Database, ctx: MutationContext, input: any): Bug {
  const draft = {
    ...input,
    id: randomUUID(),
    reporterId: ctx.actorId,
    state: "unconfirmed",
    blocked: false,
    reopenCount: 0,
    version: 1,
  } as Bug;
  return mutate(
    db,
    { ...ctx, authorize: (c) => authorizeBug(c, ctx, draft, "create", input) },
    () => {
      owner(db, draft, draft.ownerId);
      links(db, draft);
      db.prepare("INSERT INTO objects VALUES (?,'bug',?,1,?)").run(
        draft.id,
        draft.projectId,
        JSON.stringify(draft),
      );
      const actor = (
          db
            .prepare("SELECT name FROM members WHERE id=?")
            .get(ctx.actorId) as any
        ).name,
        project = (
          db
            .prepare("SELECT name FROM projects WHERE id=?")
            .get(draft.projectId) as any
        ).name;
      db.prepare(
        "INSERT INTO events(time,action,actor_id,target_kind,target_id,after_snapshot) VALUES (?,'created',?,'bug',?,?)",
      ).run(
        new Date().toISOString(),
        ctx.actorId,
        draft.id,
        JSON.stringify({ ...draft, actorName: actor, projectName: project }),
      );
      reconcileTestRequirement(db, ctx, draft.requirementId);
      return draft;
    },
  );
}
export function validateBugTest(db: Database, b: Bug, input: TestInput) {
  state(b, ["pending_verify", "closed"]);
  if (b.blocked) throw new DomainError(422, "Bug blocked");
  if (input.target.kind !== "bug" || input.target.id !== b.id)
    throw new DomainError(422, "Wrong test target");
  if (
    !b.submission?.targetVersion ||
    input.targetVersion !== b.submission.targetVersion
  )
    throw new DomainError(422, "Submitted target version required");
}
// Caller owns mutation, current authority, version and exact action validation.
export function recordBugTest(
  db: Database,
  ctx: MutationContext,
  b: Bug,
  input: TestInput,
  force?: "pass" | "fail",
) {
  if (!db.inTransaction)
    throw new Error("Bug test requires mutation transaction");
  validateBugTest(db, b, input);
  if (force === "fail" && !input.checks.some((x) => x.result === "fail"))
    throw new DomainError(422, "Failed check required");
  const record = insertTestRecord(db, ctx, input),
    gate = coverage(db, input.target, input.revision, input.targetVersion);
  if (force === "pass" && !gate.passed)
    throw new DomainError(422, "All required checks must pass");
  const failed =
      force === "fail" ||
      input.checks.some(
        (x) =>
          x.result === "fail" &&
          gate.checks.some((c) => c.id === x.checkId && c.required),
      ),
    incomplete = input.checks.some((x) => x.result === "untested");
  const next = failed
    ? "fixing"
    : gate.passed
      ? "closed"
      : b.state === "closed" && incomplete
        ? "pending_verify"
        : b.state;
  writeDomainObject(
    db,
    ctx,
    b.id,
    { ...b, state: next, lastTestId: record.id },
    failed ? "verifyFail" : gate.passed ? "verifyPass" : "testProgress",
  );
  reconcileTestRequirement(db, ctx, b.requirementId);
  return record;
}
export function actBug(
  db: Database,
  ctx: MutationContext,
  id: string,
  cmd: BugCommand,
): Bug {
  return mutate(
    db,
    {
      ...ctx,
      authorize: (c) => authorizeBug(c, ctx, getBug(c, id), cmd.action, cmd),
    },
    () => {
      const b = getBug(db, id);
      if (ctx.expectedVersion === undefined)
        throw new DomainError(400, "expectedVersion required");
      if (b.version !== ctx.expectedVersion)
        throw new DomainError(409, "Version conflict", b);
      if (["verifyPass", "verifyFail"].includes(cmd.action)) {
        recordBugTest(
          db,
          ctx,
          b,
          cmd.test as TestInput,
          cmd.action === "verifyPass" ? "pass" : "fail",
        );
        return getBug(db, id);
      }
      const n = { ...b };
      switch (cmd.action) {
        case "confirm":
          state(b, ["unconfirmed"]);
          if (
            !b.expected.trim() ||
            !b.actual.trim() ||
            !b.reproduction.trim() ||
            !b.environment.trim()
          )
            throw new DomainError(422, "Reproduction information required");
          n.state = "ready";
          n.confirmation = cmd.reason;
          break;
        case "reject":
          state(b, ["unconfirmed"]);
          if (
            !["duplicate", "not_defect", "unable"].includes(
              String(cmd.reason),
            ) ||
            !String(cmd.explanation ?? "").trim()
          )
            throw new DomainError(
              422,
              "Rejection reason and explanation required",
            );
          if (cmd.reason === "duplicate") {
            if (cmd.duplicateOfId === id)
              throw new DomainError(422, "Distinct duplicate target required");
            const d = getBug(db, String(cmd.duplicateOfId));
            if (d.projectId !== b.projectId)
              throw new DomainError(422, "Same-project duplicate required");
          } else if (cmd.duplicateOfId !== undefined)
            throw new DomainError(
              422,
              "Duplicate reference only for duplicate rejection",
            );
          n.state = "rejected";
          n.rejection = {
            reason: cmd.reason,
            explanation: cmd.explanation,
            duplicateOfId: cmd.duplicateOfId ?? null,
          };
          break;
        case "claim":
          state(b, ["ready"]);
          if (b.ownerId) throw new DomainError(409, "Bug already assigned", b);
          n.ownerId = ctx.actorId;
          break;
        case "start":
          state(b, ["ready"]);
          if (b.blocked) throw new DomainError(422, "Bug blocked");
          n.state = "fixing";
          recordExecutionParticipation(db, id, ctx.actorId, b.role);
          if (b.requirementId) {
            const r = getRequirement(db, b.requirementId);
            if (r.state === "ready")
              writeDomainObject(
                db,
                ctx,
                r.id,
                { ...r, state: "active" },
                "bugStarted",
              );
          }
          break;
        case "submit":
          state(b, ["fixing"]);
          if (b.blocked) throw new DomainError(422, "Bug blocked");
          {
            const e = cmd.evidence as any;
            for (const k of [
              "fix",
              "impact",
              "selfCheck",
              "targetVersion",
              "environment",
            ])
              if (!String(e?.[k] ?? "").trim())
                throw new DomainError(
                  422,
                  "Repair evidence and target version required",
                );
            n.submission = e;
            n.state = "pending_verify";
            recordExecutionParticipation(db, id, ctx.actorId, b.role);
          }
          break;
        case "reopen":
          state(b, ["closed", "rejected"]);
          if (!("ownerId" in cmd))
            throw new DomainError(
              422,
              "Explicit repair owner or unassigned required",
            );
          n.ownerId = (cmd.ownerId ?? null) as any;
          n.state = "ready";
          n.reopenCount = b.reopenCount + 1;
          n.reopenReason = cmd.reason;
          reconcileTestRequirement(db, ctx, b.requirementId);
          break;
        case "assign":
        case "transfer":
          if (["closed", "rejected"].includes(b.state))
            throw new DomainError(409, "Cannot transfer closed Bug", b);
          n.ownerId = (cmd.ownerId ?? null) as any;
          if (cmd.ownerId == null) {
            if (cmd.resetToReady !== true)
              throw new DomainError(422, "Unassign requires resetToReady");
            n.state = b.state === "unconfirmed" ? "unconfirmed" : "ready";
          }
          n.transfer = {
            from: b.ownerId ?? null,
            to: n.ownerId,
            reason: cmd.reason,
            handoff: cmd.handoff,
            actorId: ctx.actorId,
            time: new Date().toISOString(),
          };
          break;
        case "block":
          n.blocked = true;
          n.blocking = { reason: cmd.reason, assistance: cmd.assistance };
          reconcileTestRequirement(db, ctx, b.requirementId);
          break;
        case "unblock":
          n.blocked = false;
          n.unblockReason = cmd.reason;
          break;
        case "refine":
          state(b, ["unconfirmed"]);
          for (const k of [
            "title",
            "expected",
            "actual",
            "reproduction",
            "environment",
            "severity",
            "priority",
          ])
            if (k in cmd) (n as any)[k] = cmd[k];
          break;
        case "defineChecks":
          n.checks = cmd.checks as any;
          reconcileTestRequirement(db, ctx, b.requirementId);
          break;
      }
      writeDomainObject(db, ctx, id, n, cmd.action, {
        unassigned: cmd.action === "claim",
      });
      reconcileTestRequirement(db, ctx, n.requirementId);
      return getBug(db, id);
    },
  );
}

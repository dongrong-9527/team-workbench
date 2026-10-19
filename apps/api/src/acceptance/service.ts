import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type {
  AcceptanceInput,
  AcceptanceRecord,
  Requirement,
} from "../../../../packages/contracts/src/index.js";
import { DomainError, mutate, type MutationContext } from "../db/mutate.js";
import {
  getRequirement,
  linkedTasks,
  writeDomainObject,
} from "../requirements/service.js";
import { reconcileRequirement } from "../requirements/reconcile.js";
import { acceptanceGate, linkedBugs } from "./gate.js";
import { createPolicy } from "../access/policy.js";
import { coverage } from "../testing/evidence.js";
export class AcceptanceError extends DomainError {
  constructor(public reasons: string[]) {
    super(422, "Acceptance prerequisites not met");
  }
}
function guarded(
  db: Database,
  ctx: MutationContext,
  id: string,
  action: "submit" | "accept" | "waiver",
  input?: any,
) {
  return {
    ...ctx,
    authorize: (c: Database) => {
      ctx.authorize(c);
      const r = getRequirement(c, id),
        policy = createPolicy(c);
      policy.authorize(ctx.actorId, "read", { kind: "requirement", id });
      if (
        (
          c
            .prepare("SELECT archived FROM projects WHERE id=?")
            .get(r.projectId) as any
        ).archived
      )
        throw new DomainError(409, "ARCHIVED");
      if (r.state === "cancelled")
        throw new DomainError(409, "Requirement cancelled");
      const product = policy.canWrite(ctx.actorId, r.projectId, "product");
      const lead = c
        .prepare(
          "SELECT 1 FROM roles WHERE member_id=? AND project_id=? AND role=? AND lead=1",
        )
        .get(ctx.actorId, r.projectId, r.role ?? "");
      if (
        action === "accept"
          ? !product || r.acceptorId !== ctx.actorId
          : action === "waiver"
            ? !product
            : !product && !lead
      )
        throw new DomainError(403, "Permission denied");
      if (
        action === "accept" &&
        c
          .prepare(
            "SELECT 1 FROM execution_participations WHERE requirement_id=? AND member_id=?",
          )
          .get(id, ctx.actorId)
      )
        throw new AcceptanceError(["ACCEPTOR_PARTICIPATED"]);
      if (action === "waiver") validateWaiver(c, r, input);
      else {
        const authority = acceptanceGate(
          c,
          id,
          r.acceptanceTargetVersion ?? "",
        ).reasons.filter((x) =>
          [
            "INVALID_ACCEPTOR",
            "ACCEPTOR_PARTICIPATED",
            ...(input?.decision === "return"
              ? []
              : ["INVALID_TASK_OWNER", "INVALID_TASK_REVIEWER"]),
          ].includes(x),
        );
        if (authority.length) throw new AcceptanceError(authority);
      }
    },
  };
}
function version(r: Requirement, ctx: MutationContext, revision?: number) {
  if (ctx.expectedVersion === undefined)
    throw new DomainError(400, "expectedVersion required");
  if (r.version !== ctx.expectedVersion)
    throw new DomainError(409, "Version conflict", r);
  if (revision !== undefined && r.revision !== revision)
    throw new AcceptanceError(["REVISION_MISMATCH"]);
}
function gate(db: Database, id: string, target: string) {
  const g = acceptanceGate(db, id, target);
  if (!g.ok) throw new AcceptanceError(g.reasons);
}
export function submitAcceptance(
  db: Database,
  ctx: MutationContext,
  id: string,
  input: { revision: number; targetVersion: string },
): Requirement {
  return mutate(db, guarded(db, ctx, id, "submit"), () => {
    const r = getRequirement(db, id);
    version(r, ctx, input.revision);
    if (r.state !== "active")
      throw new DomainError(409, "Active requirement required", r);
    gate(db, id, input.targetVersion);
    writeDomainObject(
      db,
      ctx,
      id,
      {
        ...r,
        state: "pending_acceptance",
        evidenceReady: true,
        acceptanceTargetVersion: input.targetVersion,
      },
      "submitAcceptance",
    );
    reconcileRequirement(db, ctx, id);
    return getRequirement(db, id);
  });
}
export function acceptanceRecords(
  db: Database,
  id?: string,
): AcceptanceRecord[] {
  return (
    db
      .prepare(
        "SELECT record FROM acceptance_records WHERE (? IS NULL OR requirement_id=?) ORDER BY recorded_seq",
      )
      .all(id ?? null, id ?? null) as any[]
  ).map((x) => JSON.parse(x.record));
}
export function acceptRequirement(
  db: Database,
  ctx: MutationContext,
  id: string,
  input: AcceptanceInput,
): Requirement {
  return mutate(db, guarded(db, ctx, id, "accept", input), () => {
    const r = getRequirement(db, id);
    version(r, ctx, input.revision);
    if (
      r.state !== "pending_acceptance" &&
      !(input.decision === "return" && ["accepted", "active"].includes(r.state))
    )
      throw new DomainError(409, "Pending acceptance required", r);
    if (r.acceptanceTargetVersion !== input.targetVersion)
      throw new AcceptanceError(["TARGET_VERSION_MISMATCH"]);
    const ids = new Set(r.criteria.map((c) => c.id));
    if (
      input.criteria.length !== ids.size ||
      new Set(input.criteria.map((c) => c.id)).size !== ids.size ||
      input.criteria.some((c) => !ids.has(c.id))
    )
      throw new AcceptanceError(["CURRENT_CRITERIA_REQUIRED"]);
    if (input.decision === "pass") {
      if (input.criteria.some((c) => !c.passed))
        throw new AcceptanceError(["FAILED_ACCEPTANCE_CRITERIA"]);
      gate(db, id, input.targetVersion);
    } else {
      if (
        !input.reason?.trim() ||
        !input.criteria.some((c) => !c.passed) ||
        input.criteria.some((c) => !c.passed && !c.note?.trim())
      )
        throw new AcceptanceError(["FAILED_CRITERION_EXPLANATION_REQUIRED"]);
      const tasks = linkedTasks(db, id),
        bugs = linkedBugs(db, id),
        ts = input.reworkTaskIds ?? [],
        bs = input.bugIds ?? [];
      if (
        (!ts.length && !bs.length) ||
        ts.some(
          (x) =>
            !tasks.some(
              (t) => t.id === x && !["done", "cancelled"].includes(t.state),
            ),
        ) ||
        bs.some(
          (x) =>
            !bugs.some(
              (b) => b.id === x && !["closed", "rejected"].includes(b.state),
            ),
        )
      )
        throw new AcceptanceError(["LINKED_OPEN_REWORK_REQUIRED"]);
    }
    const recordedAt = new Date().toISOString(),
      recordId = randomUUID();
    const record: any = {
      ...input,
      id: recordId,
      requirementId: id,
      projectId: r.projectId,
      acceptorId: ctx.actorId,
      recordedAt,
      snapshot: {
        requirement: r,
        criteriaCoverage: coverage(
          db,
          { kind: "requirement", id },
          r.revision,
          input.targetVersion,
        ),
        tasks: linkedTasks(db, id),
        bugs: linkedBugs(db, id),
        waivers: (
          db
            .prepare("SELECT record FROM bug_waivers WHERE requirement_id=?")
            .all(id) as any[]
        ).map((x) => JSON.parse(x.record)),
        actorName: (
          db
            .prepare("SELECT name FROM members WHERE id=?")
            .get(ctx.actorId) as any
        ).name,
        projectName: (
          db
            .prepare("SELECT name FROM projects WHERE id=?")
            .get(r.projectId) as any
        ).name,
      },
    };
    const event = db
      .prepare(
        "INSERT INTO events(time,action,actor_id,target_kind,target_id,after_snapshot) VALUES (?,'acceptanceRecorded',?,'requirement',?,?)",
      )
      .run(recordedAt, ctx.actorId, id, JSON.stringify(record));
    record.recordedSeq = Number(event.lastInsertRowid);
    db.prepare("INSERT INTO acceptance_records VALUES (?,?,?,?,?,?,?,?)").run(
      recordId,
      r.projectId,
      id,
      r.revision,
      input.targetVersion,
      ctx.actorId,
      record.recordedSeq,
      JSON.stringify(record),
    );
    writeDomainObject(
      db,
      ctx,
      id,
      {
        ...r,
        state: input.decision === "pass" ? "accepted" : "active",
        evidenceReady: input.decision === "pass",
        lastAcceptanceId: recordId,
      },
      input.decision === "pass" ? "acceptancePassed" : "acceptanceReturned",
    );
    reconcileRequirement(db, ctx, id);
    return getRequirement(db, id);
  });
}
function validateWaiver(db: Database, r: Requirement, input: any) {
  const b = linkedBugs(db, r.id).find((b) => b.id === input.bugId);
  if (!b || b.projectId !== r.projectId)
    throw new AcceptanceError(["LINKED_BUG_REQUIRED"]);
  if (
    !["normal", "minor"].includes(b.severity) ||
    b.blocked ||
    ["closed", "rejected"].includes(b.state)
  )
    throw new AcceptanceError(["BUG_NOT_WAIVABLE"]);
  if (
    !input.reason?.trim() ||
    !input.plan?.trim() ||
    !createPolicy(db).canWrite(input.followUpOwnerId, r.projectId, b.role)
  )
    throw new AcceptanceError(["VALID_WAIVER_PLAN_OWNER_REQUIRED"]);
  return b;
}
export function waiveBug(
  db: Database,
  ctx: MutationContext,
  id: string,
  input: {
    bugId: string;
    reason: string;
    followUpOwnerId: string;
    plan: string;
  },
): Requirement {
  return mutate(db, guarded(db, ctx, id, "waiver", input), () => {
    const r = getRequirement(db, id);
    version(r, ctx);
    const b = validateWaiver(db, r, input);
    if (
      db
        .prepare(
          "SELECT 1 FROM bug_waivers WHERE requirement_id=? AND bug_id=? AND revision=? AND bug_version=?",
        )
        .get(id, b.id, r.revision, b.version)
    )
      throw new DomainError(409, "Current Bug version already waived");
    const record: any = {
      ...input,
      id: randomUUID(),
      requirementId: id,
      projectId: r.projectId,
      revision: r.revision,
      bugVersion: b.version,
      actorId: ctx.actorId,
      recordedAt: new Date().toISOString(),
      snapshot: {
        requirement: r,
        bug: b,
        actorName: (
          db
            .prepare("SELECT name FROM members WHERE id=?")
            .get(ctx.actorId) as { name: string }
        ).name,
        followUpOwnerName: (
          db
            .prepare("SELECT name FROM members WHERE id=?")
            .get(input.followUpOwnerId) as { name: string }
        ).name,
        projectName: (
          db
            .prepare("SELECT name FROM projects WHERE id=?")
            .get(r.projectId) as { name: string }
        ).name,
      },
    };
    const e = db
      .prepare(
        "INSERT INTO events(time,action,actor_id,target_kind,target_id,after_snapshot) VALUES (?,'bugWaived',?,'requirement',?,?)",
      )
      .run(record.recordedAt, ctx.actorId, id, JSON.stringify(record));
    record.recordedSeq = Number(e.lastInsertRowid);
    db.prepare("INSERT INTO bug_waivers VALUES (?,?,?,?,?,?,?,?)").run(
      record.id,
      r.projectId,
      id,
      b.id,
      r.revision,
      b.version,
      record.recordedSeq,
      JSON.stringify(record),
    );
    writeDomainObject(
      db,
      ctx,
      id,
      { ...r, lastWaiverId: record.id },
      "waiverRecorded",
    );
    reconcileRequirement(db, ctx, id);
    return getRequirement(db, id);
  });
}

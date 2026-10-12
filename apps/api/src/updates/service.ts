import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type {
  UpdateInput,
  WorkUpdate,
  Ref,
  ObjectSnapshot,
  SeqPage,
} from "../../../../packages/contracts/src/index.js";
import { DomainError, mutate, type MutationContext } from "../db/mutate.js";
import { createPolicy } from "../access/policy.js";
import { recordExecutionParticipation } from "../requirements/revisions.js";
import {
  localDate,
  stateAt,
  maxSeq,
  type PageInput,
} from "../history/query.js";
import { fields, text } from "../auth/guards.js";
import { parseRef } from "../history/routes.js";
export function validateUpdate(raw: unknown): UpdateInput {
  const b = fields(
    raw,
    ["target", "workDate", "done", "contributionType"],
    ["next", "obstacle", "correctsId", "reason", "expectedVersion"],
  );
  const target = parseRef(b.target);
  text(b.workDate, 10, 10);
  text(b.done, 1, 6000);
  for (const k of ["next", "obstacle"])
    if (b[k] !== undefined) text(b[k], 0, 6000);
  if (
    !["development", "repair", "testing", "coordination"].includes(
      String(b.contributionType),
    )
  )
    throw new DomainError(400, "Invalid contribution type");
  if (b.correctsId !== undefined) {
    text(b.correctsId, 1, 128);
    text(b.reason, 1, 2000);
  } else if (b.reason !== undefined)
    throw new DomainError(400, "Correction reason requires correctsId");
  return {
    target,
    workDate: b.workDate as string,
    done: b.done as string,
    contributionType: b.contributionType as UpdateInput["contributionType"],
    ...(b.next !== undefined ? { next: b.next as string } : {}),
    ...(b.obstacle !== undefined ? { obstacle: b.obstacle as string } : {}),
    ...(b.correctsId !== undefined
      ? { correctsId: b.correctsId as string, reason: b.reason as string }
      : {}),
  };
}
function targetObject(db: Database, target: Ref) {
  const row = db
    .prepare("SELECT * FROM objects WHERE kind=? AND id=?")
    .get(target.kind, target.id) as any;
  if (!row) throw new DomainError(404, "Object not found");
  return {
    ...JSON.parse(row.current),
    id: row.id,
    projectId: row.project_id,
    version: row.version,
  };
}
function snapshot(
  db: Database,
  t: any,
  target: Ref,
  recordedAt: string,
): ObjectSnapshot {
  const ownerId = t.ownerId ?? t.acceptorId ?? null;
  const requirementId =
    target.kind === "requirement" ? t.id : (t.requirementId ?? null);
  const revision =
    target.kind === "requirement"
      ? t.revision
      : requirementId
        ? (stateAt(
            db,
            { kind: "requirement", id: requirementId },
            { time: recordedAt, seq: maxSeq(db) },
          )?.revision ?? null)
        : null;
  const name = (table: string, id: string) =>
    (
      db.prepare(`SELECT name FROM ${table} WHERE id=?`).get(id) as
        | { name: string }
        | undefined
    )?.name ?? null;
  return {
    id: t.id,
    requirementId,
    title: t.title,
    projectId: t.projectId,
    projectName: name("projects", t.projectId),
    ownerId,
    ownerName: ownerId ? name("members", ownerId) : null,
    state: t.state,
    revision,
    blocked: t.blocked === true,
    version: t.version,
  };
}
// Explicit DB arg matches domain services. clock is an internal dependency, never HTTP input.
export function saveUpdate(
  db: Database,
  ctx: MutationContext,
  raw: UpdateInput,
  clock: () => Date = () => new Date(),
): WorkUpdate {
  const input = validateUpdate(raw);
  const guarded = {
    ...ctx,
    authorize: (c: Database) => {
      ctx.authorize(c);
      createPolicy(c).authorize(ctx.actorId, "read", input.target);
      const t = targetObject(c, input.target);
      if (
        (
          c
            .prepare("SELECT archived FROM projects WHERE id=?")
            .get(t.projectId) as any
        ).archived
      )
        throw new DomainError(409, "ARCHIVED");
      const roles = (
        c
          .prepare("SELECT role FROM roles WHERE project_id=? AND member_id=?")
          .all(t.projectId, ctx.actorId) as { role: string }[]
      ).map((x) => x.role);
      if (!roles.length) throw new DomainError(403, "Project role required");
      if (input.correctsId) {
        const old = c
          .prepare("SELECT author_id FROM updates WHERE id=?")
          .get(input.correctsId) as { author_id: string } | undefined;
        if (!old) throw new DomainError(404, "Update not found");
        if (old.author_id !== ctx.actorId)
          throw new DomainError(403, "Only author may correct contribution");
      } else {
        const scope =
          input.target.kind === "task" && t.kind !== "other" ? t.kind : t.role;
        if (
          input.contributionType === "development" &&
          (input.target.kind !== "task" ||
            !["frontend", "backend"].includes(scope) ||
            !roles.includes(scope))
        )
          throw new DomainError(403, "Development scope role required");
        if (
          input.contributionType === "repair" &&
          (input.target.kind !== "bug" || !roles.includes(scope))
        )
          throw new DomainError(403, "Repair scope role required");
        if (input.contributionType === "testing" && !roles.includes("test"))
          throw new DomainError(403, "Test role required");
      }
    },
  };
  return mutate(db, guarded, () => {
    const t = targetObject(db, input.target),
      recordedAt = clock().toISOString(),
      today = localDate(recordedAt);
    const date = new Date(`${input.workDate}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d\d-\d\d$/.test(input.workDate) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.workDate
    )
      throw new DomainError(422, "Invalid calendar work date");
    if (input.workDate > today) throw new DomainError(422, "Future work date");
    let previous: WorkUpdate | undefined;
    if (input.correctsId) {
      previous = JSON.parse(
        (
          db
            .prepare("SELECT record FROM updates WHERE id=?")
            .get(input.correctsId) as { record: string }
        ).record,
      ) as WorkUpdate;
      if (
        previous.target.id !== input.target.id ||
        previous.target.kind !== input.target.kind
      )
        throw new DomainError(422, "Correction target must remain unchanged");
      if (previous.contributionType !== input.contributionType)
        throw new DomainError(
          422,
          "Actual contribution type cannot be reclassified",
        );
      const latest = JSON.parse(
        (
          db
            .prepare(
              "SELECT record FROM updates WHERE logical_id=? ORDER BY version DESC LIMIT 1",
            )
            .get(previous.logicalId) as { record: string }
        ).record,
      ) as WorkUpdate;
      if (ctx.expectedVersion === undefined)
        throw new DomainError(400, "expectedVersion required");
      if (latest.id !== previous.id || ctx.expectedVersion !== latest.version)
        throw new DomainError(409, "Update version conflict", latest);
    } else if (ctx.expectedVersion !== undefined)
      throw new DomainError(400, "expectedVersion only applies to corrections");
    // An explicit self-assertion of development/repair affects independence, never workflow.
    if (
      !previous &&
      ["development", "repair"].includes(input.contributionType)
    ) {
      if (t.requirementId) {
        const r = targetObject(db, {
          kind: "requirement",
          id: t.requirementId,
        });
        if (
          ["pending_acceptance", "accepted"].includes(r.state) &&
          r.acceptorId === ctx.actorId
        )
          throw new DomainError(
            422,
            "Acceptance independence conflict; change workflow or designated acceptor through a separate authorized action first",
          );
      }
      const role =
        input.target.kind === "task" && t.kind !== "other" ? t.kind : t.role;
      recordExecutionParticipation(db, t.id, ctx.actorId, role);
    }
    const id = randomUUID(),
      base = {
        ...input,
        id,
        logicalId: previous?.logicalId ?? id,
        version: (previous?.version ?? 0) + 1,
        authorId: ctx.actorId,
        authorName:
          previous?.authorName ??
          (
            db
              .prepare("SELECT name FROM members WHERE id=?")
              .get(ctx.actorId) as { name: string }
          ).name,
        recordedAt,
        lateEntry: input.workDate < today,
        snapshot:
          previous?.snapshot ?? snapshot(db, t, input.target, recordedAt),
      };
    const event = db
      .prepare(
        "INSERT INTO events(time,action,actor_id,target_kind,target_id,before_snapshot,after_snapshot) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        recordedAt,
        previous ? "updateCorrected" : "updateRecorded",
        ctx.actorId,
        input.target.kind,
        input.target.id,
        previous ? JSON.stringify(previous) : null,
        JSON.stringify({
          ...base,
          actorName: (
            db
              .prepare("SELECT name FROM members WHERE id=?")
              .get(ctx.actorId) as { name: string }
          ).name,
        }),
      );
    const record: WorkUpdate = {
      ...base,
      recordedSeq: Number(event.lastInsertRowid),
      originalSeq: previous?.originalSeq ?? Number(event.lastInsertRowid),
    };
    db.prepare("INSERT INTO updates VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
      id,
      record.logicalId,
      record.version,
      ctx.actorId,
      t.projectId,
      input.target.kind,
      input.target.id,
      input.workDate,
      record.recordedSeq,
      input.correctsId ?? null,
      JSON.stringify(record),
    );
    return record;
  });
}
// Internal read-only Task9 helper. Select latest logical versions before filtering by work date.
// Stable order uses the original logical entry seq; correction seq remains provenance.
export function effectiveUpdatesAt(
  db: Database,
  cutoffSeq: number,
): WorkUpdate[] {
  if (!Number.isSafeInteger(cutoffSeq) || cutoffSeq < 0)
    throw new DomainError(400, "Invalid cutoff seq");
  return (
    db
      .prepare(
        `SELECT u.record FROM updates u JOIN updates original ON original.id=u.logical_id WHERE u.recorded_seq<=? AND NOT EXISTS
 (SELECT 1 FROM updates newer WHERE newer.logical_id=u.logical_id AND newer.recorded_seq<=? AND newer.version>u.version)
 ORDER BY original.recorded_seq`,
      )
      .all(cutoffSeq, cutoffSeq) as { record: string }[]
  ).map((x) => JSON.parse(x.record));
}
export function ownUpdates(
  db: Database,
  authorId: string,
  p: PageInput,
): SeqPage<WorkUpdate> {
  const rows = db
    .prepare(
      `SELECT u.record,original.recorded_seq FROM updates u JOIN updates original ON original.id=u.logical_id WHERE u.author_id=? AND original.recorded_seq>? AND u.recorded_seq<=? AND NOT EXISTS
 (SELECT 1 FROM updates newer WHERE newer.logical_id=u.logical_id AND newer.recorded_seq<=? AND newer.version>u.version) ORDER BY original.recorded_seq LIMIT ?`,
    )
    .all(authorId, p.afterSeq, p.cutoffSeq, p.cutoffSeq, p.limit + 1) as {
    record: string;
    recorded_seq: number;
  }[];
  return {
    items: rows.slice(0, p.limit).map((r) => JSON.parse(r.record)),
    cutoffSeq: p.cutoffSeq,
    nextAfterSeq:
      rows.length > p.limit ? rows[p.limit - 1]!.recorded_seq : null,
  };
}

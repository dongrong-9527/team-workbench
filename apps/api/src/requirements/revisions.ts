import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { Requirement } from "../../../../packages/contracts/src/index.js";
import { DomainError, type MutationContext } from "../db/mutate.js";
export function saveRevision(
  db: Database,
  ctx: MutationContext,
  r: Requirement,
  reason: string,
  taskIds: string[] = [],
  checkIds: string[] = [],
): void {
  if (!db.inTransaction)
    throw new Error("Revision writes require a mutation transaction");
  db.prepare("INSERT INTO requirement_revisions VALUES (?,?,?,?,?,?,?,?)").run(
    r.id,
    r.revision,
    JSON.stringify(r),
    JSON.stringify(taskIds),
    JSON.stringify(checkIds),
    reason,
    ctx.actorId,
    new Date().toISOString(),
  );
}
export function saveScope(
  db: Database,
  ctx: MutationContext,
  r: Requirement,
): void {
  if (!db.inTransaction)
    throw new Error("Scope writes require a mutation transaction");
  db.prepare("INSERT INTO requirement_scopes VALUES (?,?,?,?,?,?)").run(
    r.id,
    r.revision,
    r.version,
    JSON.stringify(r),
    ctx.actorId,
    new Date().toISOString(),
  );
}
// An object version identifies the exact immutable event, including its sequence
// when multiple writes share a timestamp. Never consult the live member directory.
export function scopeActorName(
  db: Database,
  id: string,
  version: number,
  actorId: string,
): string {
  const event = db
    .prepare(
      "SELECT after_snapshot FROM events WHERE target_kind='requirement' AND target_id=? AND actor_id=? AND json_extract(after_snapshot,'$.id')=target_id AND json_extract(after_snapshot,'$.version')=? ORDER BY seq LIMIT 1",
    )
    .get(id, actorId, version) as { after_snapshot: string } | undefined;
  const name = event ? JSON.parse(event.after_snapshot).actorName : undefined;
  return typeof name === "string" && name.length ? name : actorId;
}
export function getRevisions(
  db: Database,
  id: string,
  afterRevision = 0,
  limit = 20,
) {
  return (
    db
      .prepare(
        "SELECT * FROM requirement_revisions WHERE requirement_id=? AND revision>? ORDER BY revision LIMIT ?",
      )
      .all(id, afterRevision, limit) as any[]
  ).map((r) => ({
    revision: r.revision,
    scopes: (
      db
        .prepare(
          "SELECT * FROM requirement_scopes WHERE requirement_id=? AND revision=? ORDER BY version LIMIT 20",
        )
        .all(id, r.revision) as any[]
    ).map((s) => ({
      version: s.version,
      snapshot: JSON.parse(s.snapshot),
      actorId: s.actor_id,
      time: s.time,
    })),
    snapshot: JSON.parse(r.snapshot),
    affectedTaskIds: JSON.parse(r.affected_task_ids),
    affectedCheckIds: JSON.parse(r.affected_check_ids),
    reason: r.reason,
    actorId: r.actor_id,
    time: r.time,
  }));
}
export function recordExecutionParticipation(
  db: Database,
  objectId: string,
  memberId: string,
  role: "frontend" | "backend" | "test",
): void {
  if (!db.inTransaction)
    throw new Error("Participation writes require a mutation transaction");
  const o = db
    .prepare("SELECT current,project_id,kind FROM objects WHERE id=?")
    .get(objectId) as
    | { current: string; project_id: string; kind: string }
    | undefined;
  if (!o) throw new DomainError(404, "Object not found");
  const c = JSON.parse(o.current);
  if (o.kind !== "bug" && role === "test")
    throw new DomainError(
      422,
      "Test execution is not development participation",
    );
  db.prepare(
    "INSERT INTO execution_participations VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    randomUUID(),
    objectId,
    o.project_id,
    memberId,
    c.requirementId ?? null,
    role,
    o.kind === "bug" ? "repair" : "development",
    new Date().toISOString(),
  );
}

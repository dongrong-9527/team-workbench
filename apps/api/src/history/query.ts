import type { Database } from "better-sqlite3";
import type {
  Ref,
  ObjectSnapshot,
  HistoryEntry,
  SeqPage,
} from "../../../../packages/contracts/src/index.js";
import { DomainError } from "../db/mutate.js";
export interface Cutoff {
  time: string;
  seq: number;
}
export const WORKSPACE_TIME_ZONE = "Asia/Shanghai";
export function localDate(time: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: WORKSPACE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
}
export function maxSeq(db: Database): number {
  return (
    db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM events").get() as {
      seq: number;
    }
  ).seq;
}
export function validateCutoff(cutoff: Cutoff): void {
  if (
    !Number.isSafeInteger(cutoff.seq) ||
    cutoff.seq < 0 ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(cutoff.time) ||
    !Number.isFinite(Date.parse(cutoff.time)) ||
    new Date(cutoff.time).toISOString() !== cutoff.time
  )
    throw new DomainError(400, "Invalid cutoff");
}
// Internal read helper: both bounds inclusive. Task9 day end uses next midnight minus 1ms,
// plus its captured global seq. Ordering is by immutable global seq, never current rows.
export function stateAt(
  db: Database,
  target: Ref,
  cutoff: Cutoff,
): ObjectSnapshot | null {
  validateCutoff(cutoff);
  const row = db
    .prepare(
      `SELECT seq,after_snapshot FROM events WHERE target_kind=? AND target_id=? AND time<=? AND seq<=?
 AND json_type(after_snapshot,'$.title')='text' AND json_type(after_snapshot,'$.projectId')='text'
 AND json_type(after_snapshot,'$.state')='text' AND json_type(after_snapshot,'$.version')='integer'
 ORDER BY seq DESC LIMIT 1`,
    )
    .get(target.kind, target.id, cutoff.time, cutoff.seq) as
    | { seq: number; after_snapshot: string }
    | undefined;
  if (!row) return null;
  const s = JSON.parse(row.after_snapshot),
    ownerId = s.ownerId ?? s.acceptorId ?? null,
    requirementId =
      target.kind === "requirement" ? target.id : (s.requirementId ?? null),
    revision =
      target.kind === "requirement"
        ? (s.revision ?? null)
        : requirementId
          ? (stateAt(db, { kind: "requirement", id: requirementId }, cutoff)
              ?.revision ?? null)
          : null;
  return {
    id: target.id,
    requirementId,
    title: s.title,
    projectId: s.projectId,
    projectName: nameAt(
      db,
      "project",
      s.projectId,
      cutoff,
      s.projectName ?? null,
    ),
    ownerId,
    ownerName: ownerId
      ? nameAt(db, "member", ownerId, cutoff, s.ownerName ?? null)
      : null,
    state: s.state,
    revision,
    blocked: s.blocked === true,
    version: s.version,
  };
}
// Names use their own immutable timeline, with object-time names for pre-event members/projects.
export function nameAt(
  db: Database,
  kind: "member" | "project",
  id: string,
  cutoff: Cutoff,
  fallback: string | null,
): string | null {
  const key = kind === "member" ? "displayName" : "name";
  const row = db
    .prepare(
      `SELECT after_snapshot FROM events WHERE target_kind=? AND target_id=? AND time<=? AND seq<=? AND json_type(after_snapshot,?)='text' ORDER BY seq DESC LIMIT 1`,
    )
    .get(kind, id, cutoff.time, cutoff.seq, `$.${key}`) as
    | { after_snapshot: string }
    | undefined;
  if (row) return JSON.parse(row.after_snapshot)[key];
  if (fallback !== null) return fallback;
  const future = db
    .prepare(
      `SELECT before_snapshot FROM events WHERE target_kind=? AND target_id=? AND (time>? OR seq>?) AND json_type(before_snapshot,?)='text' ORDER BY seq LIMIT 1`,
    )
    .get(kind, id, cutoff.time, cutoff.seq, `$.${key}`) as
    | { before_snapshot: string }
    | undefined;
  return future ? JSON.parse(future.before_snapshot)[key] : null;
}
export interface PageInput {
  afterSeq: number;
  cutoffSeq: number;
  limit: number;
}
export function pageInput(
  db: Database,
  query: Record<string, unknown>,
  extra: string[] = [],
): PageInput {
  if (
    Object.keys(query).some(
      (k) => !["afterSeq", "cutoffSeq", "limit", ...extra].includes(k),
    )
  )
    throw new DomainError(400, "Invalid query");
  const number = (key: string, def: number, min: number, max: number) => {
    const v = query[key];
    if (v === undefined) return def;
    if (typeof v !== "string" || !/^\d+$/.test(v))
      throw new DomainError(400, "Invalid query");
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < min || n > max)
      throw new DomainError(400, "Invalid query");
    return n;
  };
  return {
    afterSeq: number("afterSeq", 0, 0, Number.MAX_SAFE_INTEGER),
    cutoffSeq: number("cutoffSeq", maxSeq(db), 0, Number.MAX_SAFE_INTEGER),
    limit: number("limit", 50, 1, 100),
  };
}
export function historyPage(
  db: Database,
  target: Ref,
  p: PageInput,
): SeqPage<HistoryEntry> {
  const rows = db
    .prepare(
      "SELECT * FROM events WHERE target_kind=? AND target_id=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?",
    )
    .all(target.kind, target.id, p.afterSeq, p.cutoffSeq, p.limit + 1) as any[];
  const items = rows.slice(0, p.limit).map((r) => {
    const before = r.before_snapshot ? JSON.parse(r.before_snapshot) : null,
      after = r.after_snapshot ? JSON.parse(r.after_snapshot) : null;
    const actorName =
      after?.actorName ??
      after?.authorName ??
      after?.snapshot?.actorName ??
      nameAt(db, "member", r.actor_id, { time: r.time, seq: r.seq }, null);
    return {
      seq: r.seq,
      time: r.time,
      localTime: new Date(Date.parse(r.time) + 8 * 60 * 60 * 1000)
        .toISOString()
        .replace("Z", "+08:00"),
      action: r.action,
      actorId: r.actor_id,
      actorName,
      target,
      before,
      after,
      reason:
        after?.reason ??
        after?.lastActionReason ??
        after?.transfer?.reason ??
        null,
    };
  });
  return {
    items,
    cutoffSeq: p.cutoffSeq,
    nextAfterSeq: rows.length > p.limit ? items.at(-1)!.seq : null,
  };
}

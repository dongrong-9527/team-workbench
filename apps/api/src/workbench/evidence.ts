import type { Database } from "better-sqlite3";
import { pageInput, nameAt } from "../history/query.js";
import { fields, text } from "../auth/guards.js";
import { DomainError } from "../db/mutate.js";
export function evidencePage(
  db: Database,
  table: "test_records" | "acceptance_records",
  query: Record<string, unknown>,
  where: string,
  args: unknown[],
) {
  const page = pageInput(db, { ...query, limit: query.limit ?? "20" });
  const rows = db
    .prepare(
      `SELECT recorded_seq AS seq,record FROM ${table} WHERE ${where} AND recorded_seq>? AND recorded_seq<=? ORDER BY recorded_seq LIMIT ?`,
    )
    .all(...args, page.afterSeq, page.cutoffSeq, page.limit + 1) as any[];
  return {
    items: rows.slice(0, page.limit).map((r) => JSON.parse(r.record)),
    cutoffSeq: page.cutoffSeq,
    nextAfterSeq: rows.length > page.limit ? rows[page.limit - 1].seq : null,
  };
}
export function auditPage(
  db: Database,
  kind: string,
  id: string,
  query: Record<string, unknown>,
) {
  if (!["member", "project"].includes(kind))
    throw new DomainError(400, "Invalid audit kind");
  text(id, 1, 128);
  if (
    !db
      .prepare(
        `SELECT 1 FROM ${kind === "member" ? "members" : "projects"} WHERE id=?`,
      )
      .get(id)
  )
    throw new DomainError(404, "Audit target not found");
  const page = pageInput(db, { ...query, limit: query.limit ?? "20" });
  const rows = db
    .prepare(
      "SELECT * FROM events WHERE target_kind=? AND target_id=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?",
    )
    .all(kind, id, page.afterSeq, page.cutoffSeq, page.limit + 1) as any[];
  return {
    items: rows.slice(0, page.limit).map((e) => ({
      seq: e.seq,
      time: e.time,
      localTime: new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(e.time)),
      actorId: e.actor_id,
      actorName: nameAt(
        db,
        "member",
        e.actor_id,
        { time: e.time, seq: e.seq },
        null,
      ),
      action: e.action,
      target: { kind, id },
      before: e.before_snapshot ? JSON.parse(e.before_snapshot) : null,
      after: e.after_snapshot ? JSON.parse(e.after_snapshot) : null,
      reason: null,
    })),
    cutoffSeq: page.cutoffSeq,
    nextAfterSeq: rows.length > page.limit ? rows[page.limit - 1].seq : null,
  };
}

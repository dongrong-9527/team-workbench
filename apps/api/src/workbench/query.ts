import type { Database } from "better-sqlite3";
import { createHash } from "node:crypto";
import { DomainError } from "../db/mutate.js";
import { fields, text } from "../auth/guards.js";
import { getTask } from "../tasks/service.js";
import { getBug } from "../bugs/service.js";
import { getRequirement } from "../requirements/service.js";
import { localDate } from "../history/query.js";
import { revisionImpact } from "./revision-impact.js";
export interface Query {
  limit: number;
  cursor?: string;
  projectId?: string;
  ownerId?: string;
  state?: string;
  blocked?: string;
  kind?: string;
  q?: string;
  archived?: string;
  active?: string;
  requirementId?: string;
}
export function parseQuery(raw: unknown, extra: string[] = []): Query {
  const b = fields(
    raw,
    [],
    [
      "limit",
      "cursor",
      "projectId",
      "ownerId",
      "state",
      "blocked",
      "kind",
      "requirementId",
      ...extra,
    ],
  );
  const limit = b.limit === undefined ? 20 : Number(b.limit);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (b.limit !== undefined && !/^\d+$/.test(String(b.limit)))
  )
    throw new DomainError(400, "Invalid limit");
  for (const k of Object.keys(b))
    if (k !== "limit") text(b[k], 1, k === "cursor" ? 2048 : 200);
  for (const k of ["blocked", "archived", "active"])
    if (b[k] !== undefined && !["true", "false"].includes(String(b[k])))
      throw new DomainError(400, `Invalid ${k}`);
  if (
    b.kind !== undefined &&
    !["task", "requirement", "bug"].includes(String(b.kind))
  )
    throw new DomainError(400, "Invalid kind");
  if (
    b.state !== undefined &&
    ![
      "draft",
      "refining",
      "ready",
      "active",
      "pending_acceptance",
      "accepted",
      "cancelled",
      "pending",
      "pending_check",
      "done",
      "unconfirmed",
      "fixing",
      "pending_verify",
      "closed",
      "rejected",
    ].includes(String(b.state))
  )
    throw new DomainError(400, "Invalid state");
  return { ...b, limit } as Query;
}
function bounds(db: Database, table: string, q: Query, scope: string) {
  const { cursor, limit, ...filters } = q;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([scope, Object.entries(filters).sort()]))
    .digest("hex");
  let after = 0,
    cutoff = (
      db
        .prepare(`SELECT COALESCE(MAX(rowid),0) AS n FROM ${table}`)
        .get() as any
    ).n;
  if (cursor) {
    try {
      const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
      if (
        c.f !== fingerprint ||
        !Number.isSafeInteger(c.a) ||
        !Number.isSafeInteger(c.c) ||
        c.a < 0 ||
        c.c < c.a
      )
        throw 0;
      after = c.a;
      cutoff = c.c;
    } catch {
      throw new DomainError(400, "Invalid cursor for query");
    }
  }
  return {
    after,
    cutoff,
    next: (a: number) =>
      Buffer.from(JSON.stringify({ a, c: cutoff, f: fingerprint })).toString(
        "base64url",
      ),
  };
}
export function directory(db: Database, q: Query, actorId: string) {
  const b = bounds(db, "members", q, `members:${actorId}`),
    args: any[] = [b.after, b.cutoff];
  let where = "m.rowid>? AND m.rowid<=?";
  if (q.active) {
    where += " AND m.active=?";
    args.push(q.active === "true" ? 1 : 0);
  }
  const rows = db
    .prepare(
      `SELECT m.rowid AS pos,m.id,m.name AS displayName,m.active,m.is_admin AS isAdmin,m.version,(m.password_hash IS NOT NULL) AS activated FROM members m WHERE ${where} ORDER BY m.rowid LIMIT ?`,
    )
    .all(...args, q.limit + 1) as any[];
  const more = rows.length > q.limit;
  return {
    items: rows.slice(0, q.limit).map(({ pos, ...r }) => ({
      ...r,
      active: !!r.active,
      activated: !!r.activated,
      isAdmin: !!r.isAdmin,
      ...(q.projectId
        ? {
            roles: db
              .prepare(
                "SELECT role,lead FROM roles WHERE project_id=? AND member_id=? ORDER BY role",
              )
              .all(q.projectId, r.id),
          }
        : {}),
    })),
    nextCursor: more ? b.next(rows[q.limit - 1].pos) : null,
  };
}
export function projectsPage(db: Database, q: Query, actorId: string) {
  const b = bounds(db, "projects", q, `projects:${actorId}`);
  const rows = db
    .prepare(
      "SELECT rowid AS pos,* FROM projects WHERE rowid>? AND rowid<=? AND (? IS NULL OR archived=?) ORDER BY rowid LIMIT ?",
    )
    .all(
      b.after,
      b.cutoff,
      q.archived ?? null,
      q.archived === "true" ? 1 : 0,
      q.limit + 1,
    ) as any[];
  return {
    items: rows.slice(0, q.limit).map(({ pos, ...r }) => ({
      ...r,
      myRoles: db
        .prepare(
          "SELECT role,lead FROM roles WHERE project_id=? AND member_id=? ORDER BY role",
        )
        .all(r.id, actorId),
    })),
    nextCursor: rows.length > q.limit ? b.next(rows[q.limit - 1].pos) : null,
  };
}
export function objectsPage(
  db: Database,
  q: Query,
  actorId: string,
  scope = "all",
) {
  const b = bounds(db, "objects", q, `${scope}:${actorId}`);
  const clauses = ["o.rowid>?", "o.rowid<=?"];
  const args: any[] = [b.after, b.cutoff];
  for (const [key, col] of [
    ["projectId", "o.project_id"],
    [
      "ownerId",
      "COALESCE(json_extract(o.current,'$.ownerId'),json_extract(o.current,'$.acceptorId'))",
    ],
    ["state", "json_extract(o.current,'$.state')"],
    ["kind", "o.kind"],
    ["requirementId", "json_extract(o.current,'$.requirementId')"],
  ] as const)
    if (q[key]) {
      clauses.push(`${col}=?`);
      args.push(q[key]);
    }
  if (q.blocked) {
    clauses.push("COALESCE(json_extract(o.current,'$.blocked'),0)=?");
    args.push(q.blocked === "true" ? 1 : 0);
  }
  if (q.q) {
    clauses.push(
      "(instr(lower(o.id),lower(?))>0 OR instr(lower(json_extract(o.current,'$.title')),lower(?))>0)",
    );
    args.push(q.q, q.q);
  }
  const requiredRole = `CASE WHEN o.kind='requirement' THEN 'product' WHEN o.kind='task' AND json_extract(o.current,'$.kind')!='other' THEN json_extract(o.current,'$.kind') ELSE json_extract(o.current,'$.role') END`;
  const ownerId = `COALESCE(NULLIF(json_extract(o.current,'$.ownerId'),''),NULLIF(json_extract(o.current,'$.acceptorId'),''))`;
  const invalidOwner = `(${ownerId} IS NOT NULL AND (COALESCE(m.active,0)=0 OR NOT EXISTS(SELECT 1 FROM roles own_role WHERE own_role.project_id=o.project_id AND own_role.member_id=${ownerId} AND own_role.role=${requiredRole})))`;
  const reviewerId = `NULLIF(json_extract(o.current,'$.reviewerId'),'')`;
  // Match tasks/service.validReviewer without changing assignment or write policy.
  const invalidReviewer = `(o.kind='task' AND ${reviewerId} IS NOT NULL AND NOT EXISTS(SELECT 1 FROM members reviewer JOIN roles review_role ON review_role.member_id=reviewer.id WHERE reviewer.id=${reviewerId} AND reviewer.active=1 AND review_role.project_id=o.project_id AND ((${requiredRole} IN ('frontend','backend') AND review_role.role='test') OR (${requiredRole} NOT IN ('frontend','backend') AND (review_role.role='product' OR (review_role.role=${requiredRole} AND review_role.lead=1))))))`;
  if (scope === "mine" || scope === "progress") {
    const relatedToActor = `(json_extract(o.current,'$.ownerId')=? OR json_extract(o.current,'$.acceptorId')=? OR json_extract(o.current,'$.reviewerId')=? OR EXISTS(SELECT 1 FROM execution_participations e WHERE e.object_id=o.id AND e.member_id=?) OR EXISTS(SELECT 1 FROM test_records tr WHERE tr.target_id=o.id AND json_extract(tr.record,'$.testerId')=?))`;
    clauses.push(
      scope === "progress" ? relatedToActor :
        `(${relatedToActor} OR (o.kind IN ('task','bug') AND json_extract(o.current,'$.ownerId') IS NULL AND EXISTS(SELECT 1 FROM roles r WHERE r.project_id=o.project_id AND r.member_id=? AND r.role=${requiredRole})) OR ((o.kind='bug' AND json_extract(o.current,'$.state')='pending_verify' OR o.kind='requirement' AND json_extract(o.current,'$.state')='active' AND json_extract(o.current,'$.scopeConfirmed')=1) AND EXISTS(SELECT 1 FROM roles r WHERE r.project_id=o.project_id AND r.member_id=? AND r.role='test')) OR ((${invalidOwner} OR ${invalidReviewer}) AND EXISTS(SELECT 1 FROM roles r WHERE r.project_id=o.project_id AND r.member_id=? AND (r.role='product' OR (r.role=${requiredRole} AND r.lead=1)))))`,
    );
    args.push(...Array(scope === "progress" ? 5 : 8).fill(actorId));
    if (scope === "progress") clauses.push("p.archived=0");
    else clauses.push("json_extract(o.current,'$.state') NOT IN ('done','cancelled','closed','rejected','accepted')");
  }
  const rows = db
    .prepare(
      `SELECT o.rowid AS pos,o.id,o.kind,p.name AS projectName,p.archived,m.name AS ownerName,m.active AS ownerActive,${invalidOwner} AS ownerInvalid,${invalidReviewer} AS reviewerInvalid FROM objects o JOIN projects p ON p.id=o.project_id LEFT JOIN members m ON m.id=${ownerId} WHERE ${clauses.join(" AND ")} ORDER BY o.rowid LIMIT ?`,
    )
    .all(...args, q.limit + 1) as any[];
  const items = rows.slice(0, q.limit).map(({ pos, kind, ownerInvalid, reviewerInvalid, ...meta }) => {
    const o =
      kind === "task"
        ? getTask(db, meta.id)
        : kind === "bug"
          ? getBug(db, meta.id)
          : getRequirement(db, meta.id);
    const own = (o as any).ownerId === actorId;
    const impact = kind === "task" ? revisionImpact(db, o as ReturnType<typeof getTask>) : null;
    const parent = kind === "task" && (o as any).requirementId
      ? getRequirement(db, (o as any).requirementId) : undefined;
    const participated = !!db
      .prepare(
        "SELECT 1 FROM execution_participations WHERE object_id=? AND member_id=? UNION ALL SELECT 1 FROM test_records WHERE target_id=? AND tester_id=? LIMIT 1",
      )
      .get(o.id, actorId, o.id, actorId);
    const today = localDate(new Date().toISOString());
    const updated = db
      .prepare(
        "SELECT 1 FROM updates u WHERE u.author_id=? AND u.target_id=? AND u.work_date=? AND NOT EXISTS(SELECT 1 FROM updates n WHERE n.corrects_id=u.id)",
      )
      .get(actorId, o.id, today);
    return {
      ...o,
      ...meta,
      objectKind: kind,
      ...(impact ? { revisionImpact: impact } : {}),
      flags: {
        unassigned: kind !== "requirement" && !(o as any).ownerId,
        inactiveOwner: meta.ownerActive === 0,
        invalidOwner: !!ownerInvalid,
        invalidReviewer: !!reviewerInvalid,
        parentNotExecutable: !!parent && (!['ready', 'active'].includes(parent.state) || !parent.scopeConfirmed || parent.blocked),
        pendingRevision: !!impact?.needsAttention,
        missingUpdate: (own || participated) && !updated,
      },
      responsibility: own
        ? "owner"
        : (o as any).reviewerId === actorId
          ? "reviewer"
          : (o as any).acceptorId === actorId
            ? "acceptor"
            : participated
              ? "participant"
              : ((kind === "bug" && (o as any).state === "pending_verify") ||
                    (kind === "requirement" &&
                      (o as any).state === "active")) &&
                  db
                    .prepare(
                      "SELECT 1 FROM roles WHERE project_id=? AND member_id=? AND role='test'",
                    )
                    .get(o.projectId, actorId)
                ? "tester"
                : !(o as any).ownerId && kind !== "requirement"
                  ? "claimable"
                  : "observer",
    };
  });
  return {
    items,
    nextCursor: rows.length > q.limit ? b.next(rows[q.limit - 1].pos) : null,
  };
}

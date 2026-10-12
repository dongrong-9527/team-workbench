import { reconcileProjectRequirements } from "../requirements/reconcile.js";
import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { DomainError, mutate, type MutationContext } from "../db/mutate.js";
import { createPolicy } from "../access/policy.js";
import type { Role } from "../../../../packages/contracts/src/index.js";
export interface Project {
  id: string;
  name: string;
  description: string;
  archived: number;
  version: number;
}
export function getProject(db: Database, id: string): Project {
  const p = db.prepare("SELECT * FROM projects WHERE id=?").get(id) as
    | Project
    | undefined;
  if (!p) throw new DomainError(404, "Project not found");
  return p;
}
function snapshot(db: Database, id: string) {
  return {
    ...getProject(db, id),
    roles: db
      .prepare(
        "SELECT r.member_id AS memberId,m.name AS memberName,r.role,r.lead FROM roles r JOIN members m ON m.id=r.member_id WHERE r.project_id=? ORDER BY r.member_id,r.role",
      )
      .all(id),
  };
}
function event(
  db: Database,
  ctx: MutationContext,
  id: string,
  action: string,
  before: unknown,
) {
  const actor = db
    .prepare("SELECT name FROM members WHERE id=?")
    .get(ctx.actorId) as { name: string };
  db.prepare(
    "INSERT INTO events (time,action,actor_id,target_kind,target_id,before_snapshot,after_snapshot) VALUES (?,?,?,'project',?,?,?)",
  ).run(
    new Date().toISOString(),
    action,
    ctx.actorId,
    id,
    before === null ? null : JSON.stringify(before),
    JSON.stringify({ ...snapshot(db, id), actorName: actor.name }),
  );
}
function version(ctx: MutationContext, p: Project) {
  if (ctx.expectedVersion === undefined)
    throw new DomainError(400, "expectedVersion is required");
  if (ctx.expectedVersion !== p.version)
    throw new DomainError(409, "Version conflict", p);
}
export function createProject(
  db: Database,
  ctx: MutationContext,
  name: string,
  description: string,
) {
  return mutate(db, ctx, () => {
    const id = randomUUID();
    db.prepare("INSERT INTO projects (id,name,description) VALUES (?,?,?)").run(
      id,
      name,
      description,
    );
    event(db, ctx, id, "projectCreated", null);
    return getProject(db, id);
  });
}
export function changeProject(
  db: Database,
  ctx: MutationContext,
  id: string,
  action: "archive" | "restore" | "roles",
  input?: { memberId: string; roles: Role[]; leads: Role[] },
) {
  const original = ctx.authorize;
  const guarded = {
    ...ctx,
    authorize: (connection: Database) => {
      original(connection);
      const p = getProject(connection, id);
      if (action === "restore" || action === "archive") {
        const m = connection
          .prepare("SELECT is_admin FROM members WHERE id=?")
          .get(ctx.actorId) as { is_admin: number };
        if (!m.is_admin) throw new DomainError(403, "Permission denied");
        if (action === "archive" && p.archived) {
          const replay = connection
            .prepare(
              "SELECT route,body_hash FROM idempotency WHERE actor_id=? AND request_id=?",
            )
            .get(ctx.actorId, ctx.requestId) as
            | { route: string; body_hash: string }
            | undefined;
          if (
            !replay ||
            replay.route !== ctx.route ||
            replay.body_hash !== ctx.bodyHash
          )
            throw new DomainError(409, "ARCHIVED");
        }
      } else
        createPolicy(connection).authorize(ctx.actorId, "manageProject", {
          kind: "project",
          id,
        });
    },
  };
  return mutate(db, guarded, () => {
    const p = getProject(db, id);
    version(ctx, p);
    const before = snapshot(db, id);
    if (action === "roles") {
      if (!input) throw new Error("Missing roles");
      const m = db
        .prepare("SELECT active FROM members WHERE id=?")
        .get(input.memberId) as { active: number } | undefined;
      if (!m?.active) throw new DomainError(422, "Member is inactive");
      const current = db
        .prepare(
          "SELECT role,lead FROM roles WHERE project_id=? AND member_id=? ORDER BY role",
        )
        .all(id, input.memberId) as { role: Role; lead: number }[];
      const requested = [...input.roles].sort().map((role) => ({
        role,
        lead: input.leads.includes(role) ? 1 : 0,
      }));
      if (
        current.length === requested.length &&
        current.every(
          (row, index) =>
            row.role === requested[index]!.role &&
            row.lead === requested[index]!.lead,
        )
      )
        return p;
      db.prepare("DELETE FROM roles WHERE project_id=? AND member_id=?").run(
        id,
        input.memberId,
      );
      for (const role of input.roles)
        db.prepare(
          "INSERT INTO roles (project_id,member_id,role,lead) VALUES (?,?,?,?)",
        ).run(id, input.memberId, role, input.leads.includes(role) ? 1 : 0);
      db.prepare("UPDATE projects SET version=version+1 WHERE id=?").run(id);
    } else {
      if (p.archived === (action === "archive" ? 1 : 0))
        throw new DomainError(409, "Project state conflict", p);
      db.prepare(
        "UPDATE projects SET archived=?,version=version+1 WHERE id=?",
      ).run(action === "archive" ? 1 : 0, id);
    }
    event(
      db,
      ctx,
      id,
      action === "roles"
        ? "projectRolesChanged"
        : action === "archive"
          ? "projectArchived"
          : "projectRestored",
      before,
    );
    if (action === "roles") reconcileProjectRequirements(db, ctx, id);
    return getProject(db, id);
  });
}

export function renameProject(
  db: Database,
  ctx: MutationContext,
  id: string,
  name: string,
) {
  return mutate(
    db,
    {
      ...ctx,
      authorize: (c) => {
        ctx.authorize(c);
        createPolicy(c).authorize(ctx.actorId, "manageProject", {
          kind: "project",
          id,
        });
      },
    },
    () => {
      const old = getProject(db, id);
      version(ctx, old);
      if (old.name === name) return old;
      const before = snapshot(db, id);
      db.prepare("UPDATE projects SET name=?,version=version+1 WHERE id=?").run(
        name,
        id,
      );
      event(db, ctx, id, "projectRenamed", before);
      return getProject(db, id);
    },
  );
}

import { reconcileRequirement } from "./reconcile.js";
import { isDeepStrictEqual } from "node:util";
import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  Requirement,
  RequirementCommand,
} from "../../../../packages/contracts/src/index.js";
import { DomainError, mutate, type MutationContext } from "../db/mutate.js";
import { createPolicy } from "../access/policy.js";
import { saveRevision, saveScope } from "./revisions.js";
export function getRequirement(db: Database, id: string): Requirement {
  const o = db
    .prepare("SELECT * FROM objects WHERE id=? AND kind='requirement'")
    .get(id) as any;
  if (!o) throw new DomainError(404, "Requirement not found");
  return {
    ...JSON.parse(o.current),
    id: o.id,
    projectId: o.project_id,
    version: o.version,
  };
}
export function linkedTasks(db: Database, id: string): any[] {
  const requirement = getRequirement(db, id);
  const tasks = (
    db
      .prepare(
        "SELECT * FROM objects WHERE kind='task' AND json_extract(current,'$.requirementId')=?",
      )
      .all(id) as any[]
  ).map((o) => ({
    ...JSON.parse(o.current),
    id: o.id,
    projectId: o.project_id,
    version: o.version,
  }));
  if (tasks.some((t) => t.projectId !== requirement.projectId))
    throw new DomainError(422, "Linked task belongs to a different project");
  return tasks;
}
// Coordinated domain services call this only inside their existing mutation.
export function writeDomainObject(
  db: Database,
  ctx: MutationContext,
  id: string,
  after: Record<string, unknown>,
  action: string,
  options: { unassigned?: boolean } = {},
): void {
  if (!db.inTransaction)
    throw new Error("Domain writes require a mutation transaction");
  const o = db.prepare("SELECT * FROM objects WHERE id=?").get(id) as any;
  if (!o) throw new DomainError(404, "Object not found");
  const actor = db
    .prepare("SELECT name FROM members WHERE id=?")
    .get(ctx.actorId) as any;
  const project = db
    .prepare("SELECT name FROM projects WHERE id=?")
    .get(o.project_id) as any;
  const before = {
    ...JSON.parse(o.current),
    id: o.id,
    projectId: o.project_id,
    version: o.version,
  };
  const next: Record<string, any> = {
    ...after,
    id: o.id,
    projectId: o.project_id,
    version: o.version + 1,
  };
  if (isDeepStrictEqual(before, { ...next, version: o.version })) return;
  const owner =
    typeof (next.ownerId ?? next.acceptorId) === "string"
      ? (db
          .prepare("SELECT name FROM members WHERE id=?")
          .get(next.ownerId ?? next.acceptorId) as any)
      : undefined;
  const changed = options.unassigned
    ? db
        .prepare(
          "UPDATE objects SET current=?,version=version+1 WHERE id=? AND version=? AND json_extract(current,'$.ownerId') IS NULL",
        )
        .run(JSON.stringify(next), id, o.version)
    : db
        .prepare("UPDATE objects SET current=?,version=version+1 WHERE id=?")
        .run(JSON.stringify(next), id);
  if (changed.changes !== 1)
    throw new DomainError(409, "Claim conflict", before);
  db.prepare(
    "INSERT INTO events(time,action,actor_id,target_kind,target_id,before_snapshot,after_snapshot) VALUES(?,?,?,?,?,?,?)",
  ).run(
    new Date().toISOString(),
    action,
    ctx.actorId,
    o.kind,
    id,
    JSON.stringify(before),
    JSON.stringify({
      ...next,
      actorName: actor.name,
      projectName: project.name,
      ownerId: next.ownerId ?? next.acceptorId ?? null,
      ownerName: owner?.name ?? null,
    }),
  );
  if (o.kind === "requirement")
    saveScope(db, ctx, next as unknown as Requirement);
}
function authorize(
  db: Database,
  ctx: MutationContext,
  id: string,
  action: string,
  projectId?: string,
  creationRole?: string,
  commandFields: Record<string, unknown> = {},
) {
  const base = ctx.authorize;
  return {
    ...ctx,
    authorize: (connection: Database) => {
      base(connection);
      const r = projectId ? undefined : getRequirement(db, id);
      const p = projectId ?? r!.projectId;
      createPolicy(db).authorize(ctx.actorId, "read", {
        kind: "project",
        id: p,
      });
      const proj = db
        .prepare("SELECT archived FROM projects WHERE id=?")
        .get(p) as any;
      if (proj.archived) throw new DomainError(409, "ARCHIVED");
      const roles = db
        .prepare(
          "SELECT role,lead FROM roles WHERE project_id=? AND member_id=?",
        )
        .all(p, ctx.actorId) as any[];
      const product = roles.some((x) => x.role === "product");
      if (
        !product &&
        ("acceptorId" in commandFields || (r && "role" in commandFields))
      )
        throw new DomainError(
          403,
          "Product role required to designate acceptor or transfer scope",
        );
      if (!product && Array.isArray(commandFields.criteria)) {
        for (const criterion of commandFields.criteria as any[]) {
          const old = r?.criteria.find((c) => c.id === criterion.id);
          if (
            criterion.required === false ||
            (old && old.required !== criterion.required) ||
            "exclusionReason" in criterion
          )
            throw new DomainError(403, "Product must confirm required checks");
        }
      }
      const allowed =
        action === "suggestChange"
          ? roles.length > 0
          : roles.some((x) => x.role === "product") ||
            (["create", "refine"].includes(action) &&
              roles.some(
                (x) => x.lead === 1 && x.role === (r?.role ?? creationRole),
              ));
      if (!allowed) throw new DomainError(403, "Permission denied");
    },
  };
}
export function createRequirement(
  db: Database,
  ctx: MutationContext,
  input: Omit<
    Requirement,
    | "id"
    | "state"
    | "version"
    | "revision"
    | "blocked"
    | "evidenceReady"
    | "scopeConfirmed"
    | "acceptorId"
  > & { acceptorId?: string },
): Requirement {
  const auth = authorize(
    db,
    ctx,
    "",
    "create",
    input.projectId,
    input.role,
    input,
  );
  return mutate(db, auth, () => {
    const r: Requirement = {
      ...input,
      acceptorId: input.acceptorId ?? "",
      id: randomUUID(),
      state: "draft",
      version: 1,
      revision: 1,
      blocked: false,
      evidenceReady: false,
      scopeConfirmed: false,
    };
    db.prepare("INSERT INTO objects VALUES (?,'requirement',?,1,?)").run(
      r.id,
      r.projectId,
      JSON.stringify(r),
    );
    saveRevision(db, ctx, r, "Initial scope");
    saveScope(db, ctx, r);
    const actor = db
      .prepare("SELECT name FROM members WHERE id=?")
      .get(ctx.actorId) as any;
    const project = db
      .prepare("SELECT name FROM projects WHERE id=?")
      .get(r.projectId) as any;
    db.prepare(
      "INSERT INTO events(time,action,actor_id,target_kind,target_id,after_snapshot) VALUES (?,'created',?,'requirement',?,?)",
    ).run(
      new Date().toISOString(),
      ctx.actorId,
      r.id,
      JSON.stringify({
        ...r,
        actorName: actor.name,
        projectName: project.name,
        ownerId: r.acceptorId,
        ownerName:
          (
            db
              .prepare("SELECT name FROM members WHERE id=?")
              .get(r.acceptorId) as { name: string } | undefined
          )?.name ?? null,
      }),
    );
    return r;
  });
}
function requireState(r: Requirement, states: string[]) {
  if (!states.includes(r.state))
    throw new DomainError(409, "Invalid requirement state", r);
}
export function changeRequirement(
  db: Database,
  ctx: MutationContext,
  id: string,
  cmd: RequirementCommand,
): Requirement {
  const auth = authorize(db, ctx, id, cmd.action, undefined, undefined, cmd);
  return mutate(db, auth, () => {
    let r = getRequirement(db, id);
    if (ctx.expectedVersion === undefined)
      throw new DomainError(400, "expectedVersion is required");
    if (r.version !== ctx.expectedVersion)
      throw new DomainError(409, "Version conflict", r);
    const next = { ...r };
    const patch = [
      "title",
      "source",
      "description",
      "acceptorId",
      "criteria",
      "priority",
      "role",
    ];
    if (cmd.action === "suggestChange") {
      if (r.state === "cancelled")
        throw new DomainError(409, "Requirement cancelled");
    }
    if (cmd.action === "refine") {
      requireState(r, ["draft", "refining"]);
      for (const key of patch) if (key in cmd) (next as any)[key] = cmd[key];
      next.state = "refining";
      next.scopeConfirmed = false;
      const newCriteria = next.criteria;
      const changed = r.criteria
        .filter(
          (c) =>
            JSON.stringify(c) !==
            JSON.stringify(newCriteria.find((n) => n.id === c.id)),
        )
        .map((c) => c.id)
        .concat(
          newCriteria
            .filter((c) => !r.criteria.some((old) => old.id === c.id))
            .map((c) => c.id),
        );
      next.affectedCheckIds = [
        ...new Set([...(r.affectedCheckIds ?? []), ...changed]),
      ];
    }
    if (cmd.action === "makeReady") {
      requireState(r, ["refining", "active"]);
      next.source = cmd.source as Requirement["source"];
      if (
        !next.description ||
        !next.criteria.length ||
        !next.criteria.some((c) => c.required)
      )
        throw new DomainError(
          422,
          "Description and required criteria are required",
        );
      if (
        next.source.status === "checked"
          ? !next.source.checkedAt
          : next.source.status === "unable"
            ? !next.source.reason
            : true
      )
        throw new DomainError(422, "Source confirmation required");
      if (!createPolicy(db).canWrite(next.acceptorId, r.projectId, "product"))
        throw new DomainError(422, "Active product acceptor required");
      if (
        db
          .prepare(
            "SELECT 1 FROM execution_participations WHERE requirement_id=? AND member_id=?",
          )
          .get(id, next.acceptorId)
      )
        throw new DomainError(422, "Acceptor participated in execution");
      if (
        linkedTasks(db, id).some(
          (t) =>
            !["cancelled", "done"].includes(t.state) &&
            (typeof t.definitionOfDone !== "string" ||
              !t.definitionOfDone.trim()),
        )
      )
        throw new DomainError(422, "Task completion criteria required");
      next.scopeConfirmed = true;
      next.state = r.state === "active" ? "active" : "ready";
    }
    if (cmd.action === "start") {
      requireState(r, ["ready"]);
      if (!r.scopeConfirmed || r.blocked)
        throw new DomainError(422, "Scope not executable");
      next.state = "active";
    }
    if (cmd.action === "revise") {
      requireState(r, [
        "draft",
        "refining",
        "ready",
        "active",
        "pending_acceptance",
        "accepted",
      ]);
      if (cmd.kind === "editorial") {
        if (
          ["criteria", "acceptorId", "priority", "role"].some((k) => k in cmd)
        )
          throw new DomainError(
            422,
            "Editorial changes cannot change behavior",
          );
        for (const k of ["title", "description", "source"])
          if (k in cmd) (next as any)[k] = cmd[k];
      } else {
        if (cmd.impactConfirmed !== true)
          throw new DomainError(422, "Explicit impact confirmation required");
        const tasks = linkedTasks(db, id);
        const taskIds = cmd.affectedTaskIds as string[];
        const checkIds = cmd.affectedCheckIds as string[];
        const validChecks = new Set(
          [...r.criteria, ...((cmd.criteria as any[]) ?? [])].map((c) => c.id),
        );
        if (
          taskIds.some(
            (t) =>
              !tasks.some((x) => x.id === t && x.projectId === r.projectId),
          ) ||
          checkIds.some((c) => !validChecks.has(c))
        )
          throw new DomainError(
            422,
            "Impact must reference linked tasks and known criteria",
          );
        const newCriteria = (cmd.criteria as any[]) ?? r.criteria;
        const changes = r.criteria
          .filter(
            (c) =>
              JSON.stringify(c) !==
              JSON.stringify(newCriteria.find((n) => n.id === c.id)),
          )
          .map((c) => c.id)
          .concat(
            newCriteria
              .filter((c) => !r.criteria.some((old) => old.id === c.id))
              .map((c) => c.id),
          );
        if (changes.some((c) => !checkIds.includes(c)))
          throw new DomainError(422, "Changed criteria must be affected");
        for (const k of patch) if (k in cmd) (next as any)[k] = cmd[k];
        next.revision++;
        next.affectedCheckIds = checkIds;
        next.affectedTaskIds = taskIds;
        next.scopeConfirmed = false;
        next.evidenceReady = false;
        next.state = ["pending_acceptance", "accepted", "ready"].includes(
          r.state,
        )
          ? "refining"
          : r.state;
        for (const t of tasks.filter((t) => taskIds.includes(t.id)))
          writeDomainObject(
            db,
            ctx,
            t.id,
            {
              ...t,
              ...(t.state === "done" ? { state: "active" } : {}),
              pendingChange: {
                requirementId: id,
                revision: next.revision,
                reason: cmd.reason,
              },
            },
            "requirementImpact",
          );
        saveRevision(
          db,
          ctx,
          { ...next, version: r.version + 1 },
          String(cmd.reason),
          taskIds,
          checkIds,
        );
      }
    }
    if (cmd.action === "cancel") {
      requireState(r, [
        "draft",
        "refining",
        "ready",
        "active",
        "pending_acceptance",
      ]);
      const tasks = linkedTasks(db, id).filter(
        (t) => !["done", "cancelled"].includes(t.state),
      );
      const dispositions = cmd.taskDisposition as any[];
      if (
        dispositions.length !== tasks.length ||
        tasks.some((t) => !dispositions.some((d) => d.taskId === t.id)) ||
        dispositions.some((d) => !tasks.some((t) => t.id === d.taskId))
      )
        throw new DomainError(422, "Every unfinished task needs a disposition");
      for (const t of tasks) {
        const d = dispositions.find((d) => d.taskId === t.id);
        writeDomainObject(
          db,
          ctx,
          t.id,
          {
            ...t,
            ...(d.disposition === "cancel"
              ? { state: "cancelled", cancellationReason: cmd.reason }
              : { requirementId: null, detachmentReason: cmd.reason }),
          },
          "requirementCancel",
        );
      }
      next.state = "cancelled";
      next.evidenceReady = false;
      next.scopeConfirmed = false;
    }
    if (cmd.action === "restore") {
      requireState(r, ["cancelled"]);
      next.state = "refining";
      next.scopeConfirmed = false;
      next.evidenceReady = false;
    }
    writeDomainObject(
      db,
      ctx,
      id,
      {
        ...next,
        changeReason: cmd.reason ?? null,
        ...(cmd.action === "suggestChange"
          ? {
              sourceChangeSuggestion: {
                reason: cmd.reason,
                actorId: ctx.actorId,
              },
            }
          : {}),
      },
      cmd.action,
    );
    reconcileRequirement(db, ctx, id);
    const result = getRequirement(db, id);
    return result;
  });
}

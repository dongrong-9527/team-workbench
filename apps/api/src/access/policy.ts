import type { Database } from "better-sqlite3";
import type {
  Role,
  Ref,
  ProjectRef,
  Action,
} from "../../../../packages/contracts/src/index.js";
import { DomainError } from "../db/mutate.js";
export function createPolicy(db: Database) {
  const member = (id: string) => {
    const m = db
      .prepare("SELECT active,is_admin FROM members WHERE id=?")
      .get(id) as { active: number; is_admin: number } | undefined;
    if (!m?.active) throw new DomainError(403, "Permission denied");
    return m;
  };
  const project = (id: string) => {
    const p = db.prepare("SELECT archived FROM projects WHERE id=?").get(id) as
      | { archived: number }
      | undefined;
    if (!p) throw new DomainError(404, "Project not found");
    return p;
  };
  const roles = (id: string, p: string) =>
    db
      .prepare("SELECT role,lead FROM roles WHERE member_id=? AND project_id=?")
      .all(id, p) as { role: Role; lead: number }[];
  function authorize(
    actorId: string,
    action: Action,
    target: Ref | ProjectRef,
  ): void {
    const m = member(actorId);
    let projectId = target.id;
    let current: Record<string, unknown> = {};
    if (target.kind !== "project") {
      const o = db
        .prepare("SELECT project_id,current FROM objects WHERE id=? AND kind=?")
        .get(target.id, target.kind) as
        | { project_id: string; current: string }
        | undefined;
      if (!o) throw new DomainError(404, "Object not found");
      projectId = o.project_id;
      current = JSON.parse(o.current);
    }
    const scope =
      target.kind === "task" &&
      ["frontend", "backend", "test"].includes(String(current.kind))
        ? current.kind
        : current.role;
    const p = project(projectId);
    // Reports are derived personal artifacts; archived business data remains readable.
    if (
      action === "read" ||
      (action === "manageReport" && target.kind === "project")
    )
      return;
    if (p.archived) throw new DomainError(409, "ARCHIVED");
    const rs = roles(actorId, projectId),
      has = (r: unknown) => rs.some((x) => x.role === r),
      lead = (r: unknown) => rs.some((x) => x.role === r && x.lead === 1);
    let allowed = false;
    switch (action) {
      case "attach":
        allowed = target.kind !== "project" && rs.length > 0;
        break;
      case "manageMembers":
      case "manageProject":
        allowed = !!m.is_admin;
        break;
      case "refine":
      case "assign":
        allowed = has("product") || (target.kind !== "project" && lead(scope));
        break;
      case "claim":
        allowed =
          (target.kind === "task" || target.kind === "bug") && has(scope);
        break;
      case "execute":
        allowed =
          (target.kind === "task" || target.kind === "bug") &&
          current.ownerId === actorId &&
          has(scope);
        break;
      case "test":
        allowed = has("test");
        break;
      case "accept":
        allowed =
          target.kind === "requirement" &&
          has("product") &&
          current.acceptorId === actorId;
        break;
      case "writeUpdate":
        allowed =
          rs.length > 0 &&
          target.kind !== "project" &&
          (current.authorId === actorId ||
            (Array.isArray(current.participantIds) &&
              current.participantIds.includes(actorId)));
        break;
      case "manageReport":
        allowed = target.kind === "project" || current.creatorId === actorId;
        break;
    }
    if (!allowed) throw new DomainError(403, "Permission denied");
  }
  function canWrite(actorId: string, projectId: string, role: Role): boolean {
    try {
      return (
        !!member(actorId) &&
        !project(projectId).archived &&
        roles(actorId, projectId).some((x) => x.role === role)
      );
    } catch (error) {
      if (error instanceof DomainError) return false;
      throw error;
    }
  }
  return { authorize, canWrite };
}

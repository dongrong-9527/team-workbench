import { auditPage } from "./evidence.js";
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { requireRequest, fields, text } from "../auth/guards.js";
import { getProject } from "../projects/service.js";
import { directory, objectsPage, parseQuery } from "./query.js";
export function workbenchRoutes(app: FastifyInstance, db: Database) {
  app.get<{ Params: { kind: string; id: string } }>(
    "/api/audit/:kind/:id",
    (r) => {
      requireRequest(db, r);
      return auditPage(
        db,
        r.params.kind,
        r.params.id,
        r.query as Record<string, unknown>,
      );
    },
  );
  app.get("/api/members", (r) => {
    const actor = requireRequest(db, r);
    fields(r.query, [], ["limit", "cursor", "active", "projectId"]);
    return directory(db, parseQuery(r.query, ["active"]), actor.id);
  });
  app.get("/api/my-work", (r) => {
    const actor = requireRequest(db, r);
    return objectsPage(db, parseQuery(r.query), actor.id, "mine");
  });
  app.get("/api/search", (r) => {
    const actor = requireRequest(db, r);
    const q = parseQuery(r.query, ["q"]);
    text(q.q, 1, 200);
    return objectsPage(db, q, actor.id, "search");
  });
  app.get("/api/objects", (r) => {
    const actor = requireRequest(db, r);
    return objectsPage(db, parseQuery(r.query), actor.id);
  });
  app.get<{ Params: { id: string } }>("/api/projects/:id/overview", (r) => {
    const actor = requireRequest(db, r);
    fields(r.query, []);
    const project = getProject(db, r.params.id);
    return {
      project,
      myRoles: db
        .prepare(
          "SELECT role,lead FROM roles WHERE project_id=? AND member_id=? ORDER BY role",
        )
        .all(project.id, actor.id),
      counts: db
        .prepare(
          "SELECT kind,json_extract(current,'$.state') AS state,COUNT(*) AS count FROM objects WHERE project_id=? GROUP BY kind,state ORDER BY kind,state",
        )
        .all(project.id),
      attention: db
        .prepare(
          "SELECT SUM(CASE WHEN json_extract(current,'$.blocked')=1 THEN 1 ELSE 0 END) AS blocked,SUM(CASE WHEN kind IN ('task','bug') AND json_extract(current,'$.ownerId') IS NULL THEN 1 ELSE 0 END) AS unassigned FROM objects WHERE project_id=?",
        )
        .get(project.id),
    };
  });
}

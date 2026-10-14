import { BUSINESS_BODY_LIMIT } from "../../../../packages/contracts/src/input-limits.js";
import { projectsPage, parseQuery } from "../workbench/query.js";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import type { Role } from "../../../../packages/contracts/src/index.js";
import {
  fields,
  text,
  narrative,
  requireRequest,
  mutationContext,
} from "../auth/guards.js";
import { DomainError } from "../db/mutate.js";
import { createPolicy } from "../access/policy.js";
import {
  getProject,
  createProject,
  changeProject,
  renameProject,
  editProject,
} from "./service.js";
const allowed: Role[] = ["product", "frontend", "backend", "test"];
function roleList(value: unknown): Role[] {
  if (
    !Array.isArray(value) ||
    value.some((r) => !allowed.includes(r)) ||
    new Set(value).size !== value.length
  )
    throw new DomainError(400, "Invalid roles");
  return value as Role[];
}
export function projectRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/projects", (request) => {
    const actor = requireRequest(db, request);
    fields(request.query, [], ["limit", "cursor", "archived"]);
    return projectsPage(db, parseQuery(request.query, ["archived"]), actor.id);
  });
  app.get<{ Params: { id: string } }>("/api/projects/:id", (request) => {
    const actor = requireRequest(db, request);
    createPolicy(db).authorize(actor.id, "read", {
      kind: "project",
      id: request.params.id,
    });
    return getProject(db, request.params.id);
  });
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/rename",
    (request) => {
      const b = fields(request.body, ["expectedVersion", "name"]);
      return renameProject(
        db,
        mutationContext(db, request, true),
        text(request.params.id, 1, 128),
        text(b.name, 1, 120),
      );
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/edit", { bodyLimit: BUSINESS_BODY_LIMIT }, (request) => {
      const ctx = mutationContext(db, request, true);
      const b = fields(request.body, ["expectedVersion", "name", "description"]);
      return editProject(db, ctx, text(request.params.id, 1, 128),
        text(b.name, 1, 120), narrative(b.description, 0, 2000));
    },
  );
  app.post("/api/projects", { bodyLimit: BUSINESS_BODY_LIMIT }, (request) => {
    const ctx = mutationContext(db, request, true);
    const b = fields(request.body, ["name"], ["description"]);
    return createProject(
      db,
      ctx,
      text(b.name, 1, 120),
      b.description === undefined ? "" : narrative(b.description, 0, 2000),
    );
  });
  for (const action of ["archive", "restore"] as const)
    app.post<{ Params: { id: string } }>(
      `/api/projects/:id/${action}`,
      (request) => {
        const ctx = mutationContext(db, request, true);
        fields(request.body, ["expectedVersion"]);
        return changeProject(db, ctx, request.params.id, action);
      },
    );
  app.put<{ Params: { id: string } }>("/api/projects/:id/roles", (request) => {
    const ctx = mutationContext(db, request, true);
    const b = fields(request.body, [
      "memberId",
      "roles",
      "leads",
      "expectedVersion",
    ]);
    const roles = roleList(b.roles),
      leads = roleList(b.leads);
    if (leads.some((r) => !roles.includes(r)))
      throw new DomainError(400, "Leads must have corresponding roles");
    return changeProject(db, ctx, request.params.id, "roles", {
      memberId: text(b.memberId, 1, 128),
      roles,
      leads,
    });
  });
}

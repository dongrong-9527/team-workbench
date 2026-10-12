import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { fields, loginName, mutationContext, text } from "../auth/guards.js";
import { createMember, manageMember } from "./service.js";

export function memberRoutes(app: FastifyInstance, db: Database): void {
  app.post("/api/members", (request) => {
    const body = fields(request.body, ["login", "displayName"]);
    return createMember(
      db,
      mutationContext(db, request, true),
      loginName(body.login),
      text(body.displayName, 1, 100),
    );
  });
  for (const action of ["deactivate", "reset"] as const) {
    app.post<{ Params: { id: string } }>(
      `/api/members/:id/${action}`,
      (request) => {
        fields(request.body, ["expectedVersion"]);
        return manageMember(
          db,
          mutationContext(db, request, true),
          text(request.params.id, 1, 128),
          action,
        );
      },
    );
  }
}

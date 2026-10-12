import { BUSINESS_BODY_LIMIT } from "../../../../packages/contracts/src/input-limits.js";
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { mutationContext, requireRequest } from "../auth/guards.js";
import { pageInput } from "../history/query.js";
import { saveUpdate, validateUpdate, ownUpdates } from "./service.js";
export function updateRoutes(
  app: FastifyInstance,
  db: Database,
  clock?: () => Date,
) {
  app.post("/api/updates", { bodyLimit: BUSINESS_BODY_LIMIT }, (request) =>
    saveUpdate(
      db,
      mutationContext(db, request),
      validateUpdate(request.body),
      clock,
    ),
  );
  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/updates",
    (request) => {
      const actor = requireRequest(db, request);
      return ownUpdates(db, actor.id, pageInput(db, request.query));
    },
  );
}

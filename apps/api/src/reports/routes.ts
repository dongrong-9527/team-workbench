import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import {
  fields,
  mutationContext,
  requireRequest,
  text,
} from "../auth/guards.js";
import { validateReport } from "./sources.js";
import {
  editReport,
  generateReport,
  getReport,
  reportPage,
  sourceChanges,
  sourcePage,
} from "./service.js";
export function reportRoutes(
  app: FastifyInstance,
  db: Database,
  clock?: () => Date,
) {
  app.post("/api/reports", (request) =>
    generateReport(
      db,
      mutationContext(db, request),
      validateReport(request.body),
      clock,
    ),
  );
  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/reports",
    (request) => {
      requireRequest(db, request);
      return reportPage(db, request.query);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/reports/:id/versions",
    { bodyLimit: 1024 * 1024 },
    (request) => {
      const ctx = mutationContext(db, request),
        b = fields(request.body, ["text", "expectedVersion"]);
      return editReport(
        db,
        ctx,
        text(request.params.id, 1, 128),
        b.text as string,
        clock,
      );
    },
  );
  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>(
    "/api/reports/:id",
    (request) => {
      requireRequest(db, request);
      fields(request.query, []);
      return getReport(db, text(request.params.id, 1, 128));
    },
  );
  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>(
    "/api/reports/:id/versions",
    (request) => {
      requireRequest(db, request);
      return reportPage(db, request.query, text(request.params.id, 1, 128));
    },
  );
  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>(
    "/api/reports/:id/sources",
    (request) => {
      requireRequest(db, request);
      return sourcePage(db, text(request.params.id, 1, 128), request.query);
    },
  );
  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>(
    "/api/reports/:id/source-changes",
    (request) => {
      requireRequest(db, request);
      fields(request.query, []);
      return sourceChanges(db, text(request.params.id, 1, 128), clock);
    },
  );
}

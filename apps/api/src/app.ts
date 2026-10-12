import { updateRoutes } from "./updates/routes.js";
import { historyRoutes } from "./history/routes.js";
import { acceptanceRoutes } from "./acceptance/routes.js";
import { AcceptanceError } from "./acceptance/service.js";
import { bugRoutes } from "./bugs/routes.js";
import { testingRoutes } from "./testing/routes.js";
import { taskRoutes } from "./tasks/routes.js";
import { requirementRoutes } from "./requirements/routes.js";
import { projectRoutes } from "./projects/routes.js";
import Fastify, { type FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { DomainError } from "./db/mutate.js";
import { authRoutes } from "./auth/routes.js";
import { memberRoutes } from "./members/routes.js";
import { checkOrigin } from "./auth/guards.js";

export function buildApp(
  db: Database,
  options: { origin?: string; clock?: () => Date } = {},
): FastifyInstance {
  const origin =
    options.origin ?? process.env.APP_ORIGIN ?? "https://localhost";
  const parsed = new URL(origin);
  if (
    parsed.origin !== origin ||
    !["https:", "http:"].includes(parsed.protocol)
  )
    throw new Error("Invalid APP_ORIGIN");
  const app = Fastify({ bodyLimit: 16 * 1024, logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError)
      return reply.code(error.statusCode).send({
        error: error.message,
        ...(error instanceof AcceptanceError ? { reasons: error.reasons } : {}),
        ...(error.latest !== undefined ? { latest: error.latest } : {}),
      });
    if ((error as { code?: string }).code?.startsWith("SQLITE_BUSY"))
      return reply.code(503).send({ error: "Database busy; retry later" });
    const status = (error as { statusCode?: number }).statusCode;
    return reply
      .code(status && status >= 400 && status < 500 ? status : 500)
      .send({
        error:
          status && status < 500 ? "Invalid request" : "Internal server error",
      });
  });
  app.addHook("onRequest", async (request, reply) => {
    const apiRoute = request.routeOptions.url?.startsWith("/api/") ?? false;
    if (apiRoute) reply.header("cache-control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      (apiRoute || request.routeOptions.url === "/test/mutation")
    )
      checkOrigin(request, origin);
  });
  app.get("/health", () => {
    db.prepare("SELECT 1").get();
    return { status: "ok" };
  });
  authRoutes(app, db);
  memberRoutes(app, db);
  projectRoutes(app, db);
  requirementRoutes(app, db);
  taskRoutes(app, db);
  bugRoutes(app, db);
  testingRoutes(app, db);
  acceptanceRoutes(app, db);
  updateRoutes(app, db, options.clock);
  historyRoutes(app, db);
  return app;
}

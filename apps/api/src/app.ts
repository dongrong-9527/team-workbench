import Fastify, { type FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { DomainError } from "./db/mutate.js";
import { authRoutes } from "./auth/routes.js";
import { memberRoutes } from "./members/routes.js";
import { checkOrigin } from "./auth/guards.js";

export function buildApp(
  db: Database,
  options: { origin?: string } = {},
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
      return reply
        .code(error.statusCode)
        .send({
          error: error.message,
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
    if (request.url.startsWith("/api/"))
      reply.header("cache-control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      (request.url.startsWith("/api/") ||
        request.routeOptions.url === "/test/mutation")
    )
      checkOrigin(request, origin);
  });
  app.get("/health", () => {
    db.prepare("SELECT 1").get();
    return { status: "ok" };
  });
  authRoutes(app, db);
  memberRoutes(app, db);
  return app;
}

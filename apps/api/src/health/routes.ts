import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { readdirSync } from "node:fs";
import { requireRequest } from "../auth/guards.js";
import { DomainError, mutationMeasurements } from "../db/mutate.js";
export function schemaReady(db: Database): boolean {
  const expected = readdirSync(new URL("../../migrations/", import.meta.url))
    .filter((n) => /^\d{3}_[a-z_]+\.sql$/.test(n))
    .map((n) => Number(n.slice(0, 3)))
    .sort((a, b) => a - b);
  const actual = (
    db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as { version: number }[]
  ).map((r) => r.version);
  return (
    expected.length > 0 && JSON.stringify(expected) === JSON.stringify(actual)
  );
}
export function healthRoutes(
  app: FastifyInstance,
  db: Database,
  storageReady: () => Promise<void>,
) {
  app.get("/api/health/live", () => ({ status: "ok" }));
  app.get("/api/health/ready", async (_request, reply) => {
    try {
      if (!schemaReady(db)) throw Error("Schema");
      db.prepare("SELECT 1 FROM members LIMIT 1").get();
      await storageReady();
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
  app.get("/api/admin/runtime", (request) => {
    if (!requireRequest(db, request).isAdmin)
      throw new DomainError(403, "Permission denied");
    return {
      mutations: mutationMeasurements(),
      maxRssBytes: process.resourceUsage().maxRSS * 1024,
      version: process.env.RELEASE_VERSION ?? "development",
      nodeVersion: process.versions.node,
      nodeABI: process.versions.modules,
      arch: process.arch,
      platform: process.platform,
      sqliteVersion: (
        db.prepare("SELECT sqlite_version() v").get() as { v: string }
      ).v,
      schemaVersion: (
        db.prepare("SELECT max(version) v FROM schema_migrations").get() as {
          v: number;
        }
      ).v,
    };
  });
}

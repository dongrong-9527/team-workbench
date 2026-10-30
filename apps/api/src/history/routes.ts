import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { Ref } from "../../../../packages/contracts/src/index.js";
import { fields, text, requireRequest } from "../auth/guards.js";
import { createPolicy } from "../access/policy.js";
import { DomainError } from "../db/mutate.js";
import { historyPage, pageInput } from "./query.js";
export function parseRef(input: unknown): Ref {
  const t = fields(input, ["kind", "id"]);
  if (!["requirement", "task", "bug"].includes(String(t.kind)))
    throw new DomainError(400, "Invalid target");
  return { kind: t.kind as Ref["kind"], id: text(t.id, 1, 128) };
}
export function historyRoutes(app: FastifyInstance, db: Database) {
  app.get<{
    Params: { kind: string; id: string };
    Querystring: Record<string, unknown>;
  }>("/api/objects/:kind/:id/history", (request) => {
    const actor = requireRequest(db, request),
      target = parseRef(request.params);
    createPolicy(db).authorize(actor.id, "read", target);
    return historyPage(db, target, pageInput(db, request.query));
  });
}

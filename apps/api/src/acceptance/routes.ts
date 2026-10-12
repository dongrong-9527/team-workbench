import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import {
  fields,
  text,
  mutationContext,
  requireRequest,
} from "../auth/guards.js";
import { DomainError } from "../db/mutate.js";
import { getRequirement } from "../requirements/service.js";
import {
  submitAcceptance,
  acceptRequirement,
  waiveBug,
  acceptanceRecords,
} from "./service.js";
function scope(b: any) {
  if (!Number.isSafeInteger(b.revision) || b.revision < 1)
    throw new DomainError(400, "Invalid revision");
  text(b.targetVersion, 1, 200);
}
export function acceptanceRoutes(app: FastifyInstance, db: Database) {
  app.post("/api/requirements/:id/submit-acceptance", (request) => {
    const ctx = mutationContext(db, request),
      b: any = fields(request.body, [
        "expectedVersion",
        "revision",
        "targetVersion",
      ]);
    scope(b);
    return submitAcceptance(db, ctx, (request.params as any).id, b);
  });
  app.post("/api/requirements/:id/acceptance", (request) => {
    const ctx = mutationContext(db, request),
      b: any = fields(
        request.body,
        [
          "expectedVersion",
          "decision",
          "revision",
          "targetVersion",
          "criteria",
        ],
        ["reason", "reworkTaskIds", "bugIds"],
      );
    scope(b);
    if (
      !["pass", "return"].includes(b.decision) ||
      !Array.isArray(b.criteria) ||
      !b.criteria.length ||
      b.criteria.length > 100
    )
      throw new DomainError(400, "Invalid decision");
    for (const x of b.criteria) {
      fields(x, ["id", "passed"], ["note"]);
      text(x.id, 1, 128);
      if (typeof x.passed !== "boolean")
        throw new DomainError(400, "Invalid criterion");
      if (x.note !== undefined) text(x.note, 1, 4000);
    }
    if (b.reason !== undefined) text(b.reason, 1, 4000);
    for (const k of ["reworkTaskIds", "bugIds"])
      if (b[k] !== undefined) {
        if (
          !Array.isArray(b[k]) ||
          b[k].length > 100 ||
          new Set(b[k]).size !== b[k].length
        )
          throw new DomainError(400, "Invalid rework");
        for (const id of b[k]) text(id, 1, 128);
      }
    const { expectedVersion, ...input } = b;
    return acceptRequirement(db, ctx, (request.params as any).id, input);
  });
  app.post("/api/requirements/:id/bug-waivers", (request) => {
    const ctx = mutationContext(db, request),
      b: any = fields(request.body, [
        "expectedVersion",
        "bugId",
        "reason",
        "followUpOwnerId",
        "plan",
      ]);
    for (const k of ["bugId", "reason", "followUpOwnerId", "plan"])
      text(b[k], 1, k.endsWith("Id") ? 128 : 4000);
    const { expectedVersion, ...input } = b;
    return waiveBug(db, ctx, (request.params as any).id, input);
  });
  app.get("/api/requirements/:id/acceptance", (request) => {
    requireRequest(db, request);
    const id = (request.params as any).id;
    getRequirement(db, id);
    return acceptanceRecords(db, id);
  });
}

import { BUSINESS_BODY_LIMIT } from "../../../../packages/contracts/src/input-limits.js";
import { evidencePage } from "../workbench/evidence.js";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import {
  fields,
  text,
  narrative,
  mutationContext,
  requireRequest,
} from "../auth/guards.js";
import { DomainError } from "../db/mutate.js";
import { getRequirement } from "../requirements/service.js";
import { createPolicy } from "../access/policy.js";
import { acceptanceReadiness } from "./readiness.js";
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
  app.get("/api/requirements/:id/acceptance-readiness", (request) => {
    const member = requireRequest(db, request);
    const id = (request.params as any).id;
    const query = fields(request.query, [], ["targetVersion"]);
    if (query.targetVersion !== undefined) text(query.targetVersion, 0, 200);
    // One SQLite snapshot binds the requirement version, evidence and policies.
    return db
      .transaction(() => {
        createPolicy(db).authorize(member.id, "read", {
          kind: "requirement",
          id,
        });
        return acceptanceReadiness(
          db,
          id,
          query.targetVersion as string | undefined,
        );
      })
      .deferred();
  });
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
  app.post(
    "/api/requirements/:id/acceptance",
    { bodyLimit: BUSINESS_BODY_LIMIT },
    (request) => {
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
        if (x.note !== undefined) narrative(x.note, 1, 4000);
      }
      if (b.reason !== undefined) narrative(b.reason, 1, 4000);
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
    },
  );
  app.post(
    "/api/requirements/:id/bug-waivers",
    { bodyLimit: BUSINESS_BODY_LIMIT },
    (request) => {
      const ctx = mutationContext(db, request),
        b: any = fields(request.body, [
          "expectedVersion",
          "bugId",
          "reason",
          "followUpOwnerId",
          "plan",
        ]);
      for (const k of ["bugId", "reason", "followUpOwnerId", "plan"])
        (k.endsWith("Id") ? text : narrative)(
          b[k],
          1,
          k.endsWith("Id") ? 128 : 4000,
        );
      const { expectedVersion, ...input } = b;
      return waiveBug(db, ctx, (request.params as any).id, input);
    },
  );
  app.get("/api/requirements/:id/acceptance", (request) => {
    requireRequest(db, request);
    const id = (request.params as any).id;
    getRequirement(db, id);
    const q = fields(request.query, [], ["limit", "afterSeq", "cutoffSeq"]);
    const p = evidencePage(db, "acceptance_records", q, "requirement_id=?", [
      id,
    ]);
    return Object.keys(q).length ? p : p.items;
  });
}

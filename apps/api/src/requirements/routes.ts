import { BUSINESS_BODY_LIMIT } from "../../../../packages/contracts/src/input-limits.js";
import { pageInput } from "../history/query.js";
import { objectsPage, parseQuery } from "../workbench/query.js";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
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
  createRequirement,
  changeRequirement,
  getRequirement,
} from "./service.js";
import { getRevisions, scopeActorName } from "./revisions.js";
function source(value: unknown) {
  const b = fields(
    value,
    [],
    ["url", "description", "status", "checkedAt", "reason"],
  );
  if (!b.url && !b.description) throw new DomainError(400, "Source required");
  if ("url" in b) text(b.url, 1, 2000);
  for (const k of ["description", "reason"])
    if (k in b) narrative(b[k], 1, 2000);
  if (b.url) {
    try {
      const u = new URL(String(b.url));
      if (!["https:", "http:"].includes(u.protocol)) throw 0;
    } catch {
      throw new DomainError(400, "Invalid source URL");
    }
  }
  if (
    b.status !== undefined &&
    !["checked", "unable"].includes(String(b.status))
  )
    throw new DomainError(400, "Invalid source status");
  if (
    b.checkedAt !== undefined &&
    (typeof b.checkedAt !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(b.checkedAt) ||
      !Number.isFinite(Date.parse(b.checkedAt)))
  )
    throw new DomainError(400, "Invalid checkedAt");
  return b;
}
function validate(b: Record<string, unknown>) {
  for (const k of ["title", "acceptorId", "role"])
    if (k in b) text(b[k], 1, k === "title" ? 200 : 128);
  if ("role" in b && !["frontend", "backend", "test"].includes(String(b.role)))
    throw new DomainError(400, "Invalid role");
  if ("description" in b) narrative(b.description, 0, 6000);
  if (
    "priority" in b &&
    !["high", "medium", "low"].includes(String(b.priority))
  )
    throw new DomainError(400, "Invalid priority");
  if ("source" in b) source(b.source);
  if ("criteria" in b) {
    if (!Array.isArray(b.criteria) || b.criteria.length > 100)
      throw new DomainError(400, "Invalid criteria");
    const ids = new Set();
    for (const c of b.criteria) {
      const p = fields(c, ["id", "text"], ["required", "exclusionReason"]);
      if (p.required === undefined) c.required = true;
      if (p.required === false) narrative(p.exclusionReason, 1, 2000);
      text(p.id, 1, 128);
      narrative(p.text, 1, 2000);
      if (typeof c.required !== "boolean" || ids.has(p.id))
        throw new DomainError(400, "Invalid criteria");
      ids.add(p.id);
    }
  }
}
export function requirementRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/requirements", (request) => {
    const actor = requireRequest(db, request);
    const q = parseQuery(request.query);
    if (q.kind && q.kind !== "requirement")
      throw new DomainError(400, "Conflicting kind");
    return objectsPage(
      db,
      { ...q, kind: "requirement" },
      actor.id,
      "requirements",
    );
  });
  for (const suffix of ["", "/revisions"])
    app.get<{ Params: { id: string } }>(
      `/api/requirements/:id${suffix}`,
      (request) => {
        const actor = requireRequest(db, request);
        createPolicy(db).authorize(actor.id, "read", {
          kind: "requirement",
          id: request.params.id,
        });
        if (!suffix) {
          fields(request.query, []);
          return getRequirement(db, request.params.id);
        }
        const q = fields(request.query, [], ["limit", "afterSeq"]);
        const paging = pageInput(db, { ...q, limit: q.limit ?? "20" });
        return getRevisions(
          db,
          request.params.id,
          paging.afterSeq,
          paging.limit,
        );
      },
    );
  app.get<{ Params: { id: string } }>(
    "/api/requirements/:id/revision-history",
    (request) => {
      requireRequest(db, request);
      getRequirement(db, request.params.id);
      const q = fields(request.query, [], ["limit", "afterSeq", "cutoffSeq"]);
      const max = (
        db
          .prepare(
            "SELECT COALESCE(MAX(version),0) AS n FROM requirement_scopes WHERE requirement_id=?",
          )
          .get(request.params.id) as any
      ).n;
      const p = pageInput(db, {
        ...q,
        limit: q.limit ?? "20",
        cutoffSeq: q.cutoffSeq ?? String(max),
      });
      const rows = db
        .prepare(
          "SELECT s.*,r.reason,r.affected_task_ids,r.affected_check_ids FROM requirement_scopes s JOIN requirement_revisions r ON r.requirement_id=s.requirement_id AND r.revision=s.revision WHERE s.requirement_id=? AND s.version>? AND s.version<=? ORDER BY s.version LIMIT ?",
        )
        .all(request.params.id, p.afterSeq, p.cutoffSeq, p.limit + 1) as any[];
      return {
        items: rows.slice(0, p.limit).map((r) => ({
          revision: r.revision,
          version: r.version,
          snapshot: JSON.parse(r.snapshot),
          actorId: r.actor_id,
          actorName: scopeActorName(
            db,
            request.params.id,
            r.version,
            r.actor_id,
          ),
          time: r.time,
          reason: r.reason,
          affectedTaskIds: JSON.parse(r.affected_task_ids),
          affectedCheckIds: JSON.parse(r.affected_check_ids),
        })),
        cutoffSeq: p.cutoffSeq,
        nextAfterSeq: rows.length > p.limit ? rows[p.limit - 1].version : null,
      };
    },
  );
  app.post(
    "/api/requirements",
    { bodyLimit: BUSINESS_BODY_LIMIT },
    (request) => {
      const ctx = mutationContext(db, request);
      const b = fields(
        request.body,
        ["projectId", "title", "source", "description", "criteria", "priority"],
        ["role", "acceptorId"],
      );
      text(b.projectId, 1, 128);
      validate(b);
      return createRequirement(db, ctx, b as any);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/requirements/:id/actions",
    { bodyLimit: BUSINESS_BODY_LIMIT },
    (request) => {
      const ctx = mutationContext(db, request);
      const raw = request.body as any;
      const options: Record<string, string[]> = {
        suggestChange: ["reason"],
        refine: [
          "title",
          "source",
          "description",
          "acceptorId",
          "criteria",
          "priority",
          "role",
        ],
        makeReady: ["source"],
        start: ["reason"],
        revise: [
          "kind",
          "reason",
          "affectedTaskIds",
          "affectedCheckIds",
          "impactConfirmed",
          "title",
          "source",
          "description",
          "acceptorId",
          "criteria",
          "priority",
          "role",
        ],
        cancel: ["reason", "taskDisposition"],
        restore: ["reason"],
      };
      if (!raw || !Object.hasOwn(options, raw.action))
        throw new DomainError(400, "Invalid action");
      const b = fields(raw, ["action", "expectedVersion"], options[raw.action]);
      validate(b);
      if (
        ["suggestChange", "start", "revise", "cancel", "restore"].includes(
          String(b.action),
        )
      )
        narrative(b.reason, 1, 2000);
      if (b.action === "makeReady" && !b.source)
        throw new DomainError(400, "Source required");
      if (b.action === "revise") {
        if (!["editorial", "behavior"].includes(String(b.kind)))
          throw new DomainError(400, "Invalid revision kind");
        if (b.kind === "behavior")
          for (const k of ["affectedTaskIds", "affectedCheckIds"])
            if (
              !Array.isArray(b[k]) ||
              (b[k] as unknown[]).some(
                (x) => typeof x !== "string" || !x.length,
              ) ||
              new Set(b[k] as string[]).size !== (b[k] as any[]).length
            )
              throw new DomainError(400, "Invalid impact");
      }
      if (b.action === "cancel") {
        if (!Array.isArray(b.taskDisposition))
          throw new DomainError(400, "Invalid disposition");
        const ids = new Set();
        for (const d of b.taskDisposition) {
          const p = fields(d, ["taskId", "disposition"]);
          text(p.taskId, 1, 128);
          if (
            !["cancel", "detach"].includes(String(p.disposition)) ||
            ids.has(p.taskId)
          )
            throw new DomainError(400, "Invalid disposition");
          ids.add(p.taskId);
        }
      }
      return changeRequirement(db, ctx, request.params.id, b as any);
    },
  );
}

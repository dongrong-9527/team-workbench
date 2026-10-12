import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import {
  fields,
  text,
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
import { getRevisions } from "./revisions.js";
function source(value: unknown) {
  const b = fields(
    value,
    [],
    ["url", "description", "status", "checkedAt", "reason"],
  );
  if (!b.url && !b.description) throw new DomainError(400, "Source required");
  for (const k of ["url", "description", "reason"])
    if (k in b) text(b[k], 1, 2000);
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
  if ("description" in b) text(b.description, 0, 6000);
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
      const p = fields(c, ["id", "text", "required"]);
      text(p.id, 1, 128);
      text(p.text, 1, 2000);
      if (typeof p.required !== "boolean" || ids.has(p.id))
        throw new DomainError(400, "Invalid criteria");
      ids.add(p.id);
    }
  }
}
export function requirementRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/requirements", (request) => {
    requireRequest(db, request);
    return (
      db
        .prepare("SELECT id FROM objects WHERE kind='requirement' ORDER BY id")
        .all() as { id: string }[]
    ).map((r) => getRequirement(db, r.id));
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
        return suffix
          ? getRevisions(db, request.params.id)
          : getRequirement(db, request.params.id);
      },
    );
  app.post("/api/requirements", (request) => {
    const ctx = mutationContext(db, request);
    const b = fields(
      request.body,
      [
        "projectId",
        "title",
        "source",
        "description",
        "acceptorId",
        "criteria",
        "priority",
      ],
      ["role"],
    );
    text(b.projectId, 1, 128);
    validate(b);
    return createRequirement(db, ctx, b as any);
  });
  app.post<{ Params: { id: string } }>(
    "/api/requirements/:id/actions",
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
        text(b.reason, 1, 2000);
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

import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import {
  fields,
  text,
  mutationContext,
  requireRequest,
} from "../auth/guards.js";
import { DomainError } from "../db/mutate.js";
import { createTask, actTask, getTask } from "./service.js";
function validate(b: any) {
  for (const k of [
    "projectId",
    "title",
    "ownerId",
    "reviewerId",
    "role",
    "requirementId",
    "exclusionReason",
  ])
    if (b[k] != null) text(b[k], 1, k === "title" ? 200 : 2000);
  if ("definitionOfDone" in b) text(b.definitionOfDone, 0, 6000);
  if ("priority" in b && !["high", "medium", "low"].includes(b.priority))
    throw new DomainError(400, "Invalid priority");
  if ("kind" in b && !["frontend", "backend", "test", "other"].includes(b.kind))
    throw new DomainError(400, "Invalid kind");
  if ("role" in b && !["frontend", "backend", "test"].includes(b.role))
    throw new DomainError(400, "Invalid role");
  for (const k of ["required", "resetToPending"])
    if (k in b && typeof b[k] !== "boolean")
      throw new DomainError(400, "Invalid boolean");
}
export function taskRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/tasks", (request) => {
    requireRequest(db, request);
    return (
      db
        .prepare("SELECT id FROM objects WHERE kind='task' ORDER BY id")
        .all() as any[]
    ).map((o) => getTask(db, o.id));
  });
  app.get<{ Params: { id: string } }>("/api/tasks/:id", (request) => {
    requireRequest(db, request);
    return getTask(db, request.params.id);
  });
  app.post("/api/tasks", (request) => {
    const ctx = mutationContext(db, request);
    const b = fields(
      request.body,
      ["projectId", "title", "kind", "definitionOfDone", "priority"],
      [
        "requirementId",
        "role",
        "ownerId",
        "reviewerId",
        "required",
        "exclusionReason",
      ],
    );
    validate(b);
    return createTask(db, ctx, b);
  });
  const options: Record<string, string[]> = {
    claim: [],
    assign: ["ownerId", "reason", "handoff", "resetToPending"],
    transfer: ["ownerId", "reason", "handoff", "resetToPending"],
    requestTransfer: ["reason", "handoff"],
    start: [],
    submit: ["evidence"],
    checkPass: ["evidence"],
    checkFail: ["evidence"],
    reopen: ["reason", "resetToPending"],
    cancel: ["reason"],
    block: ["reason", "assistance"],
    unblock: ["reason"],
    setDependencies: ["dependencyIds"],
    approveParallel: ["reason"],
    designateReviewer: ["reviewerId"],
    setRequired: ["required", "reason"],
    refine: ["title", "definitionOfDone", "priority"],
  };
  app.post<{ Params: { id: string } }>("/api/tasks/:id/actions", (request) => {
    const ctx = mutationContext(db, request);
    const raw = request.body as any;
    if (!raw || !Object.hasOwn(options, raw.action))
      throw new DomainError(400, "Invalid action");
    const b = fields(raw, ["action", "expectedVersion"], options[raw.action]);
    validate(b);
    if (
      [
        "assign",
        "transfer",
        "requestTransfer",
        "reopen",
        "cancel",
        "block",
        "unblock",
        "approveParallel",
        "setRequired",
      ].includes(raw.action)
    )
      text(b.reason, 1, 2000);
    if (["assign", "transfer", "requestTransfer"].includes(raw.action))
      text(b.handoff, 1, 4000);
    if (raw.action === "block") text(b.assistance, 1, 2000);
    if (raw.action === "designateReviewer") text(b.reviewerId, 1, 128);
    if (raw.action === "setRequired" && typeof b.required !== "boolean")
      throw new DomainError(400, "required required");
    if (["assign", "transfer"].includes(raw.action) && !("ownerId" in b))
      throw new DomainError(400, "ownerId required");
    if (raw.action === "setDependencies") {
      if (
        !Array.isArray(b.dependencyIds) ||
        b.dependencyIds.length > 100 ||
        new Set(b.dependencyIds).size !== b.dependencyIds.length
      )
        throw new DomainError(400, "Invalid dependencies");
      for (const id of b.dependencyIds) text(id, 1, 128);
    }
    if (["submit", "checkPass", "checkFail"].includes(raw.action)) {
      const keys =
        raw.action === "submit"
          ? ["done", "selfCheck", "environment"]
          : ["result", "environment"];
      const e = fields(b.evidence, keys);
      for (const k of keys) text(e[k], 1, 4000);
    }
    return actTask(db, ctx, request.params.id, b as any);
  });
}

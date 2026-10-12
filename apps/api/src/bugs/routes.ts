import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import {
  fields,
  text,
  mutationContext,
  requireRequest,
} from "../auth/guards.js";
import { DomainError } from "../db/mutate.js";
import { actBug, createBug, getBug } from "./service.js";
import { parseTest, validateDefinitions } from "../testing/routes.js";
function validate(b: any) {
  for (const k of ["projectId", "title", "requirementId", "taskId", "ownerId"])
    if (b[k] != null) text(b[k], 1, k === "title" ? 200 : 128);
  for (const k of ["expected", "actual", "reproduction", "environment"])
    if (k in b) text(b[k], 0, 4000);
  if ("role" in b && !["frontend", "backend", "test"].includes(b.role))
    throw new DomainError(400, "Invalid role");
  if (
    "severity" in b &&
    !["blocker", "critical", "normal", "minor"].includes(b.severity)
  )
    throw new DomainError(400, "Invalid severity");
  if ("priority" in b && !["high", "medium", "low"].includes(b.priority))
    throw new DomainError(400, "Invalid priority");
}
export function bugRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/bugs", (request) => {
    requireRequest(db, request);
    return (
      db
        .prepare("SELECT id FROM objects WHERE kind='bug' ORDER BY id")
        .all() as any[]
    ).map((x) => getBug(db, x.id));
  });
  app.get<{ Params: { id: string } }>("/api/bugs/:id", (request) => {
    requireRequest(db, request);
    return getBug(db, request.params.id);
  });
  app.post("/api/bugs", (request) => {
    const ctx = mutationContext(db, request);
    const b = fields(
      request.body,
      [
        "projectId",
        "title",
        "role",
        "expected",
        "actual",
        "reproduction",
        "environment",
        "severity",
        "priority",
      ],
      ["requirementId", "taskId", "ownerId"],
    );
    validate(b);
    return createBug(db, ctx, b);
  });
  const options: Record<string, string[]> = {
    confirm: ["reason"],
    reject: ["reason", "explanation", "duplicateOfId"],
    claim: [],
    start: [],
    submit: ["evidence"],
    verifyPass: ["test"],
    verifyFail: ["test"],
    reopen: ["reason", "ownerId"],
    assign: ["ownerId", "reason", "handoff", "resetToReady"],
    transfer: ["ownerId", "reason", "handoff", "resetToReady"],
    block: ["reason", "assistance"],
    unblock: ["reason"],
    refine: [
      "title",
      "expected",
      "actual",
      "reproduction",
      "environment",
      "severity",
      "priority",
    ],
    defineChecks: ["checks"],
  };
  app.post<{ Params: { id: string } }>("/api/bugs/:id/actions", (request) => {
    const ctx = mutationContext(db, request),
      raw = request.body as any;
    if (!raw || !Object.hasOwn(options, raw.action))
      throw new DomainError(400, "Invalid action");
    const b: any = fields(
      raw,
      ["action", "expectedVersion"],
      options[raw.action],
    );
    validate(b);
    if (
      [
        "confirm",
        "reject",
        "reopen",
        "assign",
        "transfer",
        "block",
        "unblock",
      ].includes(b.action)
    )
      text(b.reason, 1, 2000);
    if (["assign", "transfer"].includes(b.action)) {
      if (!("ownerId" in b)) throw new DomainError(400, "ownerId required");
      text(b.handoff, 1, 4000);
    }
    if (b.action === "block") text(b.assistance, 1, 2000);
    if (b.resetToReady !== undefined && typeof b.resetToReady !== "boolean")
      throw new DomainError(400, "Invalid reset");
    if (b.action === "submit") {
      const e = fields(
        b.evidence,
        ["fix", "impact", "selfCheck", "environment"],
        ["targetVersion"],
      );
      for (const k of ["fix", "impact", "selfCheck", "environment"])
        text(e[k], 1, 4000);
      if (e.targetVersion !== undefined) text(e.targetVersion, 1, 200);
    }
    if (["verifyPass", "verifyFail"].includes(b.action))
      b.test = parseTest(b.test);
    if (b.action === "defineChecks") validateDefinitions(b.checks);
    return actBug(db, ctx, request.params.id, b as any);
  });
}

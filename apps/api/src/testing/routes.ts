import { evidencePage } from "../workbench/evidence.js";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import {
  fields,
  text,
  mutationContext,
  requireRequest,
} from "../auth/guards.js";
import { DomainError } from "../db/mutate.js";
import { recordTest } from "./service.js";
import { records, coverage, testTarget } from "./evidence.js";
import type { TestInput } from "../../../../packages/contracts/src/index.js";
export function parseTest(raw: any, withVersion = false): TestInput {
  const b: any = fields(
    raw,
    [
      "target",
      "targetVersion",
      "environment",
      "checks",
      ...(withVersion ? ["expectedVersion"] : []),
    ],
    ["revision", "reusedFromId", "reuseReason", "bugId"],
  );
  const target: any = fields(b.target, ["kind", "id"]);
  if (!["task", "requirement", "bug"].includes(target.kind))
    throw new DomainError(400, "Invalid target");
  text(target.id, 1, 128);
  text(b.targetVersion, 1, 200);
  text(b.environment, 1, 2000);
  if (
    b.revision !== undefined &&
    (!Number.isSafeInteger(b.revision) || b.revision < 1)
  )
    throw new DomainError(400, "Invalid revision");
  if (
    !Array.isArray(b.checks) ||
    !b.checks.length ||
    b.checks.length > 100 ||
    new Set(b.checks.map((c: any) => c.checkId)).size !== b.checks.length
  )
    throw new DomainError(400, "Invalid checks");
  for (const raw of b.checks) {
    const c: any = fields(raw, ["checkId", "result"], ["note"]);
    text(c.checkId, 1, 128);
    if (!["pass", "fail", "untested"].includes(c.result))
      throw new DomainError(400, "Invalid result");
    if (c.note !== undefined) text(c.note, 1, 4000);
  }
  for (const k of ["reusedFromId", "reuseReason", "bugId"])
    if (b[k] !== undefined) text(b[k], 1, k === "reuseReason" ? 4000 : 128);
  const { expectedVersion, ...input } = b;
  return input as TestInput;
}
export function validateDefinitions(raw: any) {
  if (
    !Array.isArray(raw) ||
    !raw.length ||
    raw.length > 100 ||
    new Set(raw.map((x) => x.id)).size !== raw.length
  )
    throw new DomainError(400, "Invalid check definitions");
  for (const x of raw) {
    fields(x, ["id", "text"], ["required", "exclusionReason"]);
    text(x.id, 1, 128);
    text(x.text, 1, 2000);
    if (x.required !== undefined && typeof x.required !== "boolean")
      throw new DomainError(400, "Invalid required");
    if (x.required === false) text(x.exclusionReason, 1, 2000);
    x.required = x.required ?? true;
  }
}
export function testingRoutes(app: FastifyInstance, db: Database) {
  app.post("/api/tests", (request) => {
    const ctx = mutationContext(db, request),
      input = parseTest(request.body, true);
    return recordTest(db, ctx, input);
  });
  app.get("/api/tests", (request) => {
    requireRequest(db, request);
    const q = fields(
      request.query,
      [],
      ["kind", "id", "limit", "afterSeq", "cutoffSeq"],
    );
    const { kind, id, ...paging } = q;
    if (id || kind) {
      if (!id || !["task", "requirement", "bug"].includes(String(kind)))
        throw new DomainError(400, "Invalid target");
      text(id, 1, 128);
      testTarget(db, { kind: kind as any, id: id as string });
    }
    const p = evidencePage(
      db,
      "test_records",
      paging,
      "(? IS NULL OR target_id=?) AND (? IS NULL OR target_kind=?)",
      [id ?? null, id ?? null, kind ?? null, kind ?? null],
    );
    return Object.keys(paging).length ? p : p.items;
  });
  app.get("/api/tests/coverage", (request) => {
    requireRequest(db, request);
    const q = request.query as any;
    if (
      !["task", "requirement", "bug"].includes(q.kind) ||
      !q.id ||
      !q.targetVersion
    )
      throw new DomainError(400, "Invalid coverage scope");
    const revision = q.revision === undefined ? undefined : Number(q.revision);
    if (
      revision !== undefined &&
      (!Number.isSafeInteger(revision) || revision < 1)
    )
      throw new DomainError(400, "Invalid revision");
    return coverage(db, { kind: q.kind, id: q.id }, revision, q.targetVersion);
  });
}

import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type {
  Ref,
  TestInput,
  TestRecord,
  CheckDefinition,
} from "../../../../packages/contracts/src/index.js";
import { DomainError, type MutationContext } from "../db/mutate.js";
import { getRequirement, writeDomainObject } from "../requirements/service.js";
export function testTarget(db: Database, target: Ref): any {
  const row = db
    .prepare("SELECT * FROM objects WHERE id=? AND kind=?")
    .get(target.id, target.kind) as any;
  if (!row) throw new DomainError(404, "Test target not found");
  return {
    ...JSON.parse(row.current),
    id: row.id,
    projectId: row.project_id,
    version: row.version,
  };
}
export function testRequirement(db: Database, target: Ref): any {
  const t = testTarget(db, target);
  return target.kind === "requirement"
    ? t
    : t.requirementId
      ? getRequirement(db, t.requirementId)
      : undefined;
}
export function checkDefinitions(db: Database, target: Ref): CheckDefinition[] {
  const t = testTarget(db, target);
  return target.kind === "requirement"
    ? t.criteria.map((c: any) => ({
        ...c,
        required: c.required !== false || !c.exclusionReason?.trim(),
      }))
    : (t.checks ?? [
        {
          id: target.kind === "bug" ? "reproduction" : "completion",
          text: target.kind === "bug" ? t.expected : t.definitionOfDone,
          required: true,
        },
      ]);
}
export function records(db: Database, target?: Ref): TestRecord[] {
  return (
    db
      .prepare(
        "SELECT record FROM test_records WHERE (? IS NULL OR target_id=?) AND (? IS NULL OR target_kind=?) ORDER BY recorded_seq",
      )
      .all(
        target?.id ?? null,
        target?.id ?? null,
        target?.kind ?? null,
        target?.kind ?? null,
      ) as any[]
  ).map((x) => JSON.parse(x.record));
}
export function coverage(
  db: Database,
  target: Ref,
  revision: number | undefined,
  targetVersion: string,
) {
  const definitions = checkDefinitions(db, target);
  const latest = new Map<string, any>();
  for (const r of records(db, target))
    if (r.revision === revision && r.targetVersion === targetVersion)
      for (const c of r.checks) {
        const source = (r.snapshot as any).checkDefinitions?.find(
            (d: any) => d.id === c.checkId,
          ),
          current = definitions.find((d) => d.id === c.checkId);
        latest.set(
          c.checkId,
          JSON.stringify(source) === JSON.stringify(current)
            ? { ...c, recordedSeq: r.recordedSeq, recordId: r.id }
            : {
                checkId: c.checkId,
                result: "untested",
                recordedSeq: r.recordedSeq,
                recordId: r.id,
              },
        );
      }
  const checks = checkDefinitions(db, target).map((c) => ({
    ...c,
    checkId: c.id,
    ...(latest.get(c.id) ?? { result: "untested" }),
  }));
  return {
    passed:
      checks.some((c) => c.required) &&
      checks.filter((c) => c.required).every((c) => c.result === "pass"),
    checks,
  };
}
export function reconcileTestRequirement(
  db: Database,
  ctx: MutationContext,
  requirementId: string | undefined,
): void {
  if (!db.inTransaction)
    throw new Error("Reconciliation requires mutation transaction");
  if (!requirementId) return;
  const r = getRequirement(db, requirementId);
  if (["pending_acceptance", "accepted"].includes(r.state))
    writeDomainObject(
      db,
      ctx,
      r.id,
      { ...r, state: "active", evidenceReady: false },
      "testRegression",
    );
}
export function validateTestInput(db: Database, input: TestInput): void {
  const t = testTarget(db, input.target),
    r = testRequirement(db, input.target);
  if (r && input.revision !== r.revision)
    throw new DomainError(422, "Current requirement revision required");
  if (!r && input.revision !== undefined)
    throw new DomainError(
      422,
      "Independent target has no requirement revision",
    );
  const defs = checkDefinitions(db, input.target);
  if (!defs.length) throw new DomainError(422, "Check definitions required");
  for (const c of input.checks)
    if (!defs.some((d) => d.id === c.checkId))
      throw new DomainError(422, "Unknown check");
  if (input.bugId) {
    const b = testTarget(db, { kind: "bug", id: input.bugId });
    if (b.projectId !== t.projectId)
      throw new DomainError(422, "Cross-project failure Bug");
  }
  if (input.reusedFromId) {
    if (!input.reuseReason?.trim())
      throw new DomainError(422, "Reuse reason required");
    const s = records(db).find((x) => x.id === input.reusedFromId);
    if (
      !s ||
      s.target.id !== input.target.id ||
      s.target.kind !== input.target.kind ||
      s.targetVersion !== input.targetVersion ||
      s.environment !== input.environment ||
      s.requirementId !== r?.id
    )
      throw new DomainError(422, "Invalid reuse source");
    if (
      s.revision !== undefined &&
      input.revision !== undefined &&
      s.revision > input.revision
    )
      throw new DomainError(422, "Future reuse source");
    for (const c of input.checks) {
      const latest = records(db, input.target)
        .filter(
          (x) =>
            x.revision === s.revision &&
            x.targetVersion === s.targetVersion &&
            x.checks.some((check) => check.checkId === c.checkId),
        )
        .at(-1);
      if (
        latest &&
        latest.recordedSeq > s.recordedSeq &&
        latest.checks.find((x) => x.checkId === c.checkId)?.result !== c.result
      )
        throw new DomainError(422, "Superseded source result");
      if (
        !s.checks.some(
          (x) =>
            x.checkId === c.checkId &&
            x.result === c.result &&
            x.result !== "untested",
        )
      )
        throw new DomainError(422, "Source check result required");
      if (r) {
        const scopes = db
          .prepare(
            "SELECT snapshot FROM requirement_scopes WHERE requirement_id=? AND version>? ORDER BY version",
          )
          .all(r.id, (s.snapshot as any).requirementVersion) as any[];
        for (const row of scopes) {
          const v = JSON.parse(row.snapshot);
          const priorCriterion = (s.snapshot as any).requirementCriteria?.find(
              (x: any) => x.id === c.checkId,
            ),
            scopeCriterion = v.criteria?.find((x: any) => x.id === c.checkId);
          if (
            priorCriterion &&
            JSON.stringify(priorCriterion) !== JSON.stringify(scopeCriterion)
          )
            throw new DomainError(
              422,
              "Changed criterion across scope history",
            );
          if (
            input.target.kind === "task" &&
            (v.affectedTaskIds ?? []).includes(input.target.id) &&
            (v.revision > (s.revision ?? 1) ||
              !(s.snapshot as any).affectedTaskIds?.includes(input.target.id))
          )
            throw new DomainError(422, "Impacted task cannot reuse evidence");
          if (
            (v.revision > (s.revision ?? 1) ||
              !(s.snapshot as any).affectedCheckIds?.includes(c.checkId)) &&
            v.revision <= r.revision &&
            (v.affectedCheckIds ?? []).includes(c.checkId)
          )
            throw new DomainError(422, "Impacted check cannot be reused");
        }
        const revisions = db
          .prepare(
            "SELECT affected_check_ids,affected_task_ids FROM requirement_revisions WHERE requirement_id=? AND revision>? AND revision<=?",
          )
          .all(r.id, s.revision ?? 0, r.revision) as any[];
        if (
          revisions.some(
            (v) =>
              JSON.parse(v.affected_check_ids).includes(c.checkId) ||
              (input.target.kind === "task" &&
                JSON.parse(v.affected_task_ids).includes(input.target.id)),
          )
        )
          throw new DomainError(422, "Impacted check cannot be reused");
      }
      const sourceDefinition = (s.snapshot as any).checkDefinitions?.find(
          (d: any) => d.id === c.checkId,
        ),
        currentDefinition = defs.find((d) => d.id === c.checkId);
      if (
        JSON.stringify(sourceDefinition) !== JSON.stringify(currentDefinition)
      )
        throw new DomainError(422, "Changed check cannot be reused");
    }
  } else if (input.reuseReason !== undefined)
    throw new DomainError(422, "Reuse source required");
}
// Trusted transaction-only writer. Callers must authorize and enforce workflow/build/version.
export function insertTestRecord(
  db: Database,
  ctx: MutationContext,
  input: TestInput,
): TestRecord {
  if (!db.inTransaction)
    throw new Error("Test record requires mutation transaction");
  validateTestInput(db, input);
  const t = testTarget(db, input.target),
    r = testRequirement(db, input.target),
    recordedAt = new Date().toISOString();
  const selfTest = !!db
    .prepare(
      input.target.kind === "requirement"
        ? "SELECT 1 FROM execution_participations WHERE requirement_id=? AND member_id=? AND activity IN ('development','repair')"
        : "SELECT 1 FROM execution_participations WHERE object_id=? AND member_id=? AND activity IN ('development','repair')",
    )
    .get(t.id, ctx.actorId);
  const name = (table: string, id: string) =>
    (db.prepare(`SELECT name FROM ${table} WHERE id=?`).get(id) as any)?.name ??
    null;
  const base = {
    ...input,
    id: randomUUID(),
    projectId: t.projectId,
    ...(r ? { requirementId: r.id } : {}),
    testerId: ctx.actorId,
    recordedAt,
    selfTest,
    targetObjectVersion: t.version,
    snapshot: {
      targetTitle: t.title,
      actorName: name("members", ctx.actorId),
      projectName: name("projects", t.projectId),
      ownerId: t.ownerId ?? null,
      ownerName: name("members", t.ownerId ?? ""),
      requirementVersion: r?.version ?? null,
      requirementCriteria: r?.criteria ?? null,
      affectedCheckIds: r?.affectedCheckIds ?? [],
      affectedTaskIds: r?.affectedTaskIds ?? [],
      checkDefinitions: checkDefinitions(db, input.target),
    },
  };
  const event = db
    .prepare(
      "INSERT INTO events(time,action,actor_id,target_kind,target_id,after_snapshot) VALUES (?,'testRecorded',?,?,?,?)",
    )
    .run(
      recordedAt,
      ctx.actorId,
      input.target.kind,
      t.id,
      JSON.stringify(base),
    );
  const record = {
    ...base,
    recordedSeq: Number(event.lastInsertRowid),
  } as TestRecord;
  db.prepare("INSERT INTO test_records VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    record.id,
    t.projectId,
    input.target.kind,
    t.id,
    r?.id ?? null,
    input.revision ?? null,
    input.targetVersion,
    ctx.actorId,
    record.recordedSeq,
    JSON.stringify(record),
  );
  return record;
}

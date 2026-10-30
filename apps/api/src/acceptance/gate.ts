import type { Database } from "better-sqlite3";
import { getRequirement, linkedTasks } from "../requirements/service.js";
import { createPolicy } from "../access/policy.js";
import { coverage } from "../testing/evidence.js";
import { validReviewer } from "../tasks/service.js";
export function linkedBugs(db: Database, id: string): any[] {
  return (
    db
      .prepare(
        "SELECT * FROM objects WHERE kind='bug' AND (json_extract(current,'$.requirementId')=? OR json_extract(current,'$.taskId') IN (SELECT id FROM objects WHERE kind='task' AND json_extract(current,'$.requirementId')=?))",
      )
      .all(id, id) as any[]
  ).map((o) => ({
    ...JSON.parse(o.current),
    id: o.id,
    projectId: o.project_id,
    version: o.version,
  }));
}
export function validWaiver(db: Database, r: any, b: any): boolean {
  if (!["normal", "minor"].includes(b.severity) || b.blocked) return false;
  const w = db
    .prepare(
      "SELECT record FROM bug_waivers WHERE requirement_id=? AND bug_id=? AND revision=? AND bug_version=? ORDER BY recorded_seq DESC LIMIT 1",
    )
    .get(r.id, b.id, r.revision, b.version) as any;
  if (!w) return false;
  const v = JSON.parse(w.record);
  return (
    !!v.reason?.trim() &&
    !!v.plan?.trim() &&
    createPolicy(db).canWrite(v.followUpOwnerId, r.projectId, b.role)
  );
}
export function acceptanceGate(
  db: Database,
  requirementId: string,
  targetVersion: string,
): { ok: boolean; reasons: string[] } {
  const r = getRequirement(db, requirementId),
    reasons: string[] = [];
  const policy = createPolicy(db);
  if (!r.scopeConfirmed || ["draft", "refining", "cancelled"].includes(r.state))
    reasons.push("SCOPE_UNCONFIRMED");
  if (r.blocked) reasons.push("BLOCKED");
  if (!policy.canWrite(r.acceptorId, r.projectId, "product"))
    reasons.push("INVALID_ACCEPTOR");
  if (
    db
      .prepare(
        "SELECT 1 FROM execution_participations WHERE requirement_id=? AND member_id=?",
      )
      .get(r.id, r.acceptorId)
  )
    reasons.push("ACCEPTOR_PARTICIPATED");
  if (
    !targetVersion ||
    !coverage(db, { kind: "requirement", id: r.id }, r.revision, targetVersion)
      .passed
  )
    reasons.push("REQUIRED_CRITERIA_NOT_PASSED");
  for (const t of linkedTasks(db, r.id)) {
    if (t.blocked) reasons.push("BLOCKED");
    const required = t.required !== false || !t.exclusionReason?.trim();
    if (!required) continue;
    if (t.state !== "done") reasons.push("REQUIRED_TASK_NOT_DONE");
    const role = t.kind === "other" ? t.role : t.kind;
    if (!t.ownerId || !policy.canWrite(t.ownerId, r.projectId, role))
      reasons.push("INVALID_TASK_OWNER");
    if (!validReviewer(db, t, t.reviewerId))
      reasons.push("INVALID_TASK_REVIEWER");
    if (t.checks || t.submission?.targetVersion) {
      if (
        !coverage(db, { kind: "task", id: t.id }, r.revision, targetVersion)
          .passed
      )
        reasons.push("REQUIRED_TASK_TESTS_NOT_PASSED");
    }
  }
  for (const b of linkedBugs(db, r.id)) {
    if (b.projectId !== r.projectId) {
      reasons.push("INVALID_BUG_LINK");
      continue;
    }
    if (b.blocked) reasons.push("BLOCKED");
    if (["closed", "rejected"].includes(b.state)) {
      if (
        b.state === "closed" &&
        !coverage(db, { kind: "bug", id: b.id }, r.revision, targetVersion)
          .passed
      )
        reasons.push("BUG_TESTS_NOT_PASSED");
      continue;
    }
    if (["critical", "blocker"].includes(b.severity))
      reasons.push("OPEN_CRITICAL_BUG");
    else if (!validWaiver(db, r, b)) reasons.push("OPEN_BUG");
  }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

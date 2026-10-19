import type { Database } from "better-sqlite3";
import type { AcceptanceReadiness } from "../../../../packages/contracts/src/index.js";
import { getRequirement, linkedTasks } from "../requirements/service.js";
import { coverage } from "../testing/evidence.js";
import { acceptanceGate, linkedBugs, validWaiver } from "./gate.js";

// Group the existing gate's reasons for display. No acceptance rule is evaluated
// here: the same acceptanceGate remains authoritative for reads and writes.
const groups = {
  tasks: [
    "REQUIRED_TASK_NOT_DONE",
    "INVALID_TASK_OWNER",
    "INVALID_TASK_REVIEWER",
  ],
  tests: [
    "REQUIRED_CRITERIA_NOT_PASSED",
    "REQUIRED_TASK_TESTS_NOT_PASSED",
    "BUG_TESTS_NOT_PASSED",
  ],
  bugs: ["INVALID_BUG_LINK", "OPEN_CRITICAL_BUG", "OPEN_BUG"],
  unblocked: ["SCOPE_UNCONFIRMED", "BLOCKED"],
  acceptor: ["INVALID_ACCEPTOR", "ACCEPTOR_PARTICIPATED"],
} satisfies Record<AcceptanceReadiness["conditions"][number]["id"], string[]>;

export function acceptanceReadiness(
  db: Database,
  id: string,
  targetVersion?: string,
): AcceptanceReadiness {
  const r = getRequirement(db, id);
  const target = targetVersion ?? r.acceptanceTargetVersion ?? "";
  const gate = acceptanceGate(db, id, target);
  const known = new Set(Object.values(groups).flat());
  const conditions = Object.entries(groups).map(([key, codes]) => {
    const reasons = gate.reasons.filter(
      (code) =>
        codes.includes(code) || (key === "unblocked" && !known.has(code)),
    );
    return {
      id: key as AcceptanceReadiness["conditions"][number]["id"],
      passed: reasons.length === 0,
      reasons,
    };
  });
  const tasks = linkedTasks(db, id).filter(
    (t) => t.required !== false || !t.exclusionReason?.trim(),
  );
  const checks = coverage(
    db,
    { kind: "requirement", id },
    r.revision,
    target,
  ).checks.filter((c) => c.required);
  const bugs = linkedBugs(db, id).map((b) => ({
    id: b.id,
    title: b.title ?? b.id,
    severity: b.severity,
    state: b.state,
    waived: !["closed", "rejected"].includes(b.state) && validWaiver(db, r, b),
  }));
  const openBugs = bugs.filter(
    (b) => !["closed", "rejected"].includes(b.state),
  );
  return {
    requirement: r,
    requirementId: r.id,
    projectId: r.projectId,
    requirementVersion: r.version,
    revision: r.revision,
    state: r.state,
    targetVersion: target,
    archived: !!(
      db
        .prepare("SELECT archived FROM projects WHERE id=?")
        .get(r.projectId) as { archived: number }
    ).archived,
    checkedAt: new Date().toISOString(),
    ok: gate.ok,
    reasons: gate.reasons,
    total: 5,
    satisfied: conditions.filter((c) => c.passed).length,
    conditions,
    tasks: {
      required: tasks.length,
      completed: tasks.filter((t) => t.state === "done").length,
    },
    criteria: {
      required: checks.length,
      passed: checks.filter((c) => c.result === "pass").length,
      failed: checks.filter((c) => c.result === "fail").length,
      untested: checks.filter((c) => c.result === "untested").length,
    },
    bugs,
    bugSummary: {
      open: openBugs.length,
      criticalOpen: openBugs.filter((b) =>
        ["critical", "blocker"].includes(b.severity),
      ).length,
      waived: openBugs.filter((b) => b.waived).length,
    },
    acceptor: {
      id: r.acceptorId,
      name:
        (
          db
            .prepare("SELECT name FROM members WHERE id=?")
            .get(r.acceptorId) as { name: string } | undefined
        )?.name ?? r.acceptorId,
    },
  };
}

import type { Database } from "better-sqlite3";
import type { MutationContext } from "../db/mutate.js";
import { getRequirement, writeDomainObject } from "./service.js";
import { acceptanceGate } from "../acceptance/gate.js";
// Trusted coordination primitive: root action owns authorization/version checks and write transaction.
export function reconcileRequirement(
  db: Database,
  ctx: MutationContext,
  id?: string | null,
): void {
  if (!db.inTransaction)
    throw new Error("Reconciliation requires mutation transaction");
  if (!id) return;
  const r = getRequirement(db, id);
  if (!["pending_acceptance", "accepted"].includes(r.state)) return;
  const gate = acceptanceGate(db, id, String(r.acceptanceTargetVersion ?? ""));
  if (!gate.ok)
    writeDomainObject(
      db,
      ctx,
      id,
      {
        ...r,
        state: "active",
        evidenceReady: false,
        regressionReasons: gate.reasons,
      },
      "acceptanceRegression",
    );
}
// Administrative eligibility changes use the same transaction; archives retain their historical states.
export function reconcileProjectRequirements(
  db: Database,
  ctx: MutationContext,
  projectId: string,
): void {
  if (!db.inTransaction)
    throw new Error("Reconciliation requires mutation transaction");
  const rows = db
    .prepare(
      "SELECT o.id FROM objects o JOIN projects p ON p.id=o.project_id WHERE o.kind='requirement' AND o.project_id=? AND p.archived=0 AND json_extract(o.current,'$.state') IN ('pending_acceptance','accepted')",
    )
    .all(projectId) as { id: string }[];
  for (const r of rows) reconcileRequirement(db, ctx, r.id);
}

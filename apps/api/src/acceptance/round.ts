import type { Database } from "better-sqlite3";
import type { Requirement, AcceptanceRound } from "../../../../packages/contracts/src/index.js";

// Read projection only: a retained build string is not proof that this revision
// was submitted. A behavior revision can retain that older string.
export function currentAcceptanceRound(db: Database, r: Requirement): AcceptanceRound | null {
  if (!r.acceptanceTargetVersion) return null;
  const event = db.prepare(
    "SELECT seq FROM events WHERE target_kind='requirement' AND target_id=? AND action='submitAcceptance' AND json_extract(after_snapshot,'$.revision')=? AND json_extract(after_snapshot,'$.acceptanceTargetVersion')=? ORDER BY seq DESC LIMIT 1",
  ).get(r.id, r.revision, r.acceptanceTargetVersion) as { seq: number } | undefined;
  return event ? { revision: r.revision, targetVersion: r.acceptanceTargetVersion, submittedSeq: event.seq } : null;
}

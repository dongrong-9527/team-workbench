import type { Database } from "better-sqlite3";
import type { Requirement, Task, TestRecord, RevisionImpactDisplay } from "../../../../packages/contracts/src/index.js";
import { coverage } from "../testing/evidence.js";

// Presentation facts only. Never attach this to getTask(), whose callers persist
// the raw object during writes. The marker remains immutable historical input.
export function revisionImpact(db: Database, task: Task): RevisionImpactDisplay | null {
  const marker = task.pendingChange;
  if (!marker) return null;
  if (typeof marker.requirementId !== "string" || !marker.requirementId || !Number.isSafeInteger(marker.revision) || marker.revision < 1)
    return { status: "invalid", needsAttention: true, message: "修订影响记录需核对。", impactRevision: null };
  const base = { impactRevision: marker.revision, requirementId: marker.requirementId };
  const source = db.prepare("SELECT current,project_id FROM objects WHERE id=? AND kind='requirement'").get(marker.requirementId) as { current: string; project_id: string } | undefined;
  if (!source || source.project_id !== task.projectId)
    return { ...base, status: "invalid", needsAttention: true, message: "原需求归属与修订影响记录需核对。" };
  const parent = JSON.parse(source.current) as Requirement;
  const context = { ...base, currentRevision: parent.revision };
  const view = (status: RevisionImpactDisplay["status"], needsAttention: boolean, message: string): RevisionImpactDisplay => ({ ...context, status, needsAttention, message });
  if (marker.revision > parent.revision)
    return view("invalid", true, "修订影响记录超出原需求当前修订，需核对。");
  if (task.requirementId == null)
    return view("detached", false, `历史修订影响 R${marker.revision}；任务已脱离原需求，保留原影响记录。`);
  if (task.requirementId !== marker.requirementId)
    return view("invalid", true, "当前需求归属与原修订影响记录不一致，需核对。");
  if (task.state === "cancelled")
    return view("cancelled", false, `历史修订影响 R${marker.revision}；任务已取消，保留原影响记录。`);
  if (parent.state === "cancelled")
    return view("source_cancelled", false, `原需求已取消；保留 R${marker.revision} 修订影响及已有测试记录。`);
  if (task.state !== "done")
    return view(task.state === "pending_check" ? "awaiting_check" : "pending", true,
      `R${marker.revision} 修订影响记录；当前任务${task.state === "pending_check" ? "待检查" : "待处理"}，已有历史记录保留。`);
  const uncertain = () => view("evidence_required", true, `任务已完成；R${marker.revision} 修订重检证据待核对。`);
  const targetVersion = (task.submission as { targetVersion?: string } | undefined)?.targetVersion;
  if (!targetVersion?.trim() || typeof task.lastTestId !== "string") return uncertain();
  const row = db.prepare("SELECT record FROM test_records WHERE id=? AND target_kind='task' AND target_id=?").get(task.lastTestId, task.id) as { record: string } | undefined;
  if (!row) return uncertain();
  const record = JSON.parse(row.record) as TestRecord;
  if (record.target?.kind !== "task" || record.target.id !== task.id || record.projectId !== task.projectId || record.requirementId !== marker.requirementId ||
      !Number.isSafeInteger(record.revision) || record.revision! < marker.revision || record.revision! > parent.revision || record.targetVersion !== targetVersion ||
      !coverage(db, { kind: "task", id: task.id }, record.revision, targetVersion).passed) return uncertain();
  const history = record.revision !== parent.revision;
  return { ...view("rechecked", false, `R${marker.revision} 修订影响已于 R${record.revision} / ${targetVersion} 重检完成${history ? `（历史证据；当前需求 R${parent.revision} 另行核对）` : "；影响记录继续保留"}。`),
    evidenceRevision: record.revision, targetVersion, testId: record.id };
}

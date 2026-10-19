import type { Database } from "better-sqlite3";
import { DomainError } from "../db/mutate.js";
import type { Task } from "../../../../packages/contracts/src/index.js";
export function dependencies(db: Database, id: string): string[] {
  return (
    db
      .prepare(
        "SELECT dependency_id FROM task_dependencies WHERE task_id=? ORDER BY dependency_id",
      )
      .all(id) as any[]
  ).map((r) => r.dependency_id);
}
export function setDependencies(db: Database, t: Task, ids: string[]): void {
  if (!db.inTransaction)
    throw new Error("Dependencies require a mutation transaction");
  for (const id of ids) {
    const o = db
      .prepare("SELECT project_id FROM objects WHERE id=? AND kind='task'")
      .get(id) as any;
    if (!o || o.project_id !== t.projectId || id === t.id)
      throw new DomainError(422, "Invalid task dependency");
    const seen = new Set<string>();
    const queue = [id];
    while (queue.length) {
      const n = queue.pop()!;
      if (n === t.id) throw new DomainError(422, "Dependency cycle");
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(...dependencies(db, n));
      }
    }
  }
  db.prepare("DELETE FROM task_dependencies WHERE task_id=?").run(t.id);
  for (const id of ids)
    db.prepare("INSERT INTO task_dependencies VALUES (?,?,?)").run(
      t.projectId,
      t.id,
      id,
    );
}
export function dependencySnapshot(db: Database, t: Task): string {
  return JSON.stringify({
    definitionOfDone: t.definitionOfDone,
    reviewerId: t.reviewerId ?? null,
    required: t.required,
    ownerId: t.ownerId ?? null,
    role: t.kind === "other" ? t.role : t.kind,
    requirementId: t.requirementId ?? null,
    requirementScope: t.requirementId
      ? (() => {
          const o = db
            .prepare(
              "SELECT current FROM objects WHERE id=? AND kind='requirement'",
            )
            .get(t.requirementId) as { current: string };
          const r = JSON.parse(o.current);
          return {
            revision: r.revision,
            criteria: r.criteria,
            description: r.description,
            affectedCheckIds: r.affectedCheckIds ?? [],
          };
        })()
      : null,
    dependencies: dependencies(db, t.id).map((id) => {
      const o = db
        .prepare("SELECT version FROM objects WHERE id=?")
        .get(id) as any;
      return { id, version: o.version };
    }),
  });
}
export function requireParallel(db: Database, t: Task): void {
  const unfinished = dependencies(db, t.id).some((id) => {
    const o = db
      .prepare("SELECT current FROM objects WHERE id=?")
      .get(id) as any;
    return JSON.parse(o.current).state !== "done";
  });
  if (!unfinished) return;
  const rows = db
    .prepare(
      "SELECT * FROM task_parallel_approvals WHERE task_id=? ORDER BY rowid DESC",
    )
    .all(t.id) as any[];
  const scope = t.kind === "other" ? t.role : t.kind;
  if (
    !rows.some(
      (r) =>
        r.snapshot === dependencySnapshot(db, t) &&
        db
          .prepare(
            "SELECT 1 FROM roles JOIN members ON members.id=roles.member_id WHERE project_id=? AND member_id=? AND role=? AND lead=1 AND active=1",
          )
          .get(t.projectId, r.actor_id, scope),
    )
  )
    throw new DomainError(
      422,
      "Current functional lead parallel approval required",
    );
}

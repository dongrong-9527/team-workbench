import type { Database } from "better-sqlite3";
import type {
  ReportInput,
  ReportSource,
  ReportSources,
  ReportSourceRef,
  Ref,
  HistoryEntry,
} from "../../../../packages/contracts/src/index.js";
import { DomainError } from "../db/mutate.js";
import { fields, text } from "../auth/guards.js";
import { effectiveUpdatesAt } from "../updates/service.js";
import { nameAt, stateAt, type Cutoff } from "../history/query.js";
export function validateReport(raw: unknown): ReportInput {
  const b = fields(
    raw,
    ["date", "memberIds", "projectIds"],
    ["timeZone", "previousReportId", "expectedVersion"],
  );
  text(b.date, 10, 10);
  const date = new Date(`${b.date}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d\d-\d\d$/.test(String(b.date)) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== b.date
  )
    throw new DomainError(422, "Invalid calendar date");
  const timeZone = b.timeZone === undefined ? "Asia/Shanghai" : b.timeZone;
  text(timeZone, 1, 100);
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timeZone as string }).format(
      date,
    );
  } catch {
    throw new DomainError(422, "Invalid IANA time zone");
  }
  // Intl also accepts numeric offsets, which are not IANA zones.
  if (/^[+-]/.test(timeZone as string))
    throw new DomainError(422, "Invalid IANA time zone");
  const ids = (v: unknown) => {
    if (
      !Array.isArray(v) ||
      !v.length ||
      v.length > 100 ||
      new Set(v).size !== v.length
    )
      throw new DomainError(400, "Invalid selection");
    return v.map((x) => text(x, 1, 128));
  };
  if (b.previousReportId !== undefined) text(b.previousReportId, 1, 128);
  return {
    date: b.date as string,
    timeZone: timeZone as string,
    memberIds: ids(b.memberIds),
    projectIds: ids(b.projectIds),
    ...(b.previousReportId !== undefined
      ? { previousReportId: b.previousReportId as string }
      : {}),
  };
}
export function dateInZone(time: string, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
}
// Search for the first instant of a local calendar day, including 23/25-hour DST days.
function dayStart(date: string, zone: string): number {
  const center = Date.parse(`${date}T00:00:00.000Z`);
  let low = center - 48 * 3600000,
    high = center + 48 * 3600000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dateInZone(new Date(mid).toISOString(), zone) < date) low = mid + 1;
    else high = mid;
  }
  return low;
}
export function reportWindow(
  input: ReportInput,
  generatedAt: string,
  seq: number,
) {
  if (input.date > dateInZone(generatedAt, input.timeZone))
    throw new DomainError(422, "Future report date");
  const start = dayStart(input.date, input.timeZone);
  if (dateInZone(new Date(start).toISOString(), input.timeZone) !== input.date)
    throw new DomainError(422, "Local calendar date does not exist");
  const next = new Date(Date.parse(`${input.date}T00:00:00.000Z`) + 86400000)
    .toISOString()
    .slice(0, 10);
  return {
    start: new Date(start).toISOString(),
    cutoff: {
      time: new Date(
        Math.min(dayStart(next, input.timeZone) - 1, Date.parse(generatedAt)),
      ).toISOString(),
      seq,
    },
  };
}
export function sourceRef(s: ReportSource): ReportSourceRef {
  return { kind: s.kind, id: s.id, version: s.version, seq: s.seq };
}
const terminal: Record<string, string> = {
  task: "done",
  bug: "closed",
  requirement: "accepted",
};
export function collectSources(
  db: Database,
  input: ReportInput,
  generatedAt: string,
  seq: number,
): { sources: ReportSources; stateCutoff: Cutoff } {
  const { start, cutoff } = reportWindow(input, generatedAt, seq);
  const updates = effectiveUpdatesAt(db, seq).filter(
    (u) =>
      u.workDate === input.date &&
      input.memberIds.includes(u.authorId) &&
      input.projectIds.includes(u.snapshot.projectId),
  );
  const rows = db
    .prepare(
      "SELECT * FROM events WHERE seq<=? AND time<=? AND target_kind IN ('task','bug','requirement') ORDER BY seq",
    )
    .all(seq, cutoff.time) as any[];
  const canonical = rows.filter((r) => {
    const a = JSON.parse(r.after_snapshot ?? "null");
    return (
      typeof a?.title === "string" &&
      typeof a?.projectId === "string" &&
      typeof a?.state === "string" &&
      Number.isInteger(a?.version)
    );
  });
  const canonicalSeqs = new Set(canonical.map((r) => r.seq));
  const latestCanonical = new Map<string, any>();
  for (const r of canonical) latestCanonical.set(r.target_id, r);
  const actions = rows.filter((r) => {
    if (r.time < start || !input.memberIds.includes(r.actor_id)) return false;
    const a = JSON.parse(r.after_snapshot ?? "null"),
      b = JSON.parse(r.before_snapshot ?? "null");
    return (
      (canonicalSeqs.has(r.seq) && a.state !== b?.state) ||
      ["testRecorded", "acceptanceRecorded"].includes(r.action)
    );
  });
  const actionIds = new Set(actions.map((r) => r.target_id)),
    updateIds = new Set(updates.map((u) => u.target.id));
  const states = new Map<string, Extract<ReportSource, { kind: "state" }>>();
  for (const r of latestCanonical.values()) {
    const target = { kind: r.target_kind, id: r.target_id } as Ref;
    const snapshot = stateAt(db, target, cutoff);
    if (!snapshot || !input.projectIds.includes(snapshot.projectId)) continue;
    if (
      updateIds.has(target.id) ||
      actionIds.has(target.id) ||
      (snapshot.blocked &&
        snapshot.ownerId &&
        input.memberIds.includes(snapshot.ownerId))
    )
      states.set(target.id, {
        kind: "state",
        id: target.id,
        version: snapshot.version,
        seq: r.seq,
        target,
        snapshot,
      });
  }
  const entries: ReportSource[] = updates.map((u) => ({
    kind: "update",
    id: u.id,
    version: u.version,
    seq: u.recordedSeq,
    update: u,
  }));
  entries.push(
    ...[...states.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
  );
  for (const r of actions) {
    const s = states.get(r.target_id);
    if (!s) continue;
    const before = r.before_snapshot ? JSON.parse(r.before_snapshot) : null,
      after = r.after_snapshot ? JSON.parse(r.after_snapshot) : null;
    const event: HistoryEntry = {
      seq: r.seq,
      time: r.time,
      localTime: new Date(r.time).toLocaleString("sv-SE", {
        timeZone: input.timeZone,
      }),
      action: r.action,
      actorId: r.actor_id,
      actorName:
        after?.actorName ??
        after?.authorName ??
        nameAt(db, "member", r.actor_id, { time: r.time, seq: r.seq }, null),
      target: s.target,
      before,
      after,
      reason: null,
    };
    entries.push({
      kind: "event",
      id: String(r.seq),
      version: 1,
      seq: r.seq,
      event,
      projectId: s.snapshot.projectId,
    });
  }
  // Late entries carry recording-time names, not proof of names on the report day.
  const historicalUpdates = updates.filter((u) => u.recordedAt <= cutoff.time);
  // Prefer the name timeline (including future rename before-values), then day-bound snapshots.
  for (const [kind, ids] of [
    ["member", input.memberIds],
    ["project", input.projectIds],
  ] as const) {
    for (const id of ids) {
      const fallback =
        kind === "member"
          ? (historicalUpdates.find((u) => u.authorId === id)?.authorName ??
            [...states.values()].find((s) => s.snapshot.ownerId === id)
              ?.snapshot.ownerName ??
            null)
          : (historicalUpdates.find((u) => u.snapshot.projectId === id)
              ?.snapshot.projectName ??
            [...states.values()].find((s) => s.snapshot.projectId === id)
              ?.snapshot.projectName ??
            null);
      const name = nameAt(db, kind, id, cutoff, null) ?? fallback;
      const nameRow = db
        .prepare(
          "SELECT seq FROM events WHERE target_kind=? AND target_id=? AND time<=? AND seq<=? AND json_type(after_snapshot,?)='text' ORDER BY seq DESC LIMIT 1",
        )
        .get(
          kind,
          id,
          cutoff.time,
          seq,
          kind === "member" ? "$.displayName" : "$.name",
        ) as { seq: number } | undefined;
      entries.push({ kind, id, version: 1, seq: nameRow?.seq ?? 0, name });
    }
  }
  const completed = {
      task: new Set<string>(),
      bug: new Set<string>(),
      requirement: new Set<string>(),
    },
    reopened = new Set<string>();
  for (const r of actions) {
    const s = states.get(r.target_id),
      a = JSON.parse(r.after_snapshot ?? "null"),
      b = JSON.parse(r.before_snapshot ?? "null");
    if (!s || !canonicalSeqs.has(r.seq)) continue;
    const end = terminal[r.target_kind];
    if (a.state === end && b?.state !== end && s.snapshot.state === end)
      completed[r.target_kind as keyof typeof completed].add(r.target_id);
  }
  // A same-day completion/reopening pair belongs to either selected operator; owners
  // alone never receive credit. The final state must remain nonterminal.
  for (const r of actions) {
    const s = states.get(r.target_id),
      a = JSON.parse(r.after_snapshot ?? "null"),
      b = JSON.parse(r.before_snapshot ?? "null");
    if (
      !s ||
      !canonicalSeqs.has(r.seq) ||
      s.snapshot.state === terminal[r.target_kind]
    )
      continue;
    const entered = a.state === terminal[r.target_kind] && b?.state !== a.state;
    const reopenedBySelected =
      b?.state === terminal[r.target_kind] &&
      a.state !== b.state &&
      canonical.some((e) => {
        if (e.target_id !== r.target_id || e.seq >= r.seq || e.time < start)
          return false;
        const after = JSON.parse(e.after_snapshot),
          before = JSON.parse(e.before_snapshot ?? "null");
        return (
          after.state === terminal[r.target_kind] &&
          before?.state !== after.state
        );
      });
    if (entered || reopenedBySelected) reopened.add(r.target_id);
  }
  const sources: ReportSources = {
    input,
    entries,
    counts: {
      tasksDone: completed.task.size,
      bugsClosed: completed.bug.size,
      requirementsAccepted: completed.requirement.size,
    },
    reopenedIds: [...reopened].sort(),
  };
  return { sources, stateCutoff: cutoff };
}

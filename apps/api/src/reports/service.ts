import { randomUUID } from "node:crypto";
import { REPORT_TEXT_LIMITS } from "../../../../packages/contracts/src/index.js";
import { isDeepStrictEqual } from "node:util";
import type { Database } from "better-sqlite3";
import type {
  ReportInput,
  ReportVersion,
  ReportSources,
  ReportSourceChanges,
  SeqPage,
  ReportSource,
} from "../../../../packages/contracts/src/index.js";
import { DomainError, mutate, type MutationContext } from "../db/mutate.js";
import { createPolicy } from "../access/policy.js";
import { maxSeq, pageInput } from "../history/query.js";
import { validateReport, collectSources, sourceRef } from "./sources.js";
import { renderReport } from "./render.js";
function validateReportText(
  value: unknown,
  mode: keyof typeof REPORT_TEXT_LIMITS,
): string {
  const status = mode === "generated" ? 422 : 400;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
    Buffer.from(value).toString("utf8") !== value
  )
    throw new DomainError(status, "Invalid report text");
  if (value.length > REPORT_TEXT_LIMITS[mode])
    throw new DomainError(
      status,
      mode === "generated"
        ? `Generated report exceeds ${REPORT_TEXT_LIMITS.generated} characters; generate separate reports with fewer members or projects. No source content was truncated.`
        : `Report text exceeds ${REPORT_TEXT_LIMITS.edited} characters`,
    );
  return value;
}
interface Stored {
  seq: number;
  record: string;
  source_snapshot: string;
}
function stored(db: Database, id: string): Stored {
  const r = db
    .prepare(
      "SELECT seq,record,source_snapshot FROM report_versions WHERE id=?",
    )
    .get(id) as Stored | undefined;
  if (!r) throw new DomainError(404, "Report not found");
  return r;
}
export function getReport(db: Database, id: string): ReportVersion {
  return JSON.parse(stored(db, id).record);
}
function guard(db: Database, actorId: string, input: ReportInput): void {
  for (const id of input.projectIds)
    createPolicy(db).authorize(actorId, "manageReport", {
      kind: "project",
      id,
    });
  for (const id of input.memberIds)
    if (!db.prepare("SELECT 1 FROM members WHERE id=?").get(id))
      throw new DomainError(404, "Member not found");
}
function owner(db: Database, actorId: string, id: string): ReportVersion {
  const report = getReport(db, id);
  if (report.creatorId !== actorId)
    throw new DomainError(403, "Only creator may modify report");
  return report;
}
function head(
  db: Database,
  previous: ReportVersion,
  expectedVersion?: number,
): void {
  if (expectedVersion === undefined)
    throw new DomainError(400, "expectedVersion required");
  const latest = JSON.parse(
    (
      db
        .prepare(
          "SELECT record FROM report_versions WHERE series_id=? ORDER BY version DESC LIMIT 1",
        )
        .get(previous.seriesId) as Stored
    ).record,
  ) as ReportVersion;
  if (previous.id !== latest.id || expectedVersion !== latest.version)
    throw new DomainError(409, "Report version conflict", latest);
}
function append(
  db: Database,
  r: ReportVersion,
  s: ReportSources,
): ReportVersion {
  db.prepare(
    "INSERT INTO report_versions(id,series_id,version,creator_id,record,source_snapshot) VALUES (?,?,?,?,?,?)",
  ).run(
    r.id,
    r.seriesId,
    r.version,
    r.creatorId,
    JSON.stringify(r),
    JSON.stringify(s),
  );
  return r;
}
export function generateReport(
  db: Database,
  ctx: MutationContext,
  raw: ReportInput,
  clock: () => Date = () => new Date(),
): ReportVersion {
  const input = validateReport(raw),
    { previousReportId, ...selection } = input;
  return mutate(
    db,
    {
      ...ctx,
      authorize: (c) => {
        ctx.authorize(c);
        guard(c, ctx.actorId, input);
        if (previousReportId) owner(c, ctx.actorId, previousReportId);
      },
    },
    () => {
      const previous = previousReportId
        ? getReport(db, previousReportId)
        : undefined;
      if (previous) {
        head(db, previous, ctx.expectedVersion);
        if (!isDeepStrictEqual(previous.input, selection))
          throw new DomainError(
            422,
            "Regeneration must preserve date, timezone and ordered selection",
          );
      } else if (ctx.expectedVersion !== undefined)
        throw new DomainError(
          400,
          "expectedVersion only applies to regeneration",
        );
      // Capture and persist inside one short immediate transaction; never resample after release.
      const sourceCutoffSeq = maxSeq(db),
        generatedAt = clock().toISOString();
      const { sources, stateCutoff } = collectSources(
          db,
          selection,
          generatedAt,
          sourceCutoffSeq,
        ),
        reportText = validateReportText(renderReport(sources), "generated"),
        id = randomUUID();
      return append(
        db,
        {
          id,
          seriesId: previous?.seriesId ?? id,
          version: (previous?.version ?? 0) + 1,
          creatorId: ctx.actorId,
          input: selection,
          generatedAt,
          createdAt: generatedAt,
          sourceCutoffSeq,
          stateCutoff,
          sources: sources.entries.map(sourceRef),
          text: reportText,
          edited: false,
          counts: sources.counts,
          reopenedIds: sources.reopenedIds,
        },
        sources,
      );
    },
  );
}
export function editReport(
  db: Database,
  ctx: MutationContext,
  id: string,
  text: string,
  clock: () => Date = () => new Date(),
): ReportVersion {
  validateReportText(text, "edited");
  return mutate(
    db,
    {
      ...ctx,
      authorize: (c) => {
        ctx.authorize(c);
        const r = owner(c, ctx.actorId, id);
        guard(c, ctx.actorId, r.input);
      },
    },
    () => {
      const r = getReport(db, id);
      head(db, r, ctx.expectedVersion);
      return append(
        db,
        {
          ...r,
          id: randomUUID(),
          version: r.version + 1,
          createdAt: clock().toISOString(),
          text,
          edited: true,
        },
        JSON.parse(stored(db, id).source_snapshot),
      );
    },
  );
}
export function sourceChanges(
  db: Database,
  id: string,
  clock: () => Date = () => new Date(),
): ReportSourceChanges {
  return db.transaction(() => {
    const row = stored(db, id),
      r = JSON.parse(row.record) as ReportVersion,
      old = JSON.parse(row.source_snapshot) as ReportSources;
    const sourceCutoffSeq = maxSeq(db),
      checkedAt = clock().toISOString();
    const fresh = collectSources(
      db,
      r.input,
      checkedAt,
      sourceCutoffSeq,
    ).sources;
    const key = (s: ReportSource) => `${s.kind}:${s.id}`,
      previous = new Map(old.entries.map((s) => [key(s), s])),
      next = new Map(fresh.entries.map((s) => [key(s), s]));
    const added = fresh.entries
        .filter((s) => !previous.has(key(s)))
        .map(sourceRef),
      removed = old.entries.filter((s) => !next.has(key(s))).map(sourceRef),
      updated = fresh.entries
        .filter(
          (s) =>
            previous.has(key(s)) && !isDeepStrictEqual(s, previous.get(key(s))),
        )
        .map(sourceRef);
    const changed = !!(added.length || removed.length || updated.length);
    return {
      changed,
      message: changed ? "有更新可重新生成" : null,
      checkedAt,
      sourceCutoffSeq,
      added,
      removed,
      updated,
    };
  })();
}
export function reportPage(
  db: Database,
  query: Record<string, unknown>,
  id?: string,
): SeqPage<ReportVersion> {
  const seriesId = id ? getReport(db, id).seriesId : null;
  const max = (
    db
      .prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM report_versions")
      .get() as { seq: number }
  ).seq;
  const p = pageInput(db, {
    ...query,
    cutoffSeq: query.cutoffSeq ?? String(max),
  });
  const rows = db
    .prepare(
      "SELECT seq,record FROM report_versions WHERE seq>? AND seq<=? AND (? IS NULL OR series_id=?) ORDER BY seq LIMIT ?",
    )
    .all(p.afterSeq, p.cutoffSeq, seriesId, seriesId, p.limit + 1) as Stored[];
  return {
    items: rows.slice(0, p.limit).map((r) => JSON.parse(r.record)),
    cutoffSeq: p.cutoffSeq,
    nextAfterSeq: rows.length > p.limit ? rows[p.limit - 1]!.seq : null,
  };
}
export function sourcePage(
  db: Database,
  id: string,
  query: Record<string, unknown>,
): SeqPage<ReportSource> {
  const sources = JSON.parse(stored(db, id).source_snapshot) as ReportSources;
  const p = pageInput(db, {
    ...query,
    cutoffSeq: query.cutoffSeq ?? String(sources.entries.length),
  });
  const end = Math.min(p.cutoffSeq, sources.entries.length),
    items = sources.entries.slice(
      p.afterSeq,
      Math.min(p.afterSeq + p.limit, end),
    );
  return {
    items,
    cutoffSeq: end,
    nextAfterSeq:
      p.afterSeq + items.length < end ? p.afterSeq + items.length : null,
  };
}

import type {
  ReportSources,
  ReportSource,
} from "../../../../packages/contracts/src/index.js";
const stateNames: Record<string, string> = {
  pending: "待认领",
  ready: "待开始",
  active: "进行中",
  in_progress: "进行中",
  pending_check: "待检查",
  pending_verify: "待验证",
  pending_acceptance: "待验收",
  done: "已完成",
  closed: "已关闭",
  accepted: "已验收",
  cancelled: "已取消",
  draft: "草稿",
  refining: "细化中",
  new: "待确认",
  rejected: "已拒绝",
};
export function renderReport(s: ReportSources): string {
  const state = (value: string) => stateNames[value] ?? value;
  const contribution = {
    development: "开发贡献",
    repair: "修复贡献",
    testing: "测试贡献",
    coordination: "协作贡献",
  };
  const name = (kind: "member" | "project", id: string) =>
    s.entries.find(
      (e): e is Extract<ReportSource, { kind: "member" | "project" }> =>
        e.kind === kind && e.id === id,
    )?.name ?? id;
  const states = s.entries.filter(
    (e): e is Extract<ReportSource, { kind: "state" }> => e.kind === "state",
  );
  const updates = s.entries
    .filter(
      (e): e is Extract<ReportSource, { kind: "update" }> =>
        e.kind === "update",
    )
    .map((e) => e.update);
  const events = s.entries.filter(
    (e): e is Extract<ReportSource, { kind: "event" }> => e.kind === "event",
  );
  const lines = [
    `${s.input.date} 日报（${s.input.timeZone}）`,
    `团队概览（所选成员的状态操作，事项去重）：已完成任务 ${s.counts.tasksDone}；已关闭 Bug ${s.counts.bugsClosed}；已验收需求 ${s.counts.requirementsAccepted}`,
  ];
  if (s.reopenedIds.length)
    lines.push(`当日完成后重开：${s.reopenedIds.join("、")}`);
  for (const memberId of s.input.memberIds) {
    lines.push("", name("member", memberId));
    if (!updates.some((u) => u.authorId === memberId))
      lines.push("未填写今日工作更新");
    for (const projectId of s.input.projectIds) {
      const own = updates.filter(
        (u) => u.authorId === memberId && u.snapshot.projectId === projectId,
      );
      const actions = events.filter(
        (e) => e.event.actorId === memberId && e.projectId === projectId,
      );
      const attention = states.filter(
        (e) =>
          e.snapshot.ownerId === memberId &&
          e.snapshot.projectId === projectId &&
          e.snapshot.blocked,
      );
      lines.push(`【${name("project", projectId)}】`);
      const ids = [
        ...new Set([
          ...own.map((u) => u.target.id),
          ...actions.map((e) => e.event.target.id),
        ]),
      ].sort();
      for (const id of ids) {
        const current = states.find((e) => e.id === id)?.snapshot;
        for (const u of own.filter((u) => u.target.id === id))
          lines.push(
            `今日进展：${id} ${current?.title ?? u.snapshot.title} — ${u.done}（${contribution[u.contributionType]}；状态：${current ? state(current.state) : "无当日状态"}；当时主负责人：${current?.ownerName ?? current?.ownerId ?? "未指定"}）`,
          );
        for (const a of actions.filter((e) => e.event.target.id === id)) {
          const e = a.event,
            after = e.after as Record<string, unknown> | null,
            before = e.before as Record<string, unknown> | null;
          const action =
            e.action === "testRecorded"
              ? "记录测试结果"
              : e.action === "acceptanceRecorded"
                ? "记录产品验收"
                : `${before?.state ? state(String(before.state)) : "创建"} → ${state(String(after?.state))}`;
          lines.push(
            `状态操作：${id} ${current?.title ?? ""} — ${e.actorName ?? name("member", memberId)}：${action}`,
          );
        }
      }
      lines.push(
        `问题与协助：${
          own
            .filter((u) => u.obstacle)
            .map((u) => `${u.target.id} ${u.obstacle}`)
            .join("；") || "未填写"
        }`,
      );
      if (attention.length)
        lines.push(
          `待关注（截止时本人负责的阻塞事项）：${attention.map((e) => `${e.id} ${e.snapshot.title}，${state(e.snapshot.state)}，阻塞`).join("；")}`,
        );
      lines.push(
        `明日计划：${
          own
            .filter((u) => u.next)
            .map((u) => `${u.target.id} ${u.next}`)
            .join("；") || "未填写"
        }`,
      );
    }
  }
  return lines.join("\n");
}

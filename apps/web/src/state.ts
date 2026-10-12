import { reactive } from "vue";
import { allPages, request, setCsrf } from "./api/client";
export interface Member {
  id: string;
  displayName: string;
  active: boolean;
  isAdmin: boolean;
  version?: number;
  roles?: { role: string; lead: number }[];
}
export interface Project {
  id: string;
  name: string;
  description: string;
  archived: number;
  version: number;
  myRoles: { role: string; lead: number }[];
}
export const state = reactive({
  member: null as Member | null,
  projects: [] as Project[],
  members: [] as Member[],
  projectMembers: {} as Record<string, Member[]>,
  projectId: "",
  expired: false,
  ready: false,
});
export async function refreshSession() {
  const s = await request<{ member: Member; csrfToken: string }>(
    "/api/auth/session",
  );
  setCsrf(s.csrfToken);
  state.member = s.member;
  state.expired = false;
  state.ready = true;
  await refreshDirectory();
}
export async function refreshDirectory() {
  [state.projects, state.members] = await Promise.all([
    allPages<Project>("/api/projects"),
    allPages<Member>("/api/members"),
  ]);
}
export const nameOf = (id: unknown) =>
  state.members.find((m) => m.id === id)?.displayName ??
  (id ? "历史成员" : "未分配");
export const projectOf = (id: string) =>
  state.projects.find((p) => p.id === id);
export const label: Record<string, string> = {
  ACCEPTOR_PARTICIPATED: "验收人参与了开发或修复，需另行指定独立验收人",
  BLOCKED: "需求存在阻塞",
  BUG_TESTS_NOT_PASSED: "关联 Bug 验证未通过",
  INVALID_ACCEPTOR: "产品验收人无效",
  INVALID_BUG_LINK: "Bug 关联关系无效",
  INVALID_TASK_OWNER: "任务负责人已停用或无相应权限",
  INVALID_TASK_REVIEWER: "任务检查人无效",
  OPEN_BUG: "仍有未关闭且未豁免的 Bug",
  OPEN_CRITICAL_BUG: "仍有未关闭的严重或阻断 Bug",
  REQUIRED_CRITERIA_NOT_PASSED: "必需验收条目测试未通过",
  REQUIRED_TASK_NOT_DONE: "必需任务尚未完成",
  REQUIRED_TASK_TESTS_NOT_PASSED: "必需任务的目标版本测试未通过",
  SCOPE_UNCONFIRMED: "需求范围尚未确认",
  REVISION_MISMATCH: "需求修订已变化",
  duplicate: "重复缺陷",
  not_defect: "不是缺陷",
  unable: "无法复现",
  behavior: "行为变更",
  editorial: "文字修订",
  checked: "已核对",
  return: "退回返工",
  requirement: "需求",
  task: "任务",
  bug: "Bug",
  draft: "草稿",
  refining: "细化中",
  ready: "待开始",
  pending: "待处理",
  active: "进行中",
  pending_check: "待检查",
  done: "已完成",
  cancelled: "已取消",
  pending_acceptance: "待验收",
  accepted: "已验收",
  unconfirmed: "待确认",
  fixing: "修复中",
  pending_verify: "待验证",
  closed: "已关闭",
  rejected: "已驳回",
  frontend: "前端",
  backend: "后端",
  test: "测试",
  other: "其他",
  product: "产品",
  high: "高",
  medium: "中",
  low: "低",
  blocker: "阻断",
  critical: "严重",
  normal: "一般",
  minor: "轻微",
  owner: "主负责人",
  reviewer: "检查人",
  acceptor: "验收人",
  participant: "实际参与",
  tester: "待执行测试",
  claimable: "可认领",
  observer: "关注事项",
  pass: "通过",
  fail: "失败",
  untested: "未测",
  development: "开发",
  repair: "修复",
  testing: "测试",
  coordination: "协调",
};
export const zh = (v: unknown) => label[String(v)] ?? String(v ?? "未填写");
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function objectPath(kind: string, id: string) {
  return `/${kind}/${id}`;
}

export async function refreshProject(
  id: string,
  isCurrent: () => boolean = () => true,
) {
  const [overview, members] = await Promise.all([
    request<any>(`/api/projects/${id}/overview`),
    allPages<Member>(`/api/members?projectId=${id}`),
  ]);
  if (!isCurrent()) return overview;
  const i = state.projects.findIndex((p) => p.id === id);
  const p = { ...overview.project, myRoles: overview.myRoles };
  if (i >= 0) state.projects[i] = p;
  else state.projects.push(p);
  state.projectMembers[id] = members;
  return overview;
}

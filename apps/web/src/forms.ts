import { state, nameOf, zh, today, projectOf } from "./state.js";
export interface Field {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  wide?: boolean;
  max?: number;
  help?: string;
  options?: { value: any; label: string }[];
  optionsFor?: (v: any) => { value: any; label: string }[];
  when?: (v: any) => boolean;
}
export interface FormSpec {
  title: string;
  projectId?: string;
  description?: string;
  impact?: string;
  requirementEditor?: { mode: "create" | "refine" | "revise"; id?: string };
  relatedBugContext?: { projectId: string; requirementId?: string; taskId?: string; role?: string };
  fields: Field[];
  initial: Record<string, any>;
  path: string;
  method?: string;
  submit?: string;
  cancelLabel?: "取消" | "返回";
  browserDraft?: boolean;
  body: (v: any) => Record<string, any>;
  adopt?: (
    current: Record<string, unknown>,
    values: Record<string, any>,
  ) => void;
}
export function formCancelPresentation(spec: Pick<FormSpec, "fields" | "cancelLabel">, sensitive = false) {
  const showDraftHints = !sensitive && spec.fields.some(field => !field.disabled);
  return {
    label: showDraftHints && spec.cancelLabel === "返回" ? "返回" : "取消",
    showDraftHints,
  };
}
export function canSaveBrowserDraft(spec: Pick<FormSpec, "fields" | "cancelLabel" | "browserDraft">, sensitive = false) {
  return !!spec.browserDraft && formCancelPresentation(spec, sensitive).showDraftHints;
}
export const options = (values: string[]) =>
  values.map((value) => ({ value, label: zh(value) }));
// Defaults shared across forms; action-specific exceptions are explicit below.
const fieldLimits: Record<string, number> = {
  title: 200,
  login: 64,
  displayName: 100,
  name: 120,
  description: 6000,
  expectedCompletion: 2000,
  definitionOfDone: 6000,
  sourceDescription: 2000,
  sourceReason: 2000,
  sourceUrl: 2000,
  exclusionReason: 2000,
  assistance: 2000,
  reason: 2000,
  handoff: 4000,
  expected: 4000,
  actual: 4000,
  reproduction: 4000,
  fix: 4000,
  impact: 4000,
  selfCheck: 4000,
  explanation: 4000,
  environment: 4000,
  targetVersion: 200,
  reuseReason: 4000,
  plan: 4000,
  done: 6000,
  next: 6000,
  obstacle: 6000,
  requirementId: 128,
  taskId: 128,
  bugId: 128,
  duplicateOfId: 128,
  reusedFromId: 128,
};
export const field = (
  key: string,
  label: string,
  type = "text",
  required = true,
  extra: Partial<Field> = {},
): Field => ({ key, label, type, required, max: fieldLimits[key], ...extra });
const select = (
  key: string,
  label: string,
  values: string[],
  required = true,
) => field(key, label, "select", required, { options: options(values) });
export const memberField = (
  key: string,
  label: string,
  required = false,
): Field =>
  field(key, label, "select", required, {
    options: state.members
      .filter((m) => m.active)
      .map((m) => ({ value: m.id, label: m.displayName })),
  });
function scopeMembers(
  fields: Field[],
  projectId: string,
  kind: string,
  fixedScope?: string,
) {
  for (const f of fields)
    if (
      ["ownerId", "reviewerId", "acceptorId", "followUpOwnerId"].includes(f.key)
    )
      f.optionsFor = (v) => {
        const functional =
          fixedScope ??
          (kind === "task" && v.kind !== "other" ? v.kind : v.role);
        return (state.projectMembers[projectId] ?? [])
          .filter(
            (m) =>
              m.active &&
              m.roles?.some((r) =>
                f.key === "acceptorId"
                  ? r.role === "product"
                  : f.key === "followUpOwnerId"
                    ? true
                    : f.key === "reviewerId"
                      ? ["frontend", "backend"].includes(functional)
                        ? r.role === "test"
                        : r.role === "product" ||
                          (r.role === functional && !!r.lead)
                      : r.role === functional,
              ),
          )
          .map((m) => ({ value: m.id, label: m.displayName }));
      };
}
export const reason = (max = 2000) =>
  field("reason", "操作原因", "textarea", true, { max });
const evidenceFields = (bug: boolean) => [
  ...(bug
    ? [
        field("fix", "修复内容", "textarea"),
        field("impact", "影响范围", "textarea"),
      ]
    : [field("done", "完成内容", "textarea", true, { max: 4000 })]),
  field("selfCheck", "自查结果", "textarea"),
  field("environment", "检查环境"),
  field("targetVersion", "目标版本"),
];
const pick = (v: any, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => v[k] !== undefined && v[k] !== "").map((k) => [k, v[k]]),
  );
function criteria(v: any) {
  return v.map((c: any) => ({
    id: c.id,
    text: c.text,
    required: c.required,
    ...(!c.required ? { exclusionReason: c.exclusionReason } : {}),
  }));
}
export function createForm(
  kind: string,
  projectId: string,
  requirementId?: string,
): FormSpec {
  const common = [
    field("title", "标题"),
    select("priority", "优先级", ["high", "medium", "low"]),
  ];
  const initial: any = {
    title: "",
    priority: "medium",
    kind: "backend",
    role: "backend",
    definitionOfDone: "",
    ownerId: "",
    reviewerId: "",
    requirementId: requirementId ?? "",
    sourceDescription: "",
    sourceUrl: "",
    description: "",
    expectedCompletion: "",
    acceptorId: "",
    criteria: [],
    expected: "",
    actual: "",
    reproduction: "",
    environment: "",
    severity: "normal",
    taskId: "",
    required: true,
    exclusionReason: "",
  };
  const fields =
    kind === "requirement"
      ? [
          ...common,
          field("sourceDescription", "来源说明", "textarea", false, {
            help: "来源链接或来源说明至少填写一项；细化内容可稍后补充。",
          }),
          field("sourceUrl", "腾讯文档 / 来源链接（仅 HTTPS）", "url", false),
          field("description", "需求细化说明", "textarea", false),
          field("expectedCompletion", "期望完成时间", "textarea", false, {
            help: "选填，例如“本周五前”“下个版本”；仅记录文字，不产生到期提醒。",
          }),
          memberField("acceptorId", "产品验收人"),
          field("criteria", "验收条目", "definitions", false),
          select("role", "职责范围", ["frontend", "backend", "test"]),
        ]
      : kind === "task"
        ? [
            ...common,
            select("kind", "任务类型", [
              "frontend",
              "backend",
              "test",
              "other",
            ]),
            select("role", "其他任务职责", ["frontend", "backend", "test"]),
            field("definitionOfDone", "完成标准", "textarea", false, {
              help: "可先保存待处理任务，开始前补齐完成标准。",
            }),
            memberField("ownerId", "主负责人"),
            memberField("reviewerId", "检查人"),
            field("requirementId", "关联需求编号", "text", false, {
              max: 2000,
            }),
            field("required", "需求必需任务", "checkbox", false),
            field("exclusionReason", "非必需原因", "textarea", true, {
              when: (v) => !v.required,
            }),
          ]
        : [
            ...common,
            select("role", "修复职责", ["frontend", "backend", "test"]),
            field("expected", "预期行为", "textarea", false),
            field("actual", "实际行为", "textarea", false),
            field("reproduction", "复现步骤", "textarea", false),
            field("environment", "复现环境", "text", false, {
              help: "口述或微信问题可先保存待确认，确认缺陷前补齐复现信息。",
            }),
            select("severity", "严重程度", [
              "blocker",
              "critical",
              "normal",
              "minor",
            ]),
            field("requirementId", "关联需求编号", "text", false),
            field("taskId", "关联任务编号", "text", false),
          ];
  const isProduct = projectOf(projectId)?.myRoles.some(
    (r) => r.role === "product",
  );
  if (kind === "requirement" && !isProduct) {
    const index = fields.findIndex((f) => f.key === "acceptorId");
    fields.splice(index, 1);
  }
  scopeMembers(fields, projectId, kind);
  return {
    title: `新建${zh(kind)}`,
    ...(kind === "requirement" ? {requirementEditor:{mode:"create" as const},submit:"保存草稿"} : {}),
    cancelLabel: "返回",
    browserDraft: kind !== "requirement",
    projectId,
    path: `/api/${kind === "requirement" ? "requirements" : kind === "task" ? "tasks" : "bugs"}`,
    fields,
    initial,
    body: (v) =>
      kind === "requirement"
        ? {
            projectId,
            ...pick(v, [
              "title",
              "priority",
              "role",
              ...(isProduct ? ["acceptorId"] : []),
            ]),
            description: v.description ?? "",
            expectedCompletion: v.expectedCompletion ?? "",
            source: source(v),
            criteria: criteria(v.criteria),
          }
        : kind === "task"
          ? {
              projectId,
              ...pick(v, [
                "title",
                "priority",
                "kind",
                "ownerId",
                "reviewerId",
                "requirementId",
              ]),
              definitionOfDone: v.definitionOfDone ?? "",
              ...(v.kind === "other" ? { role: v.role } : {}),
              ...(projectOf(projectId)?.myRoles.some(
                (r) => r.role === "product",
              )
                ? {
                    required: v.required,
                    ...(!v.required
                      ? { exclusionReason: v.exclusionReason }
                      : {}),
                  }
                : {}),
            }
          : {
              projectId,
              ...pick(v, [
                "title",
                "priority",
                "role",
                "severity",
                "requirementId",
                "taskId",
              ]),
              expected: v.expected ?? "",
              actual: v.actual ?? "",
              reproduction: v.reproduction ?? "",
              environment: v.environment ?? "",
            },
  };
}
function source(v: any) {
  if (!v.sourceUrl?.trim() && !v.sourceDescription?.trim())
    throw new Error("请填写来源链接或来源说明。原文可在后续人工核对。");
  if (v.sourceUrl && !v.sourceUrl.startsWith("https://"))
    throw new Error("来源链接必须使用 HTTPS。");
  return {
    ...(v.sourceDescription ? { description: v.sourceDescription } : {}),
    ...(v.sourceUrl ? { url: v.sourceUrl } : {}),
  };
}
export const actionNames: Record<string, string> = {
  updateRecorded: "填写工作更新",
  updateCorrected: "更正工作更新",
  waiverRecorded: "记录延期豁免",
  claim: "认领",
  assign: "分配",
  transfer: "改派",
  requestTransfer: "申请转交",
  start: "开始处理",
  submit: "提交检查",
  checkPass: "检查通过",
  checkFail: "检查退回",
  reopen: "重开",
  cancel: "取消工作",
  block: "标记阻塞",
  unblock: "解除阻塞",
  setDependencies: "设置依赖",
  approveParallel: "批准并行",
  designateReviewer: "指定检查人",
  setRequired: "调整必需性",
  defineChecks: "维护检查条目",
  refine: "细化内容",
  confirm: "确认 Bug",
  reject: "驳回 Bug",
  verifyPass: "验证通过",
  verifyFail: "验证失败",
  makeReady: "确认可执行",
  revise: "确认需求修订",
  suggestChange: "提出变更建议",
  restore: "恢复需求",
  update: "写工作更新",
  test: "新增测试记录",
  submitAcceptance: "提交产品验收",
  acceptance: "产品验收",
  returnAcceptance: "记录验收退回",
  waiver: "Bug 延期豁免",
};
export function actionForm(
  kind: string,
  o: any,
  action: string,
  linked: any[] = [],
  parent?: any,
  correction?: any,
): FormSpec {
  const bug = kind === "bug",
    req = kind === "requirement",
    base = `/api/${req ? "requirements" : bug ? "bugs" : "tasks"}/${o.id}`;
  let path = base + "/actions";
  let title = actionNames[action] ?? action;
  let fields: Field[] = [];
  let initial: any = {
    reason: "",
    ownerId: o.ownerId ?? "",
    handoff: "",
    resetToPending: false,
    resetToReady: false,
    reviewerId: o.reviewerId ?? "",
    required: o.required ?? true,
    dependencyIds: o.dependencyIds ?? [],
    done: "",
    fix: "",
    impact: "",
    selfCheck: "",
    environment: "",
    targetVersion:
      o.submission?.targetVersion ?? o.acceptanceTargetVersion ?? "",
    checks: (req
      ? o.criteria
      : (o.checks ?? [
          {
            id: bug ? "reproduction" : "completion",
            text: bug ? o.expected : o.definitionOfDone,
            required: true,
          },
        ])
    ).map((c: any) => ({ ...c, checkId: c.id, result: "untested", note: "" })),
    ...pick(o, [
      "title",
      "description",
      "expectedCompletion",
      "definitionOfDone",
      "priority",
      "expected",
      "actual",
      "reproduction",
      "severity",
      "role",
      "acceptorId",
    ]),
    sourceDescription: o.source?.description ?? "",
    sourceUrl: o.source?.url ?? "",
    sourceStatus: "checked",
    checkedAt: new Date().toISOString(),
    sourceReason: "",
    criteria: JSON.parse(JSON.stringify(o.criteria ?? [])),
    revisionKind: "behavior",
    affectedTaskIds: [],
    affectedCheckIds: [],
    impactConfirmed: false,
    taskDisposition: linked
      .filter(
        (x) =>
          x.objectKind === "task" && !["done", "cancelled"].includes(x.state),
      )
      .map((t) => ({ taskId: t.id, title: t.title, disposition: "cancel" })),
    decision: "pass",
    reworkTaskIds: [],
    bugIds: [],
    bugId: "",
    followUpOwnerId: "",
    plan: "",
    reuseReason: "",
    reusedFromId: "",
    rejectReason: "unable",
    explanation: "",
    duplicateOfId: "",
    workDate: today(),
    next: "",
    obstacle: "",
    contributionType: req
      ? "coordination"
      : bug
        ? "repair"
        : o.kind === "test"
          ? "testing"
          : "development",
  };
  let body: (v: any) => Record<string, any> = (v) => ({ action });
  if (["claim", "start"].includes(action)) {
    if (req) {
      fields = [reason()];
      body = (v) => ({ action, reason: v.reason });
    }
  }
  if (["assign", "transfer", "requestTransfer"].includes(action)) {
    fields = [
      ...(action !== "requestTransfer"
        ? [memberField("ownerId", "新的主负责人")]
        : []),
      reason(),
      field("handoff", "交接说明", "textarea"),
      ...(action !== "requestTransfer"
        ? [
            field(
              bug ? "resetToReady" : "resetToPending",
              "重置为待开始",
              "checkbox",
              false,
            ),
          ]
        : []),
    ];
    body = (v) => ({
      action,
      ...pick(v, [
        "reason",
        "handoff",
        ...(action === "requestTransfer"
          ? []
          : [bug ? "resetToReady" : "resetToPending"]),
      ]),
      ...(action !== "requestTransfer" ? { ownerId: v.ownerId || null } : {}),
    });
  }
  if (action === "submit") {
    title = bug ? "提交修复" : "提交检查";
    fields = evidenceFields(bug);
    body = (v) => ({
      action,
      evidence: pick(
        v,
        bug
          ? ["fix", "impact", "selfCheck", "environment", "targetVersion"]
          : ["done", "selfCheck", "environment", "targetVersion"],
      ),
    });
  }
  if (
    ["checkPass", "checkFail", "verifyPass", "verifyFail", "test"].includes(
      action,
    )
  ) {
    fields = [
      field("targetVersion", "目标版本"),
      field("environment", "检查环境", "text", true, { max: 2000 }),
      field("checks", "逐项测试结果", "results"),
      field("reusedFromId", "复用测试记录编号", "text", false),
      field("reuseReason", "复用原因", "textarea", false),
      field("bugId", "关联 Bug", "select", false, {
        options: linked.filter((x) => x.objectKind === "bug" && x.projectId === o.projectId)
          .map((x) => ({ value: x.id, label: `${x.title} · ${x.id.slice(0, 8)}` })),
      }),
    ];
    const test = (v: any) => ({
      target: { kind, id: o.id },
      ...(req
        ? { revision: o.revision }
        : parent
          ? { revision: parent.revision }
          : {}),
      ...pick(v, [
        "targetVersion",
        "environment",
        "reusedFromId",
        "reuseReason",
        "bugId",
      ]),
      checks: v.checks.map((c: any) => ({
        checkId: c.checkId,
        result: c.result,
        ...(c.note ? { note: c.note } : {}),
      })),
    });
    if (action === "test") {
      path = "/api/tests";
      body = test;
    } else body = (v) => ({ action, test: test(v) });
  }
  if (
    [
      "reopen",
      "cancel",
      "block",
      "unblock",
      "approveParallel",
      "suggestChange",
      "restore",
      "confirm",
    ].includes(action)
  ) {
    fields = [reason()];
    if (action === "block")
      fields.push(field("assistance", "需要的协助", "textarea"));
    if (action === "reopen" && !req)
      fields.push(
        bug
          ? memberField("ownerId", "重新指定修复负责人")
          : field("resetToPending", "重置为待处理", "checkbox", false),
      );
    if (action === "cancel" && req)
      fields.push(field("taskDisposition", "关联任务处置", "dispositions", false));
    body = (v) => ({
      action,
      ...pick(v, [
        "reason",
        ...(action === "block" ? ["assistance"] : []),
        ...(action === "reopen" && !bug ? ["resetToPending"] : []),
      ]),
      ...(action === "reopen" && bug && v.ownerId
        ? { ownerId: v.ownerId }
        : {}),
      ...(action === "cancel" && req
        ? {
            taskDisposition: v.taskDisposition.map((t: any) => ({
              taskId: t.taskId,
              disposition: t.disposition,
            })),
          }
        : {}),
    });
  }
  if (action === "reject") {
    fields = [
      select("rejectReason", "驳回类型", ["duplicate", "not_defect", "unable"]),
      field("explanation", "驳回说明", "textarea"),
      field("duplicateOfId", "重复 Bug 编号", "text", false),
    ];
    body = (v) => ({
      action,
      reason: v.rejectReason,
      ...pick(v, ["explanation", "duplicateOfId"]),
    });
  }
  if (action === "designateReviewer") {
    fields = [memberField("reviewerId", "检查人", true)];
    body = (v) => ({ action, reviewerId: v.reviewerId });
  }
  if (action === "setRequired") {
    fields = [field("required", "必需任务", "checkbox", false), reason()];
    body = (v) => ({ action, required: v.required, reason: v.reason });
  }
  if (action === "setDependencies") {
    fields = [
      field("dependencyIds", "依赖任务", "multi", false, {
        options: linked
          .filter((t) => t.objectKind === "task" && t.id !== o.id)
          .map((t) => ({ value: t.id, label: t.title })),
      }),
    ];
    body = (v) => ({ action, dependencyIds: v.dependencyIds });
  }
  if (action === "defineChecks") {
    fields = [field("checks", "检查条目", "definitions")];
    body = (v) => ({ action, checks: criteria(v.checks) });
  }
  if (action === "refine" || action === "revise") {
    fields = [
      field("title", "标题"),
      field(
        req ? "description" : bug ? "actual" : "definitionOfDone",
        req ? "细化说明" : bug ? "实际行为" : "完成标准",
        "textarea",
      ),
      select("priority", "优先级", ["high", "medium", "low"]),
    ];
    if (req)
      fields.push(
        field("sourceDescription", "来源说明", "textarea"),
        field("sourceUrl", "来源链接（HTTPS）", "url", false),
        memberField("acceptorId", "产品验收人", true),
        field("criteria", "验收条目", "definitions"),
        field("expectedCompletion", "期望完成时间", "textarea", false, {
          help: "选填，例如“本周五前”“下个版本”；仅记录文字，不产生到期提醒。",
        }),
      );
    if (bug)
      fields.push(
        field("expected", "预期行为", "textarea"),
        field("reproduction", "复现步骤", "textarea"),
        field("environment", "复现环境"),
        select("severity", "严重程度", [
          "blocker",
          "critical",
          "normal",
          "minor",
        ]),
      );
    if (action === "revise")
      fields.unshift(
        select("revisionKind", "修订类型", ["behavior", "editorial"]),
        reason(),
        field("affectedTaskIds", "受影响任务", "multi", false, {
          options: linked
            .filter((x) => x.objectKind === "task")
            .map((x) => ({ value: x.id, label: x.title })),
        }),
        field("affectedCheckIds", "受影响验收条目", "multi", false, {
          optionsFor: (v) =>
            Array.from(
              new Map(
                [...(v.criteria ?? []), ...o.criteria].map((c: any) => [
                  c.id,
                  { value: c.id, label: c.text },
                ]),
              ).values(),
            ) as { value: string; label: string }[],
        }),
        field(
          "impactConfirmed",
          "我已核对影响范围，相关工作可能退回重新检查",
          "checkbox",
        ),
      );
    body = (v) => ({
      action,
      ...pick(
        v,
        req
          ? ["title", "description", "expectedCompletion"]
          : bug
            ? [
                "title",
                "actual",
                "expected",
                "reproduction",
                "environment",
                "severity",
                "priority",
              ]
            : ["title", "definitionOfDone", "priority"],
      ),
      ...(req
        ? {
            source: source(v),
            ...(action === "revise" && v.revisionKind === "editorial"
              ? {}
              : {
                  priority: v.priority,
                  ...(projectOf(o.projectId)?.myRoles.some(
                    (r) => r.role === "product",
                  )
                    ? { acceptorId: v.acceptorId }
                    : {}),
                  criteria: criteria(v.criteria),
                }),
          }
        : {}),
      ...(action === "revise"
        ? {
            kind: v.revisionKind,
            reason: v.reason,
            ...(v.revisionKind === "behavior"
              ? {
                  affectedTaskIds: v.affectedTaskIds,
                  affectedCheckIds: v.affectedCheckIds,
                  impactConfirmed: v.impactConfirmed,
                }
              : {}),
          }
        : {}),
    });
  }
  if (action === "makeReady") {
    fields = [
      select("sourceStatus", "来源核对结果", ["checked", "unable"]),
      field("sourceDescription", "来源说明", "textarea"),
      field("sourceUrl", "来源链接（HTTPS）", "url", false),
      field("sourceReason", "无法核对原因", "textarea", true, {
        when: (v) => v.sourceStatus === "unable",
      }),
    ];
    body = (v) => ({
      action,
      source: {
        ...source(v),
        status: v.sourceStatus,
        ...(v.sourceStatus === "checked"
          ? { checkedAt: v.checkedAt }
          : { reason: v.sourceReason }),
      },
    });
  }
  if (action === "submitAcceptance") {
    path = base + "/submit-acceptance";
    fields = [field("targetVersion", "目标版本")];
    body = (v) => ({ revision: o.revision, targetVersion: v.targetVersion });
  }
  if (action === "acceptance" || action === "returnAcceptance") {
    const returnOnly = action === "returnAcceptance";
    path = base + "/acceptance";
    initial.decision = returnOnly ? "return" : "pass";
    initial.acceptanceRevision = o.revision;
    initial.criteria = o.criteria.map((c: any) => ({
      ...c,
      passed: false,
      note: "",
    }));
    fields = [
      select("decision", "验收结论", ["pass", "return"]),
      field("targetVersion", "目标版本"),
      field("criteria", "逐项验收", "criteria"),
      reason(4000),
      field("reworkTaskIds", "退回返工任务", "multi", false, {
        options: linked
          .filter((x) => x.objectKind === "task")
          .map((x) => ({ value: x.id, label: x.title })),
      }),
      field("bugIds", "关联 Bug", "multi", false, {
        options: linked
          .filter((x) => x.objectKind === "bug")
          .map((x) => ({ value: x.id, label: x.title })),
      }),
    ];
    if (returnOnly) {
      fields.find((f) => f.key === "decision")!.disabled = true;
      fields.find((f) => f.key === "targetVersion")!.disabled = true;
    }
    body = (v) => {
      if (returnOnly && (!o.acceptanceRound || o.acceptanceRound.revision !== o.revision || o.acceptanceRound.targetVersion !== o.acceptanceTargetVersion))
        throw new Error("当前范围没有可记录退回的验收轮次，请返回详情重新核对。");
      return {
      revision: o.revision,
      ...pick(v, [
        "decision",
        "targetVersion",
        "reason",
        "reworkTaskIds",
        "bugIds",
      ]),
      ...(returnOnly ? { decision: "return", targetVersion: o.acceptanceRound.targetVersion } : {}),
      criteria: v.criteria.map((c: any) => ({
        id: c.id,
        passed: c.passed,
        ...(c.note ? { note: c.note } : {}),
      })),
      };
    };
  }
  if (action === "waiver") {
    path = base + "/bug-waivers";
    fields = [
      field("bugId", "延期 Bug", "select", true, {
        options: linked
          .filter((x) => x.objectKind === "bug")
          .map((x) => ({ value: x.id, label: x.title })),
      }),
      reason(4000),
      memberField("followUpOwnerId", "后续跟进人", true),
      field("plan", "延期处理计划", "textarea"),
    ];
    body = (v) => pick(v, ["bugId", "reason", "followUpOwnerId", "plan"]);
  }
  if (action === "update") {
    path = "/api/updates";
    fields = [
      field("workDate", "工作日期", "date"),
      select("contributionType", "实际贡献类型", [
        "development",
        "repair",
        "testing",
        "coordination",
      ]),
      field("done", "今天实际做了什么", "textarea"),
      field("next", "下一步计划", "textarea", false),
      field("obstacle", "遇到的障碍", "textarea", false),
      ...(correction ? [reason()] : []),
    ];
    if (correction) {
      initial = { ...initial, ...correction, correctsId: correction.id };
      title = "更正我的工作更新";
      const type = fields.find((f) => f.key === "contributionType")!;
      type.disabled = true;
      type.help = "更正保留原实际贡献类型；开发或修复参与会影响独立产品验收资格。";
    } else {
      fields.find((f) => f.key === "contributionType")!.help =
        "请选择实际贡献；开发或修复类型会记录执行参与，不能在普通更正中改为其他类型。";
    }
    body = (v) => ({
      target: { kind, id: o.id },
      ...pick(v, ["workDate", "contributionType", "done", "next", "obstacle"]),
      ...(correction ? { contributionType: correction.contributionType } : {}),
      ...(correction ? { correctsId: v.correctsId, reason: v.reason } : {}),
    });
  }
  if (req && !projectOf(o.projectId)?.myRoles.some((r) => r.role === "product"))
    fields = fields.filter((f) => f.key !== "acceptorId");
  scopeMembers(
    fields,
    o.projectId,
    kind,
    kind === "task" && o.kind !== "other" ? o.kind : o.role,
  );
  const longDraft = [
      "assign", "transfer", "requestTransfer", "submit", "checkPass", "checkFail",
      "verifyPass", "verifyFail", "test", "block", "reject", "defineChecks",
      "refine", "revise", "makeReady", "acceptance", "returnAcceptance", "waiver", "update",
    ].includes(action) || (req && action === "cancel" && initial.taskDisposition.length > 0);
  return {
    title,
    path,
    cancelLabel: longDraft ? "返回" : "取消",
    browserDraft: longDraft,
    initial,
    fields,
    body,
    ...(["checkPass", "checkFail", "verifyPass", "verifyFail", "test"].includes(action) ? {
      relatedBugContext: {
        projectId: o.projectId,
        requirementId: req ? o.id : o.requirementId ?? undefined,
        taskId: kind === "task" ? o.id : o.taskId ?? undefined,
        role: kind === "task" && o.kind !== "other" ? o.kind : o.role,
      },
    } : {}),
    adopt: correction
      ? (current, values) => {
          if (typeof current.id === "string") values.correctsId = current.id;
        }
      : ["acceptance", "returnAcceptance"].includes(action)
        ? (current, values) => {
            if (
              !Array.isArray(current.criteria) ||
              typeof current.revision !== "number"
            )
              return;
            const prior = Array.isArray(values.criteria) ? values.criteria : [];
            const definition = (row: any) => ({
              id: row.id,
              text: row.text,
              required: row.required,
              ...(row.exclusionReason
                ? { exclusionReason: row.exclusionReason }
                : {}),
            });
            const changedScope =
              values.acceptanceRevision !== current.revision ||
              JSON.stringify(prior.map(definition)) !==
                JSON.stringify(current.criteria.map(definition));
            if (changedScope) {
              values.previousAcceptanceCriteria = [
                ...(values.previousAcceptanceCriteria ?? []),
                ...prior.map((row: any) => ({
                  ...row,
                  revision: values.acceptanceRevision ?? "未知",
                })),
              ];
            }
            values.criteria = current.criteria.map((criterion: any) => {
              const previous = prior.find(
                (row: any) => row.id === criterion.id,
              );
              return {
                ...criterion,
                passed: !changedScope && previous?.passed === true,
                note: previous?.note ?? "",
              };
            });
            values.acceptanceRevision = current.revision;
            o = { ...o, ...current };
            initial.title = String(current.title ?? initial.title ?? "");
          }
        : undefined,
    ...(req && (action === "refine" || action === "revise") ? {requirementEditor:{mode:action,id:o.id},projectId:o.projectId} : {}),
    submit: req && (action === "refine" || action === "revise") ? "保存修改" : action === "update" ? "保存更新" : `确认${title}`,
    description: `${zh(kind)} · ${o.title} · 当前版本 ${o.version} · 负责人 ${nameOf(o.ownerId ?? o.acceptorId)}`,
    impact: ["cancel", "reopen", "transfer", "assign", "revise"].includes(
      action,
    )
      ? "此操作会改变责任分配或后续工作状态。请核对对象、影响范围与原因后提交。"
      : undefined,
  };
}

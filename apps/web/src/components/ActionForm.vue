<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { request, ApiError } from "../api/client";
import { state, zh, beginMutation } from "../state";
import ADrawer from "ant-design-vue/es/drawer";
import ConflictNotice from "./ConflictNotice.vue";
import AcceptanceReadiness from "./AcceptanceReadiness.vue";
import AButton from "ant-design-vue/es/button";
import AInput from "ant-design-vue/es/input";
import ASelect from "ant-design-vue/es/select";
import ACheckbox from "ant-design-vue/es/checkbox";
import ADatePicker from "ant-design-vue/es/date-picker";
import AForm from "ant-design-vue/es/form";
import type { FormInstance } from "ant-design-vue/es/form";
import AModal from "ant-design-vue/es/modal";
import AAlert from "ant-design-vue/es/alert";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import type { FormSpec, Field } from "../forms";
import {
  BUSINESS_BODY_LIMIT,
  CHECK_ENTRY_LIMIT,
} from "../../../../packages/contracts/src/input-limits";
const returnFocus =
  document.activeElement instanceof HTMLElement
    ? document.activeElement
    : undefined;
const datePopupOpen = ref(false);
const newId = () => crypto.randomUUID();
const props = defineProps<{
  spec: FormSpec;
  draftKey: string;
  version?: number;
  sensitive?: boolean;
}>();
const emit = defineEmits<{ saved: [result: any]; cancel: [] }>();
const expandedForm = computed(
  () =>
    props.spec.fields.length > 4 ||
    props.spec.fields.some((f) =>
      ["definitions", "results", "criteria", "dispositions"].includes(
        f.type ?? "",
      ),
    ),
);
const creationKind = computed(
  () =>
    ({
      "/api/requirements": "requirement",
      "/api/tasks": "task",
      "/api/bugs": "bug",
    })[props.spec.path as "/api/requirements" | "/api/tasks" | "/api/bugs"],
);
// Presentation follows the entry's initial context. Editing or restoring a
// relationship field must never change the form's container mid-command.
const splitTaskDrawer = computed(
  () =>
    props.spec.path === "/api/tasks" &&
    typeof props.spec.initial.requirementId === "string" &&
    !!props.spec.initial.requirementId.trim(),
);
// Standalone evidence and final product acceptance remain page forms.
const pageFormKind = computed(() =>
  creationKind.value && !splitTaskDrawer.value
    ? "creation"
    : props.spec.path === "/api/tests"
      ? "test"
      : /^\/api\/requirements\/[^/]+\/acceptance$/.test(props.spec.path)
        ? "acceptance"
        : undefined,
);
const evidencePage = computed(
  () => pageFormKind.value === "test" || pageFormKind.value === "acceptance",
);
const evidenceContext = computed(() => {
  if (!evidencePage.value) return undefined;
  // An explicit conflict adoption can advance the factory's captured revision.
  // Recompute that context when the user adopts the corresponding version.
  const contextVersion = version.value;
  const body = props.spec.body(props.spec.initial);
  const target =
    pageFormKind.value === "test"
      ? (body.target as { kind: string; id: string })
      : { kind: "requirement", id: props.spec.path.split("/")[3] };
  return {
    version: contextVersion,
    target,
    revision: body.revision,
    title: props.spec.initial.title || props.spec.description || target.id,
  };
});
const pageTitle = computed(() =>
  pageFormKind.value === "test"
    ? "记录测试结论"
    : pageFormKind.value === "acceptance"
      ? "产品验收"
      : creationTitle.value,
);
const pageSubtitle = computed(() =>
  pageFormKind.value === "test"
    ? "逐项记录实际结论，测试证据独立留存。"
    : pageFormKind.value === "acceptance"
      ? "核对当前修订的业务结果，由指定产品验收人独立记录。"
      : creationSubtitle.value,
);
const evidenceTotals = computed(() => {
  const rows: any[] = Array.isArray(values.value.checks)
    ? values.value.checks
    : [];
  const criteria: any[] = Array.isArray(values.value.criteria)
    ? values.value.criteria
    : [];
  return {
    pass: rows.filter((row) => row.result === "pass").length,
    fail: rows.filter((row) => row.result === "fail").length,
    untested: rows.filter(
      (row) => row.result !== "pass" && row.result !== "fail",
    ).length,
    reviewed: criteria.filter((row) => row.passed === true).length,
    remaining: criteria.filter((row) => row.passed !== true).length,
  };
});
const progressDrawer = computed(() => {
  if (props.spec.path === "/api/updates" || splitTaskDrawer.value) return true;
  if (!/^\/api\/(tasks|bugs)\/[^/]+\/actions$/.test(props.spec.path))
    return false;
  const action = props.spec.body(props.spec.initial).action;
  return [
    "submit",
    "checkPass",
    "checkFail",
    "verifyPass",
    "verifyFail",
  ].includes(String(action));
});
const creationProject = computed(() => {
  if (!creationKind.value) return undefined;
  // Creation specs carry project context in their existing pure body projection.
  const projectId = props.spec.body(props.spec.initial).projectId;
  return state.projects.find((project) => project.id === projectId);
});
const creationTitle = computed(() =>
  creationKind.value === "requirement"
    ? "新建需求"
    : creationKind.value === "task"
      ? "新建执行任务"
      : "登记 Bug",
);
const creationSubtitle = computed(() =>
  creationKind.value === "requirement"
    ? "先明确业务目标，再补齐执行与验收所需信息。"
    : creationKind.value === "task"
      ? "把需求拆成能分配、能检查的具体工作。"
      : "清楚记录复现路径、预期与实际结果。",
);
const presentation = computed(() =>
  pageFormKind.value ? "section" : progressDrawer.value ? ADrawer : AModal,
);
const presentationProps = computed(() =>
  pageFormKind.value
    ? {
        role: "dialog",
        "aria-modal": "false",
        "aria-label": props.spec.title,
      }
    : progressDrawer.value
      ? {
          open: true,
          title: props.spec.title,
          placement: "right",
          width: 540,
          closable: !busy.value && !otherPending.value,
          maskClosable: false,
          keyboard: !busy.value && !otherPending.value && !state.expired,
          rootClassName:
            "workbench-progress-drawer mutation-modal workbench-action-modal",
          onClose: cancel,
          onAfterOpenChange: prepareProgressDialog,
        }
      : {
          open: true,
          title: props.spec.title,
          footer: null,
          closable: false,
          maskClosable: false,
          keyboard: !busy.value && !otherPending.value && !state.expired,
          width: expandedForm.value ? 760 : 540,
          onCancel: cancel,
        },
);
const fieldSections = computed(() => {
  const kind =
    pageFormKind.value === "creation" ? creationKind.value : undefined;
  if (!kind && !evidencePage.value)
    return [{ title: "", fields: props.spec.fields }];
  const definitions =
    pageFormKind.value === "test"
      ? [
          { title: "测试上下文", keys: ["targetVersion", "environment"] },
          { title: "逐项记录结论", keys: ["checks"] },
          {
            title: "复用与缺陷关联",
            keys: ["reusedFromId", "reuseReason", "bugId"],
          },
        ]
      : pageFormKind.value === "acceptance"
        ? [
            { title: "验收结论", keys: ["decision", "targetVersion"] },
            { title: "业务验收条目", keys: ["criteria"] },
            {
              title: "验收说明与返工",
              keys: ["reason", "reworkTaskIds", "bugIds"],
            },
          ]
        : kind === "requirement"
          ? [
              { title: "业务目标", keys: ["title", "priority", "role"] },
              {
                title: "原文与细化",
                keys: ["sourceUrl", "sourceDescription", "description"],
              },
              { title: "验收条目", keys: ["criteria", "acceptorId"] },
            ]
          : kind === "task"
            ? [
                {
                  title: "执行工作",
                  keys: ["title", "priority", "requirementId", "kind", "role"],
                },
                {
                  title: "完成与检查",
                  keys: [
                    "definitionOfDone",
                    "ownerId",
                    "reviewerId",
                    "required",
                    "exclusionReason",
                  ],
                },
              ]
            : [
                {
                  title: "缺陷描述",
                  keys: [
                    "title",
                    "priority",
                    "requirementId",
                    "severity",
                    "role",
                    "taskId",
                  ],
                },
                {
                  title: "复现与证据",
                  keys: ["reproduction", "expected", "actual", "environment"],
                },
              ];
  const sections = definitions.map((section) => ({
    title: section.title,
    fields: section.keys.flatMap((key) =>
      props.spec.fields.filter((field) => field.key === key),
    ),
  }));
  const assigned = new Set(definitions.flatMap((section) => section.keys));
  const other = props.spec.fields.filter((field) => !assigned.has(field.key));
  if (other.length) sections.push({ title: "补充信息", fields: other });
  return sections.filter((section) => section.fields.length);
});
const actor = state.member?.id ?? "anonymous";
const storageKey = `workbench:draft:${actor}:${props.draftKey}`;
let stored: any;
try {
  stored = !props.sensitive
    ? JSON.parse(localStorage.getItem(storageKey) ?? "null")
    : null;
} catch {}
const values = ref<Record<string, any>>(
    stored?.values ?? JSON.parse(JSON.stringify(props.spec.initial)),
  ),
  version = ref<number | undefined>(stored?.version ?? props.version),
  busy = ref(false),
  error = ref(""),
  conflict = ref<Record<string, unknown>>(),
  form = ref<FormInstance>(),
  reasons = ref<any[]>([]);
const returnConfirmation = ref(false),
  serverGateOk = ref<boolean>();
const otherPending = computed(() => state.mutationPending && !busy.value);
const acceptancePassBlocked = computed(
  () =>
    pageFormKind.value === "acceptance" &&
    values.value.decision === "pass" &&
    serverGateOk.value !== true,
);
let active = true;
let fingerprint = stored?.fingerprint ?? "",
  key = stored?.key ?? "";
function persist() {
  if (!props.sensitive)
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        values: values.value,
        version: version.value,
        fingerprint,
        key,
      }),
    );
}
watch(values, persist, { deep: true });
async function submit() {
  if (busy.value || otherPending.value || state.expired) return;
  if (
    pageFormKind.value === "acceptance" &&
    values.value.decision === "return"
  ) {
    returnConfirmation.value = true;
    return;
  }
  await send();
}
function dismissReturn() {
  if (!busy.value) returnConfirmation.value = false;
}
async function confirmReturn() {
  if (busy.value || otherPending.value || state.expired) return;
  try {
    await form.value?.validate();
  } catch {
    returnConfirmation.value = false;
    return;
  }
  await send();
}
async function send() {
  if (busy.value) return;
  if (state.expired || otherPending.value || acceptancePassBlocked.value)
    return;
  if (state.member && state.member.id !== actor) {
    error.value = "登录身份已变化，请返回本人工作草稿后再操作。";
    return;
  }
  busy.value = true;
  const release = beginMutation();
  error.value = "";
  reasons.value = [];
  try {
    const body = props.spec.body(values.value);
    if (version.value !== undefined) body.expectedVersion = version.value;
    if (
      new TextEncoder().encode(JSON.stringify(body)).byteLength >
      BUSINESS_BODY_LIMIT
    )
      throw new Error(
        "本次内容超过 4 MiB，请减少条目或说明后再提交；输入已保留。",
      );
    const next = JSON.stringify([
      props.spec.path,
      props.spec.method ?? "POST",
      body,
    ]);
    if (next !== fingerprint) {
      fingerprint = next;
      key = crypto.randomUUID();
    }
    persist();
    const result = await request<any>(props.spec.path, {
      method: props.spec.method ?? "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
    if (!active || state.member?.id !== actor || state.expired) return;
    localStorage.removeItem(storageKey);
    emit("saved", result);
  } catch (e) {
    if (!active || state.member?.id !== actor) return;
    error.value = (e as Error).message;
    if (e instanceof ApiError) {
      conflict.value = e.code === 409 ? e.current : undefined;
      reasons.value = e.reasons ?? [];
    }
  } finally {
    release();
    if (active) busy.value = false;
  }
}
function adopt(current: Record<string, unknown>) {
  if (typeof current.version === "number") {
    version.value = current.version;
    props.spec.adopt?.(current, values.value);
    fingerprint = "";
    key = "";
    conflict.value = undefined;
    error.value = "已采用最新版本，请核对内容后主动提交。";
    persist();
  }
}
function staleAcceptance(current: Record<string, unknown>) {
  serverGateOk.value = undefined;
  conflict.value = current;
  error.value =
    "验收对象已变更，填写内容已保留。请核对并采用最新版本后重新检查验收条件。";
}
function cancel() {
  if (busy.value || returnConfirmation.value) return;
  persist();
  emit("cancel");
}
// Read popup state before its own Escape handler closes it. The modal's
// bubbling cancel event must not interpret that same key as a form cancel.
let popupEscape = false;
function popupKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  popupEscape =
    (event.target as HTMLElement).getAttribute("aria-expanded") === "true" ||
    datePopupOpen.value;
}
function finishPopupKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (returnConfirmation.value || state.expired || otherPending.value) return;
  const popupHandled = popupEscape;
  popupEscape = false;
  if (popupHandled) {
    event.stopPropagation();
    return;
  }
  if (pageFormKind.value) {
    event.stopPropagation();
    cancel();
  }
}
function trapProgressFocus(event: KeyboardEvent) {
  if (
    state.expired ||
    returnConfirmation.value ||
    !progressDrawer.value ||
    event.key !== "Tab" ||
    event.defaultPrevented
  )
    return;
  const dialog = form.value?.$el?.closest('[role="dialog"]') as
    | HTMLElement
    | undefined;
  if (!dialog || !dialog.contains(document.activeElement)) return;
  const controls = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
    ),
  ).filter(
    (element) => element.tabIndex >= 0 && element.getClientRects().length > 0,
  );
  const first = controls[0],
    last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
function prepareProgressDialog(open = true) {
  if (!open || !progressDrawer.value) return;
  // Ant Design Vue 4's Drawer discards arbitrary role/aria attributes in its
  // portal wrapper. Name the actual content node that contains header + form.
  const content = form.value?.$el?.closest(".ant-drawer-content") as
    | HTMLElement
    | undefined;
  content?.setAttribute("role", "dialog");
  content?.setAttribute("aria-modal", "true");
  content?.setAttribute("aria-label", props.spec.title);
}
function rules(f: Field) {
  return [
    {
      validator: async (_rule: unknown, value: any) => {
        if (f.when && !f.when(values.value)) return;
        if (
          f.required &&
          (value === "" ||
            value == null ||
            (f.type === "checkbox" && value !== true))
        )
          throw new Error(`请填写${f.label}`);
        if (typeof value === "string") {
          const max = f.max ?? (f.type === "textarea" ? 6000 : 200);
          if (value.length > max)
            throw new Error(`${f.label}最多 ${max} 个字符`);
          if (value && f.type === "url") {
            try {
              new URL(value);
            } catch {
              throw new Error("请输入有效链接");
            }
          }
          if (value && f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value))
            throw new Error("请输入有效日期");
        }
      },
    },
  ];
}
const textRules = (label: string, max: number, required = false) => [
  { required, message: `请填写${label}` },
  {
    validator: async (_rule: unknown, value: unknown) => {
      // The API measures UTF-16 units; async-validator's max counts codepoints.
      if (typeof value === "string" && value.length > max)
        throw new Error(`${label}最多 ${max} 个字符`);
    },
  },
];
onBeforeRouteLeave(() => !state.mutationPending);
onBeforeRouteUpdate(() => !state.mutationPending);
onMounted(async () => {
  document.addEventListener("keydown", trapProgressFocus);
  await nextTick();
  prepareProgressDialog();
  form.value?.$el?.querySelector("input,textarea,button")?.focus();
});
onUnmounted(() => {
  active = false;
  document.removeEventListener("keydown", trapProgressFocus);
  // Wait until the inline page/portal has left and its parent controls are
  // visible again before restoring the original trigger.
  void nextTick(() => {
    if (returnFocus?.isConnected) returnFocus.focus();
  });
  if (props.sensitive) values.value = {};
});
</script>
<template>
  <Teleport to="#main" :disabled="!pageFormKind">
    <component
      :is="presentation"
      v-bind="presentationProps"
      class="mutation-modal workbench-action-modal"
      :class="{
        'workbench-action-modal-compact': !expandedForm,
        'page-action-form': !!pageFormKind,
        'evidence-page-form': evidencePage,
      }"
    >
      <template v-if="pageFormKind">
        <div class="creation-breadcrumb">
          <AButton type="link" :disabled="busy" @click="cancel"
            >← 返回{{
              evidencePage ? "工作详情" : (creationProject?.name ?? "项目")
            }}</AButton
          ><span>/ {{ pageTitle }}</span>
        </div>
        <header class="creation-heading">
          <span class="eyebrow">{{
            evidencePage
              ? "WORK / " + evidenceContext?.target.id
              : "PROJECT / " + (creationProject?.id ?? "项目工作")
          }}</span>
          <h1>{{ pageTitle }}</h1>
          <p>{{ pageSubtitle }}</p>
        </header>
        <nav
          class="creation-context-nav"
          :aria-label="evidencePage ? '当前工作类型' : '当前创建类型'"
        >
          <span>项目概览</span
          ><span :class="{ active: creationKind === 'requirement' }">需求</span
          ><span :class="{ active: creationKind === 'task' }">任务</span
          ><span :class="{ active: creationKind === 'bug' }">Bug</span
          ><span :class="{ active: evidencePage }">测试与验收</span>
        </nav>
      </template>
      <div
        class="mutation-content"
        @keydown.capture="popupKeydown"
        @keydown="finishPopupKeydown"
      >
        <AForm
          ref="form"
          :model="values"
          layout="vertical"
          @finish="submit"
          :disabled="
            busy || state.expired || otherPending || returnConfirmation
          "
          :required-mark="false"
        >
          <div class="mutation-scroll">
            <p class="mutation-required-note">* 为必填项，其余可选。</p>
            <p
              v-if="(spec.description || splitTaskDrawer) && !evidencePage"
              class="mutation-object"
            >
              {{
                spec.description ||
                `从需求 ${spec.initial.requirementId} 拆分执行任务 · ${creationProject?.name ?? "当前项目"}`
              }}
            </p>
            <AAlert
              v-if="spec.impact"
              type="warning"
              :message="spec.impact"
              show-icon
            />
            <p
              v-if="stored && !sensitive"
              class="mutation-draft-note"
              role="status"
            >
              已恢复此账号的本地草稿；请核对后提交。
            </p>
            <section
              v-for="(section, sectionIndex) in fieldSections"
              :key="section.title"
              class="mutation-field-section"
            >
              <h2 v-if="pageFormKind">{{ section.title }}</h2>
              <div
                v-if="evidencePage && sectionIndex === 0"
                class="form-grid evidence-context-fields"
              >
                <AForm.Item
                  :label="pageFormKind === 'test' ? '被测对象' : '验收对象'"
                  html-for="evidence-target"
                  ><AInput
                    id="evidence-target"
                    :value="evidenceContext?.title"
                    disabled
                /></AForm.Item>
                <AForm.Item label="需求修订" html-for="evidence-revision"
                  ><AInput
                    id="evidence-revision"
                    :value="
                      evidenceContext?.revision
                        ? 'R' + evidenceContext.revision
                        : '独立工作，无关联需求修订'
                    "
                    disabled
                /></AForm.Item>
              </div>
              <details
                v-if="
                  pageFormKind === 'acceptance' &&
                  sectionIndex === 0 &&
                  values.previousAcceptanceCriteria?.length
                "
                class="prior-acceptance-notes"
              >
                <summary>原修订核对记录（仅供参考，不会提交）</summary>
                <p>
                  范围发生变化后，当前条目需要重新核对；原填写说明仍保留在这里。
                </p>
                <p
                  v-for="(row, index) in values.previousAcceptanceCriteria"
                  :key="index"
                >
                  R{{ row.revision }} · {{ row.text ?? row.id }} ·
                  {{ row.passed ? "原已核对" : "原未核对" }}：{{
                    row.note || "未填写说明"
                  }}
                </p>
              </details>
              <div class="form-grid mutation-fields">
                <template v-for="f in section.fields" :key="f.key">
                  <AForm.Item
                    v-if="!f.when || f.when(values)"
                    :name="f.key"
                    :required="!!f.required"
                    :html-for="'field-' + f.key"
                    :rules="rules(f)"
                    :class="{
                      wide:
                        f.wide ||
                        (creationKind && f.key === 'title') ||
                        [
                          'textarea',
                          'definitions',
                          'results',
                          'criteria',
                          'multi',
                          'dispositions',
                        ].includes(f.type ?? ''),
                    }"
                  >
                    <template #label
                      ><span
                        v-if="f.required"
                        class="required-mark"
                        aria-hidden="true"
                      ></span
                      >{{ f.label }}</template
                    >
                    <AInput.TextArea
                      v-if="f.type === 'textarea'"
                      :id="'field-' + f.key"
                      v-model:value="values[f.key]"
                      :placeholder="'请输入' + f.label"
                      :maxlength="f.max ?? 6000"
                      :rows="3"
                    />
                    <ASelect
                      v-else-if="f.type === 'select'"
                      :id="'field-' + f.key"
                      :value="values[f.key]"
                      :options="f.optionsFor ? f.optionsFor(values) : f.options"
                      :placeholder="'请选择' + f.label"
                      :allow-clear="!f.required"
                      :disabled="f.disabled"
                      @update:value="values[f.key] = $event ?? ''"
                    />
                    <ACheckbox.Group
                      v-else-if="f.type === 'multi'"
                      :id="'field-' + f.key"
                      v-model:value="values[f.key]"
                      :options="f.optionsFor ? f.optionsFor(values) : f.options"
                    />
                    <ACheckbox
                      v-else-if="f.type === 'checkbox'"
                      :id="'field-' + f.key"
                      v-model:checked="values[f.key]"
                    />
                    <ADatePicker
                      v-else-if="f.type === 'date'"
                      :id="'field-' + f.key"
                      :value="values[f.key] || undefined"
                      value-format="YYYY-MM-DD"
                      format="YYYY-MM-DD"
                      @openChange="datePopupOpen = $event"
                      @update:value="values[f.key] = $event ?? ''"
                    />
                    <div v-else-if="f.type === 'definitions'">
                      <div
                        v-for="(row, i) in values[f.key]"
                        :key="i"
                        class="check-row mutation-definition"
                      >
                        <div>
                          <AForm.Item
                            required
                            :name="[f.key, i, 'id']"
                            :rules="textRules('条目编号', 128, true)"
                            ><template #label
                              ><span
                                class="required-mark"
                                aria-hidden="true"
                              ></span
                              >条目编号</template
                            ><AInput v-model:value="row.id" :maxlength="128"
                          /></AForm.Item>
                          <AForm.Item
                            required
                            :name="[f.key, i, 'text']"
                            :rules="textRules('条目说明', 2000, true)"
                            ><template #label
                              ><span
                                class="required-mark"
                                aria-hidden="true"
                              ></span
                              >条目说明</template
                            ><AInput.TextArea
                              v-model:value="row.text"
                              :maxlength="2000"
                          /></AForm.Item>
                          <ACheckbox v-model:checked="row.required"
                            >必需条目</ACheckbox
                          >
                          <AForm.Item
                            v-if="!row.required"
                            required
                            :name="[f.key, i, 'exclusionReason']"
                            :rules="textRules('排除原因', 2000, true)"
                            ><template #label
                              ><span
                                class="required-mark"
                                aria-hidden="true"
                              ></span
                              >排除原因</template
                            ><AInput.TextArea
                              v-model:value="row.exclusionReason"
                              :maxlength="2000"
                          /></AForm.Item>
                        </div>
                        <AButton @click="values[f.key].splice(i, 1)"
                          >移除条目</AButton
                        >
                      </div>
                      <AButton
                        :disabled="
                          busy || values[f.key].length >= CHECK_ENTRY_LIMIT
                        "
                        @click="
                          values[f.key].push({
                            id: newId(),
                            text: '',
                            required: true,
                          })
                        "
                        >添加条目</AButton
                      >
                    </div>
                    <div
                      v-else-if="f.type === 'results' || f.type === 'criteria'"
                    >
                      <div
                        v-for="(row, i) in values[f.key]"
                        :key="i"
                        class="check-row mutation-result"
                      >
                        <div>
                          <strong>{{ row.text }}</strong
                          ><small class="muted">
                            · {{ row.checkId ?? row.id }}</small
                          >
                          <AForm.Item
                            label="检查说明"
                            :name="[f.key, i, 'note']"
                            :rules="textRules('检查说明', 4000)"
                            ><AInput.TextArea
                              v-model:value="row.note"
                              :maxlength="4000"
                          /></AForm.Item>
                        </div>
                        <AForm.Item
                          label="条目结果"
                          :html-for="`result-${f.key}-${i}`"
                        >
                          <ASelect
                            v-if="f.type === 'results'"
                            :id="`result-${f.key}-${i}`"
                            v-model:value="row.result"
                            :options="[
                              { value: 'untested', label: '未测' },
                              { value: 'pass', label: '通过' },
                              { value: 'fail', label: '失败' },
                            ]"
                          />
                          <ASelect
                            v-else
                            :id="`result-${f.key}-${i}`"
                            :value="String(row.passed)"
                            :options="[
                              { value: 'false', label: '未通过' },
                              { value: 'true', label: '通过' },
                            ]"
                            @update:value="row.passed = $event === 'true'"
                          />
                        </AForm.Item>
                      </div>
                    </div>
                    <div v-else-if="f.type === 'dispositions'">
                      <div
                        v-for="row in values[f.key]"
                        :key="row.taskId"
                        class="check-row"
                      >
                        <label :for="`disposition-${row.taskId}`"
                          >{{ row.title }}处置</label
                        ><ASelect
                          :id="`disposition-${row.taskId}`"
                          v-model:value="row.disposition"
                          :options="[
                            { value: 'cancel', label: '同步取消' },
                            { value: 'detach', label: '保留为独立任务' },
                          ]"
                        />
                      </div>
                    </div>
                    <AInput
                      v-else
                      :id="'field-' + f.key"
                      v-model:value="values[f.key]"
                      :placeholder="'请输入' + f.label"
                      :type="
                        f.type === 'url'
                          ? 'url'
                          : f.type === 'password'
                            ? 'password'
                            : 'text'
                      "
                      :maxlength="f.max ?? 200"
                      :autocomplete="sensitive ? 'off' : undefined"
                    />
                    <small v-if="f.help" class="muted">{{ f.help }}</small>
                  </AForm.Item>
                  <AForm.Item
                    v-if="
                      creationKind && sectionIndex === 0 && f.key === 'title'
                    "
                    label="所属项目"
                    html-for="field-project-context"
                    ><AInput
                      id="field-project-context"
                      :value="
                        creationProject
                          ? creationProject.name + ' · ' + creationProject.id
                          : '当前项目'
                      "
                      disabled
                  /></AForm.Item>
                </template>
              </div>
              <AAlert
                v-if="
                  creationKind === 'requirement' &&
                  section.title === '原文与细化'
                "
                type="info"
                show-icon
                message="来源由产品人工核对"
                description="平台只保存链接和说明；原文访问遵守来源平台的权限。"
              />
              <p
                v-if="creationKind === 'task' && section.title === '完成与检查'"
                class="creation-permission"
              >
                未分配不等于业务状态。任务保存为待处理后，符合岗位与前置条件的成员才能领取。
              </p>
              <p
                v-if="creationKind === 'bug' && section.title === '复现与证据'"
                class="creation-permission"
              >
                图片证据可在 Bug 创建后单独上传；上传与工作文字分别保存。
              </p>
            </section>
            <ConflictNotice
              v-if="conflict"
              :current="conflict"
              :original-version="version"
              @adopt="adopt"
            />
            <AAlert
              v-else-if="error"
              type="error"
              role="alert"
              :message="error"
              show-icon
            />
            <ul v-if="reasons.length" class="error">
              <li v-for="r in reasons">
                {{
                  typeof r === "string" ? r : (r.message ?? r.code ?? r.reason)
                }}
              </li>
            </ul>
          </div>
          <div class="form-actions mutation-footer">
            <AButton class="mutation-cancel" :disabled="busy" @click="cancel">{{
              sensitive ? "取消" : "返回并保留草稿"
            }}</AButton>
            <AButton
              class="mutation-submit"
              type="primary"
              html-type="submit"
              :disabled="
                busy ||
                state.expired ||
                otherPending ||
                returnConfirmation ||
                !!conflict ||
                acceptancePassBlocked
              "
              :loading="busy"
              >{{
                busy ? "正在提交…" : (spec.submit ?? `确认${spec.title}`)
              }}</AButton
            >
            <span v-if="!sensitive" class="muted mutation-draft-caption"
              >仅保存本账号普通工作草稿</span
            >
          </div>
        </AForm>
        <aside
          v-if="pageFormKind === 'creation'"
          class="creation-guide"
          aria-label="创建填写指引"
        >
          <h2>填写顺序</h2>
          <ol>
            <li>
              <strong>先明确工作对象</strong>
              <p>标题与项目决定协作上下文。</p>
            </li>
            <li>
              <strong>{{
                creationKind === "bug" ? "补充可复现的信息" : "定义可验证的结果"
              }}</strong>
              <p>
                {{
                  creationKind === "bug"
                    ? "区分预期、实际与严重程度。"
                    : "细化说明和完成标准支持后续检查。"
                }}
              </p>
            </li>
            <li>
              <strong>明确下一步处理人</strong>
              <p>
                {{
                  creationKind === "requirement"
                    ? "产品验收人需满足岗位与独立性。"
                    : "创建、分配与领取是分别发生的动作。"
                }}
              </p>
            </li>
          </ol>
          <p class="creation-permission">
            {{
              creationKind === "requirement"
                ? "来源发生变化后，由产品确认影响。新修订不会自动继承旧测试通过结果。"
                : creationKind === "task"
                  ? "同一任务同时只有一名主负责人。历史参与贡献不会因改派变化。"
                  : "Bug 可独立登记，需求与任务关联不是必填。"
            }}
          </p>
        </aside>
        <aside
          v-else-if="evidencePage"
          class="creation-guide evidence-summary"
          :class="{
            'acceptance-server-summary': pageFormKind === 'acceptance',
          }"
          :aria-label="
            pageFormKind === 'test' ? '测试结论摘要' : '验收核对摘要'
          "
        >
          <AcceptanceReadiness
            v-if="
              pageFormKind === 'acceptance' &&
              evidenceContext &&
              version !== undefined
            "
            :requirement-id="evidenceContext.target.id"
            :requirement-version="version"
            :revision="Number(evidenceContext.revision)"
            :target-version="String(values.targetVersion ?? '')"
            embedded
            @status="serverGateOk = $event"
            @stale="staleAcceptance"
          />
          <h2>{{ pageFormKind === "test" ? "结论摘要" : "本次填写摘要" }}</h2>
          <p class="evidence-summary-caption">以下仅汇总本次填写内容。</p>
          <template v-if="pageFormKind === 'test'">
            <div class="evidence-summary-row">
              <span>通过</span
              ><strong class="evidence-count-pass"
                >{{ evidenceTotals.pass }} 项</strong
              >
            </div>
            <div class="evidence-summary-row">
              <span>失败</span
              ><strong class="evidence-count-fail"
                >{{ evidenceTotals.fail }} 项</strong
              >
            </div>
            <div class="evidence-summary-row">
              <span>未测</span><strong>{{ evidenceTotals.untested }} 项</strong>
            </div>
            <p class="creation-permission">
              失败与未测项不代表通过。测试证据保存后，关联对象的状态仍以服务器处理结果为准。
            </p>
          </template>
          <template v-else>
            <div class="evidence-summary-row">
              <span>已核对</span
              ><strong>{{ evidenceTotals.reviewed }} 项</strong>
            </div>
            <div class="evidence-summary-row">
              <span>待核对</span
              ><strong>{{ evidenceTotals.remaining }} 项</strong>
            </div>
            <div class="evidence-summary-row">
              <span>本次结论</span
              ><strong>{{
                values.decision === "pass" ? "验收通过" : "退回返工"
              }}</strong>
            </div>
            <p class="creation-permission">
              提交时由服务器校验当前修订测试、必需任务、关联
              Bug、阻塞情况及验收人身份与独立性。未满足条件时会显示具体拒绝原因，填写内容继续保留。
            </p>
          </template>
          <dl class="evidence-context-summary">
            <div>
              <dt>当前对象</dt>
              <dd>{{ evidenceContext?.title }}</dd>
            </div>
            <div>
              <dt>需求修订</dt>
              <dd>
                {{
                  evidenceContext?.revision
                    ? "R" + evidenceContext.revision
                    : "独立工作"
                }}
              </dd>
            </div>
            <div>
              <dt>记录基于</dt>
              <dd>对象版本 {{ version ?? "—" }}</dd>
            </div>
            <div>
              <dt>目标版本</dt>
              <dd>{{ values.targetVersion || "待填写" }}</dd>
            </div>
            <div>
              <dt>当前填写人</dt>
              <dd>{{ state.member?.displayName }}</dd>
            </div>
          </dl>
          <p class="evidence-summary-caption">
            {{
              pageFormKind === "test"
                ? "测试与产品验收分别留存。本人验证开发或修复结果时，由服务器标记自测。"
                : "本次填写汇总不代表验收门禁已满足；验收通过与上线分别记录。"
            }}
          </p>
        </aside>
      </div>
    </component>
  </Teleport>
  <AModal
    :open="returnConfirmation"
    title="退回产品验收"
    :width="540"
    :z-index="1200"
    class="acceptance-return-modal"
    :mask-closable="false"
    :keyboard="!busy"
    :closable="!busy"
    @cancel="dismissReturn"
  >
    <p class="return-object">
      {{ evidenceContext?.title }} · 修订 R{{ evidenceContext?.revision }} ·
      对象版本 {{ version }}
    </p>
    <AAlert
      type="warning"
      show-icon
      message="确认后将记录本次退回及原因，原测试与验收历史继续保留。"
    />
    <h3>退回原因与说明</h3>
    <p class="return-reason">{{ values.reason }}</p>
    <h3>后续关联工作</h3>
    <p>
      {{
        [...(values.reworkTaskIds ?? []), ...(values.bugIds ?? [])]
          .map(
            (id) =>
              spec.fields
                .flatMap((f) => f.options ?? [])
                .find((o) => o.value === id)?.label ?? id,
          )
          .join("、") || "尚未选择关联返工工作，提交时由服务器校验。"
      }}
    </p>
    <p class="return-note">
      以上内容来自本次填写。取消可继续修改；确认沿用当前修订、版本与原验收命令提交。
    </p>
    <AAlert v-if="error" type="error" role="alert" :message="error" show-icon />
    <template #footer>
      <AButton :disabled="busy" @click="dismissReturn">取消</AButton>
      <AButton
        type="primary"
        :loading="busy"
        :disabled="busy || state.expired || otherPending"
        @click="confirmReturn"
        >确认退回</AButton
      >
    </template>
  </AModal>
</template>

<style>
.prior-acceptance-notes {
  margin: 0 0 20px;
  padding: 14px 16px;
  border: 1px solid #e4e9f1;
  border-radius: 6px;
  background: #f8faff;
}
.prior-acceptance-notes summary {
  color: #245bdb;
  cursor: pointer;
  font-size: 12px;
}
.prior-acceptance-notes p {
  color: #65738b;
  font-size: 12px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.acceptance-return-modal .return-object {
  color: #65738b;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.acceptance-return-modal h3 {
  margin: 22px 0 9px;
  font-size: 13px;
  color: #334562;
}
.acceptance-return-modal .return-reason {
  padding: 14px 16px;
  background: #f8faff;
  border: 1px solid #e4e9f1;
  border-radius: 6px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.acceptance-return-modal .return-note {
  color: #738097;
  font-size: 12px;
  line-height: 1.8;
}
.workbench-action-modal.ant-modal {
  top: 64px;
  padding-bottom: 24px;
  max-width: calc(100vw - 32px);
}
.workbench-action-modal .ant-modal-content {
  padding: 0;
  overflow: hidden;
  border-radius: 8px;
}
.workbench-action-modal .ant-modal-header {
  margin: 0;
  padding: 21px 24px;
  border-bottom: 1px solid #e4e9f1;
}
.workbench-action-modal .ant-modal-title {
  font-size: 17px;
  font-weight: 600;
  color: #17243b;
}
.workbench-action-modal .ant-modal-body {
  padding: 0;
}
.workbench-action-modal .mutation-content > .ant-form {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 154px);
}
.workbench-action-modal .mutation-scroll {
  padding: 22px 24px 8px;
  overflow-y: auto;
  overscroll-behavior: contain;
  min-height: 0;
}
.workbench-action-modal .mutation-object {
  margin: 0 0 22px;
  padding: 15px 17px;
  border: 1px solid #e4e9f1;
  border-radius: 6px;
  background: #f8fafc;
  color: #526580;
  font-size: 13px;
  line-height: 1.9;
  overflow-wrap: anywhere;
}
.workbench-action-modal .mutation-draft-note {
  padding: 11px 14px;
  border-radius: 6px;
  background: #edf3ff;
  color: #42659b;
  font-size: 12px;
  margin: 0 0 20px;
}
.workbench-action-modal .mutation-required-note {
  margin: 0 0 20px;
  color: #58677d;
  font-size: 12px;
}
.workbench-action-modal .required-mark::before {
  content: "*";
  margin-right: 4px;
  color: #ff4d4f;
}
.workbench-action-modal .mutation-fields {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 22px;
  row-gap: 0;
}
.workbench-action-modal .ant-form-item {
  margin-bottom: 20px;
}
.workbench-action-modal .ant-form-item-label > label {
  font-size: 13px;
  color: #526076;
  height: auto;
}
.workbench-action-modal .ant-form-item-extra,
.workbench-action-modal .ant-form-item small {
  font-size: 12px;
  line-height: 1.8;
}
.workbench-action-modal .ant-input,
.workbench-action-modal .ant-select,
.workbench-action-modal .ant-picker {
  font-size: 13px;
}
.workbench-action-modal textarea.ant-input {
  line-height: 1.8;
  min-height: 82px;
}
.workbench-action-modal .check-row {
  margin: 0 0 14px;
  padding: 16px;
  background: #fafbfd;
  border: 1px solid #e4e9f1;
  border-radius: 6px;
  grid-template-columns: minmax(0, 1fr) 130px;
  gap: 16px;
}
.workbench-action-modal .check-row > .ant-btn {
  align-self: start;
}
.workbench-action-modal .mutation-result strong {
  font-size: 13px;
  font-weight: 500;
  color: #24344d;
}
.workbench-action-modal .mutation-result small {
  overflow-wrap: anywhere;
}
.workbench-action-modal .mutation-definition .ant-form-item {
  margin-bottom: 14px;
}
.workbench-action-modal .mutation-result .ant-form-item {
  margin: 14px 0 0;
}
.workbench-action-modal .mutation-result > .ant-form-item {
  margin-top: 0;
  min-width: 0;
}
.workbench-action-modal .ant-checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}
.workbench-action-modal .ant-checkbox-wrapper {
  line-height: 1.7;
  white-space: normal;
  margin-inline-start: 0;
}
.workbench-action-modal .mutation-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0;
  padding: 17px 24px;
  border-top: 1px solid #e4e9f1;
  background: #fafbfd;
  flex-shrink: 0;
}
.workbench-action-modal .mutation-footer .ant-btn {
  min-height: 34px;
}
.workbench-action-modal .mutation-submit {
  order: 3;
}
.workbench-action-modal .mutation-cancel {
  order: 2;
}
.workbench-action-modal .mutation-draft-caption {
  order: 1;
  margin-right: auto;
  font-size: 11px;
  color: #697890;
}
.workbench-action-modal-compact .mutation-fields {
  grid-template-columns: minmax(0, 1fr);
}
.page-action-form.mutation-modal {
  min-width: 0;
  width: 100%;
  max-width: none;
}
.page-action-form .creation-breadcrumb {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  color: #738097;
  font-size: 12px;
}
.page-action-form .creation-breadcrumb .ant-btn {
  padding: 0;
  height: auto;
  font-size: 12px;
  white-space: normal;
  text-align: left;
}
.page-action-form .creation-heading .eyebrow {
  display: block;
  font-size: 11px;
  letter-spacing: 1.2px;
  margin-bottom: 9px;
  color: #697890;
  overflow-wrap: anywhere;
}
.page-action-form .creation-heading h1 {
  font-size: 28px;
  margin: 0;
  line-height: 1.4;
  color: #17243b;
}
.page-action-form .creation-heading p {
  font-size: 13px;
  color: #65738b;
  margin: 10px 0 0;
}
.page-action-form .creation-context-nav {
  display: flex;
  gap: 26px;
  border-bottom: 1px solid #e4e9f1;
  margin: 22px 0 24px;
  overflow-x: auto;
}
.page-action-form .creation-context-nav span {
  padding-bottom: 14px;
  white-space: nowrap;
  font-size: 13px;
  color: #65738b;
  border-bottom: 2px solid transparent;
}
.page-action-form .creation-context-nav .active {
  color: #245bdb;
  border-bottom-color: #245bdb;
  font-weight: 600;
}
.page-action-form .mutation-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 285px;
  gap: 24px;
  align-items: start;
}
.page-action-form .mutation-content > .ant-form {
  max-height: none;
  min-width: 0;
  border: 1px solid #e4e9f1;
  border-radius: 8px;
  background: white;
  overflow: hidden;
}
.page-action-form .mutation-scroll {
  overflow: visible;
  padding: 26px 26px 4px;
}
.page-action-form .mutation-field-section + .mutation-field-section {
  border-top: 1px solid #e4e9f1;
  margin-top: 8px;
  padding-top: 25px;
}
.page-action-form .mutation-field-section > h2 {
  margin: 0 0 22px;
  font-size: 15px;
  font-weight: 600;
  color: #17243b;
}
.page-action-form .ant-form-item {
  margin-bottom: 22px;
}
.page-action-form .creation-guide {
  border: 1px solid #e4e9f1;
  border-radius: 8px;
  background: white;
  padding: 24px 20px;
  min-width: 0;
}
.page-action-form .creation-guide h2 {
  margin: 0 0 22px;
  font-size: 15px;
  color: #17243b;
}
.page-action-form .creation-guide ol {
  counter-reset: steps;
  list-style: none;
  margin: 0;
  padding: 0;
}
.page-action-form .creation-guide li {
  position: relative;
  counter-increment: steps;
  padding-left: 34px;
  margin-bottom: 24px;
  font-size: 12px;
  color: #65738b;
  line-height: 1.8;
}
.page-action-form .creation-guide li::before {
  content: counter(steps);
  position: absolute;
  left: 0;
  top: 0;
  width: 23px;
  height: 23px;
  line-height: 23px;
  border-radius: 50%;
  text-align: center;
  background: #edf3ff;
  color: #3c69ca;
  font-size: 11px;
}
.page-action-form .creation-guide strong {
  display: block;
  color: #334562;
  font-weight: 500;
}
.page-action-form .creation-guide p {
  margin: 5px 0 0;
}
.page-action-form .creation-permission {
  padding: 16px 18px;
  border: 1px solid #e1e9f5;
  border-radius: 6px;
  background: #f8faff;
  color: #65738b;
  font-size: 12px;
  line-height: 1.9;
  margin: 0 0 22px;
}
.page-action-form .creation-guide > .creation-permission {
  margin-bottom: 0;
}
.evidence-page-form .evidence-context-fields {
  gap: 0 22px;
}
.evidence-page-form .mutation-result {
  padding: 18px 0;
  border: 0;
  border-bottom: 1px solid #e4e9f1;
  border-radius: 0;
  background: white;
}
.evidence-page-form .mutation-result:last-child {
  margin-bottom: 0;
}
.evidence-page-form .evidence-row-number {
  color: #24344d;
}
.evidence-page-form .mutation-result > .ant-form-item {
  align-self: start;
}
.evidence-summary .evidence-summary-caption {
  margin: 0 0 17px;
  font-size: 12px;
  line-height: 1.9;
  color: #697890;
}
.evidence-summary .evidence-summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid #e4e9f1;
  font-size: 13px;
  color: #334562;
}
.evidence-summary .evidence-summary-row > strong {
  font-size: 12px;
  font-weight: 500;
  padding: 2px 7px;
  border-radius: 4px;
  background: #f1f4f9;
  color: #617186;
}
.evidence-summary .evidence-summary-row > .evidence-count-pass {
  background: #eaf7ef;
  color: #257554;
}
.evidence-summary .evidence-summary-row > .evidence-count-fail {
  background: #fff1f1;
  color: #b34444;
}
.evidence-summary .creation-permission {
  margin: 20px 0;
}
.evidence-summary .evidence-context-summary {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 0 0 22px;
  font-size: 12px;
  line-height: 1.8;
}
.evidence-summary .evidence-context-summary > div {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 10px;
}
.evidence-summary .evidence-context-summary dt {
  color: #738097;
}
.evidence-summary .evidence-context-summary dd {
  margin: 0;
  color: #334562;
  overflow-wrap: anywhere;
}
.workbench-progress-drawer .ant-drawer-header {
  padding: 23px 25px;
  border-bottom: 1px solid #e4e9f1;
}
.workbench-progress-drawer .ant-drawer-title {
  font-size: 17px;
  color: #17243b;
}
.workbench-progress-drawer .ant-drawer-content-wrapper {
  max-width: 100vw;
}
.workbench-progress-drawer .ant-drawer-content {
  max-width: 100%;
}
.workbench-progress-drawer.ant-drawer {
  max-width: none;
}
.workbench-progress-drawer .ant-drawer-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}
.workbench-progress-drawer .mutation-content {
  height: 100%;
  min-height: 0;
}
.workbench-progress-drawer .mutation-content > .ant-form {
  height: 100%;
  max-height: none;
}
.workbench-progress-drawer .mutation-scroll {
  flex: 1;
  padding: 25px 25px 8px;
}
.workbench-progress-drawer .mutation-fields {
  grid-template-columns: minmax(0, 1fr);
}
.workbench-progress-drawer .mutation-footer {
  padding: 17px 25px;
}
.workbench-progress-drawer .mutation-field-section {
  min-width: 0;
}
@media (max-width: 1150px) {
  .page-action-form .mutation-content {
    grid-template-columns: minmax(0, 1fr) 240px;
    gap: 18px;
  }
}
@media (max-width: 850px) {
  .page-action-form .mutation-content {
    grid-template-columns: minmax(0, 1fr);
  }
  .page-action-form .creation-guide {
    display: none;
  }
  .page-action-form .creation-guide.acceptance-server-summary {
    display: block;
  }
}
@media (max-width: 600px) {
  .acceptance-return-modal.ant-modal {
    max-width: calc(100vw - 24px);
    margin: auto;
  }
  .workbench-action-modal.ant-modal {
    top: 16px;
    max-width: calc(100vw - 24px);
    margin: auto;
    padding-bottom: 16px;
  }
  .workbench-action-modal .ant-modal-header {
    padding: 19px 18px;
  }
  .workbench-action-modal .mutation-content > .ant-form {
    max-height: calc(100dvh - 101px);
  }
  .workbench-action-modal .mutation-scroll {
    padding: 19px 18px 4px;
  }
  .workbench-action-modal .mutation-fields {
    grid-template-columns: minmax(0, 1fr);
  }
  .workbench-action-modal .mutation-object {
    padding: 13px 14px;
  }
  .workbench-action-modal .ant-input,
  .workbench-action-modal .ant-select,
  .workbench-action-modal .ant-picker input {
    font-size: 16px;
  }
  .workbench-action-modal .mutation-footer {
    padding: 15px 18px;
    gap: 10px 8px;
  }
  .workbench-action-modal .mutation-draft-caption {
    flex-basis: 100%;
    margin: 0;
  }
  .workbench-action-modal .mutation-footer .ant-btn {
    max-width: 100%;
    min-height: 36px;
    height: auto;
    white-space: normal;
  }
  .workbench-action-modal .check-row {
    grid-template-columns: minmax(0, 1fr);
    padding: 13px;
    gap: 12px;
  }
  .workbench-action-modal .check-row > .ant-form-item {
    min-width: 0;
  }
  .page-action-form .creation-heading h1 {
    font-size: 24px;
  }
  .page-action-form .creation-context-nav {
    gap: 23px;
    margin-bottom: 20px;
  }
  .page-action-form .mutation-content > .ant-form {
    max-height: none;
  }
  .page-action-form .mutation-scroll {
    padding: 20px 18px 0;
  }
  .page-action-form .mutation-field-section + .mutation-field-section {
    padding-top: 24px;
    margin-top: 4px;
  }
  .page-action-form .mutation-footer {
    position: sticky;
    bottom: 0;
  }
  .evidence-page-form .mutation-result {
    grid-template-columns: minmax(0, 1fr) 120px;
    gap: 12px;
  }
  .workbench-progress-drawer .ant-drawer-header {
    padding: 19px 18px;
  }
  .workbench-progress-drawer .mutation-content > .ant-form {
    max-height: none;
  }
  .workbench-progress-drawer .mutation-scroll {
    padding: 20px 18px 4px;
  }
}
</style>

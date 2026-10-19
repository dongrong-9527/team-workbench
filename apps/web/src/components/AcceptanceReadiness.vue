<script setup lang="ts">
import { ref, watch } from "vue";
import AAlert from "ant-design-vue/es/alert";
import AButton from "ant-design-vue/es/button";
import CheckCircleOutlined from "@ant-design/icons-vue/CheckCircleOutlined";
import CloseCircleOutlined from "@ant-design/icons-vue/CloseCircleOutlined";
import { request } from "../api/client";
import { state, zh } from "../state";
import { useReadScope } from "../composables/readScope";
import type { AcceptanceReadiness } from "../../../../packages/contracts/src/index";

const props = defineProps<{
  requirementId: string;
  requirementVersion: number;
  revision: number;
  targetVersion: string;
  embedded?: boolean;
}>();
const emit = defineEmits<{
  status: [ready: boolean | undefined];
  stale: [current: Record<string, unknown>];
}>();
const snapshot = ref<AcceptanceReadiness>();
const loading = ref(false);
const error = ref("");
const identity = () =>
  JSON.stringify([
    state.member?.id,
    state.expired,
    props.requirementId,
    props.requirementVersion,
    props.revision,
    props.targetVersion,
  ]);
const reads = useReadScope(identity);
const labels = {
  tasks: "必需任务全部完成",
  tests: "当前修订必测项通过",
  bugs: "关联 Bug 闭环",
  unblocked: "范围明确且没有阻塞",
  acceptor: "验收人身份与独立性符合",
};
const reasons: Record<string, string> = {
  SCOPE_UNCONFIRMED: "需求范围尚未确认",
  BLOCKED: "需求、任务或 Bug 仍有执行阻塞",
  INVALID_ACCEPTOR: "指定验收人当前不具备本项目产品权限",
  ACCEPTOR_PARTICIPATED: "指定验收人参与过开发或修复，需要独立验收人",
  REQUIRED_CRITERIA_NOT_PASSED: "当前修订必测项未全部通过",
  REQUIRED_TASK_NOT_DONE: "必需任务尚未全部完成",
  INVALID_TASK_OWNER: "必需任务负责人当前不具备执行权限",
  INVALID_TASK_REVIEWER: "必需任务检查人身份或独立性不符合",
  REQUIRED_TASK_TESTS_NOT_PASSED:
    "必需任务在当前修订与目标版本的测试未全部通过",
  BUG_TESTS_NOT_PASSED: "已关闭 Bug 在当前修订与目标版本的验证未全部通过",
  INVALID_BUG_LINK: "关联 Bug 的项目关系需要核对",
  OPEN_CRITICAL_BUG: "严重 Bug 尚未闭环，不能豁免",
  OPEN_BUG: "一般或轻微 Bug 尚未闭环，且没有当前版本的有效延期",
};
function valid(value: AcceptanceReadiness) {
  return (
    value &&
    typeof value.ok === "boolean" &&
    value.requirementId === props.requirementId &&
    value.targetVersion === props.targetVersion &&
    Number.isSafeInteger(value.requirementVersion) &&
    Number.isSafeInteger(value.revision) &&
    value.total === 5 &&
    Number.isInteger(value.satisfied) &&
    value.satisfied >= 0 &&
    value.satisfied <= 5 &&
    Array.isArray(value.conditions) &&
    value.conditions.length === 5 &&
    new Set(value.conditions.map((c) => c.id)).size === 5 &&
    value.conditions.every(
      (c) =>
        c.id in labels &&
        typeof c.passed === "boolean" &&
        Array.isArray(c.reasons) &&
        c.reasons.every((r) => typeof r === "string"),
    ) &&
    value.requirement?.id === value.requirementId &&
    value.requirement.version === value.requirementVersion &&
    value.requirement.revision === value.revision &&
    Array.isArray(value.bugs) &&
    value.tasks &&
    value.criteria &&
    value.bugSummary &&
    value.acceptor
  );
}
async function load() {
  const read = reads.begin();
  if (!read) return;
  snapshot.value = undefined;
  error.value = "";
  emit("status", undefined);
  if (state.expired) {
    loading.value = false;
    error.value = "登录已过期，请重新登录。";
    return;
  }
  loading.value = true;
  try {
    const value = await request<AcceptanceReadiness>(
      `/api/requirements/${encodeURIComponent(props.requirementId)}/acceptance-readiness?targetVersion=${encodeURIComponent(props.targetVersion)}`,
      { cache: "no-store" },
    );
    if (!read.valid()) return;
    if (!valid(value)) throw new Error("验收条件数据无法读取，请刷新重试。");
    if (
      value.requirementVersion !== props.requirementVersion ||
      value.revision !== props.revision
    ) {
      error.value = "需求版本已变化，请核对最新记录后重新读取验收条件。";
      emit("stale", value.requirement as unknown as Record<string, unknown>);
      return;
    }
    read.commit(() => {
      snapshot.value = value;
      emit("status", value.ok && !value.archived);
    });
  } catch (e) {
    if (read.valid()) error.value = (e as Error).message;
  } finally {
    read.finish(() => {
      loading.value = false;
    });
  }
}
watch(identity, load, { immediate: true });
</script>

<template>
  <section
    class="acceptance-readiness"
    :class="{ embedded }"
    aria-label="验收条件"
  >
    <header class="readiness-heading">
      <h2>验收条件</h2>
      <span
        v-if="snapshot"
        class="readiness-count"
        :class="{ ready: snapshot.ok }"
        >{{ snapshot.satisfied }} / {{ snapshot.total }} 满足</span
      >
    </header>
    <div class="readiness-body">
      <p v-if="loading" role="status" class="readiness-status">
        正在读取当前验收条件…
      </p>
      <AAlert
        v-if="error"
        type="error"
        show-icon
        role="alert"
        :message="error"
      />
      <template v-if="snapshot">
        <AAlert
          :type="snapshot.ok ? 'success' : 'error'"
          show-icon
          :message="
            snapshot.ok
              ? '验收条件已满足，可核对业务结果'
              : '验收条件尚未满足，暂不能通过'
          "
        />
        <p v-if="snapshot.archived" class="readiness-caption">
          项目已归档，当前仅可阅读。
        </p>
        <ol class="readiness-conditions">
          <li v-for="condition in snapshot.conditions" :key="condition.id">
            <component
              :is="condition.passed ? CheckCircleOutlined : CloseCircleOutlined"
              :class="condition.passed ? 'condition-pass' : 'condition-fail'"
              aria-hidden="true"
            />
            <div>
              <strong>{{ labels[condition.id] }}</strong>
              <p v-if="condition.id === 'tasks'">
                {{ snapshot.tasks.completed }} /
                {{ snapshot.tasks.required }} 项必需任务完成
              </p>
              <p v-else-if="condition.id === 'tests'">
                需求必测项：{{ snapshot.criteria.passed }} 项通过，{{
                  snapshot.criteria.failed
                }}
                项失败，{{ snapshot.criteria.untested }} 项未测
              </p>
              <p v-else-if="condition.id === 'bugs'">
                未闭环 {{ snapshot.bugSummary.open }} 项 · 当前有效延期
                {{ snapshot.bugSummary.waived }} 项
              </p>
              <p v-else-if="condition.id === 'acceptor'">
                {{ snapshot.acceptor.name }}
              </p>
              <p
                v-for="reason in condition.reasons"
                :key="reason"
                class="readiness-reason"
              >
                {{ reasons[reason] ?? reason }}
              </p>
              <div
                v-if="condition.id === 'bugs' && snapshot.bugs.length"
                class="readiness-bugs"
                tabindex="0"
                aria-label="关联 Bug"
              >
                <RouterLink
                  v-for="bug in snapshot.bugs"
                  :key="bug.id"
                  :to="'/bug/' + bug.id"
                  >{{ bug.title
                  }}<small
                    >{{ zh(bug.severity) }} · {{ zh(bug.state)
                    }}{{ bug.waived ? " · 当前版本有效延期" : "" }}</small
                  ></RouterLink
                >
              </div>
            </div>
          </li>
        </ol>
        <p class="readiness-caption">
          当前修订 R{{ snapshot.revision }} · 目标版本
          {{ snapshot.targetVersion || "待填写" }}<br />读取于
          {{
            snapshot.checkedAt
          }}。提交仍由服务器重新核验；验收通过与上线分别记录。
        </p>
      </template>
      <AButton :disabled="loading || state.expired" @click="load"
        >刷新验收条件</AButton
      >
    </div>
  </section>
</template>

<style scoped>
.acceptance-readiness {
  min-width: 0;
  border: 1px solid #e4e9f1;
  border-radius: 8px;
  background: white;
  overflow: hidden;
}
.readiness-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 22px;
  border-bottom: 1px solid #e4e9f1;
}
.readiness-heading h2 {
  margin: 0;
  color: #17243b;
  font-size: 15px;
}
.readiness-count {
  border: 1px solid #f2d7d7;
  border-radius: 4px;
  padding: 3px 7px;
  font-size: 11px;
  color: #c33535;
  background: #fff3f3;
  white-space: nowrap;
}
.readiness-count.ready {
  color: #17855f;
  background: #edf8f2;
  border-color: #cee8db;
}
.readiness-body {
  padding: 20px 22px;
}
.readiness-status,
.readiness-caption {
  font-size: 12px;
  line-height: 1.9;
  color: #65738b;
  overflow-wrap: anywhere;
}
.readiness-conditions {
  list-style: none;
  margin: 0;
  padding: 0;
}
.readiness-conditions li {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 10px;
  padding: 20px 0;
  border-bottom: 1px solid #e4e9f1;
}
.readiness-conditions li > .anticon {
  padding-top: 4px;
  font-size: 15px;
}
.condition-pass {
  color: #219b70;
}
.condition-fail {
  color: #d84545;
}
.readiness-conditions strong {
  color: #263752;
  font-size: 12px;
  line-height: 1.8;
}
.readiness-conditions p {
  margin: 5px 0 0;
  color: #65738b;
  font-size: 12px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.readiness-conditions .readiness-reason {
  color: #b63a3a;
}
.readiness-bugs {
  max-height: 190px;
  overflow: auto;
  margin-top: 8px;
}
.readiness-bugs a {
  display: block;
  padding: 5px 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.readiness-bugs small {
  display: block;
  color: #738097;
  font-size: 11px;
}
.readiness-caption {
  margin: 18px 0;
}
.embedded {
  border: 0;
  border-radius: 0;
  overflow: visible;
}
.embedded .readiness-heading {
  padding: 0 0 18px;
}
.embedded .readiness-body {
  padding: 18px 0;
}
@media (max-width: 600px) {
  .readiness-heading,
  .readiness-body {
    padding: 18px;
  }
  .embedded .readiness-heading {
    padding: 0 0 16px;
  }
  .embedded .readiness-body {
    padding: 16px 0;
  }
}
</style>

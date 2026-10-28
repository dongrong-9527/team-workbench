<script setup lang="ts">
import AAlert from "ant-design-vue/es/alert";
import AButton from "ant-design-vue/es/button";
import { ref, computed, watch } from "vue";
import { useReadScope } from "../composables/readScope";
import { useRoute, useRouter } from "vue-router";
import { request, allPages, allSeqPages } from "../api/client";
import {
  state,
  zh,
  nameOf,
  projectOf,
  objectPath,
  refreshProject,
} from "../state";
import { actionForm, actionNames, createForm, type FormSpec } from "../forms";
import ActionForm from "./ActionForm.vue";
import HistoryList from "./HistoryList.vue";
import AttachmentPanel from "./AttachmentPanel.vue";
import AcceptanceReadiness from "./AcceptanceReadiness.vue";
import AInput from "ant-design-vue/es/input";
import type {
  SeqPage,
  WorkUpdate,
} from "../../../../packages/contracts/src/index";
const props = defineProps<{ kind: string }>(),
  route = useRoute(),
  router = useRouter();
const o = ref<any>(),
  parent = ref<any>(),
  linked = ref<any[]>([]),
  tests = ref<any[]>([]),
  acceptances = ref<any[]>([]),
  revisions = ref<any[]>([]),
  updates = ref<WorkUpdate[]>([]),
  error = ref(""),
  busy = ref(false),
  form = ref<FormSpec>(),
  action = ref(""),
  draftAction = ref(""),
  formVersion = ref<number>(),
  refresh = ref(0),
  notice = ref(""),
  tab = ref("details");
const acceptanceTarget = ref("");
const detailReady = computed(() => !!o.value && !busy.value && !error.value);
const plural = computed(() =>
  props.kind === "requirement"
    ? "requirements"
    : props.kind === "task"
      ? "tasks"
      : "bugs",
);
const reads = useReadScope(() => JSON.stringify([props.kind, route.params.id]));
async function load() {
  const read = reads.begin();
  if (!read) return;
  const kind = props.kind,
    id = String(route.params.id),
    collection = plural.value;
  busy.value = true;
  error.value = "";
  try {
    const object = await request<any>(`/api/${collection}/${id}`);
    if (!read.valid()) return;
    const [related, mine] = await Promise.all([
      loadRelated(object, kind, read.valid),
      loadUpdates(id, read.valid),
      refreshProject(object.projectId, read.valid),
    ]);
    read.commit(() => {
      o.value = object;
      acceptanceTarget.value = object.acceptanceTargetVersion ?? "";
      linked.value = related.all;
      tests.value = related.records;
      acceptances.value = related.acceptances;
      revisions.value = related.revisions;
      parent.value = related.parent;
      updates.value = mine;
      refresh.value++;
    });
  } catch (e) {
    if (read.valid()) error.value = (e as Error).message;
  } finally {
    read.finish(() => {
      busy.value = false;
    });
  }
}
async function loadRelated(object: any, kind: string, valid: () => boolean) {
  const [all, records, acceptances, revisions, parent] = await Promise.all([
    allPages<any>("/api/objects?projectId=" + object.projectId, valid),
    allSeqPages<any>(`/api/tests?kind=${kind}&id=${object.id}`, valid),
    kind === "requirement"
      ? allSeqPages<any>(`/api/requirements/${object.id}/acceptance`, valid)
      : Promise.resolve([]),
    kind === "requirement"
      ? allSeqPages<any>(
          `/api/requirements/${object.id}/revision-history`,
          valid,
        )
      : Promise.resolve([]),
    kind === "requirement"
      ? Promise.resolve(object)
      : object.requirementId
        ? request(`/api/requirements/${object.requirementId}`)
        : Promise.resolve(null),
  ]);
  return { all, records, acceptances, revisions, parent };
}
async function loadUpdates(id: string, valid: () => boolean) {
  const all = await allSeqPages<WorkUpdate>("/api/updates", valid);
  return all.filter((u) => u.target.id === id);
}
watch(() => [route.params.id, props.kind], load, { immediate: true });
const project = computed(() =>
    o.value ? projectOf(o.value.projectId) : undefined,
  ),
  roles = computed(() => project.value?.myRoles ?? []),
  has = (r: string) => roles.value.some((x) => x.role === r),
  scope = computed(() =>
    props.kind === "task" && o.value.kind !== "other"
      ? o.value.kind
      : o.value?.role,
  ),
  lead = computed(() =>
    roles.value.some((x) => x.role === scope.value && x.lead),
  ),
  manage = computed(() => has("product") || lead.value),
  own = computed(
    () => o.value?.ownerId === state.member?.id && has(scope.value),
  ),
  canTest = computed(() =>
    props.kind === "task"
      ? o.value?.reviewerId === state.member?.id &&
        (["frontend", "backend"].includes(scope.value)
          ? has("test")
          : has("product") || lead.value)
      : has("test"),
  );
const parentNotExecutable = computed(() =>
  props.kind === "task" && !!o.value?.requirementId &&
  (!parent.value || !["ready", "active"].includes(parent.value.state) || !parent.value.scopeConfirmed || parent.value.blocked),
);
const actions = computed(() => {
  if (!o.value || project.value?.archived) return [];
  const x = o.value,
    s = x.state,
    a: string[] = [];
  if (roles.value.length) a.push("update");
  if (props.kind === "requirement") {
    if (roles.value.length && s !== "cancelled") a.push("suggestChange");
    if (manage.value) {
      if (["draft", "refining"].includes(s)) a.push("refine");
      if (has("product")) {
        if (["refining", "active"].includes(s)) a.push("makeReady");
        if (s === "ready") a.push("start");
        if (s !== "cancelled") {
          a.push("revise");
          if (["draft", "refining", "ready", "active", "pending_acceptance"].includes(s)) a.push("cancel");
        }
        else a.push("restore");
      }
    }
    if (has("test") && s !== "cancelled" && x.scopeConfirmed && !x.blocked) a.push("test");
    if (manage.value && s === "active") a.push("submitAcceptance");
    if (has("product")) a.push("waiver");
    if (has("product") && x.acceptorId === state.member?.id) {
      if (s === "pending_acceptance") a.push("acceptance");
      else if (["active", "accepted"].includes(s) && x.acceptanceRound) a.push("returnAcceptance");
    }
  } else {
    if (
      !x.ownerId &&
      !parentNotExecutable.value &&
      has(scope.value) &&
      s === (props.kind === "task" ? "pending" : "ready")
    )
      a.push("claim");
    if (own.value) {
      if (!parentNotExecutable.value) {
        if (["pending", "ready"].includes(s)) a.push("start");
        if (["active", "fixing"].includes(s)) a.push("submit");
      }
      if (props.kind === "task") a.push("requestTransfer");
    }
    if (
      manage.value &&
      !["done", "cancelled", "closed", "rejected"].includes(s)
    )
      a.push(x.ownerId ? "transfer" : "assign");
    if (manage.value || own.value) a.push(x.blocked ? "unblock" : "block");
    if (props.kind === "task") {
      if (manage.value) {
        if (s === "pending") a.push("refine");
        if (["done", "cancelled"].includes(s)) a.push("reopen");
        else a.push("cancel");
        a.push("setDependencies", "designateReviewer");
        if (has("product")) a.push("defineChecks", "setRequired");
        if (lead.value) a.push("approveParallel");
      }
      if (canTest.value && ["pending_check", "done"].includes(s))
        a.push("checkPass", "checkFail", "test");
    } else {
      if (has("product") || has("test")) {
        if (s === "unconfirmed") a.push("confirm", "reject");
        if (["closed", "rejected"].includes(s)) a.push("reopen");
      }
      if (
        s === "unconfirmed" &&
        (manage.value ||
          (x.reporterId === state.member?.id && roles.value.length))
      )
        a.push("refine");
      if (has("product")) a.push("defineChecks");
      if (canTest.value && ["pending_verify", "closed"].includes(s))
        a.push("verifyPass", "verifyFail", "test");
    }
  }
  return a;
});
// Presentation hierarchy only: the existing permission/state-derived action list remains authoritative.
const primaryAction = computed(() =>
  [
    "claim",
    "submit",
    "acceptance",
    "returnAcceptance",
    "submitAcceptance",
    "start",
    "checkPass",
    "verifyPass",
    "makeReady",
    "confirm",
  ].find((a) => actions.value.includes(a)),
);
const topActions = computed(() =>
  actions.value.filter((a) => a === "update" || a === primaryAction.value),
);
const managementActions = computed(() =>
  actions.value.filter((a) => !topActions.value.includes(a)),
);
// Action links select an existing form; permissions and fresh detail reads still
// decide whether that form may open. Consuming the query prevents refresh replay.
watch(
  () => [detailReady.value, route.query.action],
  () => {
    const requested = route.query.action;
    if (
      !detailReady.value ||
      form.value ||
      o.value.id !== String(route.params.id)
    )
      return;
    if (
      typeof requested !== "string" ||
      !["update", "claim"].includes(requested)
    )
      return;
    if (actions.value.includes(requested)) open(requested);
    const query = { ...route.query };
    delete query.action;
    void router.replace({ path: route.path, query, hash: route.hash });
  },
);
const related = computed(() => {
  const current = o.value;
  if (!current) return [];
  const requirementId =
    props.kind === "requirement" ? current.id : current.requirementId;
  return linked.value.filter((item) => {
    if (item.id === current.id) return false;
    const sameRequirement =
      !!requirementId &&
      (item.requirementId === requirementId ||
        (item.objectKind === "requirement" && item.id === requirementId));
    const taskBug =
      (props.kind === "task" &&
        item.objectKind === "bug" &&
        item.taskId === current.id) ||
      (props.kind === "bug" &&
        item.objectKind === "task" &&
        current.taskId === item.id);
    const dependency =
      props.kind === "task" &&
      item.objectKind === "task" &&
      (current.dependencyIds.includes(item.id) ||
        item.dependencyIds.includes(current.id));
    return sameRequirement || taskBug || dependency;
  });
});
const relatedGroups = computed(() =>
  [
    { kind: "task", title: "执行任务" },
    { kind: "bug", title: "关联 Bug" },
    { kind: "requirement", title: "关联需求" },
  ]
    .map((group) => ({
      ...group,
      items: related.value.filter((item) => item.objectKind === group.kind),
    }))
    .filter((group) => group.items.length),
);
function open(a: string, correction?: WorkUpdate) {
  if (!detailReady.value) return;
  action.value = a;
  draftAction.value = correction
    ? `${a}:correction:${correction.logicalId}`
    : a;
  form.value = actionForm(
    props.kind,
    o.value,
    a,
    a === "setDependencies" ? linked.value : related.value,
    parent.value,
    correction,
  );
  formVersion.value = a === "update" ? correction?.version : o.value.version;
  notice.value = "";
}
async function saved(result: any) {
  form.value = undefined;
  notice.value = action.value === "update" ? "工作更新已保存" : "操作已记录";
  await load();
}
function split() {
  if (!detailReady.value) return;
  action.value = "createTask";
  draftAction.value = "createTask";
  form.value = createForm("task", o.value.projectId, o.value.id);
  formVersion.value = undefined;
}
</script>
<template>
  <article class="object-detail">
    <p v-if="busy && !o" class="detail-empty" role="status">正在读取详情…</p>
    <AAlert v-if="error" type="error" role="alert" show-icon>
      <template #message
        >{{ error }} <AButton @click="load">重试读取</AButton></template
      >
    </AAlert>
    <template v-if="o">
      <nav class="breadcrumb" aria-label="详情路径">
        <RouterLink :to="'/projects/' + o.projectId"
          >← {{ project?.name ?? "返回项目" }}</RouterLink
        >
        <span>/</span><span>{{ zh(kind) }}详情</span>
      </nav>
      <header class="page-heading detail-heading">
        <div>
          <span class="eyebrow"
            >PROJECT / {{ o.projectId }} · {{ zh(kind) }}</span
          >
          <h1>
            {{
              kind === "requirement" && tab === "acceptance"
                ? "产品验收"
                : o.title
            }}
          </h1>
          <p v-if="kind === 'requirement' && tab === 'acceptance'">
            {{ o.title }}
          </p>
          <p>
            {{ o.id }} · 版本 {{ o.version
            }}<span v-if="o.revision"> · 修订 R{{ o.revision }}</span>
          </p>
        </div>
        <div class="detail-top-actions">
          <AButton @click="load" :disabled="busy">刷新详情</AButton>
          <AButton
            v-for="a in topActions"
            :key="a"
            @click="open(a)"
            :disabled="!detailReady"
            :type="a === primaryAction ? 'primary' : 'default'"
            >{{
              kind === "bug" && a === "submit" ? "提交修复" : actionNames[a]
            }}</AButton
          >
          <AButton
            v-if="kind === 'requirement' && manage && !project?.archived"
            @click="split"
            :disabled="!detailReady"
            :type="primaryAction ? 'default' : 'primary'"
            >拆分任务</AButton
          >
        </div>
      </header>
      <nav class="detail-project-nav" aria-label="项目相关页面">
        <RouterLink :to="'/projects/' + o.projectId">项目概览</RouterLink>
        <RouterLink
          :to="{
            path: '/projects/' + o.projectId,
            query: { tab: 'requirements' },
          }"
          :class="{ active: kind === 'requirement' }"
          >需求</RouterLink
        >
        <RouterLink
          :to="{ path: '/projects/' + o.projectId, query: { tab: 'tasks' } }"
          :class="{ active: kind === 'task' }"
          >任务</RouterLink
        >
        <RouterLink
          :to="{ path: '/projects/' + o.projectId, query: { tab: 'bugs' } }"
          :class="{ active: kind === 'bug' }"
          >Bug</RouterLink
        >
        <RouterLink
          :to="{ path: '/projects/' + o.projectId, query: { tab: 'tests' } }"
          >测试与验收</RouterLink
        >
        <RouterLink
          :to="{ path: '/projects/' + o.projectId, query: { tab: 'settings' } }"
          >项目设置</RouterLink
        >
      </nav>
      <p v-if="busy" role="status" class="detail-read-notice">
        正在刷新详情，完成后可继续操作。
      </p>
      <p v-if="notice" class="success" role="status">{{ notice }}</p>
      <AAlert v-if="parentNotExecutable" type="warning" show-icon
        message="需求尚不可执行：请先确认需求范围、可执行状态及阻塞情况。" />
      <AAlert
        v-if="project?.archived"
        type="warning"
        show-icon
        message="项目已归档，当前保留只读历史。"
      />
      <AAlert
        v-if="o.blocked"
        type="warning"
        show-icon
        message="此工作已标记阻塞"
      >
        <template #description>{{
          o.blockReason ??
          o.block?.reason ??
          o.blocking?.reason ??
          "请查看活动历史中的阻塞原因"
        }}</template>
      </AAlert>
      <AAlert
        v-if="kind === 'requirement' && o.revision"
        type="info"
        show-icon
        :message="'当前需求修订 R' + o.revision"
      >
        <template #description
          >测试证据与产品验收分别留存。旧修订记录保留历史，须核对当前修订的适用证据。</template
        >
      </AAlert>
      <div class="detail-layout">
        <div class="detail-main">
          <section class="panel detail-document">
            <header class="detail-document-head">
              <div>
                <span class="badge" :class="o.state">{{ zh(o.state) }}</span
                ><span v-if="o.blocked" class="badge warning">阻塞</span
                ><span class="detail-owner"
                  >{{ kind === "requirement" ? "产品验收人" : "主负责人" }}：{{
                    nameOf(o.ownerId ?? o.acceptorId)
                  }}</span
                >
              </div>
              <span class="detail-code">{{ o.id }}</span>
            </header>
            <nav class="detail-tabs" aria-label="工作详情分类">
              <AButton
                @click="tab = 'details'"
                :aria-current="tab === 'details' ? 'page' : undefined"
                :class="{ active: tab === 'details' }"
                >工作详情</AButton
              >
              <AButton
                @click="tab = 'testing'"
                :aria-current="tab === 'testing' ? 'page' : undefined"
                :class="{ active: tab === 'testing' }"
                >测试证据（{{ tests.length }}）</AButton
              >
              <AButton
                v-if="kind === 'requirement'"
                @click="tab = 'acceptance'"
                :aria-current="tab === 'acceptance' ? 'page' : undefined"
                :class="{ active: tab === 'acceptance' }"
                >产品验收（{{ acceptances.length }}）</AButton
              >
              <AButton
                v-if="kind === 'requirement'"
                @click="tab = 'revisions'"
                :aria-current="tab === 'revisions' ? 'page' : undefined"
                :class="{ active: tab === 'revisions' }"
                >修订与范围历史</AButton
              >
              <AButton
                @click="tab = 'updates'"
                :aria-current="tab === 'updates' ? 'page' : undefined"
                :class="{ active: tab === 'updates' }"
                >我的工作更新（{{ updates.length }}）</AButton
              >
            </nav>
            <template v-if="tab === 'details'">
              <template v-if="kind === 'requirement'">
                <section class="doc-section">
                  <h2>需求与来源</h2>
                  <p class="body-text">{{ o.description || "尚未细化说明" }}</p>
                  <p class="body-text">期望完成时间：{{ o.expectedCompletion || "未填写" }}</p>
                  <p class="body-text">{{ o.source.description }}</p>
                  <a
                    v-if="o.source.url?.startsWith('https://')"
                    :href="o.source.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    >打开原文 ↗</a
                  >
                  <p
                    v-if="o.source.url && !o.source.url.startsWith('https://')"
                  >
                    此来源未使用 HTTPS，链接不可打开。
                  </p>
                  <p class="revision">
                    来源核对：{{
                      o.source.status === "checked"
                        ? "已核对"
                        : o.source.status === "unable"
                          ? "无法核对"
                          : "未确认"
                    }}
                    {{ o.source.checkedAt }}
                  </p>
                </section>
                <section class="doc-section">
                  <h2>
                    验收条目 <small v-if="o.revision">R{{ o.revision }}</small>
                  </h2>
                  <div
                    v-for="(c, index) in o.criteria"
                    :key="c.id"
                    class="detail-criterion"
                  >
                    <span class="criterion-number">{{
                      Number(index) + 1
                    }}</span>
                    <div>
                      <strong>{{ c.text }}</strong
                      ><small>{{ c.id }}</small>
                      <p v-if="!c.required">
                        排除原因：{{ c.exclusionReason }}
                      </p>
                    </div>
                    <span class="badge">{{
                      c.required ? "必需" : "可选"
                    }}</span>
                  </div>
                </section>
              </template>
              <template v-else-if="kind === 'task'">
                <section class="doc-section">
                  <h2>完成标准</h2>
                  <p class="body-text">{{ o.definitionOfDone }}</p>
                  <p>
                    工作类型：{{ zh(o.kind) }} ·
                    {{
                      o.requirementId
                        ? o.required
                          ? "需求必需任务"
                          : "非必需任务"
                        : "独立任务"
                    }}
                  </p>
                  <p v-if="o.exclusionReason">
                    排除原因：{{ o.exclusionReason }}
                  </p>
                </section>
                <section class="doc-section">
                  <h2>依赖与修订</h2>
                  <p v-if="!o.dependencyIds.length" class="muted">无前置依赖</p>
                  <p v-for="id in o.dependencyIds" :key="id">
                    <RouterLink :to="'/task/' + id">{{
                      linked.find((x) => x.id === id)?.title ?? id
                    }}</RouterLink>
                  </p>
                  <p v-if="o.pendingChange" :class="o.revisionImpact?.needsAttention ? 'danger-note' : 'muted'">
                    {{ o.revisionImpact?.message ?? '修订影响记录需核对。' }}
                    变更原因：{{ o.pendingChange.reason }}
                  </p>
                </section>
              </template>
              <template v-else>
                <section class="doc-section">
                  <h2>复现步骤</h2>
                  <p class="body-text">{{ o.reproduction }}</p>
                </section>
                <section class="doc-section">
                  <h2>预期与实际结果</h2>
                  <h3>预期行为</h3>
                  <p class="body-text">{{ o.expected }}</p>
                  <h3>实际行为</h3>
                  <p class="body-text">{{ o.actual }}</p>
                  <div class="detail-context">
                    <h3>环境与证据</h3>
                    <p class="body-text">{{ o.environment }}</p>
                    <p>
                      严重程度：{{ zh(o.severity) }} · 重开
                      {{ o.reopenCount }} 次
                    </p>
                  </div>
                </section>
              </template>
              <section
                v-if="parent && kind !== 'requirement'"
                class="doc-section"
              >
                <h2>所属需求</h2>
                <RouterLink :to="'/requirement/' + parent.id"
                  >{{ parent.title }} · R{{ parent.revision }}</RouterLink
                >
              </section>
            </template>
            <section
              v-if="tab === 'testing'"
              class="doc-section detail-evidence"
            >
              <h2>测试记录 · 独立于产品验收</h2>
              <p class="detail-context">
                每次测试按被测版本、环境与条目结论独立留存。自测会明确标识，测试通过不代替产品验收。
              </p>
              <p v-if="!tests.length" class="detail-empty">
                尚无测试记录。每次记录保留版本、环境与逐项结论。
              </p>
              <article
                v-for="t in tests"
                :key="t.id ?? t.seq"
                class="source-item"
              >
                <strong
                  >{{ t.snapshot?.actorName ?? t.testerId }} ·
                  {{ t.targetVersion }}
                  <span v-if="t.selfTest" class="badge warning"
                    >自测</span
                  ></strong
                ><small
                  >{{ t.recordedAt }} · R{{ t.revision ?? "—" }} ·
                  {{ t.environment }}</small
                >
                <p v-for="c in t.checks" :key="c.checkId">
                  {{ c.checkId }}：<span class="badge" :class="c.result">{{
                    zh(c.result)
                  }}</span>
                  {{ c.note }}
                </p>
              </article>
            </section>
            <section
              v-if="tab === 'acceptance'"
              class="doc-section detail-evidence"
            >
              <h2>业务验收条目</h2>
              <div
                v-for="(criterion, index) in o.criteria"
                :key="criterion.id"
                class="acceptance-criterion"
              >
                <span class="criterion-order">{{ Number(index) + 1 }}</span>
                <div>
                  <strong>{{ criterion.text }}</strong>
                  <p>
                    当前修订 R{{ o.revision }} ·
                    {{ criterion.required ? "必需条目" : "可选条目" }}
                  </p>
                </div>
              </div>
              <p class="detail-context">
                所有有效成员可查看条件；提交与产品验收仍要求本项目显式角色及指定独立验收人。对象变化后请刷新详情重新核对。
              </p>
              <h2>产品验收记录</h2>
              <p class="detail-context">
                由指定产品验收人核对业务结果，独立于开发、修复与测试记录。验收通过后仍需单独记录上线。
              </p>
              <p v-if="!acceptances.length" class="detail-empty">
                尚无产品验收记录
              </p>
              <article
                v-for="a in acceptances"
                :key="a.id ?? a.seq"
                class="source-item"
              >
                <strong
                  >{{ a.snapshot?.actorName ?? a.acceptorId }} ·
                  <span
                    class="badge"
                    :class="a.decision === 'pass' ? 'accepted' : 'warning'"
                    >{{ a.decision === "pass" ? "验收通过" : "退回返工" }}</span
                  ></strong
                ><small
                  >R{{ a.revision }} · {{ a.targetVersion }} ·
                  {{ a.recordedAt }}</small
                >
                <p v-if="a.reason">{{ a.reason }}</p>
                <p v-for="c in a.criteria" :key="c.id">
                  {{ c.id }}：{{ c.passed ? "通过" : "未通过" }} {{ c.note }}
                </p>
              </article>
            </section>
            <section
              v-if="tab === 'revisions'"
              class="doc-section detail-evidence"
            >
              <h2>修订与范围快照</h2>
              <article
                v-for="r in revisions"
                :key="r.revision"
                class="source-item"
              >
                <strong>R{{ r.revision }} · 范围版本 {{ r.version }}</strong
                ><small>{{ r.time }} · {{ r.actorName ?? r.actorId }}</small>
                <p>{{ r.reason }}</p>
                <p>{{ r.snapshot.title }} · {{ r.snapshot.description }}</p>
                <p v-for="c in r.snapshot.criteria" :key="c.id">
                  {{ c.id }} · {{ c.text }}
                </p>
              </article>
            </section>
            <section
              v-if="tab === 'updates'"
              class="doc-section detail-evidence"
            >
              <h2>本人填写的贡献</h2>
              <p v-if="!updates.length" class="detail-empty">
                尚未填写这项工作的更新。
              </p>
              <article
                v-for="u in updates"
                :key="u.logicalId"
                class="source-item"
              >
                <strong>{{ u.workDate }} · {{ zh(u.contributionType) }}</strong
                ><small
                  >版本 {{ u.version }} ·
                  {{ u.lateEntry ? "补记 · " : "" }}记录于
                  {{ u.recordedAt }}</small
                >
                <p>{{ u.done }}</p>
                <p>下一步：{{ u.next || "未填写" }}</p>
                <p>障碍：{{ u.obstacle || "未填写" }}</p>
                <AButton
                  v-if="!project?.archived && roles.length"
                  @click="open('update', u)"
                  :disabled="!detailReady"
                  >更正此条更新</AButton
                >
              </article>
            </section>
          </section>
          <template v-if="tab === 'details'">
            <section
              v-for="group in relatedGroups"
              :key="group.kind"
              class="panel detail-related"
            >
              <header class="detail-section-head">
                <h2>{{ group.title }}</h2>
                <span class="muted">{{ group.items.length }} 项关联记录</span>
              </header>
              <article
                v-for="x in group.items"
                :key="x.id"
                class="detail-related-row"
              >
                <div>
                  <small>{{ zh(x.objectKind) }} · {{ x.id }}</small
                  ><RouterLink
                    :to="objectPath(x.objectKind, x.id)"
                    :aria-label="zh(x.objectKind) + ' · ' + x.title"
                    >{{ x.title }}</RouterLink
                  >
                  <p>
                    {{
                      x.objectKind === "requirement"
                        ? "产品验收人"
                        : "主负责人"
                    }}：{{ nameOf(x.ownerId ?? x.acceptorId) }}
                  </p>
                </div>
                <span class="badge" :class="x.state">{{ zh(x.state) }}</span>
              </article>
            </section>
          </template>
          <AttachmentPanel
            :key="kind + o.id"
            :kind="kind"
            :id="o.id"
            :version="o.version"
            :can-upload="detailReady && !!roles.length && !project?.archived"
            @uploaded="refresh++"
          />
          <HistoryList
            v-if="kind !== 'requirement'"
            :kind="kind"
            :id="o.id"
            :refresh="refresh"
          />
        </div>
        <aside class="detail-rail" aria-label="工作属性与协作">
          <template v-if="kind === 'requirement' && tab === 'acceptance'">
            <section class="panel acceptance-readiness-entry">
              <label for="acceptance-readiness-target">验收目标版本</label>
              <AInput
                id="acceptance-readiness-target"
                v-model:value="acceptanceTarget"
                :maxlength="200"
                placeholder="填写本次核对的实际版本"
              />
            </section>
            <AcceptanceReadiness
              :requirement-id="o.id"
              :requirement-version="o.version"
              :revision="o.revision"
              :target-version="acceptanceTarget"
            />
          </template>
          <section class="panel detail-properties">
            <h2>{{ zh(kind) }}属性</h2>
            <dl>
              <div>
                <dt>所属项目</dt>
                <dd>
                  <RouterLink :to="'/projects/' + o.projectId">{{
                    project?.name ?? o.projectId
                  }}</RouterLink>
                </dd>
              </div>
              <div>
                <dt>优先级</dt>
                <dd class="priority">{{ zh(o.priority) }}</dd>
              </div>
              <div>
                <dt>当前状态</dt>
                <dd>
                  <span class="badge" :class="o.state">{{ zh(o.state) }}</span>
                </dd>
              </div>
              <div v-if="o.revision">
                <dt>当前修订</dt>
                <dd>R{{ o.revision }}</dd>
              </div>
              <div>
                <dt>
                  {{ kind === "requirement" ? "产品验收人" : "主负责人" }}
                </dt>
                <dd>{{ nameOf(o.ownerId ?? o.acceptorId) }}</dd>
              </div>
              <div>
                <dt>下一步操作人</dt>
                <dd>
                  {{
                    o.state === "pending_check"
                      ? nameOf(o.reviewerId)
                      : o.state === "pending_verify"
                        ? "项目测试人员"
                        : o.state === "pending_acceptance"
                          ? nameOf(o.acceptorId)
                          : nameOf(o.ownerId ?? o.acceptorId)
                  }}
                </dd>
              </div>
              <div v-if="o.reviewerId">
                <dt>检查人</dt>
                <dd>{{ nameOf(o.reviewerId) }}</dd>
              </div>
              <div v-if="kind === 'bug'">
                <dt>严重程度</dt>
                <dd>{{ zh(o.severity) }}</dd>
              </div>
              <div v-if="parent && kind !== 'requirement'">
                <dt>关联需求</dt>
                <dd>
                  <RouterLink :to="'/requirement/' + parent.id"
                    >{{ parent.title }} · R{{ parent.revision }}</RouterLink
                  >
                </dd>
              </div>
            </dl>
          </section>
          <section class="panel detail-collaboration" aria-label="协作操作说明">
            <h2>协作与管理</h2>
            <div
              v-if="managementActions.length"
              class="detail-management-actions"
            >
              <AButton
                v-for="a in managementActions"
                :key="a"
                @click="open(a)"
                :disabled="!detailReady"
                :danger="['cancel', 'reject'].includes(a)"
                >{{ actionNames[a] }}</AButton
              >
            </div>
            <div class="detail-role-guide">
              <p v-if="!roles.length">
                你在本项目没有业务角色，可阅读历史；请联系管理员明确配置所需角色。
              </p>
              <p v-if="kind === 'requirement'">
                需求由项目产品或对应职责负责人细化与拆分，不支持认领。指定产品验收人须独立于实际开发或修复人员。
              </p>
              <template v-else
                ><p v-if="kind === 'bug' && o.state === 'unconfirmed'">
                  新登记的 Bug 须先由项目产品或测试确认，再由对应修复角色认领。
                </p>
                <p>
                  认领需要本项目的{{ zh(scope) }}角色，且工作处于{{
                    zh(kind === "task" ? "pending" : "ready")
                  }}、未分配状态。产品或对应职责负责人可通过分配指定有效的对应角色成员。
                </p>
                <p v-if="kind === 'task' && parent">
                  关联需求须已确认范围、未阻塞且处于可执行或进行中，任务才能认领或开始；请先在关联需求详情确认这些条件。
                </p></template
              ><RouterLink
                v-if="state.member?.isAdmin"
                :to="{ path: '/members', query: { projectId: o.projectId } }"
                >管理本项目成员与角色</RouterLink
              >
            </div>
          </section>
          <HistoryList
            v-if="kind === 'requirement'"
            :kind="kind"
            :id="o.id"
            :refresh="refresh"
          />
        </aside>
      </div>
      <ActionForm
        v-if="form"
        :key="draftAction + ':' + formVersion"
        :spec="form"
        :draft-key="`${kind}:${o.id}:${draftAction}`"
        :version="formVersion"
        @saved="saved"
        @cancel="
          notice = form?.cancelLabel === '返回并保留草稿'
            ? '普通草稿已保留，可重新打开继续填写。' : '已取消操作。';
          form = undefined;
        "
      />
    </template>
  </article>
</template>

<style scoped>
.object-detail {
  min-width: 0;
}
.acceptance-readiness-entry {
  display: grid;
  gap: 14px;
  padding: 20px;
}
.acceptance-readiness-entry label {
  font-size: 12px;
  color: #65738b;
}
.acceptance-criterion {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 12px;
  padding: 22px 0;
  border-bottom: 1px solid #e4e9f1;
}
.acceptance-criterion .criterion-order {
  color: #738097;
  background: #f0f4fa;
  border-radius: 4px;
  text-align: center;
  height: 28px;
  line-height: 28px;
}
.acceptance-criterion strong {
  font-size: 13px;
  line-height: 1.8;
  color: #263752;
}
.acceptance-criterion p {
  margin: 6px 0 0;
  font-size: 12px;
  color: #738097;
}
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}
.detail-heading {
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 18px;
}
.detail-heading .eyebrow {
  display: block;
  margin-bottom: 8px;
  font-size: 11px;
  letter-spacing: 1.1px;
  color: #697890;
}
.detail-heading h1 {
  font-size: 28px;
  line-height: 1.4;
  margin: 0;
}
.detail-heading p {
  margin: 9px 0 0;
  color: #65738b;
  font-size: 13px;
}
.detail-top-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
  max-width: 46%;
}
.detail-project-nav {
  display: flex;
  align-items: center;
  gap: 26px;
  border-bottom: 1px solid #e4e9f1;
  margin-bottom: 24px;
  overflow-x: auto;
}
.detail-project-nav a {
  padding: 0 0 14px;
  white-space: nowrap;
  color: #59677c;
  font-size: 13px;
  border-bottom: 2px solid transparent;
}
.detail-project-nav a.active {
  color: #245bdb;
  border-bottom-color: #245bdb;
  font-weight: 600;
}
.detail-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 310px;
  align-items: start;
  gap: 22px;
}
.detail-main,
.detail-rail {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.panel {
  margin: 0;
  border: 1px solid #e4e9f1;
  border-radius: 8px;
  background: white;
  overflow: hidden;
}
.detail-document-head {
  padding: 18px 23px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  border-bottom: 1px solid #e4e9f1;
}
.detail-document-head > div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.detail-owner {
  font-size: 12px;
  color: #65738b;
}
.detail-code {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: #697890;
  overflow-wrap: anywhere;
}
.detail-tabs {
  padding: 0 23px;
  display: flex;
  gap: 20px;
  overflow-x: auto;
  border-bottom: 1px solid #e4e9f1;
}
.detail-tabs .ant-btn {
  border: 0;
  background: transparent;
  border-radius: 0;
  height: auto;
  box-shadow: none;
  padding: 15px 0 12px;
  color: #65738b;
  font-size: 12px;
  border-bottom: 2px solid transparent;
}
.detail-tabs .ant-btn.active {
  border-bottom-color: #245bdb;
  color: #245bdb;
  font-weight: 600;
}
.doc-section {
  padding: 23px;
  border-bottom: 1px solid #e4e9f1;
  font-size: 13px;
  line-height: 1.9;
  color: #4c5d74;
  overflow-wrap: anywhere;
}
.doc-section:last-child {
  border-bottom: 0;
}
.doc-section h2 {
  margin: 0 0 16px;
  font-size: 15px;
  font-weight: 600;
  color: #17243b;
}
.doc-section h2 small {
  font-size: 12px;
  color: #697890;
  font-weight: 400;
}
.doc-section h3 {
  font-size: 13px;
  margin: 18px 0 7px;
  color: #334562;
}
.doc-section p {
  margin: 10px 0;
}
.doc-section .revision {
  font-size: 12px;
  color: #697890;
}
.detail-criterion {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid #e4e9f1;
}
.detail-criterion:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.criterion-number {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 27px;
  height: 27px;
  border-radius: 5px;
  background: #f1f4f9;
  color: #617186;
  font-size: 11px;
}
.detail-criterion > div {
  flex: 1;
  min-width: 0;
}
.detail-criterion strong {
  font-weight: 500;
  color: #24344d;
}
.detail-criterion small {
  display: block;
  color: #738097;
  font-size: 11px;
}
.detail-criterion .badge {
  margin: 0 0 0 auto;
  flex-shrink: 0;
}
.detail-context {
  padding: 16px 18px;
  background: #f8faff;
  border: 1px solid #e1e9f5;
  border-radius: 6px;
  color: #65738b;
  font-size: 12px;
  line-height: 1.9;
}
.detail-context h3 {
  margin-top: 0;
}
.detail-context p:last-child {
  margin-bottom: 0;
}
.detail-properties {
  padding: 22px;
}
.detail-properties h2 {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1px;
  color: #768298;
  margin: 0 0 20px;
}
.detail-properties dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-size: 13px;
}
.detail-properties dl > div {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 12px;
}
.detail-properties dt {
  color: #69778d;
}
.detail-properties dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: #24344d;
}
.detail-properties .priority {
  color: #ad782d;
}
.detail-collaboration {
  padding: 22px;
}
.detail-collaboration h2 {
  margin: 0 0 18px;
  font-size: 15px;
}
.detail-management-actions {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.detail-management-actions .ant-btn {
  width: 100%;
  height: auto;
  min-height: 33px;
  white-space: normal;
  padding: 6px 10px;
}
.detail-role-guide {
  font-size: 12px;
  line-height: 1.8;
  color: #65738b;
}
.detail-role-guide p {
  margin: 14px 0 0;
}
.detail-role-guide a {
  display: inline-block;
  margin-top: 12px;
}
.detail-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 19px 23px;
  border-bottom: 1px solid #e4e9f1;
}
.detail-section-head h2 {
  margin: 0;
  font-size: 15px;
}
.detail-section-head .muted {
  font-size: 11px;
}
.detail-related-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin: 0 23px;
  padding: 18px 0;
  border-bottom: 1px solid #e4e9f1;
}
.detail-related-row:last-child {
  border-bottom: 0;
}
.detail-related-row > div {
  min-width: 0;
}
.detail-related-row small {
  font-size: 11px;
  color: #738097;
  display: block;
}
.detail-related-row a {
  display: block;
  margin: 6px 0;
  font-weight: 500;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.detail-related-row p {
  margin: 0;
  font-size: 12px;
  color: #697890;
}
.detail-empty {
  margin: 0;
  padding: 22px 16px;
  border: 1px dashed #d8e1ee;
  border-radius: 6px;
  color: #697890;
  background: #fbfcfe;
  font-size: 13px;
}
.source-item {
  padding: 18px 0;
  font-size: 13px;
}
.source-item:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.source-item strong {
  font-weight: 500;
  color: #24344d;
}
.source-item small {
  margin-top: 6px;
  font-size: 12px;
}
.badge.pass {
  color: #257554;
  background: #eaf7ef;
}
.badge.fail {
  color: #b34444;
  background: #fff1f1;
}
.detail-read-notice {
  font-size: 12px;
  color: #65738b;
}
@media (max-width: 1150px) {
  .detail-layout {
    grid-template-columns: minmax(0, 1fr) 260px;
    gap: 18px;
  }
  .detail-properties dl > div {
    grid-template-columns: 85px minmax(0, 1fr);
    gap: 8px;
  }
  .detail-top-actions {
    max-width: 42%;
  }
}
@media (max-width: 850px) {
  .detail-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .detail-top-actions {
    max-width: 100%;
    justify-content: flex-start;
  }
  .detail-heading {
    display: flex;
    flex-wrap: wrap;
  }
  .detail-main,
  .detail-rail {
    gap: 18px;
  }
  .detail-properties dl > div {
    grid-template-columns: 120px minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  .detail-heading h1 {
    font-size: 24px;
  }
  .detail-heading {
    gap: 15px;
  }
  .detail-top-actions {
    width: 100%;
  }
  .detail-top-actions .ant-btn {
    min-height: 36px;
  }
  .detail-project-nav {
    gap: 23px;
    margin-bottom: 20px;
  }
  .detail-document-head,
  .doc-section {
    padding: 18px;
  }
  .detail-document-head {
    gap: 8px;
    flex-wrap: wrap;
  }
  .detail-tabs {
    padding: 0 18px;
    gap: 18px;
  }
  .detail-tabs .ant-btn {
    padding-top: 13px;
  }
  .detail-properties,
  .detail-collaboration {
    padding: 20px 18px;
  }
  .detail-properties dl > div {
    grid-template-columns: 100px minmax(0, 1fr);
  }
  .detail-section-head {
    padding: 17px 18px;
    flex-wrap: wrap;
  }
  .detail-related-row {
    margin: 0 18px;
    gap: 10px;
  }
  .detail-criterion {
    gap: 10px;
    flex-wrap: wrap;
  }
  .detail-criterion > div {
    flex-basis: calc(100% - 40px);
  }
  .detail-criterion .badge {
    margin-left: 37px;
  }
}
</style>

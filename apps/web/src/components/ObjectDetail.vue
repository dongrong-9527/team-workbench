<script setup lang="ts">
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
        (["frontend", "backend"].includes(o.value.kind)
          ? has("test")
          : has("product") || lead.value)
      : has("test"),
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
        if (s !== "cancelled") a.push("revise", "cancel");
        else a.push("restore");
      }
    }
    if (has("test")) a.push("test");
    if (manage.value && s === "active") a.push("submitAcceptance");
    if (has("product")) a.push("waiver");
    if (has("product") && x.acceptorId === state.member?.id) {
      if (s === "pending_acceptance") a.push("acceptance");
    }
  } else {
    if (
      !x.ownerId &&
      has(scope.value) &&
      s === (props.kind === "task" ? "pending" : "ready")
    )
      a.push("claim");
    if (own.value) {
      if (["pending", "ready"].includes(s)) a.push("start");
      if (["active", "fixing"].includes(s)) a.push("submit");
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
function open(a: string, correction?: WorkUpdate) {
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
  action.value = "createTask";
  draftAction.value = "createTask";
  form.value = createForm("task", o.value.projectId, o.value.id);
  formVersion.value = undefined;
}
</script>
<template>
  <p v-if="busy && !o" class="empty" role="status">正在读取详情…</p>
  <p v-if="error" class="error" role="alert">
    {{ error }} <button @click="load">重试读取</button>
  </p>
  <template v-if="o"
    ><div class="breadcrumb">
      <RouterLink :to="'/projects/' + o.projectId">{{
        project?.name
      }}</RouterLink>
      / {{ zh(kind) }}详情
    </div>
    <div class="page-heading">
      <div>
        <span class="eyebrow">{{ zh(kind) }} · {{ o.id }}</span>
        <h1>{{ o.title }}</h1>
        <p>
          版本 {{ o.version
          }}<span v-if="o.revision"> · 需求修订 R{{ o.revision }}</span> ·
          优先级 {{ zh(o.priority) }}
        </p>
      </div>
      <button @click="load" :disabled="busy">刷新详情</button>
    </div>
    <p v-if="notice" class="success" role="status">{{ notice }}</p>
    <p v-if="project?.archived" class="danger-note">
      项目已归档，当前保留只读历史。
    </p>
    <section class="panel">
      <dl class="detail-summary">
        <div>
          <dt>{{ kind === "requirement" ? "产品验收人" : "主负责人" }}</dt>
          <dd>{{ nameOf(o.ownerId ?? o.acceptorId) }}</dd>
        </div>
        <div>
          <dt>当前状态</dt>
          <dd>
            <span class="badge" :class="o.state">{{ zh(o.state) }}</span>
            <span v-if="o.blocked" class="badge warning">阻塞</span>
          </dd>
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
      </dl>
    </section>
    <div class="toolbar">
      <button
        v-for="a in actions"
        @click="open(a)"
        :class="{
          primary: ['submit', 'claim', 'acceptance', 'update'].includes(a),
        }"
      >
        {{
          kind === "bug" && a === "submit" ? "提交修复" : actionNames[a]
        }}</button
      ><button
        v-if="kind === 'requirement' && manage && !project?.archived"
        @click="split"
      >
        拆分任务
      </button>
    </div>
    <div class="tabs">
      <button @click="tab = 'details'" :class="{ primary: tab === 'details' }">
        工作详情</button
      ><button @click="tab = 'testing'" :class="{ primary: tab === 'testing' }">
        测试证据（{{ tests.length }}）</button
      ><button
        v-if="kind === 'requirement'"
        @click="tab = 'acceptance'"
        :class="{ primary: tab === 'acceptance' }"
      >
        产品验收（{{ acceptances.length }}）</button
      ><button v-if="kind === 'requirement'" @click="tab = 'revisions'">
        修订与范围历史</button
      ><button @click="tab = 'updates'" :class="{ primary: tab === 'updates' }">
        我的工作更新（{{ updates.length }}）
      </button>
    </div>
    <div class="detail-layout">
      <div>
        <section v-if="tab === 'details'" class="panel panel-body">
          <template v-if="kind === 'requirement'"
            ><h2>需求与来源</h2>
            <p class="body-text">{{ o.description || "尚未细化说明" }}</p>
            <p>{{ o.source.description }}</p>
            <a
              v-if="o.source.url?.startsWith('https://')"
              :href="o.source.url"
              target="_blank"
              rel="noopener noreferrer"
              >打开原文 ↗</a
            >
            <p v-if="o.source.url && !o.source.url.startsWith('https://')">
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
            <h3>验收条目</h3>
            <div v-for="c in o.criteria" class="check-row">
              <div>
                {{ c.text }}<small class="muted"> · {{ c.id }}</small>
              </div>
              <span>{{
                c.required ? "必需" : "可选：" + c.exclusionReason
              }}</span>
            </div></template
          ><template v-else-if="kind === 'task'"
            ><h2>完成标准</h2>
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
            <p v-if="o.exclusionReason">排除原因：{{ o.exclusionReason }}</p>
            <h3>依赖与修订</h3>
            <p v-if="!o.dependencyIds.length">无前置依赖</p>
            <p v-for="id in o.dependencyIds">
              <RouterLink :to="'/task/' + id">{{
                linked.find((x) => x.id === id)?.title ?? id
              }}</RouterLink>
            </p>
            <p v-if="o.pendingChange" class="danger-note">
              修订待处理：R{{ o.pendingChange.revision }} ·
              {{ o.pendingChange.reason }}
            </p></template
          ><template v-else
            ><h2>复现信息</h2>
            <h3>预期行为</h3>
            <p class="body-text">{{ o.expected }}</p>
            <h3>实际行为</h3>
            <p class="body-text">{{ o.actual }}</p>
            <h3>复现步骤</h3>
            <p class="body-text">{{ o.reproduction }}</p>
            <p>环境：{{ o.environment }}</p>
            <p>
              严重程度：{{ zh(o.severity) }} · 重开 {{ o.reopenCount }} 次
            </p></template
          ><template v-if="o.blocked"
            ><h3>阻塞与协助</h3>
            <p>
              {{
                o.blockReason ??
                o.block?.reason ??
                o.blocking?.reason ??
                "请查看活动历史中的阻塞原因"
              }}
            </p></template
          ><template v-if="parent && kind !== 'requirement'"
            ><h3>所属需求</h3>
            <RouterLink :to="'/requirement/' + parent.id"
              >{{ parent.title }} · R{{ parent.revision }}</RouterLink
            ></template
          ><template v-if="related.length"
            ><h3>关联工作</h3>
            <p v-for="x in related">
              <RouterLink :to="objectPath(x.objectKind, x.id)"
                >{{ zh(x.objectKind) }} · {{ x.title }}</RouterLink
              >
              <span class="badge">{{ zh(x.state) }}</span>
            </p></template
          >
        </section>
        <section v-if="tab === 'testing'" class="panel panel-body">
          <h2>测试记录 · 独立于产品验收</h2>
          <p v-if="!tests.length">
            尚无测试记录。每次记录保留版本、环境与逐项结论。
          </p>
          <article v-for="t in tests" class="source-item">
            <strong
              >{{ nameOf(t.testerId) }} · {{ t.targetVersion }}
              <span class="badge warning" v-if="t.selfTest">自测</span></strong
            ><small
              >{{ t.recordedAt }} · R{{ t.revision ?? "—" }} ·
              {{ t.environment }}</small
            >
            <p v-for="c in t.checks">
              {{ c.checkId }}：{{ zh(c.result) }} {{ c.note }}
            </p>
          </article>
        </section>
        <section v-if="tab === 'acceptance'" class="panel panel-body">
          <h2>产品验收记录</h2>
          <p v-if="!acceptances.length">尚无产品验收记录</p>
          <article v-for="a in acceptances" class="source-item">
            <strong
              >{{ nameOf(a.acceptorId) }} ·
              {{ a.decision === "pass" ? "验收通过" : "退回返工" }}</strong
            ><small
              >R{{ a.revision }} · {{ a.targetVersion }} ·
              {{ a.recordedAt }}</small
            >
            <p v-if="a.reason">{{ a.reason }}</p>
            <p v-for="c in a.criteria">
              {{ c.id }}：{{ c.passed ? "通过" : "未通过" }} {{ c.note }}
            </p>
          </article>
        </section>
        <section v-if="tab === 'revisions'" class="panel panel-body">
          <h2>修订与范围快照</h2>
          <article v-for="r in revisions" class="source-item">
            <strong>R{{ r.revision }} · 范围版本 {{ r.version }}</strong
            ><small>{{ r.time }} · {{ nameOf(r.actorId) }}</small>
            <p>{{ r.reason }}</p>
            <p>{{ r.snapshot.title }} · {{ r.snapshot.description }}</p>
            <p v-for="c in r.snapshot.criteria">{{ c.id }} · {{ c.text }}</p>
          </article>
        </section>
        <section v-if="tab === 'updates'" class="panel panel-body">
          <h2>本人填写的贡献</h2>
          <p v-if="!updates.length">尚未填写这项工作的更新。</p>
          <article v-for="u in updates" class="source-item">
            <strong>{{ u.workDate }} · {{ zh(u.contributionType) }}</strong
            ><small
              >版本 {{ u.version }} · {{ u.lateEntry ? "补记 · " : "" }}记录于
              {{ u.recordedAt }}</small
            >
            <p>{{ u.done }}</p>
            <p>下一步：{{ u.next || "未填写" }}</p>
            <p>障碍：{{ u.obstacle || "未填写" }}</p>
            <button
              v-if="!project?.archived && roles.length"
              @click="open('update', u)"
            >
              更正此条更新
            </button>
          </article>
        </section>
      </div>
      <HistoryList :kind="kind" :id="o.id" :refresh="refresh" />
    </div>
    <ActionForm
      v-if="form"
      :key="draftAction + ':' + formVersion"
      :spec="form"
      :draft-key="`${kind}:${o.id}:${draftAction}`"
      :version="formVersion"
      @saved="saved"
      @cancel="
        form = undefined;
        notice = '普通草稿已保留，可重新打开继续填写。';
      "
  /></template>
</template>

<script setup lang="ts">
import {
  FileTextOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  FlagOutlined,
  EditOutlined,
} from "@ant-design/icons-vue";
import { ref, watch, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import AModal from "ant-design-vue/es/modal";
import AInput from "ant-design-vue/es/input";
import { request, type Page } from "../api/client";
import { state, objectPath, zh } from "../state";
import { useReadScope } from "../composables/readScope";
import AButton from "ant-design-vue/es/button";
import ASelect from "ant-design-vue/es/select";
import ATag from "ant-design-vue/es/tag";
import AAlert from "ant-design-vue/es/alert";
import WorkList from "../components/WorkList.vue";
const items = ref<any[]>([]),
  cursor = ref<string | null>(null),
  busy = ref(false),
  error = ref(""),
  kind = ref(""),
  status = ref(""),
  blocked = ref(""),
  owner = ref("");
const route = useRoute(),
  router = useRouter();
const tab = computed(() =>
  ["owned", "claim", "review"].includes(String(route.query.workTab))
    ? String(route.query.workTab)
    : "all",
);
const query = ref(""),
  progressOpen = ref(false);
const owned = computed(() =>
  items.value.filter((x) => x.ownerId === state.member?.id),
);
const claimable = computed(() =>
  items.value.filter((x) => {
    const scope =
      x.objectKind === "task" && x.kind !== "other" ? x.kind : x.role;
    return (
      x.objectKind !== "requirement" &&
      !x.ownerId &&
      !x.archived &&
      !x.blocked &&
      !x.flags?.parentNotExecutable &&
      x.state === (x.objectKind === "task" ? "pending" : "ready") &&
      state.projects
        .find((p) => p.id === x.projectId)
        ?.myRoles.some((r) => r.role === scope)
    );
  }),
);
const reviews = computed(() =>
  items.value.filter(
    (x) =>
      (x.reviewerId === state.member?.id && x.state === "pending_check") ||
      (x.acceptorId === state.member?.id && x.state === "pending_acceptance") ||
      (((x.objectKind === "bug" && x.state === "pending_verify") ||
        (x.objectKind === "requirement" &&
          x.state === "active" &&
          x.scopeConfirmed)) &&
        state.projects
          .find((p) => p.id === x.projectId)
          ?.myRoles.some((r) => r.role === "test")),
  ),
);
const visible = computed(() =>
  (tab.value === "owned"
    ? owned.value
    : tab.value === "claim"
      ? claimable.value
      : tab.value === "review"
        ? reviews.value
        : items.value
  ).filter(
    (x) =>
      !query.value ||
      x.title.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()) ||
      x.id.includes(query.value),
  ),
);
const tabs = computed(() => [
  { id: "owned", label: "我负责", count: owned.value.length },
  { id: "claim", label: "可领取", count: claimable.value.length },
  { id: "review", label: "待我检查", count: reviews.value.length },
  { id: "all", label: "全部相关", count: items.value.length },
]);
const attention = computed(() =>
  items.value.filter(
    (x) => x.blocked || x.flags?.inactiveOwner || x.flags?.invalidOwner || x.flags?.invalidReviewer || x.flags?.pendingRevision,
  ),
);
const progressRows = ref<any[]>([]),
  progressCursor = ref<string | null>(null),
  progressBusy = ref(false),
  progressError = ref(""),
  progressSearch = ref("");
const progressItems = computed(() =>
  progressRows.value.filter(
    (x) =>
      !x.archived &&
      state.projects.find((p) => p.id === x.projectId)?.myRoles.length &&
      ["owner", "participant", "reviewer", "tester", "acceptor"].includes(
        x.responsibility,
      ),
  ),
);
const progressReads = useReadScope(() => JSON.stringify([progressOpen.value, state.projectId, progressSearch.value]));
async function loadProgress(more = false) {
  if (!progressOpen.value) return;
  const read = progressReads.begin(more);
  if (!read || (more && !progressCursor.value)) return;
  if (!more) { progressRows.value = []; progressCursor.value = null; }
  progressBusy.value = true;
  progressError.value = "";
  const q = new URLSearchParams();
  if (state.projectId) q.set("projectId", state.projectId);
  if (progressSearch.value) q.set("q", progressSearch.value);
  if (more && progressCursor.value) q.set("cursor", progressCursor.value);
  try {
    const result = await request<Page<any>>("/api/my-progress?" + q);
    read.commit(() => {
      progressRows.value = more ? [...progressRows.value, ...result.items] : result.items;
      progressCursor.value = result.nextCursor;
    });
  } catch (e) {
    if (read.valid()) progressError.value = (e as Error).message;
  } finally {
    read.finish(() => { progressBusy.value = false; });
  }
}
watch(() => [progressOpen.value, state.projectId, progressSearch.value], () => loadProgress(), { immediate: true });
const stats = computed(() => [
  {
    name: "我负责的未完成工作",
    value: owned.value.length,
    note: "当前筛选已加载的主责事项",
  },
  {
    name: "可领取工作",
    value: claimable.value.length,
    note: "符合当前项目岗位与状态",
  },
  {
    name: "待我测试或检查",
    value: reviews.value.length,
    note: "测试、检查与产品验收分开记录",
  },
  {
    name: "我负责的阻塞工作",
    value: owned.value.filter((x) => x.blocked).length,
    note: "需要说明原因与协助",
  },
]);
function selectTab(value: string) {
  void router.push({
    path: route.path,
    query: { ...route.query, workTab: value },
  });
}
watch(
  () => route.query.progress,
  (value) => {
    if (value === "1") {
      progressOpen.value = true;
      const query = { ...route.query };
      delete query.progress;
      void router.replace({ path: route.path, query });
    }
  },
  { immediate: true },
);
const reads = useReadScope(() =>
  JSON.stringify([
    state.projectId,
    kind.value,
    status.value,
    blocked.value,
    owner.value,
  ]),
);
async function load(more = false) {
  const read = reads.begin(more);
  if (!read || (more && !cursor.value)) return;
  if (!more) {
    items.value = [];
    cursor.value = null;
  }
  busy.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({
      projectId: state.projectId,
      kind: kind.value,
      state: status.value,
      blocked: blocked.value,
      ownerId: owner.value,
      cursor: more ? cursor.value : "",
    }))
      if (v) q.set(k, v);
    const p = await request<Page<any>>("/api/my-work?" + q);
    read.commit(() => {
      items.value = more ? [...items.value, ...p.items] : p.items;
      cursor.value = p.nextCursor;
    });
  } catch (e) {
    if (read.valid()) error.value = (e as Error).message;
  } finally {
    read.finish(() => {
      busy.value = false;
    });
  }
}
watch(
  () => [state.projectId, kind.value, status.value, blocked.value, owner.value],
  () => load(),
  { immediate: true },
);
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">WORKSPACE</div>
      <h1>我的工作</h1>
      <p>聚焦下一步操作，推进你负责的工作。</p>
    </div>
    <AButton @click="progressOpen = true"
      ><EditOutlined aria-hidden="true" />填写今日进展</AButton
    >
  </div>
  <div class="metrics">
    <div
      v-for="(s, i) in stats"
      :key="s.name"
      class="metric"
      :class="{ warning: i === 3 }"
    >
      <span>{{ s.name }}</span
      ><strong>{{ busy ? "—" : s.value }}</strong
      ><small>{{ s.note }}</small>
    </div>
  </div>
  <div class="work-content-layout">
    <section class="panel work-main-panel">
      <div class="work-tabs" role="tablist" aria-label="工作责任筛选">
        <button
          v-for="t in tabs"
          :key="t.id"
          class="work-tab"
          role="tab"
          :aria-selected="tab === t.id"
          @click="selectTab(t.id)"
        >
          {{ t.label }}<span class="tab-count">{{ t.count }}</span>
        </button>
        <AButton
          class="work-tab-refresh"
          type="text"
          aria-label="刷新"
          @click="load()"
          :loading="busy"
          :disabled="busy"
          ><ReloadOutlined aria-hidden="true"
        /></AButton>
      </div>
      <div class="filters">
        <div>
          <label for="work-kind">工作类型</label
          ><ASelect
            id="work-kind"
            aria-label="工作类型"
            :value="kind"
            @update:value="kind = typeof $event === 'string' ? $event : ''"
            allow-clear
            :options="[
              { value: '', label: '全部类型' },
              { value: 'task', label: '任务' },
              { value: 'requirement', label: '需求' },
              { value: 'bug', label: 'Bug' },
            ]"
          />
        </div>
        <div>
          <label for="work-owner">负责人</label
          ><ASelect
            id="work-owner"
            aria-label="负责人"
            :value="owner"
            @update:value="owner = typeof $event === 'string' ? $event : ''"
            allow-clear
            :options="[
              { value: '', label: '全部负责人' },
              ...state.members.map((m) => ({
                value: m.id,
                label: m.displayName,
              })),
            ]"
          />
        </div>
        <div>
          <label for="work-status">状态</label
          ><ASelect
            id="work-status"
            aria-label="状态"
            :value="status"
            @update:value="status = typeof $event === 'string' ? $event : ''"
            allow-clear
            :options="[
              { value: '', label: '全部状态' },
              ...[
                'pending',
                'ready',
                'active',
                'fixing',
                'pending_check',
                'pending_verify',
                'pending_acceptance',
              ].map((value) => ({ value, label: zh(value) })),
            ]"
          />
        </div>
        <div>
          <label for="work-blocked">阻塞</label
          ><ASelect
            id="work-blocked"
            aria-label="阻塞"
            :value="blocked"
            @update:value="blocked = typeof $event === 'string' ? $event : ''"
            allow-clear
            :options="[
              { value: '', label: '全部' },
              { value: 'true', label: '仅阻塞' },
              { value: 'false', label: '未阻塞' },
            ]"
          />
        </div>
        <div class="mobile-project-filter">
          <label for="work-project">工作项目</label
          ><ASelect
            id="work-project"
            :value="state.projectId"
            @update:value="
              state.projectId = typeof $event === 'string' ? $event : ''
            "
            allow-clear
            :options="[
              { value: '', label: '全部项目' },
              ...state.projects.map((p) => ({ value: p.id, label: p.name })),
            ]"
          />
        </div>
      </div>
      <div class="work-filter-extra">
        <AInput
          v-model:value="query"
          aria-label="筛选已加载工作"
          placeholder="筛选已加载的编号或工作标题"
          allow-clear
        /><span class="loaded-note"
          >当前筛选已加载 {{ items.length }} 项{{
            cursor ? "，还有更多" : ""
          }}</span
        >
      </div>
      <p v-if="error" class="error" role="alert">
        {{ error }} <AButton @click="load()">重试加载</AButton>
      </p>
      <p v-if="busy" role="status" class="empty">正在读取工作事项…</p>
      <WorkList v-else-if="visible.length" :items="visible" />
      <div v-else-if="!error" class="empty">
        当前筛选下没有待处理事项。<RouterLink to="/projects"
          >浏览全部项目 →</RouterLink
        ><span v-if="cursor">当前页暂无符合事项，可以继续加载。</span>
      </div>
      <AButton
        v-if="cursor"
        class="load-more"
        @click="load(true)"
        :disabled="busy"
        >加载更多</AButton
      >
      <div class="table-footnote">
        显示 {{ visible.length }} 项 ·
        统计仅包含当前筛选已加载事项，保留各自责任身份。
      </div>
    </section>
    <aside class="work-rail">
      <section class="panel">
        <div class="section-heading">
          <h2>需要你关注</h2>
          <ATag color="orange">{{ attention.length }} 项</ATag>
        </div>
        <div class="panel-body">
          <div
            v-for="o in attention.slice(0, 4)"
            :key="o.id"
            class="attention-item"
          >
            <span class="row-meta"
              >{{ zh(o.objectKind) }} ·
              {{
                o.blocked
                  ? "阻塞"
                  : o.flags.inactiveOwner
                    ? "负责人已停用"
                    : o.flags.invalidOwner
                      ? "负责人岗位权限已变更"
                    : o.flags.invalidReviewer
                      ? "检查人岗位资格已失效"
                    : o.revisionImpact?.message ?? "修订待处理"
              }}</span
            ><strong>{{ o.title }}</strong>
            <p>保留现有责任与记录，进入详情查看需要的协助。</p>
            <RouterLink :to="objectPath(o.objectKind, o.id)"
              >查看说明 →</RouterLink
            >
          </div>
          <p v-if="!attention.length">已加载事项中暂无阻塞或角色异常。</p>
        </div>
      </section>
      <section class="panel">
        <div class="section-heading"><h2>让下一步更清楚</h2></div>
        <div class="panel-body">
          <h3>先拆任务，再领取执行</h3>
          <p>
            需求由产品或岗位负责人细化。对应岗位成员领取任务或
            Bug；领取后再单独开始。
          </p>
          <h3>测试与验收分别留痕</h3>
          <p>检查结果通过后，由独立的产品验收人核对当前修订与目标版本。</p>
          <RouterLink to="/projects">进入项目协作 →</RouterLink>
        </div>
      </section>
    </aside>
  </div>
  <div class="hint-card">
    <div>
      <strong>今天的推进，留下可核对的记录</strong>
      <p>你的进展会汇总到微信日报；文字记录不会自动改变任务状态。</p>
    </div>
    <RouterLink to="/reports" custom v-slot="{ href, navigate }"
      ><AButton :href="href" @click="navigate"
        >生成今日日报 <FileTextOutlined aria-hidden="true" /></AButton
    ></RouterLink>
  </div>
  <AModal
    v-model:open="progressOpen"
    title="选择要记录进展的工作"
    :footer="null"
    :width="540"
  >
    <p>包含已完成事项，可补记当天或过去的实际贡献；文字不会自动改变状态。</p>
    <AInput v-model:value="progressSearch" aria-label="搜索可补记事项" placeholder="按标题或编号查找，包含已完成工作" :maxlength="200" />
    <p v-if="progressBusy" role="status">正在读取可补记事项…</p>
    <AAlert v-if="progressError" type="error" role="alert" show-icon>
      <template #message>{{ progressError }} <AButton @click="loadProgress()">重试读取事项</AButton></template>
    </AAlert>
    <div class="progress-options">
      <RouterLink
        v-for="o in progressItems"
        :key="o.id"
        :to="{
          path: objectPath(o.objectKind, o.id),
          query: { action: 'update' },
        }"
        >{{ o.title }}</RouterLink
      >
    </div>
    <p v-if="!progressBusy && !progressError && !progressItems.length" class="empty">
      当前没有匹配的可补记事项。可调整搜索，或进入有项目角色的工作详情。
    </p>
    <AButton v-if="progressCursor" :disabled="progressBusy" @click="loadProgress(true)">加载更多可补记事项</AButton>
    <div class="form-actions">
      <AButton @click="progressOpen = false">取消</AButton>
    </div>
  </AModal>
</template>
<style scoped>
.mobile-project-filter {
  display: none;
}
@media (max-width: 600px) {
  .mobile-project-filter {
    display: block;
    grid-column: 1/-1;
  }
}
</style>

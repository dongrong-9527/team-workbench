<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { state, zh, refreshDirectory, refreshProject } from "../state";
import { request, type Page } from "../api/client";
import { createForm, field, type FormSpec } from "../forms";
import WorkList from "../components/WorkList.vue";
import ActionForm from "../components/ActionForm.vue";
import HistoryList from "../components/HistoryList.vue";
const route = useRoute(),
  router = useRouter(),
  overview = ref<any>(),
  items = ref<any[]>([]),
  cursor = ref<string | null>(null),
  error = ref(""),
  busy = ref(false),
  kind = ref(""),
  status = ref(""),
  owner = ref(""),
  blocked = ref(""),
  archive = ref("active"),
  form = ref<FormSpec>(),
  version = ref<number>(),
  formKey = ref(""),
  notice = ref("");
const projectId = computed(() =>
  String(route.params.id ?? state.projectId ?? ""),
);
const canManage = computed(() =>
  overview.value?.myRoles.some((r: any) => r.role === "product" || r.lead),
);
const canCreateBug = computed(() => overview.value?.myRoles.length > 0);
const projects = computed(() =>
  state.projects.filter(
    (p) =>
      archive.value === "all" ||
      (archive.value === "archived" ? p.archived : !p.archived),
  ),
);
async function load(more = false) {
  error.value = "";
  busy.value = true;
  try {
    if (projectId.value) overview.value = await refreshProject(projectId.value);
    else overview.value = undefined;
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({
      projectId: projectId.value,
      kind: kind.value,
      state: status.value,
      ownerId: owner.value,
      blocked: blocked.value,
      q: route.query.q ? String(route.query.q) : "",
      cursor: more ? cursor.value : "",
    }))
      if (v) q.set(k, v);
    const p = await request<Page<any>>(
      (route.query.q ? "/api/search?" : "/api/objects?") + q,
    );
    items.value = more ? [...items.value, ...p.items] : p.items;
    cursor.value = p.nextCursor;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
watch(
  () => [
    projectId.value,
    kind.value,
    status.value,
    owner.value,
    blocked.value,
    route.query.q,
  ],
  () => load(),
  { immediate: true },
);
function create(kind: string) {
  form.value = createForm(kind, projectId.value);
  version.value = undefined;
  formKey.value = "create:" + kind + ":" + projectId.value;
}
function projectAction(a: string) {
  const p = overview.value?.project;
  version.value = a === "create" ? undefined : p.version;
  formKey.value = "project:" + a + ":" + (p?.id ?? "new");
  form.value = {
    title:
      a === "create"
        ? "新建项目"
        : a === "rename"
          ? "重命名项目"
          : a === "archive"
            ? "归档项目"
            : "恢复项目",
    path: a === "create" ? "/api/projects" : `/api/projects/${p.id}/${a}`,
    description: p?.name,
    impact:
      a === "archive"
        ? "归档后所有成员只能阅读项目历史，业务写入会被拒绝。"
        : undefined,
    fields: ["create", "rename"].includes(a)
      ? [
          field("name", "项目名称"),
          ...(a === "create"
            ? [field("description", "项目简介", "textarea", false)]
            : []),
        ]
      : [],
    initial: { name: p?.name ?? "", description: "" },
    body: (v) =>
      a === "create"
        ? { name: v.name, description: v.description }
        : a === "rename"
          ? { name: v.name }
          : {},
  };
}
async function saved(result: any) {
  const newObject = formKey.value.startsWith("create:");
  const newKind = formKey.value.split(":")[1];
  form.value = undefined;
  notice.value = "已保存";
  await refreshDirectory();
  if (newObject) await router.push(`/${newKind}/${result.id}`);
  else await load();
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">项目与协作范围</span>
      <h1>
        {{ overview?.project.name ?? (route.query.q ? "搜索结果" : "项目") }}
      </h1>
      <p>
        {{
          overview?.project.description ??
          "所有有效成员均可阅读，按项目角色协作。"
        }}
      </p>
    </div>
    <button
      v-if="state.member?.isAdmin && !overview"
      class="primary"
      @click="projectAction('create')"
    >
      新建项目
    </button>
  </div>
  <p v-if="notice" class="success" role="status">{{ notice }}</p>
  <p v-if="error" class="error" role="alert">
    {{ error }}<button @click="load()">重试加载</button>
  </p>
  <template v-if="!overview && !route.query.q"
    ><div class="tabs">
      <button @click="archive = 'active'">进行中的项目</button
      ><button @click="archive = 'archived'">已归档</button
      ><button @click="archive = 'all'">全部项目</button>
    </div>
    <div class="card-grid">
      <section v-for="p in projects" class="panel project-card">
        <span class="eyebrow">{{ p.archived ? "只读归档" : "团队项目" }}</span>
        <h2>
          <RouterLink :to="'/projects/' + p.id">{{ p.name }} ↗</RouterLink>
        </h2>
        <p>{{ p.description || "暂无项目简介" }}</p>
        <div class="chips">
          <span v-for="r in p.myRoles" class="badge"
            >{{ zh(r.role) }}{{ r.lead ? "负责人" : "" }}</span
          ><span v-if="!p.myRoles.length" class="badge">可阅读与生成日报</span>
        </div>
      </section>
    </div></template
  ><template v-if="overview"
    ><div class="toolbar">
      <button
        v-if="canManage && !overview.project.archived"
        class="primary"
        @click="create('requirement')"
      >
        新建需求</button
      ><button
        v-if="canManage && !overview.project.archived"
        @click="create('task')"
      >
        新建任务</button
      ><button
        v-if="canCreateBug && !overview.project.archived"
        @click="create('bug')"
      >
        新建 Bug</button
      ><template v-if="state.member?.isAdmin"
        ><button
          v-if="!overview.project.archived"
          @click="projectAction('rename')"
        >
          重命名项目</button
        ><button
          @click="
            projectAction(overview.project.archived ? 'restore' : 'archive')
          "
        >
          {{ overview.project.archived ? "恢复项目" : "归档项目" }}
        </button></template
      >
    </div>
    <div class="metrics">
      <div class="metric" v-for="k in ['requirement', 'task', 'bug']">
        <span>{{ zh(k) }} · 全部状态</span
        ><strong>{{
          overview.counts
            .filter((x: any) => x.kind === k)
            .reduce((n: number, x: any) => n + x.count, 0)
        }}</strong>
      </div>
      <div class="metric">
        <span>阻塞 / 未分配</span
        ><strong
          >{{ overview.attention.blocked ?? 0 }} /
          {{ overview.attention.unassigned ?? 0 }}</strong
        >
      </div>
    </div>
    <div class="chips">
      <span v-for="c in overview.counts" class="badge"
        >{{ zh(c.kind) }} · {{ zh(c.state) }} {{ c.count }}</span
      >
    </div>
    <p v-if="overview.project.archived" class="danger-note">
      项目已归档，保留只读历史；管理员可恢复。
    </p></template
  >
  <section class="panel" style="margin-top: 20px">
    <div class="section-heading">
      <div>
        <h2>
          {{ route.query.q ? "搜索“" + route.query.q + "”" : "项目工作列表" }}
        </h2>
        <p>先看状态与责任人，再进入详情推进工作。</p>
      </div>
      <button @click="load()" :disabled="busy">刷新列表</button>
    </div>
    <div class="filters">
      <label
        >类型<select aria-label="工作类型" v-model="kind">
          <option value="">全部类型</option>
          <option value="requirement">需求</option>
          <option value="task">任务</option>
          <option value="bug">Bug</option>
        </select></label
      ><label
        >负责人<select aria-label="负责人" v-model="owner">
          <option value="">全部负责人</option>
          <option v-for="m in state.members" :value="m.id">
            {{ m.displayName }}
          </option>
        </select></label
      ><label
        >状态<select aria-label="状态" v-model="status">
          <option value="">全部状态</option>
          <option
            v-for="s in [
              'draft',
              'refining',
              'pending',
              'ready',
              'active',
              'pending_check',
              'done',
              'unconfirmed',
              'fixing',
              'pending_verify',
              'closed',
              'pending_acceptance',
              'accepted',
              'cancelled',
              'rejected',
            ]"
            :value="s"
          >
            {{ zh(s) }}
          </option>
        </select></label
      ><label
        >阻塞<select aria-label="阻塞" v-model="blocked">
          <option value="">全部</option>
          <option value="true">仅阻塞</option>
          <option value="false">未阻塞</option>
        </select></label
      >
    </div>
    <p v-if="busy" class="empty" role="status">正在读取…</p>
    <WorkList v-else :items="items" />
    <p v-if="!busy && !items.length && !error" class="empty">
      当前条件下没有工作事项
    </p>
    <button v-if="cursor" @click="load(true)" class="load-more">
      加载更多
    </button>
  </section>
  <HistoryList
    v-if="overview"
    kind="project"
    :id="overview.project.id"
  /><ActionForm
    v-if="form"
    :spec="form"
    :draft-key="formKey"
    :version="version"
    @saved="saved"
    @cancel="form = undefined"
  />
</template>

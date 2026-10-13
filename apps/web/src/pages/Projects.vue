<script setup lang="ts">
import ASelect from "ant-design-vue/es/select";
import ATag from "ant-design-vue/es/tag";
import AButton from "ant-design-vue/es/button";
import AAlert from "ant-design-vue/es/alert";
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { state, zh, refreshDirectory, refreshProject } from "../state";
import { request, type Page } from "../api/client";
import { createForm, field, type FormSpec } from "../forms";
import { useReadScope } from "../composables/readScope";
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
const reads = useReadScope(() =>
  JSON.stringify([
    projectId.value,
    kind.value,
    status.value,
    owner.value,
    blocked.value,
    route.query.q,
  ]),
);
async function load(more = false) {
  const read = reads.begin(more);
  if (!read || (more && !cursor.value)) return;
  const id = projectId.value;
  const search = route.query.q ? String(route.query.q) : "";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({
    projectId: id,
    kind: kind.value,
    state: status.value,
    ownerId: owner.value,
    blocked: blocked.value,
    q: search,
    cursor: more ? cursor.value : "",
  }))
    if (v) q.set(k, v);
  if (!more) {
    items.value = [];
    cursor.value = null;
    overview.value = undefined;
  }
  error.value = "";
  busy.value = true;
  try {
    const [details, p] = await Promise.all([
      id ? refreshProject(id, read.valid) : Promise.resolve(undefined),
      request<Page<any>>((search ? "/api/search?" : "/api/objects?") + q),
    ]);
    read.commit(() => {
      overview.value = details;
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
            ? [
                field("description", "项目简介", "textarea", false, {
                  max: 2000,
                }),
              ]
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
    <AButton
      v-if="state.member?.isAdmin && !overview"
      type="primary"
      @click="projectAction('create')"
    >
      新建项目
    </AButton>
  </div>
  <AAlert
    v-if="notice"
    :message="notice"
    type="success"
    role="status"
    show-icon
  />
  <AAlert v-if="error" type="error" show-icon role="alert"
    ><template #message>
      {{ error }}<AButton @click="load()">重试加载</AButton>
    </template></AAlert
  >
  <template v-if="!overview && !route.query.q"
    ><div class="tabs">
      <AButton @click="archive = 'active'">进行中的项目</AButton
      ><AButton @click="archive = 'archived'">已归档</AButton
      ><AButton @click="archive = 'all'">全部项目</AButton>
    </div>
    <div class="card-grid">
      <section v-for="p in projects" class="panel project-card">
        <span class="eyebrow">{{ p.archived ? "只读归档" : "团队项目" }}</span>
        <h2>
          <RouterLink :to="'/projects/' + p.id">{{ p.name }} ↗</RouterLink>
        </h2>
        <p>{{ p.description || "暂无项目简介" }}</p>
        <div class="chips">
          <ATag v-for="r in p.myRoles"
            >{{ zh(r.role) }}{{ r.lead ? "负责人" : "" }}</ATag
          ><ATag v-if="!p.myRoles.length">可阅读与生成日报</ATag>
        </div>
      </section>
    </div></template
  ><template v-if="overview"
    ><div class="toolbar">
      <AButton
        v-if="canManage && !overview.project.archived"
        type="primary"
        @click="create('requirement')"
      >
        新建需求</AButton
      ><AButton
        v-if="canManage && !overview.project.archived"
        @click="create('task')"
      >
        新建任务</AButton
      ><AButton
        v-if="canCreateBug && !overview.project.archived"
        @click="create('bug')"
      >
        新建 Bug</AButton
      ><template v-if="state.member?.isAdmin"
        ><AButton
          v-if="!overview.project.archived"
          @click="projectAction('rename')"
        >
          重命名项目</AButton
        ><AButton
          @click="
            projectAction(overview.project.archived ? 'restore' : 'archive')
          "
        >
          {{ overview.project.archived ? "恢复项目" : "归档项目" }}
        </AButton></template
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
      <ATag v-for="c in overview.counts"
        >{{ zh(c.kind) }} · {{ zh(c.state) }} {{ c.count }}</ATag
      >
    </div>
    <AAlert v-if="overview.project.archived" type="warning" show-icon
      ><template #message>
        项目已归档，保留只读历史；管理员可恢复。
      </template></AAlert
    ></template
  >
  <section class="panel" style="margin-top: 20px">
    <div class="section-heading">
      <div>
        <h2>
          {{ route.query.q ? "搜索“" + route.query.q + "”" : "项目工作列表" }}
        </h2>
        <p>先看状态与责任人，再进入详情推进工作。</p>
      </div>
      <AButton @click="load()" :disabled="busy">刷新列表</AButton>
    </div>
    <div class="filters">
      <div>
        <label for="project-kind">工作类型</label
        ><ASelect
          id="project-kind"
          :value="kind"
          @update:value="kind = typeof $event === 'string' ? $event : ''"
          allow-clear
          :options="[
            { value: '', label: '全部类型' },
            { value: 'requirement', label: '需求' },
            { value: 'task', label: '任务' },
            { value: 'bug', label: 'Bug' },
          ]"
        />
      </div>
      <div>
        <label for="project-owner">负责人</label
        ><ASelect
          id="project-owner"
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
        <label for="project-status">状态</label
        ><ASelect
          id="project-status"
          :value="status"
          @update:value="status = typeof $event === 'string' ? $event : ''"
          allow-clear
          :options="[
            { value: '', label: '全部状态' },
            ...[
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
            ].map((value) => ({ value, label: zh(value) })),
          ]"
        />
      </div>
      <div>
        <label for="project-blocked">阻塞</label
        ><ASelect
          id="project-blocked"
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
    </div>
    <p v-if="busy" class="empty" role="status">正在读取…</p>
    <WorkList v-else :items="items" />
    <p v-if="!busy && !items.length && !error" class="empty">
      当前条件下没有工作事项
    </p>
    <AButton
      v-if="cursor"
      :disabled="busy"
      @click="load(true)"
      class="load-more"
    >
      加载更多
    </AButton>
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

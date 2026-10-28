<script setup lang="ts">
import AInput from "ant-design-vue/es/input";
import AAvatar from "ant-design-vue/es/avatar";
import {
  FolderOpenOutlined,
  PlusOutlined,
  ArrowUpOutlined,
} from "@ant-design/icons-vue";
import ASelect from "ant-design-vue/es/select";
import ATag from "ant-design-vue/es/tag";
import AButton from "ant-design-vue/es/button";
import AAlert from "ant-design-vue/es/alert";
import { ref, computed, watch, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { state, zh, refreshDirectory, refreshProject } from "../state";
import { request, type Page } from "../api/client";
import { createForm, field, type FormSpec } from "../forms";
import { useReadScope } from "../composables/readScope";
import { decodeFilters, encodeFilters, workFilterSchema, type FilterValues } from "../composables/listFilters";
import FilterPanel from "../components/FilterPanel.vue";
import WorkList from "../components/WorkList.vue";
import ActionForm from "../components/ActionForm.vue";
import HistoryList from "../components/HistoryList.vue";
import ProjectHeader from "../components/ProjectHeader.vue";
import ProjectSettingsNav from "../components/ProjectSettingsNav.vue";
import ProjectRelatedWork from "../components/ProjectRelatedWork.vue";
import { projectTabs } from "../projectNavigation";
const route = useRoute(),
  router = useRouter(),
  overview = ref<any>(),
  items = ref<any[]>([]),
  cursor = ref<string | null>(null),
  error = ref(""),
  busy = ref(false),
  archivedExpanded = ref(false),
  form = ref<FormSpec>(),
  version = ref<number>(),
  formKey = ref(""),
  notice = ref(""),
  createdProjectId = ref("");
const directoryDefaults = { keyword: "", archive: "all" };
const directoryFilters = ref({ ...directoryDefaults });
const directoryPanel = ref<InstanceType<typeof FilterPanel>>();
const projectSearch = computed(() => directoryFilters.value.keyword);
const archive = computed(() => directoryFilters.value.archive);
const filterSchema = { ...workFilterSchema, keyword: { key: "q", default: "", max: 200 } };
const filterDefaults = decodeFilters({}, filterSchema);
const workFilters = computed(() => {
  const values = decodeFilters(route.query, filterSchema);
  if (["requirements", "tasks", "bugs", "tests"].includes(tab.value)) values.kind = "";
  if (tab.value === "tests") values.status = "";
  return values;
});
const kind = computed(() => workFilters.value.kind);
const status = computed(() => workFilters.value.status);
const owner = computed(() => workFilters.value.owner);
const blocked = computed(() => workFilters.value.blocked);
const workPanel = ref<InstanceType<typeof FilterPanel>>();
async function applyWorkFilters(next: FilterValues) {
  if (["requirements", "tasks", "bugs", "tests"].includes(tab.value)) next.kind = "";
  if (tab.value === "tests") next.status = "";
  const query = encodeFilters(route.query, next, filterSchema);
  if (JSON.stringify(next) === JSON.stringify(workFilters.value)) await load();
  else await router.push({ path: route.path, query, hash: route.hash });
}
function applyDirectoryFilters(next: FilterValues) {
  directoryFilters.value = { keyword: next.keyword ?? "", archive: next.archive ?? "all" };
}
// Creation crosses App's route-path component key. Carry only a server-acknowledged
// project id across that remount, and consume the URL marker once on arrival.
const creationReceiptKey = () =>
  "workbench:created-project:" + String(state.member?.id ?? "");
watch(
  () => [route.params.id, route.query.created],
  () => {
    if (route.query.created !== "1") return;
    const id = String(route.params.id ?? "");
    try {
      if (id && sessionStorage.getItem(creationReceiptKey()) === id) {
        createdProjectId.value = id;
        sessionStorage.removeItem(creationReceiptKey());
      }
    } catch {
      // Storage may be unavailable; the loaded project and role guide still work.
    }
    const { created: _created, ...query } = route.query;
    void router.replace({ path: route.path, query, hash: route.hash });
  },
  { immediate: true },
);
const tabs = projectTabs;
const tab = computed(() =>
  tabs.some((t) => t.key === route.query.tab)
    ? String(route.query.tab)
    : "overview",
);
const queues = [
  { key: "tasks", label: "待检查任务", kind: "task", state: "pending_check" },
  { key: "bugs", label: "待验证 Bug", kind: "bug", state: "pending_verify" },
  {
    key: "acceptance",
    label: "产品验收队列",
    kind: "requirement",
    state: "pending_acceptance",
  },
];
const queue = computed(
  () => queues.find((q) => q.key === route.query.queue) ?? queues[0]!,
);
const requestKind = computed(() =>
  tab.value === "tests"
    ? queue.value.kind
    : ((
        { requirements: "requirement", tasks: "task", bugs: "bug" } as Record<
          string,
          string
        >
      )[tab.value] ?? kind.value),
);
const requestStatus = computed(() =>
  tab.value === "tests" ? queue.value.state : status.value,
);
const projectMembers = computed(() =>
  (state.projectMembers[projectId.value] ?? []).filter((m) => m.active),
);
const missingRoles = computed(() =>
  ["product", "frontend", "backend", "test"].filter(
    (role) =>
      !projectMembers.value.some((member) =>
        member.roles?.some((entry) => entry.role === role),
      ),
  ),
);
const missingRoleText = computed(() =>
  missingRoles.value.map((role) => zh(role)).join("、"),
);
const listTitle = computed(() =>
  workFilters.value.keyword
    ? "搜索“" + workFilters.value.keyword + "”"
    : tab.value === "tests"
      ? queue.value.label
      : ((
          {
            requirements: "全部需求",
            tasks: "全部任务",
            bugs: "全部 Bug",
          } as Record<string, string>
        )[tab.value] ?? "项目工作列表"),
);
function tabLocation(key: string, extra: Record<string, string> = {}) {
  return {
    path: "/projects/" + projectId.value,
    query: {
      ...(route.query.q ? { q: String(route.query.q) } : {}),
      ...(key === "overview" ? {} : { tab: key }),
      ...extra,
    },
  };
}
function navigateTab(
  key: string,
  extra: Record<string, string> = {},
  clearSearch = false,
) {
  const destination = tabLocation(key, extra);
  if (clearSearch) delete destination.query.q;
  router.push(destination);
}
function count(kind: string, states?: string[]) {
  return (overview.value?.counts ?? [])
    .filter(
      (c: any) => c.kind === kind && (!states || states.includes(c.state)),
    )
    .reduce((n: number, c: any) => n + c.count, 0);
}
const projectId = computed(() =>
  String(
    route.params.id ??
      (route.query.view === "all" ? "" : state.projectId) ??
      "",
  ),
);
const isDirectory = computed(() => !projectId.value && !workFilters.value.keyword && route.query.work !== "1");
const filterScope = computed(() => JSON.stringify([state.member?.id, projectId.value, tab.value, queue.value.key]));
watch(() => route.query.openFilters, async (value) => {
  if (value !== "1") return;
  const { openFilters: _open, ...query } = route.query;
  await router.replace({ path: route.path, query, hash: route.hash });
  await nextTick();
  workPanel.value?.openPanel();
  workPanel.value?.scrollIntoView();
}, { immediate: true, flush: "post" });
const canManage = computed(() =>
  overview.value?.myRoles.some((r: any) => r.role === "product" || r.lead),
);
const canCreateBug = computed(() => overview.value?.myRoles.length > 0);
const projects = computed(() =>
  state.projects.filter(
    (p) =>
      (archive.value === "all" ||
        (archive.value === "archived" ? p.archived : !p.archived)) &&
      (!projectSearch.value ||
        (p.name + " " + p.id + " " + p.description)
          .toLowerCase()
          .includes(projectSearch.value.toLowerCase())),
  ),
);
const projectGroups = computed(() => [
  {
    key: "active",
    label: "进行中",
    items: projects.value.filter((p) => !p.archived),
    show: archive.value !== "archived",
    expanded: true,
  },
  {
    key: "archived",
    label: "已归档",
    items: projects.value.filter((p) => p.archived),
    show: archive.value !== "active",
    expanded: archive.value === "archived" || archivedExpanded.value,
  },
]);
const settingsSection = computed(() =>
  route.query.section === "history" || route.hash === "#project-history"
    ? "history"
    : "basic",
);
const listIdentity = computed(() =>
  JSON.stringify([
    state.member?.id,
    projectId.value,
    tab.value,
    requestKind.value,
    requestStatus.value,
    owner.value,
    blocked.value,
    workFilters.value.keyword,
  ]),
);
const reads = useReadScope(() => listIdentity.value);
async function load(more = false) {
  const read = reads.begin(more);
  if (!read || (more && !cursor.value)) return;
  const id = projectId.value;
  const search = workFilters.value.keyword;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({
    projectId: id,
    kind: requestKind.value,
    state: requestStatus.value,
    ownerId: owner.value,
    blocked: blocked.value,
    q: search,
    cursor: more ? cursor.value : "",
  }))
    if (v) q.set(k, v);
  if (!more) {
    items.value = [];
    cursor.value = null;
    if (overview.value?.project.id !== id) overview.value = undefined;
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
watch(listIdentity, () => load(), { immediate: true });
function create(kind: string) {
  form.value = createForm(kind, projectId.value);
  version.value = undefined;
  formKey.value = "create:" + kind + ":" + projectId.value;
}
watch(
  () => [
    overview.value?.project.id,
    route.query.create,
    route.query.requirementId,
    route.query.taskId,
    route.query.role,
  ],
  () => {
    if (route.query.create !== "bug" || !overview.value || form.value) return;
    if (!canCreateBug.value || overview.value.project.archived) {
      notice.value = "当前项目没有登记 Bug 的权限，或项目已归档。";
      return;
    }
    create("bug");
    for (const key of ["requirementId", "taskId"])
      if (
        typeof route.query[key] === "string" &&
        route.query[key].length <= 128
      )
        form.value!.initial[key] = route.query[key];
    if (["frontend", "backend", "test"].includes(String(route.query.role)))
      form.value!.initial.role = route.query.role;
    formKey.value +=
      ":" +
      JSON.stringify([
        form.value!.initial.requirementId,
        form.value!.initial.taskId,
      ]);
  },
  { immediate: true },
);
function cancelForm() {
  form.value = undefined;
  if (route.query.create === "bug") {
    const {
      create: _create,
      requirementId: _requirement,
      taskId: _task,
      role: _role,
      ...query
    } = route.query;
    void router.replace({ path: route.path, query });
  }
}
function projectAction(a: string, selected?: any) {
  const p = selected ?? overview.value?.project;
  version.value = a === "create" ? undefined : p.version;
  formKey.value = "project:" + a + ":" + (p?.id ?? "new");
  form.value = {
    cancelLabel: ["create", "edit"].includes(a) ? "返回并保留草稿" : "取消",
    title:
      a === "create"
        ? "新建项目"
        : a === "edit"
          ? "编辑项目"
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
    fields: ["create", "rename", "edit"].includes(a)
      ? [
          field("name", "项目名称", "text", true, { max: 120 }),
          ...(["create", "edit"].includes(a)
            ? [
                field("description", "项目简介", "textarea", false, {
                  max: 2000,
                }),
              ]
            : []),
        ]
      : [],
    initial: { name: p?.name ?? "", description: p?.description ?? "" },
    body: (v) =>
      ["create", "edit"].includes(a)
        ? { name: v.name, description: v.description }
        : a === "rename"
          ? { name: v.name }
          : {},
  };
}
async function saved(result: any) {
  const newProject = formKey.value.startsWith("project:create:");
  const newObject = formKey.value.startsWith("create:");
  const newKind = formKey.value.split(":")[1];
  form.value = undefined;
  notice.value = "已保存";
  await refreshDirectory();
  if (newProject) {
    try {
      sessionStorage.setItem(creationReceiptKey(), result.id);
    } catch {
      // Do not infer a creation acknowledgement from a query marker alone.
    }
    await router.push({
      path: `/projects/${result.id}`,
      query: { created: "1" },
    });
  } else if (newObject) await router.push(`/${newKind}/${result.id}`);
  else await load();
}
</script>
<template>
  <div class="projects-page">
    <div v-if="!projectId" class="page-heading">
      <div>
        <span class="eyebrow">WORKSPACE</span>
        <h1>{{ route.query.q ? "搜索结果" : "项目" }}</h1>
        <p>查看全部可见项目，进入协作或配置项目。</p>
      </div>
      <AButton
        v-if="state.member?.isAdmin && !route.query.q"
        type="primary"
        @click="projectAction('create')"
        ><PlusOutlined aria-hidden="true" />新建项目</AButton
      >
    </div>
    <ProjectHeader
      v-else
      :project-id="projectId"
      :project="
        overview?.project ?? state.projects.find((p) => p.id === projectId)
      "
      :active="tab"
    >
      <template #actions
        ><template v-if="overview">
          <AButton
            v-if="canManage && !overview.project.archived"
            type="primary"
            @click="create('requirement')"
            >新建需求</AButton
          >
          <AButton
            v-if="canManage && !overview.project.archived"
            @click="create('task')"
            >新建任务</AButton
          >
          <AButton
            v-if="canCreateBug && !overview.project.archived"
            @click="create('bug')"
            >新建 Bug</AButton
          >
          <template v-if="state.member?.isAdmin">
            <AButton
              v-if="!overview.project.archived"
              @click="projectAction('edit')"
              >编辑项目</AButton
            >
            <AButton
              :danger="!overview.project.archived"
              @click="
                projectAction(overview.project.archived ? 'restore' : 'archive')
              "
              >{{
                overview.project.archived ? "恢复项目" : "归档项目"
              }}</AButton
            >
          </template>
        </template></template
      >
    </ProjectHeader>
    <AAlert
      v-if="notice"
      :message="notice"
      type="success"
      role="status"
      show-icon
    />
    <AAlert v-if="error" type="error" show-icon role="alert"
      ><template #message
        >{{ error }}<AButton @click="load()">重试加载</AButton></template
      ></AAlert
    >
    <template v-if="isDirectory">
      <FilterPanel ref="directoryPanel" :model-value="directoryFilters" :defaults="directoryDefaults" :scope-key="String(state.member?.id ?? '')" label="项目目录筛选" @apply="applyDirectoryFilters" v-slot="{ draft }">
      <div class="directory-filters filters">
        <AInput
          v-model:value="draft.keyword"
          aria-label="搜索项目名称"
          placeholder="搜索名称、编号或简介"
          allow-clear
        />
        <div class="archive-tabs" aria-label="项目归档筛选">
          <AButton
            :type="draft.archive === 'active' ? 'primary' : 'default'"
            @click="draft.archive = 'active'"
            >进行中的项目</AButton
          >
          <AButton
            :type="draft.archive === 'archived' ? 'primary' : 'default'"
            @click="draft.archive = 'archived'"
            >已归档</AButton
          >
          <AButton
            :type="draft.archive === 'all' ? 'primary' : 'default'"
            @click="draft.archive = 'all'"
            >全部项目</AButton
          >
        </div>
        <span class="directory-result"
          >当前筛选 {{ projects.length }} 个项目</span
        >
      </div>
      <p class="filter-note">名称、编号与简介仅筛选已加载的完整项目目录。</p>
      </FilterPanel>
      <section v-if="!state.projects.length" class="panel first-project">
        <span class="empty-project-icon"
          ><FolderOpenOutlined aria-hidden="true"
        /></span>
        <h2>从第一个项目开始</h2>
        <p>
          {{
            state.member?.isAdmin
              ? "你可以创建项目和管理成员。创建完成后，还需要显式配置项目业务角色。"
              : "管理员创建项目后，你可以在这里查看项目与协作记录。"
          }}
        </p>
        <AButton
          v-if="state.member?.isAdmin"
          type="primary"
          @click="projectAction('create')"
          >创建第一个项目</AButton
        >
        <ol>
          <li>创建项目，明确团队协作目标</li>
          <li>设置产品、前端、后端和测试角色</li>
          <li>进入项目，发布需求并安排执行工作</li>
        </ol>
      </section>
      <template v-else>
        <section
          v-for="group in projectGroups.filter((g) => g.show)"
          :key="group.key"
          class="project-directory-section"
          role="region"
          :aria-label="group.label + '项目'"
        >
          <button
            v-if="group.key === 'archived' && archive === 'all'"
            class="archive-section-toggle"
            :aria-expanded="archivedExpanded"
            @click="archivedExpanded = !archivedExpanded"
          >
            {{ archivedExpanded ? "▾" : "▸" }} 已归档
            <span>{{ group.items.length }} 个项目</span>
          </button>
          <h2 v-else class="directory-section-heading">
            {{ group.label }} <span>{{ group.items.length }} 个项目</span>
          </h2>
          <div v-if="group.expanded" class="project-card-grid">
            <section
              v-for="p in group.items"
              :key="p.id"
              class="panel project-card"
              :class="{ archived: p.archived }"
            >
              <div class="card-top">
                <span class="project-icon"
                  ><FolderOpenOutlined aria-hidden="true" /></span
                ><ATag :color="p.archived ? undefined : 'blue'">{{
                  p.archived ? "已归档" : "进行中"
                }}</ATag>
              </div>
              <div>
                <div class="project-code">{{ p.id }}</div>
                <h2>
                  <RouterLink :to="'/projects/' + p.id"
                    >{{ p.name }} ↗</RouterLink
                  >
                </h2>
                <p>{{ p.description || "暂无项目简介" }}</p>
              </div>
              <div class="project-role-summary">
                <span class="muted">我的项目角色</span>
                <div class="chips">
                  <ATag v-for="r in p.myRoles" :key="r.role"
                    >{{ zh(r.role) }}{{ r.lead ? "负责人" : "" }}</ATag
                  ><span v-if="!p.myRoles.length">可阅读与生成日报</span>
                </div>
              </div>
              <div class="project-card-footer">
                <AButton
                  v-if="state.member?.isAdmin && !p.archived"
                  type="link"
                  @click="projectAction('edit', p)"
                  >编辑项目</AButton
                ><span v-else class="muted">{{
                  p.archived ? "业务记录只读" : "按项目角色协作"
                }}</span
                ><RouterLink class="enter-project" :to="'/projects/' + p.id"
                  >{{ p.archived ? "查看历史" : "进入项目" }}
                  <ArrowUpOutlined aria-hidden="true"
                /></RouterLink>
              </div>
            </section>
          </div>
          <p
            v-if="group.expanded && !group.items.length && projects.length"
            class="directory-section-empty"
          >
            此分区暂无匹配项目
          </p>
        </section>
        <section v-if="!projects.length" class="panel directory-empty">
          <h2>没有符合条件的项目</h2>
          <p>请调整项目名称、编号、简介或归档筛选。</p>
          <AButton @click="directoryPanel?.openPanel()">调整项目筛选</AButton>
        </section>
      </template>
    </template>
    <template v-if="overview">
      <section
        v-if="createdProjectId === projectId"
        class="panel created-project"
      >
        <ATag color="success">项目已创建</ATag>
        <h2>{{ overview.project.name }}已创建</h2>
        <p>项目信息已保存。接下来配置业务角色，让团队知道谁能执行哪些操作。</p>
        <div class="setup-grid">
          <div>
            <h3>设置成员与角色</h3>
            <p>
              选择有效成员，显式分配项目岗位与岗位负责人。管理员不会自动获得业务身份。
            </p>
            <RouterLink
              v-if="state.member?.isAdmin"
              :to="{ path: '/members', query: { projectId } }"
              >设置成员与角色 →</RouterLink
            >
          </div>
          <div>
            <h3>查看项目业务入口</h3>
            <p>
              先浏览需求、任务、Bug
              与测试验收。实际开发或修复人员不能参与最终产品验收。
            </p>
            <AButton @click="createdProjectId = ''">进入项目</AButton>
          </div>
        </div>
      </section>
      <AAlert
        v-if="overview.project.archived"
        type="warning"
        show-icon
        message="项目已归档，保留只读历史；管理员可恢复。"
      />
      <ProjectRelatedWork v-if="tab === 'overview'" :project-id="projectId" />
      <section
        class="collaboration-guide"
        :class="{ 'without-role': !overview.myRoles.length }"
        aria-label="项目协作与权限"
      >
        <div>
          <h2>项目协作与权限</h2>
          <p v-if="!overview.myRoles.length">
            当前项目尚未授予你业务角色，可阅读项目与生成日报。管理员身份只提供成员、项目与授权管理权限。
          </p>
          <p v-else>
            你的项目角色：{{
              overview.myRoles
                .map((r: any) => zh(r.role) + (r.lead ? "负责人" : ""))
                .join("、")
            }}
          </p>
          <p v-if="missingRoles.length">
            尚未配置岗位：{{ missingRoleText }}。请按项目实际分工补齐。
          </p>
          <p v-if="missingRoles.includes('product')">
            尚未配置产品角色，暂不能指定产品验收人。
          </p>
          <p v-if="missingRoles.includes('test')">
            尚未配置测试角色，测试工作需要相应岗位成员配合。
          </p>
          <p>
            产品验收人须未参与该需求的实际开发或修复；角色兼任本身不等于已参与。
          </p>
        </div>
        <div class="guide-actions">
          <RouterLink
            v-if="state.member?.isAdmin"
            :to="{
              path: '/members',
              query: { projectId: overview.project.id },
            }"
            >管理本项目成员与角色</RouterLink
          ><span v-else>需要执行权限时，请联系管理员配置本项目角色。</span
          ><RouterLink :to="{ path: '/projects', query: { view: 'all' } }"
            >查看全部项目</RouterLink
          >
        </div>
      </section>
      <template v-if="tab === 'overview'">
        <div class="project-metrics" aria-label="当前项目全部记录统计">
          <div>
            <span>未完成任务</span
            ><strong>{{
              count("task", ["pending", "active", "pending_check"])
            }}</strong
            ><small>待处理 / 进行中 / 待检查</small>
          </div>
          <div>
            <span>未闭环 Bug</span
            ><strong>{{
              count("bug", ["unconfirmed", "ready", "fixing", "pending_verify"])
            }}</strong
            ><small>含待确认与待验证</small>
          </div>
          <AButton
            class="project-metric-link"
            @click="navigateTab('tests', { queue: 'acceptance' }, true)"
          >
            <span>待验收需求</span
            ><strong>{{ count("requirement", ["pending_acceptance"]) }}</strong
            ><small>查看产品验收队列 →</small>
          </AButton>
          <div>
            <span>阻塞 / 未分配</span
            ><strong
              >{{ overview.attention.blocked ?? 0 }} /
              {{ overview.attention.unassigned ?? 0 }}</strong
            ><small>当前项目全部记录</small>
          </div>
        </div>
        <div class="overview-columns">
          <section class="panel">
            <div class="section-heading">
              <h2>工作状态</h2>
              <span class="muted">当前项目全部记录</span>
            </div>
            <div class="count-list">
              <div v-for="k in ['requirement', 'task', 'bug']" :key="k">
                <strong>{{ zh(k) }} · 全部状态 {{ count(k) }}</strong>
                <div class="chips">
                  <ATag
                    v-for="c in overview.counts.filter(
                      (c: any) => c.kind === k,
                    )"
                    :key="c.state"
                    >{{ zh(c.state) }} {{ c.count }}</ATag
                  ><span v-if="!count(k)" class="muted">暂无记录</span>
                </div>
              </div>
            </div>
          </section>
          <section class="panel">
            <div class="section-heading">
              <h2>快捷入口</h2>
              <span class="muted">按项目角色协作</span>
            </div>
            <div class="entry-list">
              <div
                v-for="e in [
                  {
                    key: 'requirements',
                    title: '需求',
                    text: '细化业务目标、验收标准，拆分执行工作',
                  },
                  {
                    key: 'tasks',
                    title: '执行任务',
                    text: '明确完成标准，分配或进入可认领队列',
                  },
                  {
                    key: 'bugs',
                    title: 'Bug',
                    text: '独立登记缺陷，修复后单独验证',
                  },
                ]"
                :key="e.key"
              >
                <div>
                  <h3>{{ e.title }}</h3>
                  <p>{{ e.text }}</p>
                </div>
                <RouterLink :to="tabLocation(e.key)"
                  >查看{{ e.title }} →</RouterLink
                >
              </div>
            </div>
          </section>
        </div>
        <section class="panel project-members">
          <div class="section-heading">
            <h2>项目成员与岗位</h2>
            <RouterLink :to="{ path: '/members', query: { projectId } }"
              >查看或调整角色 →</RouterLink
            >
          </div>
          <div class="member-strip">
            <div v-for="m in projectMembers" :key="m.id">
              <div class="person">
                <AAvatar :size="26">{{ m.displayName.slice(0, 1) }}</AAvatar
                ><strong>{{ m.displayName }}</strong>
              </div>
              <p>
                {{
                  m.roles?.length
                    ? m.roles
                        .map((r) => zh(r.role) + (r.lead ? "负责人" : ""))
                        .join(" · ")
                    : "尚未配置项目角色"
                }}
              </p>
            </div>
          </div>
        </section>
      </template>
      <template v-else-if="tab === 'settings'">
        <ProjectSettingsNav :project-id="projectId" :active="settingsSection" />
        <section
          v-if="settingsSection === 'basic'"
          class="panel settings-basic-panel"
        >
          <div class="section-heading">
            <h2>项目基本信息</h2>
            <span class="project-code"
              >{{ overview.project.id }} · 版本
              {{ overview.project.version }}</span
            >
          </div>
          <dl class="project-properties">
            <dt>项目名称</dt>
            <dd>{{ overview.project.name }}</dd>
            <dt>项目简介</dt>
            <dd>{{ overview.project.description || "暂无项目简介" }}</dd>
            <dt>项目状态</dt>
            <dd>
              <ATag :color="overview.project.archived ? undefined : 'blue'">{{
                overview.project.archived ? "已归档" : "进行中"
              }}</ATag>
            </dd>
          </dl>
          <div class="settings-note">
            <h3>并发编辑会检查版本</h3>
            <p>
              {{
                state.member?.isAdmin
                  ? "使用项目头部“编辑项目”修改名称与简介。"
                  : "项目名称与简介由管理员维护。"
              }}发生冲突时保留填写内容，重新读取最新版本后再提交。
            </p>
          </div>
          <div class="settings-footer">
            <h3>归档与历史</h3>
            <p>
              归档后业务记录只读，历史与贡献完整保留。{{
                state.member?.isAdmin
                  ? "可使用上方项目操作归档或恢复项目。"
                  : "项目设置由管理员维护。"
              }}
            </p>
          </div>
        </section>
        <section v-else class="panel panel-body archive-history-guide">
          <h2>归档与历史</h2>
          <p>
            归档后业务记录只读，完整保留授权、编辑、归档与恢复记录。{{
              state.member?.isAdmin
                ? "请使用项目头部归档或恢复，先核对相关工作安排。"
                : "仅管理员可归档或恢复项目。"
            }}
          </p>
        </section>
      </template>
      <template v-else-if="tab === 'tests'">
        <div class="queue-grid">
          <AButton
            v-for="q in queues"
            :key="q.key"
            class="queue-card"
            :class="{ selected: queue.key === q.key }"
            :aria-pressed="queue.key === q.key"
            @click="navigateTab('tests', { queue: q.key })"
            ><span>{{ q.label }}</span
            ><strong>{{ count(q.kind, [q.state]) }}</strong
            ><small>当前项目 · {{ zh(q.state) }}</small></AButton
          >
        </div>
        <AAlert
          type="info"
          show-icon
          message="检查、修复验证与最终验收各有独立记录"
          description="进入工作详情记录结论；自测需明确标记，最终产品验收人不能参与该需求的实际开发与修复。"
        />
      </template>
    </template>
    <section v-if="tab !== 'settings' || !overview" class="panel project-work">
      <div class="section-heading">
        <div>
          <h2>{{ listTitle }}</h2>
          <p>
            {{
              tab === "tests"
                ? "只显示当前项目所选队列；从详情核对版本、证据与执行权限。"
                : "先看状态与责任人，再进入详情推进工作。"
            }}
          </p>
        </div>
        <AButton @click="load()" :disabled="busy">刷新列表</AButton>
      </div>
      <FilterPanel ref="workPanel" :model-value="workFilters" :defaults="filterDefaults" :scope-key="filterScope" label="项目工作筛选" @apply="applyWorkFilters" v-slot="{ draft }">
      <div class="filters">
        <div v-if="tab !== 'tests'">
          <label for="project-kind">工作类型</label
          ><ASelect
            id="project-kind"
            :value="['requirements', 'tasks', 'bugs'].includes(tab) ? requestKind : draft.kind"
            :disabled="['requirements', 'tasks', 'bugs'].includes(tab)"
            @update:value="draft.kind = typeof $event === 'string' ? $event : ''"
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
            :value="draft.owner"
            @update:value="draft.owner = typeof $event === 'string' ? $event : ''"
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
        <div v-if="tab !== 'tests'">
          <label for="project-status">状态</label
          ><ASelect
            id="project-status"
            :value="draft.status"
            @update:value="draft.status = typeof $event === 'string' ? $event : ''"
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
            :value="draft.blocked"
            @update:value="draft.blocked = typeof $event === 'string' ? $event : ''"
            allow-clear
            :options="[
              { value: '', label: '全部' },
              { value: 'true', label: '仅阻塞' },
              { value: 'false', label: '未阻塞' },
            ]"
          />
        </div>
        <div>
          <label for="project-keyword">搜索编号或标题</label>
          <AInput id="project-keyword" v-model:value="draft.keyword" aria-label="搜索编号或标题" placeholder="搜索编号或标题" :maxlength="200" allow-clear />
        </div>
      </div>
      </FilterPanel>
      <p v-if="busy" class="empty" role="status">正在读取…</p>
      <WorkList v-else :items="items" />
      <p v-if="!busy && !items.length && !error" class="empty">
        当前条件下没有工作事项
      </p>
      <div v-if="!busy" class="list-footer">
        <span
          >已加载 {{ items.length }} 项{{
            cursor ? " · 还有更多记录" : ""
          }}</span
        ><AButton
          v-if="cursor"
          :disabled="busy"
          @click="load(true)"
          class="load-more"
          >加载更多</AButton
        >
      </div>
    </section>
    <section v-if="overview" class="workflow-note">
      <div class="workflow-heading">
        <h3>项目协作规则</h3>
        <RouterLink
          :to="{
            path: '/projects/' + projectId,
            query: { tab: 'settings', section: 'history' },
            hash: '#project-history',
          }"
          >查看项目活动历史 →</RouterLink
        >
      </div>
      <p>
        产品或对应职责负责人可录入、细化需求与拆分任务；需求不支持认领。对应角色成员可在任务或
        Bug
        详情中认领未分配工作，产品或对应负责人可分配给有效的对应角色成员。Bug
        须先由产品或测试确认，才能认领。产品最终验收须独立于实际开发或修复人员。
      </p>
    </section>
    <div
      v-if="overview && tab === 'settings' && settingsSection === 'history'"
      id="project-history"
    >
      <HistoryList
        kind="project"
        :id="overview.project.id"
        :refresh="overview.project.version"
      />
    </div>
    <ActionForm
      v-if="form"
      :spec="form"
      :draft-key="formKey"
      :version="version"
      @saved="saved"
      @cancel="cancelForm"
    />
  </div>
</template>
<style scoped>
.projects-page {
  min-width: 0;
}
.heading-actions,
.directory-filters,
.archive-tabs,
.card-top,
.project-card-footer,
.guide-actions,
.person {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.heading-actions {
  justify-content: flex-end;
  max-width: 560px;
}
.projects-page > .ant-alert {
  margin-bottom: 20px;
}
.project-navigation {
  display: flex;
  gap: 26px;
  overflow-x: auto;
  border-bottom: 1px solid var(--line, #e4e9f1);
  margin: 0 0 24px;
  padding-bottom: 16px;
}
.project-navigation a {
  padding: 0 0 10px;
  color: #58677d;
  white-space: nowrap;
  font-size: 13px;
  border-bottom: 2px solid transparent;
}
.project-navigation a[aria-current] {
  color: var(--primary, #245bdb);
  font-weight: 600;
  border-color: var(--primary, #245bdb);
}
.directory-filters {
  margin-bottom: 22px;
}
.directory-filters > .ant-input-affix-wrapper {
  width: 250px;
}
.project-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.project-card {
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
.project-card.archived {
  background: #fafbfd;
}
.card-top,
.project-card-footer {
  justify-content: space-between;
}
.project-icon,
.empty-project-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #245bdb;
  background: #edf3ff;
  border-radius: 8px;
  width: 38px;
  height: 38px;
  font-size: 20px;
}
.project-code {
  font:
    12px ui-monospace,
    SFMono-Regular,
    monospace;
  color: #6a7890;
  overflow-wrap: anywhere;
}
.project-card h2 {
  font-size: 17px;
  margin: 10px 0;
  overflow-wrap: anywhere;
}
.project-card h2 a {
  color: #17243b;
}
.project-card p {
  font-size: 12px;
  color: #58677d;
  min-height: 42px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.project-role-summary {
  margin-top: auto;
  padding-top: 18px;
  border-top: 1px solid var(--line, #e4e9f1);
  font-size: 12px;
}
.project-role-summary .chips {
  margin-top: 10px;
}
.project-card-footer .ant-btn {
  padding-left: 0;
}
.enter-project {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  border: 1px solid #d9e1ef;
  border-radius: 6px;
  color: #17243b;
  background: white;
  font-size: 12px;
}
.enter-project .anticon {
  transform: rotate(45deg);
}
.first-project {
  padding: 80px 24px;
  text-align: center;
}
.empty-project-icon {
  width: 90px;
  height: 90px;
  font-size: 32px;
  border-radius: 24px;
  margin: 0 auto 24px;
}
.first-project h2 {
  font-size: 22px;
}
.first-project p {
  max-width: 460px;
  margin: 18px auto 28px;
  color: #58677d;
  line-height: 1.9;
}
.first-project ol {
  display: table;
  text-align: left;
  background: #f8faff;
  padding: 22px 28px 22px 44px;
  margin: 34px auto 0;
  font-size: 12px;
  color: #58677d;
  line-height: 2.6;
}
.collaboration-guide {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
  border: 1px solid #dbe5f8;
  background: #f0f5ff;
  border-radius: 8px;
  margin-bottom: 22px;
}
.collaboration-guide.without-role {
  background: #fff9ee;
  border-color: #f0e1c2;
}
.collaboration-guide h2 {
  font-size: 14px;
  margin-bottom: 8px;
}
.collaboration-guide p {
  font-size: 12px;
  color: #58677d;
  margin: 0;
  line-height: 1.8;
}
.guide-actions {
  flex-shrink: 0;
  align-items: flex-end;
  flex-direction: column;
  font-size: 12px;
  max-width: 240px;
}
.project-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  background: white;
  border: 1px solid var(--line, #e4e9f1);
  border-radius: 8px;
  margin-bottom: 24px;
}
.project-metrics > div {
  padding: 22px 24px;
  border-right: 1px solid var(--line, #e4e9f1);
}
.project-metrics > div:last-child {
  border-right: 0;
}
.project-metrics span,
.project-metrics small {
  display: block;
  font-size: 12px;
  color: #58677d;
}
.project-metrics small {
  font-size: 11px;
  line-height: 1.8;
}
.project-metrics strong {
  display: block;
  font-size: 30px;
  font-weight: 600;
  line-height: 1.35;
  margin: 7px 0 5px;
  color: #17243b;
}
.overview-columns,
.setup-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px;
}
.projects-page .section-heading {
  padding: 19px 22px;
  border-bottom: 1px solid var(--line, #e4e9f1);
}
.projects-page .section-heading h2 {
  font-size: 15px;
  margin: 0;
}
.projects-page .section-heading p {
  font-size: 12px;
  margin: 6px 0 0;
  color: #58677d;
}
.projects-page .section-heading > .muted,
.projects-page .section-heading > a {
  font-size: 12px;
}
.entry-list,
.count-list {
  padding: 0 22px;
}
.entry-list > div,
.count-list > div {
  padding: 18px 0;
  border-bottom: 1px solid var(--line, #e4e9f1);
}
.entry-list > div:last-child,
.count-list > div:last-child {
  border-bottom: 0;
}
.entry-list > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.entry-list h3 {
  font-size: 13px;
  margin: 0 0 8px;
}
.entry-list p {
  font-size: 12px;
  color: #58677d;
  margin: 0;
}
.entry-list a {
  font-size: 12px;
  white-space: nowrap;
}
.count-list strong {
  font-size: 13px;
  font-weight: 500;
  display: block;
  margin-bottom: 10px;
}
.count-list .chips {
  gap: 5px;
  margin: 0;
}
.project-members,
.project-work {
  margin-top: 22px;
}
.member-strip {
  display: flex;
  gap: 30px;
  flex-wrap: wrap;
  padding: 22px;
}
.person {
  font-size: 12px;
}
.person strong {
  font-weight: 500;
}
.member-strip p {
  font-size: 12px;
  color: #58677d;
  margin: 10px 0 0;
}
.created-project {
  padding: 28px;
  margin-bottom: 22px;
}
.created-project h2 {
  font-size: 23px;
  margin: 12px 0;
}
.created-project p {
  font-size: 13px;
  color: #58677d;
  line-height: 1.9;
}
.setup-grid {
  margin-top: 24px;
}
.setup-grid > div {
  padding: 22px;
  border: 1px solid var(--line, #e4e9f1);
  border-radius: 6px;
  background: #fcfdff;
}
.setup-grid h3 {
  font-size: 15px;
}
.setup-grid p {
  margin: 12px 0 22px;
}
.settings-layout {
  display: grid;
  grid-template-columns: 175px minmax(0, 1fr);
  gap: 24px;
}
.settings-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.settings-menu > * {
  padding: 14px 18px;
  color: #58677d;
  font-size: 13px;
  border-radius: 6px;
}
.settings-menu [aria-current] {
  background: #eaf0ff;
  color: #245bdb;
  font-weight: 600;
}
.settings-menu .anticon {
  margin-right: 8px;
}
.project-properties {
  padding: 26px;
  margin: 0;
  display: grid;
  gap: 12px;
}
.project-properties dt {
  font-size: 13px;
  color: #58677d;
}
.project-properties dd {
  padding: 10px 12px;
  border: 1px solid var(--line, #e4e9f1);
  border-radius: 6px;
  margin: 0 0 10px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.settings-note {
  margin: 0 26px 26px;
  padding: 18px;
  background: #f8faff;
  border: 1px solid var(--line, #e4e9f1);
  border-radius: 6px;
}
.settings-note h3,
.settings-footer h3 {
  font-size: 13px;
  margin: 0 0 8px;
}
.settings-note p,
.settings-footer p {
  font-size: 12px;
  color: #58677d;
  line-height: 1.9;
  margin: 0;
}
.settings-footer {
  padding: 22px 26px;
  background: #fafbfd;
  border-top: 1px solid var(--line, #e4e9f1);
}
.queue-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  margin-bottom: 22px;
}
.queue-card.ant-btn {
  height: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  padding: 22px;
  gap: 10px;
  white-space: normal;
  background: white;
}
.queue-card.selected {
  border-color: #245bdb;
  background: #f4f7ff;
}
.queue-card span {
  font-size: 14px;
  font-weight: 600;
}
.queue-card strong {
  font-size: 28px;
}
.queue-card small {
  font-size: 12px;
  color: #58677d;
}
.list-footer {
  padding: 16px 22px;
  border-top: 1px solid var(--line, #e4e9f1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #58677d;
}
.list-footer .load-more {
  margin: 0;
}
.workflow-note {
  padding: 18px 20px;
  background: #f0f5ff;
  border: 1px solid #dbe5f8;
  border-radius: 8px;
  margin: 22px 0;
}
.workflow-note h3 {
  font-size: 13px;
  margin: 0 0 8px;
}
.workflow-note p {
  font-size: 12px;
  color: #58677d;
  line-height: 1.9;
  margin: 0;
}
#project-history {
  margin-top: 22px;
}
@media (max-width: 1150px) {
  .project-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .project-metrics > div {
    padding: 20px 16px;
  }
  .project-metrics strong {
    font-size: 26px;
  }
  .heading-actions {
    max-width: 460px;
  }
  .guide-actions {
    max-width: 200px;
  }
}
@media (max-width: 850px) {
  .overview-columns {
    grid-template-columns: 1fr;
  }
  .settings-layout {
    grid-template-columns: 1fr;
  }
  .settings-menu {
    flex-direction: row;
    overflow-x: auto;
  }
  .settings-menu > * {
    white-space: nowrap;
  }
  .collaboration-guide {
    align-items: flex-start;
    flex-direction: column;
  }
  .guide-actions {
    max-width: none;
    align-items: flex-start;
    flex-direction: row;
  }
  .heading-actions {
    justify-content: flex-start;
    max-width: none;
  }
  .project-navigation {
    gap: 24px;
  }
}
@media (max-width: 600px) {
  .project-card-grid,
  .setup-grid {
    grid-template-columns: 1fr;
  }
  .project-card {
    padding: 20px;
  }
  .directory-filters > .ant-input-affix-wrapper {
    width: 100%;
  }
  .archive-tabs {
    gap: 6px;
  }
  .archive-tabs .ant-btn {
    font-size: 12px;
    padding-inline: 10px;
  }
  .project-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .project-metrics > div:nth-child(2) {
    border-right: 0;
  }
  .project-metrics > div:nth-child(-n + 2) {
    border-bottom: 1px solid var(--line, #e4e9f1);
  }
  .project-metrics strong {
    font-size: 26px;
  }
  .project-navigation {
    gap: 23px;
    padding-bottom: 12px;
  }
  .project-navigation a {
    font-size: 12px;
  }
  .queue-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .queue-card.ant-btn {
    display: grid;
    grid-template-columns: 1fr auto;
    padding: 16px;
  }
  .queue-card small {
    grid-column: 1/-1;
  }
  .queue-card strong {
    font-size: 22px;
  }
  .created-project {
    padding: 20px;
  }
  .first-project {
    padding: 45px 18px;
  }
  .first-project ol {
    font-size: 11px;
    padding-right: 12px;
  }
  .member-strip {
    gap: 22px;
  }
  .settings-menu > * {
    padding: 12px;
  }
  .project-properties {
    padding: 20px;
  }
  .settings-note {
    margin: 0 20px 20px;
  }
  .projects-page .section-heading {
    padding: 18px;
  }
  .projects-page .section-heading > .project-code {
    max-width: 45%;
  }
}

.directory-result {
  margin-left: auto;
  color: #7b879b;
  font-size: 12px;
}
.directory-section-heading,
.archive-section-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 14px;
}
.directory-section-heading span,
.archive-section-toggle span {
  font-size: 12px;
  font-weight: 400;
  color: #7b879b;
}
.archive-section-toggle {
  width: 100%;
  border: 0;
  border-top: 1px solid #e4e9f1;
  padding: 18px 0 0;
  background: none;
  text-align: left;
  color: #58677d;
  cursor: pointer;
}
.project-directory-section {
  margin-bottom: 22px;
  min-width: 0;
}
.directory-empty {
  padding: 40px;
  text-align: center;
}
.directory-empty h2 {
  font-size: 16px;
}
.directory-empty p,
.directory-section-empty {
  color: #738097;
  font-size: 13px;
}
.project-card-grid {
  grid-template-columns: repeat(auto-fill, minmax(min(310px, 100%), 1fr));
  gap: 18px;
}
.project-card {
  padding: 20px;
  gap: 14px;
  transition: box-shadow 0.15s;
}
.project-card:hover {
  border-color: #c9d6ea;
  box-shadow: 0 5px 18px #17243b0c;
}
.project-card h2 {
  margin: 8px 0;
}
.project-card p {
  font-size: 13px;
  line-height: 1.7;
}
.project-role-summary {
  padding-top: 14px;
}
.project-card-footer {
  gap: 10px;
}
.project-metrics {
  gap: 14px;
  border: 0;
  background: none;
}
.project-metrics > div,
.project-metrics > .ant-btn {
  border: 1px solid #e4e9f1;
  border-radius: 8px;
  background: #fff;
  padding: 17px 18px;
  min-width: 0;
}
.project-metrics > .ant-btn {
  height: auto;
  text-align: left;
  white-space: normal;
}
.project-metrics > .ant-btn:hover {
  border-color: #245bdb;
  background: #f8faff;
}
.project-metrics strong {
  font-size: 26px;
}
.overview-columns {
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 18px;
}
.entry-list > div {
  padding: 13px 0;
}
.entry-list h3 {
  margin-bottom: 4px;
}
.settings-basic-panel {
  max-width: 760px;
}
.archive-history-guide h2 {
  font-size: 16px;
}
.archive-history-guide p {
  font-size: 13px;
  line-height: 1.8;
  color: #58677d;
}
.workflow-heading {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  flex-wrap: wrap;
}
.workflow-heading a {
  font-size: 12px;
}
.project-header :deep(.project-heading-actions .ant-btn) {
  font-size: 12px;
  padding-inline: 11px;
}
.project-header :deep(.project-heading-description) {
  max-height: 5.4em;
  overflow: auto;
}
@media (max-width: 850px) {
  .overview-columns {
    grid-template-columns: 1fr;
  }
  .directory-result {
    margin-left: 0;
  }
}
@media (max-width: 600px) {
  .project-metrics {
    gap: 10px;
  }
  .project-metrics > div,
  .project-metrics > .ant-btn {
    padding: 15px;
  }
  .directory-empty {
    padding: 30px 16px;
  }
  .project-metrics > div:nth-child(2),
  .project-metrics > div:last-child {
    border-right: 1px solid #e4e9f1;
  }
}
</style>

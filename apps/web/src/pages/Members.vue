<script setup lang="ts">
import AAvatar from "ant-design-vue/es/avatar";
import ACheckbox from "ant-design-vue/es/checkbox";
import {
  UserAddOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons-vue";
import ASelect from "ant-design-vue/es/select";
import AInput from "ant-design-vue/es/input";
import ATable from "ant-design-vue/es/table";
import ATag from "ant-design-vue/es/tag";
import AButton from "ant-design-vue/es/button";
import AAlert from "ant-design-vue/es/alert";
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { state, zh, type Member, type Project } from "../state";
import { allPages, request, type Page } from "../api/client";
import { field, type FormSpec } from "../forms";
import { useReadScope } from "../composables/readScope";
import ActionForm from "../components/ActionForm.vue";
import HistoryList from "../components/HistoryList.vue";
const route = useRoute(),
  router = useRouter();
function projectFromQuery(value: unknown): string {
  if (value === undefined)
    return state.projectId || state.projects[0]?.id || "";
  return typeof value === "string" ? value : "";
}
const auditMember = ref("");
const search = ref("");
const roleContext = computed(
  () =>
    typeof route.query.projectId === "string" &&
    !!route.query.projectId &&
    state.projects.some((p) => p.id === route.query.projectId),
);
const roleNames = ["product", "frontend", "backend", "test"];
const projectTabs = [
  { key: "overview", label: "概览" },
  { key: "requirements", label: "需求" },
  { key: "tasks", label: "任务" },
  { key: "bugs", label: "Bug" },
  { key: "tests", label: "测试与验收" },
  { key: "settings", label: "项目设置" },
];
const visibleMembers = computed(() =>
  members.value.filter(
    (m) =>
      !search.value ||
      m.displayName.toLowerCase().includes(search.value.toLowerCase()),
  ),
);
const columns = computed(() => [
  { key: "member", title: "成员", width: roleContext.value ? 180 : undefined },
  { key: "active", title: "状态", width: 90 },
  ...(roleContext.value
    ? roleNames.map((role) => ({ key: role, title: zh(role), width: 80 }))
    : [{ key: "roles", title: "项目角色" }]),
  ...(roleContext.value
    ? [{ key: "leads", title: "岗位负责人", width: 140 }]
    : []),
  ...(state.member?.isAdmin
    ? [
        {
          key: "actions",
          title: "管理操作",
          width: roleContext.value ? 300 : undefined,
        },
      ]
    : []),
]);
const members = ref<any[]>([]),
  projectId = ref(projectFromQuery(route.query.projectId)),
  active = ref(""),
  cursor = ref<string | null>(null),
  error = ref(""),
  busy = ref(false),
  permissionsRefreshing = ref(false),
  directoryReady = ref(false),
  directoryError = ref(""),
  loadedScope = ref(""),
  form = ref<FormSpec>(),
  version = ref<number>(),
  formKey = ref(""),
  ticket = ref(""),
  ticketKind = ref(""),
  notice = ref("");
const project = computed(() =>
  state.projects.find((p) => p.id === projectId.value),
);
const scope = computed(() => JSON.stringify([projectId.value, active.value]));
const reads = useReadScope(() => scope.value);
const permissionReads = useReadScope(() => String(state.member?.id ?? ""));
const writesReady = computed(
  () =>
    directoryReady.value &&
    loadedScope.value === scope.value &&
    !busy.value &&
    !permissionsRefreshing.value &&
    !state.mutationPending,
);
async function load(more = false) {
  const read = reads.begin(more);
  if (!read || (more && !cursor.value)) return;
  if (!more) {
    loadedScope.value = "";
    members.value = [];
    cursor.value = null;
  }
  busy.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams();
    if (projectId.value) q.set("projectId", projectId.value);
    if (active.value) q.set("active", active.value);
    if (more && cursor.value) q.set("cursor", cursor.value);
    const p = await request<Page<any>>("/api/members?" + q);
    read.commit(() => {
      members.value = more ? [...members.value, ...p.items] : p.items;
      cursor.value = p.nextCursor;
      loadedScope.value = scope.value;
    });
  } catch (e) {
    read.commit(() => {
      loadedScope.value = "";
      error.value = (e as Error).message;
    });
  } finally {
    read.finish(() => {
      busy.value = false;
    });
  }
}
// A successful write can close its form immediately, but the next write must
// wait for both fresh directory versions and the current scoped member rows.
async function refreshPermissions() {
  if (permissionsRefreshing.value) return;
  const refresh = permissionReads.begin();
  if (!refresh) return;
  permissionsRefreshing.value = true;
  directoryReady.value = false;
  directoryError.value = "";
  reads.invalidate();
  busy.value = false;
  try {
    const [projects, directory] = await Promise.all([
      allPages<Project>("/api/projects"),
      allPages<Member>("/api/members"),
    ]);
    if (!refresh.valid()) return;
    refresh.commit(() => {
      state.projects = projects;
      state.members = directory;
      directoryReady.value = true;
    });
    await load();
  } catch (e) {
    refresh.commit(() => {
      directoryError.value = (e as Error).message;
    });
  } finally {
    refresh.finish(() => {
      permissionsRefreshing.value = false;
    });
  }
}
watch(
  () => route.query.projectId,
  (id) => {
    projectId.value = projectFromQuery(id);
    form.value = undefined;
  },
);
function selectProject(id: unknown) {
  if (state.mutationPending) return;
  router.push({
    path: "/members",
    query: { projectId: typeof id === "string" ? id : "" },
  });
}
watch(
  [projectId, active],
  () => {
    if (directoryReady.value) void load();
    else if (!permissionsRefreshing.value && !directoryError.value)
      void refreshPermissions();
  },
  { immediate: true },
);
function open(a: string, m?: any) {
  if (!writesReady.value) return;
  if (
    a === "roles" &&
    (!project.value || project.value.archived || !state.member?.isAdmin)
  )
    return;
  ticket.value = "";
  formKey.value = a + ":" + (m?.id ?? "new") + ":" + projectId.value;
  version.value =
    a === "create"
      ? undefined
      : a === "roles"
        ? project.value?.version
        : m.version;
  const roles = m?.roles ?? [];
  form.value = {
    title: (
      {
        create: "创建成员",
        rename: "修改显示名",
        reset: "签发密码重置票据",
        deactivate: "停用成员",
        roles: "调整项目授权",
      } as any
    )[a],
    description: m
      ? `成员 ${m.displayName} · ${project.value?.name ?? ""}`
      : "创建后由成员本人使用票据激活账号",
    impact:
      a === "deactivate"
        ? "停用会立即撤销会话并阻止继续写入；未完成事项保留原责任归属并显示停用提示。"
        : a === "roles"
          ? "授权变化立即生效；撤销权限后旧会话也不能继续写入。"
          : undefined,
    path:
      a === "create"
        ? "/api/members"
        : a === "roles"
          ? `/api/projects/${projectId.value}/roles`
          : `/api/members/${m.id}/${a}`,
    method: a === "roles" ? "PUT" : "POST",
    initial: {
      login: "",
      displayName: m?.displayName ?? "",
      roles: roles.map((r: any) => r.role),
      leads: roles.filter((r: any) => r.lead).map((r: any) => r.role),
    },
    fields:
      a === "create"
        ? [
            field("login", "登录账号（小写英文或数字）"),
            field("displayName", "显示名"),
          ]
        : a === "rename"
          ? [field("displayName", "显示名")]
          : a === "roles"
            ? [
                field("roles", "项目角色", "multi", false, {
                  options: ["product", "frontend", "backend", "test"].map(
                    (value) => ({ value, label: zh(value) }),
                  ),
                }),
                field("leads", "角色负责人", "multi", false, {
                  options: ["product", "frontend", "backend", "test"].map(
                    (value) => ({ value, label: zh(value) }),
                  ),
                }),
              ]
            : [],
    body: (v) =>
      a === "create"
        ? { login: v.login, displayName: v.displayName }
        : a === "rename"
          ? { displayName: v.displayName }
          : a === "roles"
            ? { memberId: m.id, roles: v.roles, leads: v.leads }
            : {},
  };
}
async function saved(r: any) {
  directoryReady.value = false;
  form.value = undefined;
  ticket.value = r.activationToken ?? r.resetToken ?? "";
  ticketKind.value = r.activationToken ? "activate" : "reset";
  notice.value =
    r.ticketIssued && !ticket.value
      ? "票据已签发；重复请求只返回安全元数据。若原票据丢失，请刷新成员版本后重新签发。"
      : "操作已完成";
  await refreshPermissions();
}
</script>
<template>
  <div class="members-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">{{
          roleContext && project ? "PROJECT / " + project.id : "TEAM MEMBERS"
        }}</span>
        <h1>{{ roleContext && project ? "项目设置" : "成员管理" }}</h1>
        <p>
          {{
            roleContext && project
              ? "管理员显式配置项目岗位；业务身份不会自动获得。"
              : "平台成员决定谁能登录，项目角色决定谁能操作。"
          }}
        </p>
      </div>
      <AButton
        v-if="state.member?.isAdmin"
        type="primary"
        :disabled="!writesReady"
        @click="open('create')"
      >
        <UserAddOutlined aria-hidden="true" />创建成员
      </AButton>
    </div>
    <nav
      v-if="roleContext && project"
      class="project-navigation"
      aria-label="项目导航"
    >
      <RouterLink
        v-for="t in projectTabs"
        :key="t.key"
        :to="{
          path: '/projects/' + project.id,
          query: t.key === 'overview' ? {} : { tab: t.key },
        }"
        :aria-current="t.key === 'settings' ? 'page' : undefined"
        >{{ t.label }}</RouterLink
      >
    </nav>
    <AAlert v-if="directoryError || error" type="error" show-icon role="alert"
      ><template #message>
        {{ directoryError || error
        }}<AButton
          :disabled="permissionsRefreshing || busy || state.mutationPending"
          @click="refreshPermissions()"
          >重新读取成员</AButton
        >
      </template></AAlert
    >
    <AAlert
      v-if="notice"
      :message="notice"
      type="success"
      role="status"
      show-icon
    />
    <section v-if="ticket" class="panel panel-body">
      <h2>
        {{ ticketKind === "activate" ? "激活" : "重置" }}票据 · 仅本次显示
      </h2>
      <p>
        通过可信渠道交给本人；请勿用于截图或公开文档。票据不会存储到本地草稿。
      </p>
      <label
        >一次性票据<AInput :value="ticket" readonly autocomplete="off" /></label
      ><RouterLink :to="ticketKind === 'activate' ? '/activate' : '/reset'"
        >打开本人{{
          ticketKind === "activate" ? "激活" : "重置"
        }}表单</RouterLink
      ><AButton @click="ticket = ''">隐藏票据</AButton>
    </section>
    <div
      class="member-layout"
      :class="{ 'with-project': roleContext && project }"
    >
      <nav
        v-if="roleContext && project"
        class="settings-menu"
        aria-label="项目设置导航"
      >
        <RouterLink
          :to="{ path: '/projects/' + project.id, query: { tab: 'settings' } }"
          >基本信息</RouterLink
        ><span aria-current="page">成员与角色</span
        ><RouterLink
          :to="'/projects/' + project.id + '?tab=settings#project-history'"
          >归档与历史</RouterLink
        >
      </nav>
      <div class="member-content">
        <section class="permission-guide">
          <SafetyCertificateOutlined aria-hidden="true" />
          <div>
            <h2>
              {{
                roleContext
                  ? "平台成员与项目业务角色分别管理"
                  : "平台账号与项目授权各有明确范围"
              }}
            </h2>
            <p>
              所有有效成员可查看项目。管理员账号不会自动获得产品、开发或测试身份，一个成员可承担多个岗位。
            </p>
          </div>
          <RouterLink
            v-if="roleContext"
            :to="{ path: '/members', query: { projectId: '' } }"
            >管理平台成员</RouterLink
          >
        </section>
        <p v-if="project" class="project-return">
          <RouterLink :to="'/projects/' + project.id"
            >返回项目 · {{ project.name }}</RouterLink
          >
        </p>
        <AAlert
          v-if="!project"
          type="info"
          message="请先选择有效项目，再调整项目角色。"
        />
        <AAlert
          v-else-if="project.archived"
          type="warning"
          message="此项目已归档，角色授权只读。管理员恢复项目后可调整。"
        />
        <p v-else class="scope-description">
          当前授权项目：{{
            project.name
          }}。逐个成员明确选择项目角色；创建项目或成员不会自动授予业务角色。
        </p>
        <section class="panel member-panel">
          <div class="section-heading">
            <h2>{{ roleContext ? "成员与项目岗位" : "平台成员目录" }}</h2>
            <span>已加载 {{ members.length }} 位成员</span>
          </div>
          <div class="filters">
            <div class="member-search">
              <label for="member-search">搜索已加载成员</label
              ><AInput
                id="member-search"
                v-model:value="search"
                placeholder="搜索显示名"
                allow-clear
              />
            </div>
            <div>
              <label for="member-project">授权项目</label
              ><ASelect
                id="member-project"
                :value="projectId"
                :disabled="state.mutationPending"
                @update:value="selectProject"
                :options="
                  state.projects.map((p) => ({ value: p.id, label: p.name }))
                "
              />
            </div>
            <div>
              <label for="member-active">成员状态</label
              ><ASelect
                id="member-active"
                :value="active"
                :disabled="state.mutationPending"
                @update:value="
                  active = typeof $event === 'string' ? $event : ''
                "
                allow-clear
                :options="[
                  { value: '', label: '全部成员' },
                  { value: 'true', label: '有效成员' },
                  { value: 'false', label: '已停用' },
                ]"
              />
            </div>
            <AButton
              :disabled="permissionsRefreshing || busy || state.mutationPending"
              @click="refreshPermissions()"
              >刷新权限</AButton
            >
          </div>
          <p v-if="!state.member?.isAdmin" class="panel-body muted">
            你可查看安全成员目录，管理动作仅向管理员开放。
          </p>
          <p class="member-scroll-hint muted">
            左右滑动可查看完整成员信息与操作
          </p>
          <!-- Keep scrolling outside Ant Table: its empty-row width measurement can
         resize its observed ancestor during the same browser layout. -->
          <div
            class="member-table-scroll"
            role="region"
            aria-label="成员目录，可横向滚动"
            tabindex="0"
          >
            <ATable
              :data-source="visibleMembers"
              row-key="id"
              :pagination="false"
              style="min-width: 700px"
              :columns="columns"
            >
              <template #bodyCell="{ column, record: m }">
                <template v-if="column.key === 'member'"
                  ><div class="member-identity">
                    <AAvatar :size="25">{{ m.displayName.slice(0, 1) }}</AAvatar
                    ><AButton type="link" @click="auditMember = m.id">{{
                      m.displayName
                    }}</AButton>
                  </div>
                  <div class="revision">
                    {{ m.isAdmin ? "平台管理员" : "平台成员" }}
                    <span v-if="projectId && !m.roles?.length">
                      · 全项目可读</span
                    >
                  </div></template
                >
                <template v-else-if="column.key === 'active'"
                  ><ATag :color="m.active ? 'success' : 'warning'">{{
                    m.active ? "有效" : "已停用"
                  }}</ATag></template
                >
                <template v-else-if="column.key === 'roles'"
                  ><ATag v-for="r in m.roles"
                    >{{ zh(r.role) }}{{ r.lead ? "负责人" : "" }}</ATag
                  ><span v-if="!m.roles?.length" class="muted"
                    >全项目可读</span
                  ></template
                >
                <template v-else-if="roleNames.includes(String(column.key))"
                  ><ACheckbox
                    :checked="m.roles?.some((r: any) => r.role === column.key)"
                    disabled
                    :aria-label="
                      m.displayName + ' · ' + zh(column.key) + '当前授权'
                    "
                /></template>
                <template v-else-if="column.key === 'leads'"
                  ><span>{{
                    m.roles
                      ?.filter((r: any) => r.lead)
                      .map((r: any) => zh(r.role))
                      .join("、") || "无"
                  }}</span></template
                >
                <template v-else-if="column.key === 'actions'"
                  ><div class="member-actions">
                    <AButton
                      type="link"
                      size="small"
                      :disabled="!writesReady"
                      @click="open('rename', m)"
                      >改名</AButton
                    ><AButton
                      type="link"
                      size="small"
                      v-if="m.active"
                      :disabled="!writesReady || !project || !!project.archived"
                      @click="open('roles', m)"
                      >授权</AButton
                    ><AButton
                      v-if="m.active"
                      type="link"
                      size="small"
                      :disabled="!writesReady"
                      @click="open('reset', m)"
                      >重置密码</AButton
                    ><AButton
                      v-if="m.active"
                      type="link"
                      size="small"
                      danger
                      :disabled="!writesReady"
                      @click="open('deactivate', m)"
                      >停用</AButton
                    >
                  </div></template
                >
              </template></ATable
            >
          </div>
          <p
            v-if="permissionsRefreshing || busy"
            class="read-status"
            role="status"
          >
            {{
              permissionsRefreshing
                ? "正在刷新权限与成员版本…"
                : "正在读取成员…"
            }}
          </p>
          <div class="member-footer">
            <span
              >已加载 {{ members.length }} 位成员{{
                search ? " · 当前显示 " + visibleMembers.length + " 位" : ""
              }}。停用账号不能登录，历史记录保留。</span
            >
            <AButton
              v-if="cursor"
              class="load-more"
              :disabled="busy || permissionsRefreshing || state.mutationPending"
              @click="load(true)"
            >
              更多成员
            </AButton>
          </div>
        </section>
        <section v-if="roleContext && project" class="panel independence-note">
          <h2>产品验收独立性</h2>
          <p>
            前端或后端可以兼测试；修复者本人验证时明确标记自测。最终产品验收人不能参与该需求的实际开发与修复，管理员也不能绕过规则。
          </p>
          <p>
            授权按成员逐个确认，使用“授权”核对项目角色与负责人后保存；撤销岗位会保留历史，未完成工作需重新安排。
          </p>
        </section>
        <p class="delivery-note">
          成员创建或重置后，一次性票据仅在本次操作显示。请通过可信渠道交给本人。
        </p>
      </div>
    </div>
    <HistoryList
      v-if="auditMember"
      kind="member"
      :id="auditMember"
    /><ActionForm
      v-if="form"
      :spec="form"
      :draft-key="'member:' + formKey"
      :version="version"
      @saved="saved"
      @cancel="form = undefined"
    />
  </div>
</template>
<style scoped>
.members-page,
.member-content {
  min-width: 0;
}
.members-page > .ant-alert {
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
  color: #245bdb;
  font-weight: 600;
  border-color: #245bdb;
}
.member-layout.with-project {
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
.permission-guide {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 18px 20px;
  border: 1px solid #dbe5f8;
  background: #f0f5ff;
  border-radius: 8px;
  margin-bottom: 20px;
}
.permission-guide > .anticon {
  font-size: 18px;
  color: #245bdb;
  margin-top: 2px;
  flex-shrink: 0;
}
.permission-guide h2 {
  font-size: 13px;
  margin: 0 0 7px;
}
.permission-guide p {
  font-size: 12px;
  line-height: 1.8;
  margin: 0;
  color: #58677d;
}
.permission-guide > a {
  white-space: nowrap;
  margin-left: auto;
  font-size: 12px;
}
.project-return {
  font-size: 12px;
  margin: 0 0 12px;
}
.scope-description {
  font-size: 12px;
  color: #58677d;
  line-height: 1.9;
  margin: 0 0 18px;
}
.member-content > .ant-alert {
  margin-bottom: 20px;
}
.member-panel .section-heading {
  padding: 19px 22px;
  border-bottom: 1px solid var(--line, #e4e9f1);
}
.member-panel .section-heading h2 {
  font-size: 15px;
  margin: 0;
}
.member-panel .section-heading > span {
  color: #58677d;
  font-size: 12px;
}
.member-panel .filters {
  align-items: flex-end;
  padding: 18px 22px;
}
.member-search {
  min-width: 190px;
}
.member-panel .filters .ant-select {
  min-width: 150px;
}
.member-panel :deep(.ant-table-thead > tr > th) {
  background: #f8fafc;
  color: #626e82;
  font-size: 12px;
  font-weight: 500;
}
.member-panel :deep(.ant-table-cell) {
  padding: 17px 18px;
  font-size: 13px;
}
.member-panel :deep(.ant-table-cell:first-child) {
  padding-left: 22px;
}
.member-panel :deep(.ant-table-cell .ant-tag) {
  font-size: 11px;
  margin-block: 3px;
}
.member-identity {
  display: flex;
  align-items: center;
  gap: 7px;
}
.member-identity .ant-btn {
  height: auto;
  padding: 0;
  color: #17243b;
  font-size: 13px;
  white-space: normal;
  text-align: left;
}
.member-panel .revision {
  font-size: 12px;
  color: #58677d;
  padding-top: 6px;
}
.member-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.member-actions .ant-btn {
  font-size: 12px;
  padding-inline: 5px;
}
.member-panel :deep(.ant-checkbox-disabled .ant-checkbox-inner) {
  background: white;
  border-color: #d8e1f1;
}
.member-panel
  :deep(.ant-checkbox-checked.ant-checkbox-disabled .ant-checkbox-inner) {
  background: #245bdb;
  border-color: #245bdb;
}
.member-panel
  :deep(
    .ant-checkbox-checked.ant-checkbox-disabled .ant-checkbox-inner::after
  ) {
  border-color: white;
}
.member-table-scroll {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
}
.member-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 22px;
  border-top: 1px solid var(--line, #e4e9f1);
  color: #58677d;
  font-size: 12px;
}
.member-footer .load-more {
  margin: 0;
  flex-shrink: 0;
}
.read-status {
  margin: 0;
  padding: 12px 22px;
  color: #58677d;
  font-size: 12px;
}
.independence-note {
  padding: 24px;
  margin-top: 22px;
}
.independence-note h2 {
  font-size: 15px;
  margin: 0 0 14px;
}
.independence-note p {
  font-size: 12px;
  line-height: 1.9;
  color: #58677d;
  margin: 8px 0 0;
}
.delivery-note {
  color: #58677d;
  font-size: 12px;
  line-height: 1.9;
  margin: 20px 0;
}
@media (max-width: 1150px) {
  .member-layout.with-project {
    grid-template-columns: 150px minmax(0, 1fr);
    gap: 20px;
  }
  .member-panel .filters .ant-select {
    min-width: 130px;
  }
  .permission-guide {
    flex-wrap: wrap;
  }
  .permission-guide > a {
    margin-left: 30px;
  }
}
@media (max-width: 850px) {
  .member-layout.with-project {
    grid-template-columns: 1fr;
  }
  .settings-menu {
    flex-direction: row;
    overflow-x: auto;
  }
  .settings-menu > * {
    white-space: nowrap;
  }
  .member-search {
    min-width: 170px;
  }
}
@media (max-width: 600px) {
  .project-navigation {
    gap: 23px;
    padding-bottom: 12px;
  }
  .project-navigation a {
    font-size: 12px;
  }
  .settings-menu > * {
    padding: 12px;
  }
  .permission-guide {
    padding: 18px 16px;
    gap: 10px;
  }
  .permission-guide > div {
    flex: 1;
    min-width: 0;
  }
  .permission-guide > a {
    margin-left: 28px;
  }
  .member-panel .section-heading {
    padding: 18px 16px;
  }
  .member-panel .filters {
    padding: 16px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 14px 10px;
  }
  .member-search {
    grid-column: 1/-1;
    min-width: 0;
  }
  .member-panel .filters .ant-select {
    min-width: 0;
    width: 100%;
  }
  .member-panel .filters > button {
    justify-self: start;
  }
  .member-footer {
    padding: 16px;
    align-items: flex-start;
    flex-direction: column;
  }
  .independence-note {
    padding: 20px;
  }
  .member-scroll-hint {
    display: block;
    padding: 0 16px 12px;
    font-size: 12px;
  }
}
</style>

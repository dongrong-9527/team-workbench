<script setup lang="ts">
import ASelect from "ant-design-vue/es/select";
import AInput from "ant-design-vue/es/input";
import ATable from "ant-design-vue/es/table";
import ATag from "ant-design-vue/es/tag";
import AButton from "ant-design-vue/es/button";
import AAlert from "ant-design-vue/es/alert";
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { state, refreshDirectory, zh } from "../state";
import { request, type Page } from "../api/client";
import { field, type FormSpec } from "../forms";
import { useReadScope } from "../composables/readScope";
import ActionForm from "../components/ActionForm.vue";
import HistoryList from "../components/HistoryList.vue";
const route = useRoute(), router = useRouter();
const auditMember = ref("");
const members = ref<any[]>([]),
  projectId = ref(typeof route.query.projectId === "string" ? route.query.projectId : state.projectId || state.projects[0]?.id || ""),
  active = ref(""),
  cursor = ref<string | null>(null),
  error = ref(""),
  busy = ref(false),
  form = ref<FormSpec>(),
  version = ref<number>(),
  formKey = ref(""),
  ticket = ref(""),
  ticketKind = ref(""),
  notice = ref("");
const project = computed(() =>
  state.projects.find((p) => p.id === projectId.value),
);
const reads = useReadScope(() =>
  JSON.stringify([projectId.value, active.value]),
);
async function load(more = false) {
  const read = reads.begin(more);
  if (!read || (more && !cursor.value)) return;
  if (!more) {
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
    });
  } catch (e) {
    if (read.valid()) error.value = (e as Error).message;
  } finally {
    read.finish(() => {
      busy.value = false;
    });
  }
}
watch(() => route.query.projectId, (id) => {
  projectId.value = typeof id === "string" ? id : "";
  form.value = undefined;
});
function selectProject(id: unknown) {
  router.replace({path:'/members',query:{projectId:typeof id === 'string' ? id : ''}});
}
watch([projectId, active], () => load(), { immediate: true });
function open(a: string, m?: any) {
  if (a === "roles" && (!project.value || project.value.archived || !state.member?.isAdmin)) return;
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
  form.value = undefined;
  ticket.value = r.activationToken ?? r.resetToken ?? "";
  ticketKind.value = r.activationToken ? "activate" : "reset";
  notice.value =
    r.ticketIssued && !ticket.value
      ? "票据已签发；重复请求只返回安全元数据。若原票据丢失，请刷新成员版本后重新签发。"
      : "操作已完成";
  await refreshDirectory();
  await load();
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">成员与项目权限</span>
      <h1>成员管理</h1>
      <p>有效成员可阅读全项目；执行与管理权限按项目授予。</p>
    </div>
    <AButton
      v-if="state.member?.isAdmin"
      type="primary"
      @click="open('create')"
    >
      创建成员
    </AButton>
  </div>
  <AAlert v-if="error" type="error" show-icon role="alert"
    ><template #message>
      {{ error }}<AButton @click="load()">重新读取成员</AButton>
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
    <h2>{{ ticketKind === "activate" ? "激活" : "重置" }}票据 · 仅本次显示</h2>
    <p>
      通过可信渠道交给本人；请勿用于截图或公开文档。票据不会存储到本地草稿。
    </p>
    <label
      >一次性票据<AInput :value="ticket" readonly autocomplete="off" /></label
    ><RouterLink :to="ticketKind === 'activate' ? '/activate' : '/reset'"
      >打开本人{{ ticketKind === "activate" ? "激活" : "重置" }}表单</RouterLink
    ><AButton @click="ticket = ''">隐藏票据</AButton>
  </section>
  <p v-if="project"><RouterLink :to="'/projects/' + project.id">返回项目 · {{ project.name }}</RouterLink></p>
  <AAlert v-if="!project" type="info" message="请先选择有效项目，再调整项目角色。" />
  <AAlert v-else-if="project.archived" type="warning" message="此项目已归档，角色授权只读。管理员恢复项目后可调整。" />
  <p v-else>当前授权项目：{{ project.name }}。逐个成员明确选择项目角色；创建项目或成员不会自动授予业务角色。</p>
  <section class="panel">
    <div class="filters" style="padding-top: 20px">
      <div>
        <label for="member-project">授权项目</label
        ><ASelect
          id="member-project"
          :value="projectId"
          @update:value="selectProject"
          :options="state.projects.map((p) => ({ value: p.id, label: p.name }))"
        />
      </div>
      <div>
        <label for="member-active">成员状态</label
        ><ASelect
          id="member-active"
          :value="active"
          @update:value="active = typeof $event === 'string' ? $event : ''"
          allow-clear
          :options="[
            { value: '', label: '全部成员' },
            { value: 'true', label: '有效成员' },
            { value: 'false', label: '已停用' },
          ]"
        />
      </div>
      <AButton @click="refreshDirectory().then(() => load())">刷新权限</AButton>
    </div>
    <p v-if="!state.member?.isAdmin" class="panel-body muted">
      你可查看安全成员目录，管理动作仅向管理员开放。
    </p>
    <p class="member-scroll-hint muted">左右滑动可查看完整成员信息与操作</p>
    <!-- Keep scrolling outside Ant Table: its empty-row width measurement can
         resize its observed ancestor during the same browser layout. -->
    <div
      class="member-table-scroll"
      role="region"
      aria-label="成员目录，可横向滚动"
      tabindex="0"
    >
      <ATable
        :data-source="members"
        row-key="id"
        :pagination="false"
        style="min-width: 700px"
        :columns="[
          { key: 'member', title: '成员' },
          { key: 'active', title: '状态' },
          { key: 'roles', title: '项目角色' },
          ...(state.member?.isAdmin
            ? [{ key: 'actions', title: '管理操作' }]
            : []),
        ]"
      >
        <template #bodyCell="{ column, record: m }">
          <template v-if="column.key === 'member'"
            ><AButton type="link" @click="auditMember = m.id">{{
              m.displayName
            }}</AButton>
            <div class="revision">
              {{ m.isAdmin ? "平台管理员" : "平台成员" }}
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
        <template v-else-if="column.key === 'actions'"
          ><div class="toolbar" style="margin: 0">
            <AButton @click="open('rename', m)">改名</AButton
            ><AButton
              v-if="m.active"
              :disabled="!project || !!project.archived"
              @click="open('roles', m)"
              >授权</AButton
            ><AButton v-if="m.active" @click="open('reset', m)"
              >重置密码</AButton
            ><AButton v-if="m.active" danger @click="open('deactivate', m)"
              >停用</AButton
            >
          </div></template
        >
      </template></ATable
    >
    </div>
    <AButton
      v-if="cursor"
      class="load-more"
      :disabled="busy"
      @click="load(true)"
    >
      更多成员
    </AButton>
  </section>
  <HistoryList v-if="auditMember" kind="member" :id="auditMember" /><ActionForm
    v-if="form"
    :spec="form"
    :draft-key="'member:' + formKey"
    :version="version"
    @saved="saved"
    @cancel="form = undefined"
  />
</template>

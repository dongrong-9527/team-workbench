<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { state, refreshDirectory, zh } from "../state";
import { request, type Page } from "../api/client";
import { field, type FormSpec } from "../forms";
import ActionForm from "../components/ActionForm.vue";
import HistoryList from "../components/HistoryList.vue";
const auditMember = ref("");
const members = ref<any[]>([]),
  projectId = ref(state.projectId || state.projects[0]?.id || ""),
  active = ref(""),
  cursor = ref<string | null>(null),
  error = ref(""),
  form = ref<FormSpec>(),
  version = ref<number>(),
  formKey = ref(""),
  ticket = ref(""),
  ticketKind = ref(""),
  notice = ref("");
const project = computed(() =>
  state.projects.find((p) => p.id === projectId.value),
);
async function load(more = false) {
  try {
    const q = new URLSearchParams();
    if (projectId.value) q.set("projectId", projectId.value);
    if (active.value) q.set("active", active.value);
    if (more && cursor.value) q.set("cursor", cursor.value);
    const p = await request<Page<any>>("/api/members?" + q);
    members.value = more ? [...members.value, ...p.items] : p.items;
    cursor.value = p.nextCursor;
    error.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  }
}
watch([projectId, active], () => load(), { immediate: true });
function open(a: string, m?: any) {
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
    <button
      v-if="state.member?.isAdmin"
      class="primary"
      @click="open('create')"
    >
      创建成员
    </button>
  </div>
  <p v-if="error" class="error" role="alert">
    {{ error }}<button @click="load()">重新读取成员</button>
  </p>
  <p v-if="notice" class="success" role="status">{{ notice }}</p>
  <section v-if="ticket" class="panel panel-body">
    <h2>{{ ticketKind === "activate" ? "激活" : "重置" }}票据 · 仅本次显示</h2>
    <p>
      通过可信渠道交给本人；请勿用于截图或公开文档。票据不会存储到本地草稿。
    </p>
    <label
      >一次性票据<input :value="ticket" readonly autocomplete="off" /></label
    ><RouterLink :to="ticketKind === 'activate' ? '/activate' : '/reset'"
      >打开本人{{ ticketKind === "activate" ? "激活" : "重置" }}表单</RouterLink
    ><button @click="ticket = ''">隐藏票据</button>
  </section>
  <section class="panel">
    <div class="filters" style="padding-top: 20px">
      <label
        >授权项目<select aria-label="授权项目" v-model="projectId">
          <option v-for="p in state.projects" :value="p.id">
            {{ p.name }}
          </option>
        </select></label
      ><label
        >成员状态<select aria-label="成员状态" v-model="active">
          <option value="">全部成员</option>
          <option value="true">有效成员</option>
          <option value="false">已停用</option>
        </select></label
      ><button @click="refreshDirectory().then(() => load())">刷新权限</button>
    </div>
    <p v-if="!state.member?.isAdmin" class="panel-body muted">
      你可查看安全成员目录，管理动作仅向管理员开放。
    </p>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>成员</th>
            <th>状态</th>
            <th>项目角色</th>
            <th v-if="state.member?.isAdmin">管理操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in members">
            <td>
              <button @click="auditMember = m.id">{{ m.displayName }}</button>
              <div class="revision">
                {{ m.isAdmin ? "平台管理员" : "平台成员" }}
              </div>
            </td>
            <td>
              <span class="badge" :class="m.active ? 'done' : 'warning'">{{
                m.active ? "有效" : "已停用"
              }}</span>
            </td>
            <td>
              <span v-for="r in m.roles" class="badge"
                >{{ zh(r.role) }}{{ r.lead ? "负责人" : "" }}</span
              ><span v-if="!m.roles?.length" class="muted">全项目可读</span>
            </td>
            <td v-if="state.member?.isAdmin">
              <div class="toolbar" style="margin: 0">
                <button @click="open('rename', m)">改名</button
                ><button
                  v-if="m.active && !project?.archived"
                  @click="open('roles', m)"
                >
                  授权</button
                ><button v-if="m.active" @click="open('reset', m)">
                  重置密码</button
                ><button
                  v-if="m.active"
                  @click="open('deactivate', m)"
                  class="danger"
                >
                  停用
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <button v-if="cursor" class="load-more" @click="load(true)">
      更多成员
    </button>
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

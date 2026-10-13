<script setup lang="ts">
import {
  AppstoreOutlined,
  ProjectOutlined,
  FileTextOutlined,
  TeamOutlined,
  MenuOutlined,
  SearchOutlined,
} from "@ant-design/icons-vue";
import { onMounted, ref, watch, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { state, refreshSession } from "./state";
import { command } from "./api/client";
import AConfigProvider from "ant-design-vue/es/config-provider";
import AButton from "ant-design-vue/es/button";
import AInput from "ant-design-vue/es/input";
import ASelect from "ant-design-vue/es/select";
import ADrawer from "ant-design-vue/es/drawer";
import AAvatar from "ant-design-vue/es/avatar";
import { uiTheme, uiLocale } from "./ui";
const navigation = [
  { path: "/my-work", label: "我的工作", icon: AppstoreOutlined },
  { path: "/projects", label: "项目", icon: ProjectOutlined },
  { path: "/reports", label: "日报", icon: FileTextOutlined },
  { path: "/members", label: "成员管理", icon: TeamOutlined },
];
const navOpen = ref(false);
const navigationDialog = ref<HTMLElement>();
const navTrigger = ref<InstanceType<typeof AButton>>();
function restoreNavigationFocus(open: boolean) {
  nextTick(() => {
    if (open)
      navigationDialog.value
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus();
    else navTrigger.value?.$el?.focus();
  });
}
function trapNavigationFocus(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const controls = Array.from(
    navigationDialog.value?.querySelectorAll<HTMLElement>(
      "a[href], button:not(:disabled)",
    ) ?? [],
  );
  const first = controls[0],
    last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
const route = useRoute(),
  router = useRouter(),
  loading = ref(true),
  search = ref(""),
  error = ref("");
watch(
  () => route.fullPath,
  () => {
    navOpen.value = false;
  },
);
const demo = import.meta.env.VITE_DEMO === "true";
window.addEventListener("workbench:expired", () => {
  if (state.member) state.expired = true;
});
onMounted(async () => {
  try {
    await refreshSession();
  } catch {
    if (!["/login", "/activate", "/reset"].includes(route.path))
      await router.replace("/login");
  } finally {
    loading.value = false;
  }
});
async function logout() {
  try {
    await command().send("/api/auth/logout", {});
    state.member = null;
    state.expired = false;
    await router.push("/login");
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <AConfigProvider
    :theme="uiTheme"
    :locale="uiLocale"
    :auto-insert-space-in-button="false"
  >
    <div v-if="loading" class="loading" role="status">正在载入工作台…</div>
    <template v-else>
      <div v-if="demo" class="demo-banner">
        云端演示数据 · 非生产部署 <span>— 界面与流程持续验证中</span>
      </div>
      <div
        v-if="
          state.member &&
          !['/login', '/activate', '/reset'].includes(route.path)
        "
        class="shell"
      >
        <aside class="sidebar" :inert="navOpen">
          <RouterLink class="brand" to="/my-work"
            ><span class="brand-icon"
              ><AppstoreOutlined aria-hidden="true" /></span
            ><span
              >团队协作<span class="brand-sub">WORKBENCH</span></span
            ></RouterLink
          >
          <div class="workspace-label">团队工作区</div>
          <nav aria-label="主导航">
            <RouterLink
              v-for="item in navigation"
              :key="item.path"
              :to="item.path"
              ><component :is="item.icon" aria-hidden="true" />
              {{ item.label }}</RouterLink
            >
          </nav>
          <div class="sidebar-note">每一步进展<br />都有责任与来源</div>
          <div class="profile">
            <AAvatar>{{ state.member.displayName.slice(0, 1) }}</AAvatar>
            <div>
              {{ state.member.displayName
              }}<RouterLink to="/password">账号设置</RouterLink>
            </div>
            <AButton type="text" @click="logout" aria-label="退出登录">
              退出
            </AButton>
          </div>
        </aside>
        <ADrawer
          v-model:open="navOpen"
          :closable="false"
          placement="left"
          :width="280"
          class="navigation-drawer"
          @after-open-change="restoreNavigationFocus"
        >
          <section
            ref="navigationDialog"
            role="dialog"
            aria-modal="true"
            aria-label="团队工作区"
            @keydown="trapNavigationFocus"
          >
            <div class="drawer-heading">
              <h2>团队工作区</h2>
              <AButton aria-label="收起导航" @click="navOpen = false"
                >关闭</AButton
              >
            </div>
            <nav aria-label="移动主导航" @click="navOpen = false">
              <RouterLink
                v-for="item in navigation"
                :key="item.path"
                :to="item.path"
                ><component :is="item.icon" aria-hidden="true" />
                {{ item.label }}</RouterLink
              >
              <RouterLink to="/password">账号设置</RouterLink>
              <AButton @click="logout">退出登录</AButton>
            </nav>
          </section>
        </ADrawer>
        <div class="workspace" :inert="navOpen">
          <header class="topbar">
            <AButton
              ref="navTrigger"
              class="menu-toggle"
              aria-label="展开导航"
              :aria-expanded="navOpen"
              @click="navOpen = true"
              ><MenuOutlined aria-hidden="true"
            /></AButton>
            <div class="global-project">
              <label for="global-project"
                ><span aria-hidden="true">项目范围</span
                ><span class="sr-only">全局项目筛选</span></label
              >
              <ASelect
                id="global-project"
                aria-label="全局项目筛选"
                :value="state.projectId"
                @update:value="
                  state.projectId = typeof $event === 'string' ? $event : ''
                "
                allow-clear
                :options="[
                  { value: '', label: '全部项目' },
                  ...state.projects.map((p) => ({
                    value: p.id,
                    label: p.name + (p.archived ? '（已归档）' : ''),
                  })),
                ]"
              />
            </div>
            <form
              class="search"
              @submit.prevent="
                router.push({ path: '/projects', query: { q: search } })
              "
            >
              <AInput
                v-model:value="search"
                aria-label="搜索编号或标题"
                placeholder="搜索编号或标题"
              /><AButton html-type="submit" aria-label="搜索"
                ><SearchOutlined aria-hidden="true"
              /></AButton>
            </form>
            <span class="timezone">Asia/Shanghai</span>
            <div class="mobile-account">
              <RouterLink to="/password">账号设置</RouterLink
              ><AButton @click="logout">退出登录</AButton>
            </div>
          </header>
          <main id="main">
            <div v-if="error" class="error" role="alert">{{ error }}</div>
            <div v-if="state.expired" class="error" role="alert">
              登录已过期，普通工作草稿已保留。<RouterLink
                :to="{ path: '/login', query: { return: route.fullPath } }"
                >重新登录</RouterLink
              >
            </div>
            <RouterView :key="String(state.member.id) + route.path" />
          </main>
          <footer>团队协作工作台 · 进展由本人填写，日报由人工核对</footer>
        </div>
      </div>
      <main v-else class="auth-layout"><RouterView /></main>
    </template>
  </AConfigProvider>
</template>

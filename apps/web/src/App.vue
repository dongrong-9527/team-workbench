<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { state, refreshSession } from "./state";
import { command } from "./api/client";
const route = useRoute(),
  router = useRouter(),
  loading = ref(true),
  search = ref(""),
  error = ref("");
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
  <div v-if="loading" class="loading" role="status">正在载入工作台…</div>
  <template v-else>
    <div v-if="demo" class="demo-banner">
      云端演示数据 · 非生产部署 <span>— 界面与流程持续验证中</span>
    </div>
    <div
      v-if="
        state.member && !['/login', '/activate', '/reset'].includes(route.path)
      "
      class="shell"
    >
      <aside class="sidebar">
        <RouterLink class="brand" to="/my-work"
          ><span class="brand-icon">协</span
          ><span
            >团队协作<span class="brand-sub">WORKBENCH</span></span
          ></RouterLink
        >
        <div class="workspace-label">团队工作区</div>
        <nav aria-label="主导航">
          <RouterLink to="/my-work"><span>◫</span> 我的工作</RouterLink
          ><RouterLink to="/projects"><span>▦</span> 项目</RouterLink
          ><RouterLink to="/reports"><span>▤</span> 日报</RouterLink
          ><RouterLink to="/members"><span>♧</span> 成员管理</RouterLink>
        </nav>
        <div class="sidebar-note">每一步进展<br />都有责任与来源</div>
        <div class="profile">
          <span class="avatar">{{ state.member.displayName.slice(0, 1) }}</span>
          <div>
            {{ state.member.displayName
            }}<RouterLink to="/password">账号设置</RouterLink>
          </div>
          <button class="text-button" @click="logout" aria-label="退出登录">
            退出
          </button>
        </div>
      </aside>
      <div class="workspace">
        <header class="topbar">
          <label class="global-project"
            >项目范围<select
              v-model="state.projectId"
              aria-label="全局项目筛选"
            >
              <option value="">全部项目</option>
              <option v-for="p in state.projects" :value="p.id">
                {{ p.name }}{{ p.archived ? "（已归档）" : "" }}
              </option>
            </select></label
          >
          <form
            class="search"
            @submit.prevent="
              router.push({ path: '/projects', query: { q: search } })
            "
          >
            <input
              v-model="search"
              aria-label="搜索编号或标题"
              placeholder="搜索编号或标题"
            /><button aria-label="搜索">⌕</button>
          </form>
          <span class="timezone">Asia/Shanghai</span>
          <div class="mobile-account">
            <RouterLink to="/password">账号设置</RouterLink
            ><button @click="logout">退出登录</button>
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
</template>

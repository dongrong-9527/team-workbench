<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { request, setCsrf } from "../api/client";
import { refreshSession } from "../state";
const login = ref(""),
  password = ref(""),
  error = ref(""),
  busy = ref(false),
  router = useRouter(),
  route = useRoute();
async function submit() {
  busy.value = true;
  error.value = "";
  try {
    const r = await request<{ csrfToken: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ login: login.value, password: password.value }),
    });
    setCsrf(r.csrfToken);
    password.value = "";
    await refreshSession();
    const next = String(route.query.return ?? "/my-work");
    await router.push(
      next.startsWith("/") && !next.startsWith("//") ? next : "/my-work",
    );
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="auth-card">
    <span class="eyebrow">团队协作工作台</span>
    <h1>让进展清楚可见</h1>
    <p class="muted">登录后，继续今天的协作。</p>
    <form @submit.prevent="submit">
      <label
        >登录账号<input
          v-model="login"
          autocomplete="username"
          required /></label
      ><label
        >密码<input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
      /></label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button class="primary" :disabled="busy">
        {{ busy ? "正在登录…" : "登录工作台" }}
      </button>
    </form>
    <div class="auth-links">
      <RouterLink to="/activate">激活账号</RouterLink
      ><RouterLink to="/reset">使用重置票据</RouterLink>
    </div>
  </section>
</template>

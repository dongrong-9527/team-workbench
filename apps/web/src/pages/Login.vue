<script setup lang="ts">
import AButton from "ant-design-vue/es/button";
import AInput from "ant-design-vue/es/input";
import AForm from "ant-design-vue/es/form";
import AAlert from "ant-design-vue/es/alert";
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
  if (busy.value) return;
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
    <AForm
      :model="{ login, password }"
      layout="vertical"
      :required-mark="false"
      @finish="submit"
    >
      <AForm.Item
        label="登录账号"
        name="login"
        :rules="[{ required: true, message: '请填写登录账号' }]"
        ><AInput v-model:value="login" autocomplete="username"
      /></AForm.Item>
      <AForm.Item
        label="密码"
        name="password"
        :rules="[{ required: true, message: '请填写密码' }]"
        ><AInput.Password
          v-model:value="password"
          autocomplete="current-password"
      /></AForm.Item>
      <AAlert
        v-if="error"
        type="error"
        role="alert"
        :message="error"
        show-icon
      />
      <AButton type="primary" html-type="submit" :disabled="busy">
        {{ busy ? "正在登录…" : "登录工作台" }}
      </AButton>
    </AForm>
    <div class="auth-links">
      <RouterLink to="/activate">激活账号</RouterLink
      ><RouterLink to="/reset">使用重置票据</RouterLink>
    </div>
  </section>
</template>

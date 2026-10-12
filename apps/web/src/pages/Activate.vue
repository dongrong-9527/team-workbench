<script setup lang="ts">
import { ref, computed } from "vue";
import { useRoute } from "vue-router";
import { request } from "../api/client";
const route = useRoute(),
  reset = computed(() => route.path === "/reset"),
  token = ref(""),
  password = ref(""),
  confirm = ref(""),
  error = ref(""),
  success = ref(false),
  busy = ref(false);
async function submit() {
  if (password.value !== confirm.value) {
    error.value = "两次密码不一致";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await request("/api/auth/" + (reset.value ? "reset" : "activate"), {
      method: "POST",
      body: JSON.stringify({
        token: token.value,
        [reset.value ? "newPassword" : "password"]: password.value,
      }),
    });
    token.value = "";
    password.value = "";
    confirm.value = "";
    success.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="auth-card">
    <h1>{{ reset ? "重置密码" : "激活账号" }}</h1>
    <p>使用管理员交给你的有效票据，由本人设置密码。</p>
    <p v-if="success" class="success" role="status">
      设置成功，请返回登录。所有旧会话已撤销。
    </p>
    <form v-else @submit.prevent="submit">
      <label
        >管理员票据<input
          v-model="token"
          required
          autocomplete="off"
          maxlength="43" /></label
      ><label
        >新密码<input
          v-model="password"
          type="password"
          required
          minlength="12"
          autocomplete="new-password" /></label
      ><label
        >确认密码<input
          v-model="confirm"
          type="password"
          required
          minlength="12"
          autocomplete="new-password"
      /></label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button class="primary" :disabled="busy">
        {{ reset ? "确认重置" : "激活账号" }}
      </button>
    </form>
    <RouterLink to="/login">返回登录</RouterLink>
  </section>
</template>

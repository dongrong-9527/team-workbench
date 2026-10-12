<script setup lang="ts">
import { ref } from "vue";
import { command } from "../api/client";
import { state } from "../state";
const currentPassword = ref(""),
  newPassword = ref(""),
  confirm = ref(""),
  error = ref(""),
  success = ref(false),
  busy = ref(false),
  cmd = command();
async function submit() {
  if (newPassword.value !== confirm.value) {
    error.value = "两次密码不一致";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await cmd.send("/api/auth/password", {
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    });
    currentPassword.value = "";
    newPassword.value = "";
    confirm.value = "";
    success.value = true;
    state.expired = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="panel panel-body">
    <h1>账号设置</h1>
    <p>修改密码后所有会话会撤销，请重新登录。</p>
    <p v-if="success" class="success" role="status">
      密码已修改。<RouterLink to="/login">重新登录</RouterLink>
    </p>
    <form v-else @submit.prevent="submit" class="form-grid">
      <label class="wide"
        >当前密码<input
          v-model="currentPassword"
          type="password"
          autocomplete="current-password"
          required /></label
      ><label
        >新密码<input
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
          minlength="12"
          required /></label
      ><label
        >确认密码<input
          v-model="confirm"
          type="password"
          autocomplete="new-password"
          minlength="12"
          required
      /></label>
      <p v-if="error" class="error wide" role="alert">{{ error }}</p>
      <div class="wide">
        <button class="primary" :disabled="busy">修改密码</button>
      </div>
    </form>
  </section>
</template>

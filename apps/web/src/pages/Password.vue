<script setup lang="ts">
import AButton from "ant-design-vue/es/button";
import AInput from "ant-design-vue/es/input";
import AForm from "ant-design-vue/es/form";
import AAlert from "ant-design-vue/es/alert";
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
  if (busy.value) return;
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
    <AForm
      v-else
      :model="{ currentPassword, newPassword, confirm }"
      layout="vertical"
      :required-mark="false"
      @finish="submit"
      class="form-grid"
    >
      <AForm.Item
        label="当前密码"
        name="currentPassword"
        :rules="[{ required: true, message: '请填写当前密码' }]"
        ><AInput.Password
          v-model:value="currentPassword"
          autocomplete="current-password"
      /></AForm.Item>
      <AForm.Item
        label="新密码"
        name="newPassword"
        :rules="[
          { required: true, message: '请填写新密码' },
          { min: 12, message: '至少 12 个字符' },
        ]"
        ><AInput.Password
          v-model:value="newPassword"
          autocomplete="new-password"
      /></AForm.Item>
      <AForm.Item
        label="确认密码"
        name="confirm"
        :rules="[
          { required: true, message: '请填写确认密码' },
          { min: 12, message: '至少 12 个字符' },
        ]"
        ><AInput.Password v-model:value="confirm" autocomplete="new-password"
      /></AForm.Item>
      <AAlert
        v-if="error"
        type="error"
        role="alert"
        :message="error"
        show-icon
      />
      <div class="wide">
        <AButton type="primary" html-type="submit" :disabled="busy"
          >修改密码</AButton
        >
      </div>
    </AForm>
  </section>
</template>

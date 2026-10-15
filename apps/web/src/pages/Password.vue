<script setup lang="ts">
import AButton from "ant-design-vue/es/button";
import AInput from "ant-design-vue/es/input";
import AForm from "ant-design-vue/es/form";
import AAlert from "ant-design-vue/es/alert";
import { SafetyCertificateOutlined } from "@ant-design/icons-vue";
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
  <div class="page-heading">
    <div>
      <span class="eyebrow">ACCOUNT SETTINGS</span>
      <h1>账号设置</h1>
      <p>管理个人密码，保护工作记录与协作权限。</p>
    </div>
  </div>
  <div class="password-layout">
    <section class="panel password-panel">
      <header class="password-heading">
        <SafetyCertificateOutlined aria-hidden="true" />
        <div>
          <h2>修改登录密码</h2>
          <p>修改密码后所有会话会撤销，请重新登录。</p>
        </div>
      </header>
      <p v-if="success" class="success" role="status">
        密码已修改。<RouterLink to="/login">重新登录</RouterLink>
      </p>
      <AForm
        v-else
        :model="{ currentPassword, newPassword, confirm }"
        layout="vertical"
        :required-mark="false"
        @finish="submit"
        class="password-form"
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
        <div class="password-actions">
          <AButton
            type="primary"
            html-type="submit"
            :disabled="busy"
            :loading="busy"
            >修改密码</AButton
          >
        </div>
      </AForm>
    </section>
    <aside class="panel password-guide">
      <h3>密码安全</h3>
      <p>使用至少 12 个字符的新密码，并与其他服务的密码区分。</p>
      <p>密码修改成功后，请使用新密码重新登录工作台。</p>
      <div class="password-note">
        忘记当前密码时，请联系平台管理员获取重置票据。
      </div>
    </aside>
  </div>
</template>
<style scoped>
.password-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 285px;
  align-items: start;
  gap: 24px;
}
.password-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 22px 26px;
  border-bottom: 1px solid #e4e9f1;
}
.password-heading > .anticon {
  font-size: 20px;
  color: #245bdb;
  margin-top: 3px;
}
.password-heading h2 {
  margin: 0;
  font-size: 16px;
}
.password-heading p {
  margin: 6px 0 0;
  font-size: 12px;
  color: #65738b;
}
.password-form {
  max-width: 640px;
  padding: 26px;
}
.password-form :deep(.ant-form-item) {
  margin-bottom: 22px;
}
.password-form :deep(.ant-input-affix-wrapper) {
  min-height: 38px;
}
.password-actions {
  padding-top: 6px;
}
.password-guide {
  padding: 22px;
  font-size: 12px;
  color: #65738b;
  line-height: 1.9;
}
.password-guide h3 {
  margin: 0 0 14px;
  font-size: 15px;
  color: #17243b;
}
.password-guide p {
  margin: 12px 0;
}
.password-note {
  padding: 15px;
  background: #f8faff;
  border: 1px solid #e4e9f1;
  border-radius: 6px;
  margin-top: 20px;
}
.password-panel > .success {
  margin: 24px 26px;
}
@media (max-width: 1150px) {
  .password-layout {
    grid-template-columns: minmax(0, 1fr) 240px;
    gap: 18px;
  }
}
@media (max-width: 850px) {
  .password-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  .password-heading,
  .password-form {
    padding: 20px 18px;
  }
  .password-form :deep(.ant-input) {
    font-size: 16px;
  }
}
</style>

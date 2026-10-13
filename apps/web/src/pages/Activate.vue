<script setup lang="ts">
import AButton from "ant-design-vue/es/button";
import AInput from "ant-design-vue/es/input";
import AForm from "ant-design-vue/es/form";
import AAlert from "ant-design-vue/es/alert";
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
  if (busy.value) return;
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
    <AForm
      v-else
      :model="{ token, password, confirm }"
      layout="vertical"
      :required-mark="false"
      @finish="submit"
    >
      <AForm.Item
        label="管理员票据"
        name="token"
        :rules="[
          { required: true, message: '请填写管理员票据' },
          { max: 43, message: '最多 43 个字符' },
        ]"
        ><AInput v-model:value="token" autocomplete="off" :maxlength="43"
      /></AForm.Item>
      <AForm.Item
        label="新密码"
        name="password"
        :rules="[
          { required: true, message: '请填写新密码' },
          { min: 12, message: '至少 12 个字符' },
        ]"
        ><AInput.Password v-model:value="password" autocomplete="new-password"
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
      <AButton type="primary" html-type="submit" :disabled="busy">
        {{ reset ? "确认重置" : "激活账号" }}
      </AButton>
    </AForm>
    <RouterLink to="/login">返回登录</RouterLink>
  </section>
</template>

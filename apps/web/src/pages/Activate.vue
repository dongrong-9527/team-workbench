<script setup lang="ts">
import AButton from "ant-design-vue/es/button";
import AInput from "ant-design-vue/es/input";
import AForm from "ant-design-vue/es/form";
import AAlert from "ant-design-vue/es/alert";
import { BuildOutlined, ArrowRightOutlined } from "@ant-design/icons-vue";
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
  <div class="auth-split">
    <section class="auth-brand" aria-label="团队协作工作台介绍">
      <div class="auth-brand-name">
        <span class="auth-mark"><BuildOutlined aria-hidden="true" /></span>
        <div><strong>团队协作工作台</strong><span>TEAM WORKSPACE</span></div>
      </div>
      <div class="auth-intro">
        <p class="auth-eyebrow">A CLEAR PATH FROM IDEA TO DELIVERY</p>
        <h1 aria-label="每一步推进，都有明确的下一步。">
          每一步推进，<br />都有明确的下一步。
        </h1>
        <p class="auth-description">
          连接需求、执行、测试与验收。<br />让团队围绕真实工作保持同步。
        </p>
        <div class="auth-flow" aria-label="协作流程">
          <span>需求</span><ArrowRightOutlined aria-hidden="true" /><span
            >执行</span
          ><ArrowRightOutlined aria-hidden="true" /><span>测试</span
          ><ArrowRightOutlined aria-hidden="true" /><span>验收</span>
        </div>
      </div>
      <p class="auth-foot">记录真实，让协作更清楚</p>
      <div class="auth-art" aria-hidden="true"></div>
    </section>
    <section class="auth-form-side">
      <div class="auth-form">
        <h2>{{ reset ? "重置密码" : "激活账号" }}</h2>
        <p class="auth-subtitle">
          使用管理员交给你的有效票据，由本人设置密码。
        </p>
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
            ><AInput
              v-model:value="token"
              autocomplete="off"
              :maxlength="43"
              placeholder="输入管理员票据"
              :disabled="busy"
          /></AForm.Item>
          <AForm.Item
            label="新密码"
            name="password"
            :rules="[
              { required: true, message: '请填写新密码' },
              { min: 12, message: '至少 12 个字符' },
            ]"
            ><AInput.Password
              v-model:value="password"
              autocomplete="new-password"
              placeholder="至少 12 个字符"
              :disabled="busy"
          /></AForm.Item>
          <AForm.Item
            label="确认密码"
            name="confirm"
            :rules="[
              { required: true, message: '请填写确认密码' },
              { min: 12, message: '至少 12 个字符' },
            ]"
            ><AInput.Password
              v-model:value="confirm"
              autocomplete="new-password"
              placeholder="再次输入新密码"
              :disabled="busy"
          /></AForm.Item>
          <AAlert
            v-if="error"
            type="error"
            role="alert"
            :message="error"
            show-icon
          />
          <AButton
            type="primary"
            html-type="submit"
            :disabled="busy"
            :loading="busy"
            class="auth-submit"
          >
            {{ reset ? "确认重置" : "激活账号" }}
          </AButton>
        </AForm>
        <div class="auth-links">
          <RouterLink to="/login">返回登录</RouterLink>
        </div>
      </div>
    </section>
  </div>
</template>
<style scoped src="./auth-design.css"></style>

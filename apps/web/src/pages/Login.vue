<script setup lang="ts">
import AButton from "ant-design-vue/es/button";
import AInput from "ant-design-vue/es/input";
import AForm from "ant-design-vue/es/form";
import AAlert from "ant-design-vue/es/alert";
import { BuildOutlined, ArrowRightOutlined } from "@ant-design/icons-vue";
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
        <h2>登录工作台</h2>
        <p class="auth-subtitle">使用管理员为你创建的成员账号</p>
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
            ><AInput
              v-model:value="login"
              autocomplete="username"
              placeholder="输入成员账号"
              :disabled="busy"
          /></AForm.Item>
          <AForm.Item
            label="密码"
            name="password"
            :rules="[{ required: true, message: '请填写密码' }]"
            ><AInput.Password
              v-model:value="password"
              autocomplete="current-password"
              placeholder="输入密码"
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
            {{ busy ? "正在登录…" : "登录工作台" }}
          </AButton>
        </AForm>
        <p class="auth-help">没有账号或无法登录？请联系平台管理员。</p>
        <div class="auth-links">
          <RouterLink to="/activate">激活账号</RouterLink
          ><RouterLink to="/reset">使用重置票据</RouterLink>
        </div>
      </div>
    </section>
  </div>
</template>
<style scoped src="./auth-design.css"></style>

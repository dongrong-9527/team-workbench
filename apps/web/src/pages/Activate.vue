<script setup lang="ts">
import AButton from "ant-design-vue/es/button";
import AInput from "ant-design-vue/es/input";
import AForm from "ant-design-vue/es/form";
import type { FormInstance } from "ant-design-vue";
import AAlert from "ant-design-vue/es/alert";
import { BuildOutlined, ArrowRightOutlined } from "@ant-design/icons-vue";
import { ref, computed, watch } from "vue";
import { useRoute, onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { request, ApiError } from "../api/client";
import { accountCodeError, accountPasswordError, accountSetupFailure } from "../accountSetup";
const route = useRoute(),
  reset = computed(() => route.path === "/reset"),
  token = ref(""),
  password = ref(""),
  confirm = ref(""),
  error = ref(""),
  success = ref(false),
  busy = ref(false);
const form = ref<FormInstance>();
const codeLabel = computed(() => reset.value ? "密码重置码" : "激活码");
const codeHelp = computed(() => `请粘贴管理员提供的 43 位${codeLabel.value}，不是登录账号。仅含英文字母、数字、下划线或短横线。`);
const passwordHelp = "密码须为 12–128 个 Unicode 字符；空格会原样保留，请勿在两端误加空格。";
const codeRules = computed(() => [{ validator: async () => {
  const message = accountCodeError(token.value, codeLabel.value);
  if (message) throw new Error(message);
} }]);
const passwordRules = [{ validator: async () => {
  const message = accountPasswordError(password.value);
  if (message) throw new Error(message);
} }];
const confirmRules = [{ validator: async () => {
  if (!confirm.value) throw new Error("请再次输入新密码");
  if (password.value !== confirm.value) throw new Error("两次密码不一致，请重新确认。");
} }];
watch(reset, () => {
  token.value = password.value = confirm.value = error.value = "";
  success.value = false;
  form.value?.clearValidate();
});
onBeforeRouteUpdate(() => !busy.value);
onBeforeRouteLeave(() => !busy.value);
async function submit() {
  if (busy.value) return;
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
    error.value = accountSetupFailure(e instanceof ApiError ? e.code : 500, codeLabel.value);
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
          使用管理员提供的{{ codeLabel }}，由本人设置新密码。激活码与密码重置码不能互用，有效期为签发后 24 小时。
        </p>
        <p v-if="success" class="success" role="status">
          设置成功，请返回登录。所有旧会话已撤销。
        </p>
        <AForm
          v-else
          ref="form"
          :model="{ token, password, confirm }"
          layout="vertical"
          :required-mark="false"
          @finish="submit"
        >
          <AForm.Item
            :label="codeLabel"
            name="token"
            :extra="codeHelp"
            :rules="codeRules"
            ><AInput
              v-model:value="token"
              autocomplete="off"
              :spellcheck="false"
              autocapitalize="off"
              :placeholder="'粘贴 43 位' + codeLabel"
              :disabled="busy"
          /></AForm.Item>
          <AForm.Item
            label="新密码"
            name="password"
            :extra="passwordHelp"
            :rules="passwordRules"
            ><AInput.Password
              v-model:value="password"
              :visibility-toggle="false"
              autocomplete="new-password"
              placeholder="12–128 个 Unicode 字符"
              :disabled="busy"
          /></AForm.Item>
          <AForm.Item
            label="确认密码"
            name="confirm"
            :dependencies="['password']"
            :rules="confirmRules"
            ><AInput.Password
              v-model:value="confirm"
              :visibility-toggle="false"
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
          <RouterLink :to="reset ? '/activate' : '/reset'">{{ reset ? '前往激活账号' : '前往重置密码' }}</RouterLink>
        </div>
      </div>
    </section>
  </div>
</template>
<style scoped src="./auth-design.css"></style>

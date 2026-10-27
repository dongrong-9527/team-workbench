<script setup lang="ts">
import { computed, ref } from "vue";
import AButton from "ant-design-vue/es/button";
import AInput from "ant-design-vue/es/input";
import AAlert from "ant-design-vue/es/alert";
import AModal from "ant-design-vue/es/modal";
import { buildAccountInvitation, type AccountInvitation } from "../accountSetup";

const props = defineProps<{ invitation: AccountInvitation }>();
const emit = defineEmits<{ hide: [] }>();
const text = computed(() => buildAccountInvitation(props.invitation, window.location.origin));
const failed = ref(false), copied = ref(false), copying = ref(false);
const manual = ref<{ focus(): void; resizableTextArea: { textArea: HTMLTextAreaElement } }>();
async function copy() {
  if (!text.value || copying.value) return;
  copying.value = true;
  copied.value = false;
  failed.value = false;
  try {
    await navigator.clipboard.writeText(text.value);
    copied.value = true;
  } catch {
    failed.value = true;
  } finally {
    copying.value = false;
  }
}
function select() {
  manual.value?.focus();
  manual.value?.resizableTextArea.textArea.select();
}
</script>
<template>
  <AModal
    v-if="text"
    :open="true"
    :title="(invitation.kind === 'activate' ? '激活码' : '密码重置码') + ' · 仅本次显示'"
    :width="640"
    centered
    :body-style="{ maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' }"
    :z-index="1100"
    :mask-closable="false"
    :keyboard="false"
    :closable="false"
    :destroy-on-close="true"
    class="ticket-invitation"
  >
    <p>通过可信渠道交给本人；请勿用于截图或公开文档。一次性码不会存储到本地草稿。</p>
    <p>有效期自本次签发起 24 小时，重新签发会使旧码失效。</p>
    <AAlert type="warning" show-icon message="关闭后本页无法再次显示此码，请先复制并妥善交付。" description="离开页面也会清除本次显示；关闭不会撤销已签发的码，已复制的码仍按原有效期使用。" />
    <label>一次性票据<AInput :value="invitation.code" readonly autocomplete="off" /></label>
    <div class="ticket-actions">
      <AButton type="primary" :loading="copying" :disabled="copying" @click="copy">{{ invitation.kind === 'activate' ? '复制激活邀请' : '复制密码重置说明' }}</AButton>
      <RouterLink :to="invitation.kind === 'activate' ? '/activate' : '/reset'">打开本人{{ invitation.kind === 'activate' ? '激活' : '重置' }}表单</RouterLink>
    </div>
    <p v-if="copied" role="status">已复制，请通过可信渠道手动交给本人。</p>
    <template v-if="failed">
      <AAlert type="warning" role="alert" message="无法访问剪贴板，请全选下方说明后手动复制。" show-icon />
      <label>手动复制说明<AInput.TextArea ref="manual" :value="text" readonly autocomplete="off" :rows="9" /></label>
      <AButton @click="select">全选说明</AButton>
    </template>
    <template #footer><AButton @click="emit('hide')">关闭查看</AButton></template>
  </AModal>
</template>
<style scoped>
.ticket-invitation { overflow-wrap: anywhere; }
.ticket-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin: 16px 0; }
.ticket-invitation label { display: block; margin: 12px 0; }
</style>

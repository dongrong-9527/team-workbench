<script setup lang="ts">
import { ref } from "vue";
import AButton from "ant-design-vue/es/button";
import AAlert from "ant-design-vue/es/alert";
import type { PendingRequirementImage } from "../requirementImages";
defineProps<{
  delivery: { entries: PendingRequirementImage[] };
  disabled: boolean;
  existing: { id: string }[];
  error?: string;
  loading?: boolean;
  restored?: boolean;
}>();
const emit = defineEmits<{
  add: [files: File[]];
  remove: [id: string];
  reload: [];
}>();
const input = ref<HTMLInputElement>();
function selected(event: Event) {
  const control = event.target as HTMLInputElement;
  emit("add", Array.from(control.files ?? []));
  control.value = "";
}
</script>
<template>
  <section class="requirement-images" aria-label="需求截图">
    <header>
      <h3>截图</h3>
      <span>文字先保存，图片随后逐张上传</span>
    </header>
    <p class="image-rules">
      PNG、JPEG、WebP · 单张最多 5 MiB · 每个需求默认最多 10 张 ·
      仅静态图片、最多 20M 像素；服务端最终校验。
    </p>
    <AAlert v-if="error" type="error" :message="error" show-icon
      ><template #description
        ><AButton :disabled="loading" @click="emit('reload')"
          >重新读取已保存截图</AButton
        ></template
      ></AAlert
    >
    <p v-if="loading" role="status">正在读取已保存截图…</p>
    <div v-if="existing.length" class="image-preview-grid saved-images">
      <a
        v-for="(image, index) in existing"
        :key="image.id"
        :href="'/api/attachments/' + image.id + '/content'"
        target="_blank"
        rel="noopener noreferrer"
        ><img
          :src="'/api/attachments/' + image.id + '/content'"
          :alt="'已保存截图 ' + (index + 1)"
        /><span>已保存截图 {{ index + 1 }}</span></a
      >
    </div>
    <template v-if="!restored">
      <div
        class="image-drop-zone"
        role="button"
        aria-label="粘贴拖入或选择需求截图"
        :tabindex="disabled ? -1 : 0"
        :aria-disabled="disabled"
        @click="!disabled && input?.click()"
        @keydown.enter.prevent="!disabled && input?.click()"
        @keydown.space.prevent="!disabled && input?.click()"
        @dragover.prevent
        @drop.prevent="
          !disabled && emit('add', Array.from($event.dataTransfer?.files ?? []))
        "
      >
        <strong>点击选择、粘贴或拖入截图</strong
        ><span>待上传图片仅保留在本次填写内存中，刷新后无法恢复。</span>
      </div>
      <label hidden
        >选择需求截图<input
          ref="input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          :disabled="disabled"
          @change="selected"
      /></label>
    </template>
    <div
      v-if="delivery.entries.length"
      class="image-preview-grid pending-images"
    >
      <article v-for="item in delivery.entries" :key="item.id">
        <img :src="item.preview" :alt="'待上传：' + item.file.name" />
        <span :title="item.file.name">{{ item.file.name }}</span>
        <small>{{
          {
            pending: "待上传",
            uploading: "正在上传",
            uploaded: "已上传",
            failed: "上传失败",
          }[item.status]
        }}</small>
        <p v-if="item.error" role="alert">{{ item.error }}</p>
        <AButton
          v-if="item.status !== 'uploaded'"
          size="small"
          :disabled="disabled"
          @click="emit('remove', item.id)"
          >移除待上传图片</AButton
        >
      </article>
    </div>
  </section>
</template>
<style scoped>
.requirement-images {
  margin: 16px 0;
  min-width: 0;
}
.requirement-images header {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
.requirement-images h3 {
  font-size: 14px;
  margin: 0;
}
.requirement-images header span,
.image-rules {
  font-size: 12px;
  color: #738097;
  line-height: 1.8;
}
.image-drop-zone {
  border: 1px dashed #aabbd5;
  border-radius: 8px;
  padding: 25px 16px;
  background: #f7faff;
  text-align: center;
  cursor: pointer;
}
.image-drop-zone strong,
.image-drop-zone span {
  display: block;
  line-height: 1.8;
  font-size: 13px;
}
.image-drop-zone span {
  font-size: 12px;
  color: #738097;
  margin-top: 6px;
}
.image-drop-zone[aria-disabled="true"] {
  cursor: default;
  opacity: 0.55;
}
.image-drop-zone:focus-visible {
  outline: 2px solid #245bdb;
  outline-offset: 3px;
}
.image-preview-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 14px 0;
}
.image-preview-grid article,
.image-preview-grid > a {
  border: 1px solid #e4e9f1;
  border-radius: 6px;
  overflow: hidden;
  min-width: 0;
  padding: 8px;
}
.image-preview-grid img {
  display: block;
  width: 100%;
  height: 100px;
  object-fit: contain;
  background: #f5f7fc;
}
.image-preview-grid span,
.image-preview-grid small {
  display: block;
  font-size: 12px;
  overflow-wrap: anywhere;
  margin: 6px 0;
}
.image-preview-grid p {
  font-size: 12px;
  color: #b42318;
  overflow-wrap: anywhere;
}
.image-preview-grid .ant-btn {
  max-width: 100%;
  font-size: 11px;
}
@media (max-width: 600px) {
  .image-preview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .image-drop-zone {
    padding: 20px 12px;
  }
  .requirement-images header span {
    font-size: 11px;
  }
}
</style>

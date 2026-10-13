<script setup lang="ts">
import UploadOutlined from "@ant-design/icons-vue/UploadOutlined";
import AAlert from "ant-design-vue/es/alert";
import AButton from "ant-design-vue/es/button";
import { onMounted, onBeforeUnmount, ref } from "vue";
import { request } from "../api/client";
const props = defineProps<{
  kind: string;
  id: string;
  version: number;
  canUpload: boolean;
}>();
const emit = defineEmits<{ uploaded: [] }>();
interface ImageInfo {
  id: string;
  size: number;
  mime: string;
  sha256: string;
}
const images = ref<ImageInfo[]>([]),
  next = ref<number | null>(null),
  loading = ref(false),
  uploading = ref(false),
  error = ref(""),
  notice = ref(""),
  file = ref<File>(),
  input = ref<HTMLInputElement>(),
  preview = ref("");
let active = true,
  key = "",
  version = 0;
onBeforeUnmount(() => {
  active = false;
});
const path = `/api/objects/${props.kind}/${props.id}/attachments`;
async function load(more = false) {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const page = await request<{
      items: ImageInfo[];
      nextAfter: number | null;
    }>(
      path +
        "?limit=20" +
        (more && next.value !== null ? "&after=" + next.value : ""),
    );
    if (
      !page ||
      !Array.isArray(page.items) ||
      page.items.length > 100 ||
      !page.items.every(
        (image) =>
          image &&
          typeof image.id === "string" &&
          /^[A-Za-z0-9_-]{1,128}$/.test(image.id) &&
          Number.isSafeInteger(image.size) &&
          image.size > 0 &&
          ["image/png", "image/jpeg", "image/webp"].includes(image.mime) &&
          typeof image.sha256 === "string" &&
          /^[a-f0-9]{64}$/.test(image.sha256),
      ) ||
      !(
        page.nextAfter === null ||
        (Number.isSafeInteger(page.nextAfter) && page.nextAfter > 0)
      )
    )
      throw new Error("附件数据无法读取，请重试。");
    if (active) {
      images.value = more ? [...images.value, ...page.items] : page.items;
      next.value = page.nextAfter;
    }
  } catch (e) {
    if (active) error.value = (e as Error).message;
  } finally {
    if (active) loading.value = false;
  }
}
function select(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0];
  key = crypto.randomUUID();
  version = props.version;
  error.value = "";
  notice.value = "";
}
async function upload() {
  if (!file.value || uploading.value) return;
  uploading.value = true;
  error.value = "";
  notice.value = "";
  const body = new FormData();
  body.append("image", file.value);
  try {
    await request(
      path + `?expectedVersion=${version}&size=${file.value.size}`,
      { method: "POST", body, headers: { "Idempotency-Key": key } },
    );
    if (active) {
      file.value = undefined;
      if (input.value) input.value.value = "";
      notice.value = "图片已保存";
      emit("uploaded");
      await load();
    }
  } catch (e) {
    if (active) error.value = (e as Error).message;
  } finally {
    if (active) uploading.value = false;
  }
}
onMounted(() => load());
</script>
<template>
  <section class="panel panel-body" aria-label="图片附件">
    <h2>图片证据</h2>
    <p class="muted">
      图片单独上传，不影响工作更新文字的保存。支持 PNG、JPEG、WebP 静态图片。
    </p>
    <div v-if="canUpload" class="toolbar">
      <AButton :disabled="uploading" @click="input?.click()"
        ><UploadOutlined aria-hidden="true" />选择图片</AButton
      >
      <label hidden
        >选择图片
        <input
          ref="input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          :disabled="uploading"
          @change="select"
      /></label>
      <AButton :disabled="!file || uploading || loading" @click="upload">
        {{
          uploading ? "正在上传…" : error && file ? "重试上传图片" : "上传图片"
        }}
      </AButton>
    </div>
    <p v-if="uploading" role="status">正在校验并保存图片，请稍候…</p>
    <p v-if="notice" role="status" class="success">{{ notice }}</p>
    <p v-if="error" role="alert" class="error">
      {{ error }}
      <AButton :disabled="loading" @click="load()">重新读取附件</AButton>
    </p>
    <p v-if="!images.length && !loading">暂无图片附件</p>
    <ul>
      <li v-for="(image, index) in images" :key="image.id">
        图片 {{ index + 1 }} · {{ image.mime }} ·
        {{ Math.ceil(image.size / 1024) }} KiB
        <AButton @click="preview = preview === image.id ? '' : image.id">
          {{ preview === image.id ? "收起图片" : "查看图片" }}
        </AButton>
        <img
          v-if="preview === image.id"
          :src="`/api/attachments/${image.id}/content`"
          alt="已上传的图片证据"
          style="display: block; max-width: 100%; max-height: 420px"
          @error="
            error = '图片读取失败，请检查登录状态后重试。';
            preview = '';
          "
        />
      </li>
    </ul>
    <AButton v-if="next !== null" :disabled="loading" @click="load(true)">
      更多图片
    </AButton>
  </section>
</template>

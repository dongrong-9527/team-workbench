<script setup lang="ts">
import UploadOutlined from "@ant-design/icons-vue/UploadOutlined";
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
  <section class="panel attachment-panel" aria-label="图片附件">
    <header class="attachment-panel-head">
      <h2>图片证据</h2>
      <span>{{ images.length }} 张已读取</span>
    </header>
    <div class="attachment-panel-body">
      <p class="muted attachment-intro">
        图片单独上传，不影响工作更新文字的保存。支持 PNG、JPEG、WebP 静态图片。
      </p>
      <div v-if="canUpload" class="attachment-upload">
        <div class="attachment-upload-copy">
          <UploadOutlined aria-hidden="true" /><strong>{{
            file ? file.name : "选择本地图片作为工作证据"
          }}</strong
          ><small>支持 PNG、JPEG、WebP · 图片与工作文字分别保存</small>
        </div>
        <div class="attachment-upload-actions">
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
          <AButton
            type="primary"
            :disabled="!file || uploading || loading"
            :aria-busy="uploading"
            @click="upload"
          >
            {{
              uploading
                ? "正在上传…"
                : error && file
                  ? "重试上传图片"
                  : "上传图片"
            }}
          </AButton>
        </div>
      </div>
      <p v-if="uploading" role="status">正在校验并保存图片，请稍候…</p>
      <p v-if="notice" role="status" class="success">{{ notice }}</p>
      <p v-if="error" role="alert" class="error">
        {{ error }}
        <AButton :disabled="loading" @click="load()">重新读取附件</AButton>
      </p>
      <p v-if="loading" role="status" class="attachment-state">
        正在读取图片证据…
      </p>
      <p v-if="!images.length && !loading" class="attachment-empty">
        暂无图片附件
      </p>
      <ul class="attachment-files">
        <li v-for="(image, index) in images" :key="image.id">
          <div class="attachment-file-heading">
            <div>
              <strong>图片 {{ index + 1 }}</strong
              ><small
                >{{ image.mime }} ·
                {{ Math.ceil(image.size / 1024) }} KiB</small
              >
            </div>
            <AButton @click="preview = preview === image.id ? '' : image.id">
              {{ preview === image.id ? "收起图片" : "查看图片" }}
            </AButton>
          </div>
          <img
            v-if="preview === image.id"
            :src="`/api/attachments/${image.id}/content`"
            alt="已上传的图片证据"
            class="attachment-preview"
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
    </div>
  </section>
</template>

<style scoped>
.attachment-panel {
  margin: 0;
  border: 1px solid #e4e9f1;
  border-radius: 8px;
  overflow: hidden;
  background: white;
}
.attachment-panel-head {
  padding: 19px 22px;
  border-bottom: 1px solid #e4e9f1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.attachment-panel-head h2 {
  margin: 0;
  font-size: 15px;
  color: #17243b;
}
.attachment-panel-head > span {
  color: #738097;
  font-size: 11px;
}
.attachment-panel-body {
  padding: 20px 22px;
}
.attachment-intro {
  margin: 0 0 18px;
  font-size: 12px;
  line-height: 1.8;
  color: #697890;
}
.attachment-upload {
  padding: 20px 18px;
  background: #fafbfd;
  border: 1px dashed #d5dfed;
  border-radius: 6px;
}
.attachment-upload-copy {
  display: flex;
  align-items: center;
  flex-direction: column;
  text-align: center;
  gap: 7px;
  color: #526580;
  margin-bottom: 15px;
}
.attachment-upload-copy > .anticon {
  font-size: 22px;
  color: #526580;
}
.attachment-upload-copy strong {
  font-size: 13px;
  font-weight: 500;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.attachment-upload-copy small {
  font-size: 11px;
  line-height: 1.7;
  color: #738097;
}
.attachment-upload-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}
.attachment-files {
  list-style: none;
  padding: 0;
  margin: 0;
}
.attachment-files li {
  border-top: 1px solid #e4e9f1;
  padding: 15px 0;
}
.attachment-files li:last-child {
  padding-bottom: 0;
}
.attachment-file-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.attachment-file-heading strong {
  display: block;
  font-size: 13px;
  color: #24344d;
  font-weight: 500;
}
.attachment-file-heading small {
  font-size: 11px;
  color: #738097;
}
.attachment-preview {
  display: block;
  max-width: 100%;
  max-height: 420px;
  object-fit: contain;
  border: 1px solid #e4e9f1;
  border-radius: 5px;
  margin-top: 15px;
}
.attachment-empty {
  padding: 16px;
  margin: 18px 0 0;
  border-radius: 6px;
  background: #f8faff;
  color: #738097;
  font-size: 12px;
  text-align: center;
}
.attachment-state {
  color: #697890;
  font-size: 12px;
}
@media (max-width: 600px) {
  .attachment-panel-head {
    padding: 17px 18px;
  }
  .attachment-panel-body {
    padding: 18px;
  }
  .attachment-upload {
    padding: 18px 13px;
  }
}
</style>

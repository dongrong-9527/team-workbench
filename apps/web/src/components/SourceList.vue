<script setup lang="ts">
import AAlert from "ant-design-vue/es/alert";
import AButton from "ant-design-vue/es/button";
import { ref, watch } from "vue";
import { useReadScope } from "../composables/readScope";
import { request } from "../api/client";
import { zh, objectPath } from "../state";
import { actionNames } from "../forms";
import type {
  SeqPage,
  ReportSource,
} from "../../../../packages/contracts/src/index";
const props = defineProps<{ id: string }>();
const items = ref<ReportSource[]>([]),
  next = ref<number | null>(null),
  cutoff = ref(0),
  error = ref(""),
  busy = ref(false);
const reads = useReadScope(() => props.id);
function recordedTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium",
  }).format(date) + "（上海时间）" : "填写时间需核对";
}
async function load(more = false) {
  const read = reads.begin(more);
  if (!read || (more && next.value === null)) return;
  const id = props.id;
  if (!more) {
    items.value = [];
    next.value = null;
    cutoff.value = 0;
  }
  busy.value = true;
  error.value = "";
  try {
    const p = await request<SeqPage<ReportSource>>(
      `/api/reports/${id}/sources?limit=20` +
        (more ? `&afterSeq=${next.value}&cutoffSeq=${cutoff.value}` : ""),
    );
    read.commit(() => {
      items.value = more ? [...items.value, ...p.items] : p.items;
      next.value = p.nextAfterSeq;
      cutoff.value = p.cutoffSeq;
    });
  } catch (e) {
    if (read.valid()) error.value = (e as Error).message;
  } finally {
    read.finish(() => {
      busy.value = false;
    });
  }
}
watch(
  () => props.id,
  () => load(),
  { immediate: true },
);
</script>
<template>
  <div class="source-list" :aria-busy="busy">
    <div class="source-snapshot-heading">
      <h2>本版本的来源快照</h2>
      <p>保存时的原始贡献、状态与名称；不会随当前记录变化。</p>
    </div>
    <AAlert v-if="error" type="error" role="alert" show-icon
      ><template #message>
        {{ error }}<AButton @click="load()">重试读取来源</AButton>
      </template></AAlert
    >
    <p v-if="busy && !items.length" class="source-empty">正在读取来源快照…</p>
    <p v-else-if="!busy && !error && !items.length" class="source-empty">
      本版本没有可显示的来源记录。
    </p>
    <article
      v-for="s in items"
      :key="s.kind + s.id + s.seq"
      class="source-record"
      :class="{ 'contribution-source': s.kind === 'update' }"
    >
      <template v-if="s.kind === 'update'"
        ><div class="source-person">
          <span class="source-avatar" aria-hidden="true">{{
            s.update.authorName?.slice(0, 1) ?? "·"
          }}</span
          ><strong
            >{{ s.update.authorName }} · {{ s.update.workDate }} ·
            {{ zh(s.update.contributionType) }}</strong
          >
        </div>
        <div class="source-content">
          <p class="source-title">
            <RouterLink
              :to="objectPath(s.update.target.kind, s.update.target.id)"
              >{{ s.update.snapshot.title }}</RouterLink
            >
          </p>
          <p>{{ s.update.done }}</p>
          <dl class="source-update-details">
            <dt>下一步计划</dt><dd data-source-field="next">{{ s.update.next || '未填写' }}</dd>
            <dt>问题与协助</dt><dd data-source-field="obstacle">{{ s.update.obstacle || '未填写' }}</dd>
            <dt>实际填写时间 <span v-if="s.update.lateEntry">补记</span></dt>
            <dd><time :datetime="s.update.recordedAt" :title="s.update.recordedAt">{{ recordedTime(s.update.recordedAt) }}</time></dd>
          </dl>
          <small
            >贡献版本 {{ s.version }} · 事件 #{{ s.seq }} · 原记录
            {{ s.update.id }}</small
          >
        </div></template
      ><template v-else-if="s.kind === 'state'"
        ><strong>{{ s.snapshot.title }}</strong>
        <p>
          {{ zh(s.snapshot.state) }} · 截止时负责人
          {{ s.snapshot.ownerName ?? "未分配" }}
        </p>
        <small
          >对象版本 {{ s.version }} · R{{ s.snapshot.revision ?? "—" }} · #{{
            s.seq
          }}</small
        ></template
      ><template v-else-if="s.kind === 'event'"
        ><strong
          >{{ s.event.actorName }} ·
          {{ actionNames[s.event.action] ?? s.event.action }}</strong
        >
        <p>{{ s.event.reason }}</p>
        <small>{{ s.event.localTime }} · #{{ s.seq }}</small></template
      ><template v-else
        ><strong
          >{{ s.kind === "member" ? "成员" : "项目" }} ·
          {{ s.name ?? s.id }}</strong
        ><small>来源版本 {{ s.version }} · #{{ s.seq }}</small></template
      >
    </article>
    <div v-if="next !== null" class="source-more">
      <AButton :disabled="busy" :loading="busy" @click="load(true)">
        更多来源
      </AButton>
    </div>
  </div>
</template>
<style scoped>
.source-update-details { margin: 10px 0; }
.source-update-details dt { color: #748199; margin-top: 6px; font-size: 12px; }
.source-update-details dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.source-list {
  min-width: 0;
}
.source-snapshot-heading {
  padding: 17px 22px;
  background: #f8faff;
  border-bottom: 1px solid #e4e9f1;
}
.source-snapshot-heading h2 {
  margin: 0;
  font-size: 13px;
  color: #334969;
}
.source-snapshot-heading p {
  font-size: 11px;
  color: #748199;
  line-height: 1.8;
  margin: 6px 0 0;
}
.source-record {
  padding: 17px 22px;
  border-bottom: 1px solid #e4e9f1;
  overflow-wrap: anywhere;
  font-size: 12px;
}
.source-record:last-child {
  border-bottom: 0;
}
.source-record strong {
  color: #334969;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.7;
}
.source-record p {
  margin: 7px 0;
  color: #617087;
  font-size: 12px;
  line-height: 1.8;
  white-space: pre-wrap;
}
.source-record small {
  display: block;
  color: #748199;
  font-size: 11px;
  line-height: 1.8;
}
.contribution-source {
  padding: 0;
}
.source-person {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 15px 22px;
  background: #fafbfd;
  border-bottom: 1px solid #e4e9f1;
}
.source-avatar {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 50%;
  align-items: center;
  justify-content: center;
  color: #245bdb;
  background: #e7efff;
  font-size: 11px;
}
.source-content {
  padding: 12px 22px 17px;
}
.source-title a {
  font-weight: 600;
  color: #334969;
}
.source-title a:hover {
  color: #245bdb;
}
.source-empty {
  padding: 20px 22px;
  margin: 0;
  color: #748199;
  font-size: 12px;
}
.source-more {
  padding: 16px 22px;
  border-top: 1px solid #e4e9f1;
}
.source-list > .ant-alert {
  margin: 16px;
}
@media (max-width: 600px) {
  .source-snapshot-heading,
  .source-record {
    padding: 16px 17px;
  }
  .contribution-source {
    padding: 0;
  }
  .source-person {
    padding: 15px 17px;
  }
  .source-content {
    padding: 12px 17px 16px;
  }
}
</style>

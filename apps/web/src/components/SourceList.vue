<script setup lang="ts">
import { ref, watch } from "vue";
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
  error = ref("");
async function load(more = false) {
  try {
    const p = await request<SeqPage<ReportSource>>(
      `/api/reports/${props.id}/sources?limit=20` +
        (more ? `&afterSeq=${next.value}&cutoffSeq=${cutoff.value}` : ""),
    );
    items.value = more ? [...items.value, ...p.items] : p.items;
    next.value = p.nextAfterSeq;
    cutoff.value = p.cutoffSeq;
    error.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  }
}
watch(
  () => props.id,
  () => load(),
  { immediate: true },
);
</script>
<template>
  <h2>本版本的来源快照</h2>
  <p class="revision">保存时的原始贡献、状态与名称；不会随当前记录变化。</p>
  <p v-if="error" class="error" role="alert">
    {{ error }}<button @click="load()">重试读取来源</button>
  </p>
  <article v-for="s in items" class="source-item">
    <template v-if="s.kind === 'update'"
      ><strong
        >{{ s.update.authorName }} · {{ s.update.workDate }} ·
        {{ zh(s.update.contributionType) }}</strong
      >
      <p>
        <RouterLink
          :to="objectPath(s.update.target.kind, s.update.target.id)"
          >{{ s.update.snapshot.title }}</RouterLink
        >
      </p>
      <p>{{ s.update.done }}</p>
      <small
        >贡献版本 {{ s.version }} · 事件 #{{ s.seq }} · 原记录
        {{ s.update.id }}</small
      ></template
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
  <button v-if="next !== null" @click="load(true)">更多来源</button>
</template>

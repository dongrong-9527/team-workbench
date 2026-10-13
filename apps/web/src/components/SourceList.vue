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
  <h2>本版本的来源快照</h2>
  <p class="revision">保存时的原始贡献、状态与名称；不会随当前记录变化。</p>
  <AAlert v-if="error" type="error" role="alert" show-icon
    ><template #message>
      {{ error }}<AButton @click="load()">重试读取来源</AButton>
    </template></AAlert
  >
  <article v-for="s in items" :key="s.kind + s.id + s.seq" class="source-item">
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
  <AButton v-if="next !== null" :disabled="busy" @click="load(true)">
    更多来源
  </AButton>
</template>

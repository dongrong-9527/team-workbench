<script setup lang="ts">
import AAlert from "ant-design-vue/es/alert";
import AButton from "ant-design-vue/es/button";
import { ref, watch } from "vue";
import { useReadScope } from "../composables/readScope";
import { request } from "../api/client";
import { zh } from "../state";
import { actionNames } from "../forms";
import type {
  HistoryEntry,
  SeqPage,
} from "../../../../packages/contracts/src/index";
const props = defineProps<{ kind: string; id: string; refresh?: number }>();
const items = ref<HistoryEntry[]>([]),
  next = ref<number | null>(null),
  cutoff = ref<number>(),
  error = ref(""),
  busy = ref(false);
const reads = useReadScope(() =>
  JSON.stringify([props.kind, props.id, props.refresh]),
);
async function load(more = false) {
  const read = reads.begin(more);
  if (!read || (more && next.value === null)) return;
  if (!more) {
    items.value = [];
    next.value = null;
    cutoff.value = undefined;
  }
  busy.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ limit: "20" });
    if (more && next.value !== null) {
      q.set("afterSeq", String(next.value));
      q.set("cutoffSeq", String(cutoff.value));
    }
    const path = ["member", "project"].includes(props.kind)
      ? `/api/audit/${props.kind}/${props.id}`
      : `/api/objects/${props.kind}/${props.id}/history`;
    const page = await request<SeqPage<HistoryEntry>>(`${path}?${q}`);
    read.commit(() => {
      items.value = more ? [...items.value, ...page.items] : page.items;
      next.value = page.nextAfterSeq;
      cutoff.value = page.cutoffSeq;
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
  () => [props.kind, props.id, props.refresh],
  () => load(),
  { immediate: true },
);
const names: Record<string, string> = {
  attachmentAdded: "添加图片证据",
  created: "创建",
  create: "创建",
  saveUpdate: "填写工作更新",
  workUpdate: "填写工作更新",
  update: "填写工作更新",
  correction: "更正工作更新",
  testRecorded: "记录测试",
  recordTest: "记录测试",
  testProgress: "更新测试证据",
  requirementImpact: "需求修订影响",
  requirementCancel: "需求取消联动",
  updated: "更新",
  checkPassed: "检查通过",
  checkFailed: "检查退回",
  memberRenamed: "成员改名",
  projectCreated: "创建项目",
  projectRolesChanged: "调整项目权限",
  projectArchived: "归档项目",
  projectRestored: "恢复项目",
  projectRenamed: "项目改名",
  deactivate: "停用成员",
  reset: "签发重置票据",
  activate: "激活账号",
  password: "修改密码",
};
const action = (a: string) => actionNames[a] ?? names[a] ?? a;
const fields: Record<string, string> = {
  title: "标题",
  description: "说明",
  done: "实际工作",
  next: "下一步",
  obstacle: "障碍",
  ownerName: "负责人",
  state: "状态",
  revision: "修订",
  version: "版本",
  displayName: "显示名",
  active: "有效状态",
  name: "名称",
};
</script>
<template>
  <section class="panel panel-body">
    <h2>活动历史</h2>
    <p class="revision">事件按记录顺序追加 · 截止序号 {{ cutoff ?? "—" }}</p>
    <AAlert v-if="error" type="error" role="alert" show-icon
      ><template #message>
        {{ error }}<AButton @click="load()">重新读取历史</AButton>
      </template></AAlert
    >
    <ul class="history">
      <li v-for="e in items" :key="e.seq">
        <time>{{ e.localTime }} · #{{ e.seq }}</time
        ><strong>{{ e.actorName ?? e.actorId }}</strong> ·
        {{ action(e.action) }}
        <p v-if="e.before?.state || e.after?.state">
          {{ zh(e.before?.state) }} → {{ zh(e.after?.state) }}
        </p>
        <p v-if="e.reason">原因：{{ e.reason }}</p>
        <details v-if="e.before || e.after">
          <summary>查看变更内容</summary>
          <template v-for="(name, key) in fields" :key="key"
            ><p
              v-if="
                e.before?.[key] !== undefined || e.after?.[key] !== undefined
              "
            >
              {{ name }}：{{
                key === "state" ? zh(e.before?.[key]) : (e.before?.[key] ?? "—")
              }}
              →
              {{
                key === "state" ? zh(e.after?.[key]) : (e.after?.[key] ?? "—")
              }}
            </p></template
          >
        </details>
      </li>
    </ul>
    <p v-if="!items.length && !busy && !error" class="muted">暂无活动记录</p>
    <AButton v-if="next !== null" @click="load(true)" :disabled="busy">
      更多历史
    </AButton>
  </section>
</template>

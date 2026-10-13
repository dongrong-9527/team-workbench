<script setup lang="ts">
import {
  FileTextOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  FlagOutlined,
  EditOutlined,
} from "@ant-design/icons-vue";
import { ref, watch, computed } from "vue";
import { request, type Page } from "../api/client";
import { state, today } from "../state";
import { useReadScope } from "../composables/readScope";
import AButton from "ant-design-vue/es/button";
import ASelect from "ant-design-vue/es/select";
import ATag from "ant-design-vue/es/tag";
import WorkList from "../components/WorkList.vue";
const items = ref<any[]>([]),
  cursor = ref<string | null>(null),
  busy = ref(false),
  error = ref(""),
  kind = ref(""),
  status = ref(""),
  blocked = ref(""),
  owner = ref("");
const stats = computed(() => [
  {
    name: "当前页待推进",
    value: items.value.filter((x) =>
      ["pending", "active", "fixing"].includes(x.state),
    ).length,
  },
  {
    name: "待检查 / 验收",
    value: items.value.filter((x) =>
      ["pending_check", "pending_verify", "pending_acceptance"].includes(
        x.state,
      ),
    ).length,
  },
  {
    name: "需要协调",
    value: items.value.filter(
      (x) => x.blocked || x.flags.inactiveOwner || x.flags.pendingRevision,
    ).length,
  },
  {
    name: "待填今日更新",
    value: items.value.filter((x) => x.flags.missingUpdate).length,
  },
]);
const reads = useReadScope(() =>
  JSON.stringify([
    state.projectId,
    kind.value,
    status.value,
    blocked.value,
    owner.value,
  ]),
);
async function load(more = false) {
  const read = reads.begin(more);
  if (!read || (more && !cursor.value)) return;
  if (!more) {
    items.value = [];
    cursor.value = null;
  }
  busy.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({
      projectId: state.projectId,
      kind: kind.value,
      state: status.value,
      blocked: blocked.value,
      ownerId: owner.value,
      cursor: more ? cursor.value : "",
    }))
      if (v) q.set(k, v);
    const p = await request<Page<any>>("/api/my-work?" + q);
    read.commit(() => {
      items.value = more ? [...items.value, ...p.items] : p.items;
      cursor.value = p.nextCursor;
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
  () => [state.projectId, kind.value, status.value, blocked.value, owner.value],
  () => load(),
  { immediate: true },
);
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">{{ today() }} · 今天的协作</div>
      <h1>我的工作</h1>
      <p>先明确责任，再推进下一步。与你相关的工作，都在这里。</p>
    </div>
    <RouterLink to="/reports" custom v-slot="{ href, navigate }"
      ><AButton type="primary" size="large" :href="href" @click="navigate"
        ><FileTextOutlined aria-hidden="true" />生成今日日报 ↗</AButton
      ></RouterLink
    >
  </div>
  <div class="section-caption">
    我的工作概览 <span>以下统计仅包含当前筛选已加载的事项</span>
  </div>
  <div class="metrics">
    <div v-for="(s, i) in stats" :key="s.name" class="metric">
      <span>{{ s.name }}</span
      ><strong>{{ s.value.toString().padStart(2, "0") }}</strong
      ><span class="metric-mark" aria-hidden="true"
        ><component
          :is="
            [
              ThunderboltOutlined,
              CheckCircleOutlined,
              FlagOutlined,
              EditOutlined,
            ][i]
          "
      /></span>
    </div>
  </div>
  <section class="panel">
    <div class="section-heading">
      <div>
        <h2>
          待办与参与事项 <ATag>{{ items.length }} 项</ATag>
        </h2>
        <p>主责、检查、实际参与和可认领事项分别保留责任身份</p>
      </div>
      <AButton @click="load()" :loading="busy" :disabled="busy"
        ><ReloadOutlined aria-hidden="true" v-if="!busy" />刷新</AButton
      >
    </div>
    <div class="filters">
      <div>
        <label for="work-kind">工作类型</label
        ><ASelect
          id="work-kind"
          aria-label="工作类型"
          :value="kind"
          @update:value="kind = typeof $event === 'string' ? $event : ''"
          allow-clear
          :options="[
            { value: '', label: '全部类型' },
            { value: 'task', label: '任务' },
            { value: 'requirement', label: '需求' },
            { value: 'bug', label: 'Bug' },
          ]"
        />
      </div>
      <div>
        <label for="work-owner">负责人</label
        ><ASelect
          id="work-owner"
          aria-label="负责人"
          :value="owner"
          @update:value="owner = typeof $event === 'string' ? $event : ''"
          allow-clear
          :options="[
            { value: '', label: '全部负责人' },
            ...state.members.map((m) => ({
              value: m.id,
              label: m.displayName,
            })),
          ]"
        />
      </div>
      <div>
        <label for="work-status">状态</label
        ><ASelect
          id="work-status"
          aria-label="状态"
          :value="status"
          @update:value="status = typeof $event === 'string' ? $event : ''"
          allow-clear
          :options="[
            { value: '', label: '全部状态' },
            { value: 'active', label: '进行中' },
            { value: 'pending', label: '待处理' },
            { value: 'pending_check', label: '待检查' },
            { value: 'pending_verify', label: '待验证' },
            { value: 'pending_acceptance', label: '待验收' },
          ]"
        />
      </div>
      <div>
        <label for="work-blocked">阻塞</label
        ><ASelect
          id="work-blocked"
          aria-label="阻塞"
          :value="blocked"
          @update:value="blocked = typeof $event === 'string' ? $event : ''"
          allow-clear
          :options="[
            { value: '', label: '全部' },
            { value: 'true', label: '仅阻塞' },
            { value: 'false', label: '未阻塞' },
          ]"
        />
      </div>
    </div>
    <p v-if="error" class="error" role="alert">
      {{ error }} <AButton @click="load()">重试加载</AButton>
    </p>
    <p v-if="busy" role="status" class="empty">正在读取工作事项…</p>
    <WorkList v-else-if="items.length" :items="items" />
    <div v-else-if="!error" class="empty">
      当前筛选下没有待处理事项。<RouterLink to="/projects"
        >浏览全部项目 →</RouterLink
      >
    </div>
    <AButton
      v-if="cursor"
      class="load-more"
      @click="load(true)"
      :disabled="busy"
    >
      加载更多
    </AButton>
  </section>
  <div class="hint-card">
    <span><EditOutlined aria-hidden="true" /></span>
    <div>
      <strong>把今天的实际贡献记下来</strong>
      <p>
        工作更新独立于任务状态。记录做了什么、下一步和需要的协助，汇总时便有据可查。
      </p>
    </div>
  </div>
</template>

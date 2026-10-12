<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { request, type Page } from "../api/client";
import { state, today } from "../state";
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
async function load(more = false) {
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
    items.value = more ? [...items.value, ...p.items] : p.items;
    cursor.value = p.nextCursor;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
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
    <RouterLink class="button primary" to="/reports">生成今日日报 ↗</RouterLink>
  </div>
  <div class="metrics">
    <div v-for="(s, i) in stats" class="metric">
      <span>{{ s.name }}</span
      ><strong>{{ s.value.toString().padStart(2, "0") }}</strong
      ><span class="metric-mark">{{ ["↗", "◎", "!", "✎"][i] }}</span>
    </div>
  </div>
  <section class="panel">
    <div class="section-heading">
      <div>
        <h2>
          待办与参与事项 <span class="count">{{ items.length }}</span>
        </h2>
        <p>主责、检查、实际参与和可认领事项分别保留责任身份</p>
      </div>
      <button @click="load()" :disabled="busy">刷新</button>
    </div>
    <div class="filters">
      <label
        >工作类型<select aria-label="工作类型" v-model="kind">
          <option value="">全部类型</option>
          <option value="task">任务</option>
          <option value="requirement">需求</option>
          <option value="bug">Bug</option>
        </select></label
      ><label
        >负责人<select aria-label="负责人" v-model="owner">
          <option value="">全部负责人</option>
          <option v-for="m in state.members" :value="m.id">
            {{ m.displayName }}
          </option>
        </select></label
      ><label
        >状态<select aria-label="状态" v-model="status">
          <option value="">全部状态</option>
          <option value="active">进行中</option>
          <option value="pending">待处理</option>
          <option value="pending_check">待检查</option>
          <option value="pending_verify">待验证</option>
          <option value="pending_acceptance">待验收</option>
        </select></label
      ><label
        >阻塞<select aria-label="阻塞" v-model="blocked">
          <option value="">全部</option>
          <option value="true">仅阻塞</option>
          <option value="false">未阻塞</option>
        </select></label
      >
    </div>
    <p v-if="error" class="error" role="alert">
      {{ error }} <button @click="load()">重试加载</button>
    </p>
    <p v-if="busy" role="status" class="empty">正在读取工作事项…</p>
    <WorkList v-else-if="items.length" :items="items" />
    <div v-else-if="!error" class="empty">
      当前筛选下没有待处理事项。<RouterLink to="/projects"
        >浏览全部项目 →</RouterLink
      >
    </div>
    <button
      v-if="cursor"
      class="load-more"
      @click="load(true)"
      :disabled="busy"
    >
      加载更多
    </button>
  </section>
  <div class="hint-card">
    <span>✎</span>
    <div>
      <strong>把今天的实际贡献记下来</strong>
      <p>
        工作更新独立于任务状态。记录做了什么、下一步和需要的协助，汇总时便有据可查。
      </p>
    </div>
  </div>
</template>

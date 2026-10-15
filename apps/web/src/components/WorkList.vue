<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import ATable from "ant-design-vue/es/table";
import AAvatar from "ant-design-vue/es/avatar";
import ATag from "ant-design-vue/es/tag";
import { state, zh, objectPath, nameOf } from "../state";
defineProps<{ items: any[] }>();
const media = window.matchMedia("(max-width:600px)");
const mobile = ref(media.matches);
const resized = () => {
  mobile.value = media.matches;
};
onMounted(() => media.addEventListener("change", resized));
onBeforeUnmount(() => media.removeEventListener("change", resized));
const columns = [
  { title: "工作内容", key: "title", width: "44%" },
  { title: "状态", key: "status", width: 110 },
  { title: "优先级", key: "priority", width: 85 },
  { title: "负责人", key: "owner", width: 110 },
  { title: "下一步", key: "next", width: 112 },
];
function tone(s: string) {
  return ["active", "fixing"].includes(s)
    ? "blue"
    : ["pending_check", "pending_verify", "pending_acceptance"].includes(s)
      ? "purple"
      : ["done", "closed", "accepted"].includes(s)
        ? "green"
        : undefined;
}
function next(o: any) {
  if (
    o.archived ||
    ["done", "closed", "accepted", "cancelled", "rejected"].includes(o.state)
  )
    return "查看详情";
  if (o.blocked) return "查看阻塞";
  const scope = o.objectKind === "task" && o.kind !== "other" ? o.kind : o.role;
  const canClaim =
    o.objectKind !== "requirement" &&
    !o.ownerId &&
    !o.archived &&
    o.state === (o.objectKind === "task" ? "pending" : "ready") &&
    state.projects
      .find((p) => p.id === o.projectId)
      ?.myRoles.some((r) => r.role === scope);
  if (canClaim) return "领取工作";
  if (["pending_check", "pending_verify"].includes(o.state)) return "查看检查";
  if (o.state === "pending_acceptance") return "产品验收";
  if (o.ownerId === state.member?.id)
    return ["active", "fixing"].includes(o.state) ? "写进展" : "开始处理";
  return "查看详情";
}
function destination(o: any) {
  const label = next(o);
  return {
    path: objectPath(o.objectKind, o.id),
    query:
      label === "领取工作"
        ? { action: "claim" }
        : label === "写进展"
          ? { action: "update" }
          : {},
  };
}
</script>
<template>
  <div class="work-list">
    <div
      v-if="!mobile"
      class="work-table-scroll"
      role="region"
      aria-label="工作事项，可横向滚动"
      tabindex="0"
    >
      <ATable
        class="work-table"
        :data-source="items"
        :columns="columns"
        :pagination="false"
        row-key="id"
        :row-class-name="() => 'work-row'"
        style="min-width: 720px"
      >
        <template #bodyCell="{ column, record: o }">
          <template v-if="column.key === 'title'">
            <RouterLink
              class="work-title"
              :to="objectPath(o.objectKind, o.id)"
              >{{ o.title }}</RouterLink
            >
            <div class="row-meta">
              <span>{{ String(o.id).slice(0, 8) }}</span
              ><span>· {{ o.projectName }}</span
              ><span
                >·
                {{ zh(o.objectKind === "task" ? o.kind : o.objectKind) }}</span
              >
            </div>
            <div class="row-flags">
              <span>{{ zh(o.responsibility) }}</span
              ><ATag v-if="o.flags?.inactiveOwner" color="orange"
                >负责人已停用</ATag
              ><ATag v-if="o.flags?.pendingRevision" color="orange"
                >修订待处理</ATag
              ><span v-if="o.flags?.missingUpdate">未填今日更新</span>
            </div>
          </template>
          <template v-else-if="column.key === 'status'"
            ><ATag :color="tone(o.state)">{{ zh(o.state) }}</ATag
            ><ATag v-if="o.blocked" color="orange">阻塞</ATag></template
          >
          <span
            v-else-if="column.key === 'priority'"
            class="priority"
            :class="o.priority"
            >{{ zh(o.priority) }}</span
          >
          <div v-else-if="column.key === 'owner'" class="owner">
            <AAvatar :size="24">{{ (o.ownerName ?? "待").slice(0, 1) }}</AAvatar
            >{{ o.ownerName ?? "未分配" }}
          </div>
          <div v-else-if="column.key === 'next'" class="next-step">
            <span v-if="o.state === 'pending_check'"
              >检查人 {{ nameOf(o.reviewerId) }}</span
            ><RouterLink :to="destination(o)">{{ next(o) }} →</RouterLink>
          </div>
        </template>
      </ATable>
    </div>
    <p v-if="!mobile" class="work-table-scroll-hint">
      表格可横向滚动查看负责人和下一步
    </p>
    <template v-if="mobile">
      <article v-for="o in items" :key="o.id" class="mobile-work-card work-row">
        <div class="mobile-card-top">
          <span class="row-meta"
            >{{ String(o.id).slice(0, 8) }} ·
            {{ zh(o.objectKind === "task" ? o.kind : o.objectKind) }}</span
          ><ATag :color="tone(o.state)">{{ zh(o.state) }}</ATag>
        </div>
        <RouterLink class="work-title" :to="objectPath(o.objectKind, o.id)">{{
          o.title
        }}</RouterLink>
        <div class="row-meta">
          {{ o.projectName }} · {{ zh(o.responsibility) }}
        </div>
        <div class="row-flags">
          <ATag v-if="o.blocked" color="orange">阻塞</ATag
          ><ATag v-if="o.flags?.inactiveOwner" color="orange">负责人已停用</ATag
          ><ATag v-if="o.flags?.pendingRevision" color="orange">修订待处理</ATag
          ><span v-if="o.flags?.missingUpdate">未填今日更新</span>
        </div>
        <div class="mobile-card-footer">
          <span class="priority" :class="o.priority">{{ zh(o.priority) }}</span
          ><span class="owner">{{ o.ownerName ?? "未分配" }}</span
          ><RouterLink :to="destination(o)">{{ next(o) }} →</RouterLink>
        </div>
      </article>
    </template>
  </div>
</template>

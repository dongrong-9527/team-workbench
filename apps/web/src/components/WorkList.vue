<script setup lang="ts">
import { zh, objectPath, nameOf } from "../state";
defineProps<{ items: any[] }>();
</script>
<template>
  <div class="work-list">
    <div class="list-head">
      <span>工作事项</span><span>责任人</span><span>当前状态</span
      ><span>下一步</span>
    </div>
    <article v-for="o in items" :key="o.id" class="work-row">
      <div>
        <div class="row-meta">
          <span class="kind-label">{{ zh(o.objectKind) }}</span
          ><span>{{ o.projectName }}</span
          ><span class="priority" v-if="o.priority === 'high'">高优先级</span>
        </div>
        <RouterLink class="work-title" :to="objectPath(o.objectKind, o.id)">{{
          o.title
        }}</RouterLink>
        <div class="row-flags">
          <span class="subtle">{{ zh(o.responsibility) }}</span
          ><span v-if="o.blocked" class="badge warning">阻塞</span
          ><span v-if="o.flags.inactiveOwner" class="badge warning"
            >负责人已停用</span
          ><span v-if="o.flags.pendingRevision" class="badge warning"
            >修订待处理</span
          ><span v-if="o.flags.missingUpdate" class="subtle">未填今日更新</span>
        </div>
      </div>
      <div class="owner">
        <span class="mini-avatar">{{ (o.ownerName ?? "待").slice(0, 1) }}</span
        >{{ o.ownerName ?? "待认领" }}
      </div>
      <div>
        <span class="badge" :class="o.state">{{ zh(o.state) }}</span>
      </div>
      <div class="next-step">
        {{
          o.state === "pending_check"
            ? "检查人 " + nameOf(o.reviewerId)
            : o.state === "pending_verify"
              ? "项目测试验证"
              : o.state === "pending_acceptance"
                ? "产品验收"
                : o.flags.unassigned
                  ? "对应角色认领"
                  : o.blocked
                    ? "协调解除阻塞"
                    : "负责人推进"
        }}<RouterLink
          :to="objectPath(o.objectKind, o.id)"
          aria-label="查看工作详情"
          >查看 →</RouterLink
        >
      </div>
    </article>
  </div>
</template>

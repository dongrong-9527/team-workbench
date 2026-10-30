<script setup lang="ts">
import { ref, computed } from "vue";
import AInput from "ant-design-vue/es/input";
import { state } from "../state";
const props = defineProps<{ activeId?: string; mobile?: boolean }>();
const emit = defineEmits<{ select: [] }>();
const query = ref("");
const projects = computed(() => {
  const q = query.value.trim().toLocaleLowerCase();
  return state.projects.filter(
    (p) =>
      !q ||
      (p.name + " " + p.id + " " + p.description)
        .toLocaleLowerCase()
        .includes(q),
  );
});
</script>
<template>
  <section
    v-if="state.projects.length"
    class="project-shortcuts"
    :class="{ 'desktop-shortcuts': !props.mobile }"
  >
    <div class="shortcut-heading">
      项目 <span>{{ state.projects.length }}</span>
    </div>
    <AInput
      v-model:value="query"
      :aria-label="props.mobile ? '筛选移动项目' : '筛选侧栏项目'"
      placeholder="筛选项目…"
      allow-clear
    />
    <nav
      class="project-shortcut-list"
      :aria-label="props.mobile ? '移动项目入口' : '项目快捷入口'"
    >
      <RouterLink
        v-for="p in projects"
        :key="p.id"
        :to="'/projects/' + p.id"
        :title="p.name"
        :aria-current="activeId === p.id ? 'page' : undefined"
        :class="{ archived: !!p.archived }"
        @click="emit('select')"
      >
        <span class="project-dot" aria-hidden="true"></span
        ><span class="project-name">{{ p.name }}</span
        ><small v-if="p.archived">已归档</small>
      </RouterLink>
      <p v-if="!projects.length" class="shortcut-empty">没有匹配的项目</p>
    </nav>
  </section>
</template>
<style scoped>
.project-shortcuts {
  display: flex;
  flex-direction: column;
  min-height: 110px;
  flex: 1 1 auto;
  overflow: hidden;
  margin: 14px 0;
}
.shortcut-heading {
  display: flex;
  justify-content: space-between;
  color: #7b879b;
  font-size: 11px;
  padding: 5px 10px 10px;
}
.shortcut-heading span {
  font-variant-numeric: tabular-nums;
}
.project-shortcuts > .ant-input-affix-wrapper {
  flex-shrink: 0;
  margin-bottom: 8px;
}
.project-shortcut-list {
  min-height: 0;
  overflow-y: auto;
  max-height: 42vh;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.project-shortcut-list a {
  height: auto;
  min-height: 37px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border-radius: 6px;
  color: #58677d;
  font-size: 12px;
}
.project-shortcut-list a[aria-current] {
  background: #eaf0fb;
  color: #245bdb;
  font-weight: 600;
}
.project-shortcut-list a:hover {
  text-decoration: none;
  background: #f4f6fa;
}
.project-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.project-dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 3px;
  background: #86a6ec;
}
.archived .project-dot {
  background: #b6bfcc;
}
.project-shortcut-list small {
  font-size: 10px;
  color: #8792a6;
  white-space: nowrap;
}
.shortcut-empty {
  font-size: 12px;
  color: #7b879b;
  padding: 10px;
}
@media (max-width: 850px) {
  .desktop-shortcuts {
    display: none;
  }
}
</style>

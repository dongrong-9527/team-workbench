<script setup lang="ts">
defineProps<{ projectId: string; active: "basic" | "roles" | "history" }>();
</script>
<template>
  <nav class="project-settings-segments" aria-label="项目设置导航">
    <RouterLink
      :to="{ path: '/projects/' + projectId, query: { tab: 'settings' } }"
      :aria-current="active === 'basic' ? 'page' : undefined"
      >基本信息</RouterLink
    >
    <RouterLink
      :to="{ path: '/members', query: { projectId } }"
      :aria-current="active === 'roles' ? 'page' : undefined"
      >成员与角色</RouterLink
    >
    <RouterLink
      :to="{
        path: '/projects/' + projectId,
        query: { tab: 'settings', section: 'history' },
        hash: '#project-history',
      }"
      :aria-current="active === 'history' ? 'page' : undefined"
      >归档与历史</RouterLink
    >
  </nav>
</template>
<style scoped>
.project-settings-segments {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: fit-content;
  max-width: 100%;
  padding: 4px;
  border-radius: 8px;
  background: #eaf0f8;
  margin: 0 0 20px;
}
.project-settings-segments a {
  padding: 9px 18px;
  border-radius: 6px;
  color: #58677d;
  font-size: 13px;
  white-space: nowrap;
}
.project-settings-segments a[aria-current] {
  background: #fff;
  color: #17243b;
  box-shadow: 0 1px 4px #17243b12;
  font-weight: 600;
}
.project-settings-segments a:hover {
  text-decoration: none;
  color: #245bdb;
}
@media (max-width: 600px) {
  .project-settings-segments a {
    font-size: 12px;
    padding: 9px 11px;
  }
}
</style>

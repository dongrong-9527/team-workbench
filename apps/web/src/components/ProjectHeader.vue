<script setup lang="ts">
import ASelect from "ant-design-vue/es/select";
import ATag from "ant-design-vue/es/tag";
import { FolderOpenOutlined } from "@ant-design/icons-vue";
import { useRoute, useRouter } from "vue-router";
import { state, type Project } from "../state";
import { projectTabs } from "../projectNavigation";
const props = defineProps<{
  projectId: string;
  project?: Pick<
    Project,
    "id" | "name" | "description" | "archived" | "version"
  >;
  active: string;
}>();
const emit = defineEmits<{ navigate: [] }>();
const route = useRoute(),
  router = useRouter();
function location(key: string, id = props.projectId) {
  return {
    path: "/projects/" + id,
    query: {
      ...(route.query.q && route.path !== "/members"
        ? { q: String(route.query.q) }
        : {}),
      ...(key === "overview" ? {} : { tab: key }),
    },
  };
}
function switchProject(value: unknown) {
  if (
    state.mutationPending ||
    typeof value !== "string" ||
    value === props.projectId
  )
    return;
  void router.push(
    route.path === "/members"
      ? { path: "/members", query: { projectId: value } }
      : location(props.active, value),
  );
}
</script>
<template>
  <section class="project-header">
    <div class="project-heading-row">
      <span class="project-heading-icon"
        ><FolderOpenOutlined aria-hidden="true"
      /></span>
      <div class="project-heading-copy">
        <slot name="title"
          ><h1>{{ project?.name ?? "项目" }}</h1></slot
        >
        <p class="project-heading-code" :title="projectId">{{ projectId }}</p>
      </div>
      <ATag v-if="project" :color="project.archived ? undefined : 'blue'">{{
        project.archived ? "已归档" : "进行中"
      }}</ATag>
      <label class="project-select-label" for="project-context-selector"
        >切换当前项目</label
      >
      <ASelect
        id="project-context-selector"
        :value="projectId"
        :disabled="state.mutationPending"
        :options="
          state.projects.map((p) => ({
            value: p.id,
            label: p.name + (p.archived ? ' · 已归档' : ''),
          }))
        "
        @update:value="switchProject"
      />
      <div class="project-heading-actions"><slot name="actions" /></div>
    </div>
    <p v-if="project?.description" class="project-heading-description">
      {{ project.description }}
    </p>
    <nav class="project-navigation" aria-label="项目导航">
      <RouterLink
        v-for="t in projectTabs"
        :key="t.key"
        :to="location(t.key)"
        :aria-current="active === t.key ? 'page' : undefined"
        @click="emit('navigate')"
        >{{ t.label }}</RouterLink
      >
    </nav>
  </section>
</template>
<style scoped>
.project-header {
  background: #fff;
  border: 1px solid #e4e9f1;
  border-radius: 8px;
  padding: 20px 22px 0;
  margin-bottom: 20px;
  min-width: 0;
}
.project-heading-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
}
.project-heading-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #edf3ff;
  color: #245bdb;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 19px;
}
.project-heading-copy {
  min-width: 0;
  flex: 1 1 170px;
}
.project-heading-copy :deep(h1) {
  font-size: 21px;
  margin: 0;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.project-heading-code {
  font-size: 11px;
  color: #7b879b;
  margin: 3px 0 0;
  overflow-wrap: anywhere;
}
.project-heading-row > .ant-select {
  width: 150px;
  max-width: 100%;
}
.project-heading-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  min-width: 0;
}
.project-select-label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.project-heading-description {
  font-size: 12px;
  color: #58677d;
  line-height: 1.8;
  margin: 12px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.project-navigation {
  display: flex;
  gap: 24px;
  overflow-x: auto;
  margin-top: 18px;
  min-width: 0;
}
.project-navigation a {
  padding: 10px 2px 13px;
  white-space: nowrap;
  color: #58677d;
  border-bottom: 2px solid transparent;
  font-size: 13px;
}
.project-navigation a[aria-current] {
  color: #245bdb;
  border-color: #245bdb;
  font-weight: 600;
}
.project-navigation a:hover {
  text-decoration: none;
  color: #245bdb;
}
@media (max-width: 850px) {
  .project-heading-actions {
    width: 100%;
    justify-content: flex-start;
  }
  .project-heading-row > .ant-select {
    width: 140px;
  }
}
@media (max-width: 600px) {
  .project-header {
    padding: 16px 16px 0;
  }
  .project-heading-copy {
    flex-basis: calc(100% - 50px);
  }
  .project-heading-copy :deep(h1) {
    font-size: 20px;
  }
  .project-heading-row > .ant-select {
    flex: 1;
    min-width: 0;
  }
  .project-navigation {
    gap: 20px;
  }
  .project-navigation a {
    font-size: 12px;
  }
  .project-heading-description {
    max-height: 5.4em;
    overflow: auto;
  }
}
</style>

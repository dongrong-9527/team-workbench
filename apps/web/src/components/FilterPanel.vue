<script setup lang="ts">
import { computed, ref, useId } from "vue";
import AButton from "ant-design-vue/es/button";
import { FilterOutlined, DownOutlined, UpOutlined } from "@ant-design/icons-vue";
import { countFilters, useStagedFilters, type FilterValues } from "../composables/listFilters";
const props = defineProps<{ modelValue: FilterValues; defaults: FilterValues; scopeKey: string; label: string; disabled?: boolean }>();
const emit = defineEmits<{ apply: [next: FilterValues] }>();
const { open, draft, openPanel, close, reset, apply } = useStagedFilters(
  () => props.modelValue, () => props.defaults, () => props.scopeKey, (next) => emit("apply", next),
);
const count = computed(() => countFilters(props.modelValue, props.defaults));
const id = useId();
const root = ref<HTMLElement>();
defineExpose({ openPanel, scrollIntoView() { root.value?.scrollIntoView({ block: "nearest" }); } });
</script>
<template>
  <section ref="root" class="filter-panel" role="region" :aria-label="label">
    <AButton class="filter-toggle" :aria-expanded="open" :aria-controls="id" :disabled="disabled" @click="open ? close() : openPanel()">
      <FilterOutlined aria-hidden="true" />筛选（{{ count }}）<UpOutlined v-if="open" aria-hidden="true" /><DownOutlined v-else aria-hidden="true" />
    </AButton>
    <div v-if="open" :id="id" class="filter-body">
      <slot :draft="draft" />
      <div class="filter-actions">
        <AButton type="primary" :disabled="disabled" @click="apply">确定</AButton>
        <AButton :disabled="disabled" @click="reset">重置</AButton>
        <AButton @click="close">收起</AButton>
      </div>
    </div>
  </section>
</template>
<style scoped>
.filter-panel { padding: 16px 20px; min-width: 0; border-bottom: 1px solid #e4e9f1; }
.filter-body { padding-top: 16px; }
.filter-actions { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 14px; }
.filter-panel :deep(.filters) { padding: 0; margin: 0; flex-wrap: wrap; }
.filter-panel :deep(.filters > div) { min-width: 140px; max-width: 100%; }
.filter-panel :deep(.filters .ant-input-affix-wrapper), .filter-panel :deep(.filters .ant-select) { width: 100%; }
.filter-panel :deep(.filter-note) { color: #58677d; font-size: 12px; margin: 12px 0 0; }
@media (max-width: 600px) {
  .filter-panel { padding: 14px 16px; }
  .filter-panel :deep(.filters) { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .filter-panel :deep(.filters > div) { min-width: 0; }
}
</style>

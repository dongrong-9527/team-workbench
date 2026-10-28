<script setup lang="ts">
import { ref, watch } from "vue";
import AAlert from "ant-design-vue/es/alert";
import AButton from "ant-design-vue/es/button";
import ATag from "ant-design-vue/es/tag";
import { request, type Page } from "../api/client";
import { state, zh, objectPath } from "../state";
import { useReadScope } from "../composables/readScope";
const props = defineProps<{ projectId: string }>();
const items = ref<any[]>([]),
  cursor = ref<string | null>(null),
  busy = ref(false),
  error = ref("");
const reads = useReadScope(() =>
  JSON.stringify([props.projectId, state.member?.id]),
);
const relation: Record<string, string> = {
  owner: "负责",
  reviewer: "检查关联",
  acceptor: "验收关联",
  participant: "参与记录",
  tester: "测试关联",
  claimable: "未分配关联",
  observer: "关注关联",
};
async function load(more = false) {
  const read = reads.begin(more);
  if (!read || (more && !cursor.value)) return;
  if (!more) {
    items.value = [];
    cursor.value = null;
  }
  busy.value = true;
  error.value = "";
  const q = new URLSearchParams({ projectId: props.projectId, limit: "5" });
  if (more && cursor.value) q.set("cursor", cursor.value);
  try {
    const page = await request<Page<any>>("/api/my-work?" + q);
    read.commit(() => {
      items.value = more ? [...items.value, ...page.items] : page.items;
      cursor.value = page.nextCursor;
    });
  } catch (e) {
    read.commit(() => {
      error.value = (e as Error).message;
    });
  } finally {
    read.finish(() => {
      busy.value = false;
    });
  }
}
watch(
  () => [props.projectId, state.member?.id],
  () => load(),
  { immediate: true },
);
</script>
<template>
  <section
    class="panel project-related-work"
    role="region"
    aria-label="与我相关的工作"
  >
    <header>
      <div>
        <h2>与我相关的工作</h2>
        <p>包含负责、检查、参与等关联；是否能操作请进入详情核对。</p>
      </div>
      <AButton :disabled="busy" @click="load()">刷新关联</AButton>
    </header>
    <AAlert v-if="error" type="error" role="alert" :message="error" show-icon />
    <p v-if="busy && !items.length" role="status" class="related-empty">
      正在读取关联工作…
    </p>
    <ul>
      <li v-for="o in items" :key="o.id" class="related-work-row">
        <ATag>{{ zh(o.objectKind) }}</ATag>
        <div class="related-copy">
          <RouterLink :to="objectPath(o.objectKind, o.id)">{{
            o.title
          }}</RouterLink>
          <p>
            {{ zh(o.state) }} · {{ relation[o.responsibility] ?? "关联记录"
            }}<span v-if="o.blocked"> · 阻塞</span
            ><span v-if="o.archived"> · 项目已归档，只读</span
            ><span v-if="o.flags?.invalidOwner || o.flags?.invalidReviewer">
              · 岗位资格需核对</span
            >
          </p>
        </div>
        <RouterLink
          class="related-detail"
          :to="objectPath(o.objectKind, o.id)"
          :aria-label="'查看详情：' + o.title"
          >查看详情 →</RouterLink
        >
      </li>
    </ul>
    <p v-if="!busy && !items.length && !error" class="related-empty">
      当前项目暂无与我相关的工作
    </p>
    <footer>
      <span
        >已展示 {{ items.length }} 项{{
          cursor ? " · 还有更多关联记录" : ""
        }}</span
      ><AButton v-if="cursor" :disabled="busy" @click="load(true)"
        >加载更多关联</AButton
      >
    </footer>
  </section>
</template>
<style scoped>
.project-related-work {
  margin-bottom: 20px;
  overflow: hidden;
}
.project-related-work header {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 17px 20px;
  border-bottom: 1px solid #e4e9f1;
}
.project-related-work h2 {
  font-size: 15px;
  margin: 0;
}
.project-related-work header p {
  font-size: 12px;
  color: #738097;
  margin: 6px 0 0;
  line-height: 1.6;
}
.project-related-work ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.related-work-row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid #eef1f6;
  min-width: 0;
}
.related-copy {
  flex: 1;
  min-width: 0;
}
.related-copy > a {
  font-size: 13px;
  color: #17243b;
  overflow-wrap: anywhere;
}
.related-copy p {
  font-size: 11px;
  color: #738097;
  margin: 5px 0 0;
  line-height: 1.6;
}
.related-detail {
  font-size: 12px;
  flex-shrink: 0;
}
.related-empty {
  padding: 24px 20px;
  font-size: 13px;
  color: #738097;
}
.project-related-work footer {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  font-size: 11px;
  color: #738097;
}
.project-related-work > .ant-alert {
  margin: 14px 20px;
}
@media (max-width: 600px) {
  .related-work-row {
    align-items: flex-start;
    flex-wrap: wrap;
    padding: 14px 16px;
  }
  .related-detail {
    margin-left: auto;
  }
  .project-related-work header {
    padding: 16px;
  }
  .project-related-work header .ant-btn {
    font-size: 12px;
    padding-inline: 8px;
  }
  .project-related-work footer {
    padding: 12px 16px;
  }
}
</style>

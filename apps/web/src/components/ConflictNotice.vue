<script setup lang="ts">
import { zh, nameOf } from "../state";
defineProps<{ current: Record<string, unknown>; originalVersion?: number }>();
defineEmits<{ adopt: [current: Record<string, unknown>] }>();
const fields: Record<string, string> = {
  title: "标题",
  state: "状态",
  ownerId: "负责人",
  acceptorId: "验收人",
  displayName: "显示名",
  revision: "需求修订",
  description: "说明",
  definitionOfDone: "完成标准",
  priority: "优先级",
  text: "最新稿件文本",
  done: "今天实际做了什么",
  next: "下一步计划",
  obstacle: "遇到的障碍",
  workDate: "工作日期",
};
</script>
<template>
  <section class="error" role="alert">
    <h3>版本冲突：请核对最新记录</h3>
    <p>
      你的填写内容仍然保留。原版本 {{ originalVersion ?? "—" }} → 当前版本
      {{ current.version ?? "—" }}
    </p>
    <dl>
      <template v-for="(name, key) in fields" :key="key"
        ><template v-if="current[key] !== undefined"
          ><dt>{{ name }}</dt>
          <dd class="body-text">
            {{
              key.endsWith("Id")
                ? nameOf(current[key])
                : ["state", "priority"].includes(key)
                  ? zh(current[key])
                  : current[key]
            }}
          </dd></template
        ></template
      >
    </dl>
    <button type="button" @click="$emit('adopt', current)">
      采用最新版本并重新核对
    </button>
    <p>采用版本后仍需由你主动提交；不会自动覆盖或重试。</p>
  </section>
</template>

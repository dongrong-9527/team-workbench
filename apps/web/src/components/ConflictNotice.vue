<script setup lang="ts">
import AAlert from "ant-design-vue/es/alert";
import AButton from "ant-design-vue/es/button";
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
  <AAlert class="conflict-notice" type="error" role="alert"
    ><template #description>
      <h3>版本冲突：请核对最新记录</h3>
      <p>你的填写内容仍然保留。请对照当前记录，核对后继续编辑。</p>
      <div class="conflict-versions">
        <div>
          <span>我填写时的版本</span
          ><strong>{{ originalVersion ?? "—" }}</strong>
        </div>
        <div>
          <span>当前服务器版本</span
          ><strong>{{ current.version ?? "—" }}</strong>
        </div>
      </div>
      <dl class="conflict-current">
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
      <AButton html-type="button" @click="$emit('adopt', current)">
        采用最新版本并重新核对
      </AButton>
      <p>采用版本后仍需由你主动提交；不会自动覆盖或重试。</p>
    </template></AAlert
  >
</template>

<style scoped>
.conflict-notice {
  margin: 0 0 16px;
  border: 1px solid #f0d9d5;
  background: #fff7f5;
  border-radius: 7px;
}
.conflict-notice h3 {
  margin: 0 0 10px;
  color: #923f35;
  font-size: 15px;
}
.conflict-notice p {
  font-size: 12px;
  line-height: 1.9;
  color: #6c6671;
  margin: 10px 0;
}
.conflict-versions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 16px 0;
}
.conflict-versions > div {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 14px;
  border: 1px solid #e4e9f1;
  border-radius: 6px;
  background: white;
}
.conflict-versions span {
  font-size: 12px;
  color: #697890;
}
.conflict-versions strong {
  color: #24344d;
  font-size: 20px;
  font-weight: 500;
}
.conflict-current {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  padding: 15px;
  gap: 12px;
  border: 1px solid #e4e9f1;
  background: #fafbfd;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.8;
}
.conflict-current dt {
  color: #697890;
}
.conflict-current dd {
  margin: 0;
  min-width: 0;
  color: #334562;
}
.conflict-notice .ant-btn {
  height: auto;
  min-height: 34px;
  white-space: normal;
}
@media (max-width: 600px) {
  .conflict-versions {
    gap: 8px;
  }
  .conflict-versions > div {
    padding: 12px;
  }
  .conflict-current {
    grid-template-columns: 80px minmax(0, 1fr);
    padding: 12px;
    gap: 10px;
  }
}
</style>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import { request, ApiError } from "../api/client";
import { state, zh } from "../state";
import ConflictNotice from "./ConflictNotice.vue";
import AButton from "ant-design-vue/es/button";
import AInput from "ant-design-vue/es/input";
import ASelect from "ant-design-vue/es/select";
import ACheckbox from "ant-design-vue/es/checkbox";
import ADatePicker from "ant-design-vue/es/date-picker";
import AForm from "ant-design-vue/es/form";
import AModal from "ant-design-vue/es/modal";
import AAlert from "ant-design-vue/es/alert";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import type { FormSpec, Field } from "../forms";
import {
  BUSINESS_BODY_LIMIT,
  CHECK_ENTRY_LIMIT,
} from "../../../../packages/contracts/src/input-limits";
const returnFocus =
  document.activeElement instanceof HTMLElement
    ? document.activeElement
    : undefined;
const datePopupOpen = ref(false);
const newId = () => crypto.randomUUID();
const props = defineProps<{
  spec: FormSpec;
  draftKey: string;
  version?: number;
  sensitive?: boolean;
}>();
const emit = defineEmits<{ saved: [result: any]; cancel: [] }>();
const actor = state.member?.id ?? "anonymous";
const storageKey = `workbench:draft:${actor}:${props.draftKey}`;
let stored: any;
try {
  stored = !props.sensitive
    ? JSON.parse(localStorage.getItem(storageKey) ?? "null")
    : null;
} catch {}
const values = ref<Record<string, any>>(
    stored?.values ?? JSON.parse(JSON.stringify(props.spec.initial)),
  ),
  version = ref<number | undefined>(stored?.version ?? props.version),
  busy = ref(false),
  error = ref(""),
  conflict = ref<Record<string, unknown>>(),
  form = ref<InstanceType<typeof AForm>>(),
  reasons = ref<any[]>([]);
let fingerprint = stored?.fingerprint ?? "",
  key = stored?.key ?? "";
function persist() {
  if (!props.sensitive)
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        values: values.value,
        version: version.value,
        fingerprint,
        key,
      }),
    );
}
watch(values, persist, { deep: true });
async function submit() {
  if (busy.value) return;
  if (state.member && state.member.id !== actor) {
    error.value = "登录身份已变化，请返回本人工作草稿后再操作。";
    return;
  }
  busy.value = true;
  error.value = "";
  reasons.value = [];
  try {
    const body = props.spec.body(values.value);
    if (version.value !== undefined) body.expectedVersion = version.value;
    if (
      new TextEncoder().encode(JSON.stringify(body)).byteLength >
      BUSINESS_BODY_LIMIT
    )
      throw new Error(
        "本次内容超过 4 MiB，请减少条目或说明后再提交；输入已保留。",
      );
    const next = JSON.stringify([
      props.spec.path,
      props.spec.method ?? "POST",
      body,
    ]);
    if (next !== fingerprint) {
      fingerprint = next;
      key = crypto.randomUUID();
    }
    persist();
    const result = await request<any>(props.spec.path, {
      method: props.spec.method ?? "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
    localStorage.removeItem(storageKey);
    emit("saved", result);
  } catch (e) {
    error.value = (e as Error).message;
    if (e instanceof ApiError) {
      conflict.value = e.code === 409 ? e.current : undefined;
      reasons.value = e.reasons ?? [];
    }
  } finally {
    busy.value = false;
  }
}
function adopt(current: Record<string, unknown>) {
  if (typeof current.version === "number") {
    version.value = current.version;
    props.spec.adopt?.(current, values.value);
    fingerprint = "";
    key = "";
    conflict.value = undefined;
    error.value = "已采用最新版本，请核对内容后主动提交。";
    persist();
  }
}
function cancel() {
  if (busy.value) return;
  persist();
  emit("cancel");
}
// Read popup state before its own Escape handler closes it. The modal's
// bubbling cancel event must not interpret that same key as a form cancel.
let popupEscape = false;
function popupKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  popupEscape =
    (event.target as HTMLElement).getAttribute("aria-expanded") === "true" ||
    datePopupOpen.value;
}
function finishPopupKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && popupEscape) event.stopPropagation();
  popupEscape = false;
}
function rules(f: Field) {
  return [
    {
      validator: async (_rule: unknown, value: any) => {
        if (f.when && !f.when(values.value)) return;
        if (
          f.required &&
          (value === "" ||
            value == null ||
            (f.type === "checkbox" && value !== true))
        )
          throw new Error(`请填写${f.label}`);
        if (typeof value === "string") {
          const max = f.max ?? (f.type === "textarea" ? 6000 : 200);
          if (value.length > max)
            throw new Error(`${f.label}最多 ${max} 个字符`);
          if (value && f.type === "url") {
            try {
              new URL(value);
            } catch {
              throw new Error("请输入有效链接");
            }
          }
          if (value && f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value))
            throw new Error("请输入有效日期");
        }
      },
    },
  ];
}
const textRules = (label: string, max: number, required = false) => [
  { required, message: `请填写${label}` },
  {
    validator: async (_rule: unknown, value: unknown) => {
      // The API measures UTF-16 units; async-validator's max counts codepoints.
      if (typeof value === "string" && value.length > max)
        throw new Error(`${label}最多 ${max} 个字符`);
    },
  },
];
onBeforeRouteLeave(() => !busy.value);
onBeforeRouteUpdate(() => !busy.value);
onMounted(async () => {
  await nextTick();
  form.value?.$el?.querySelector("input,textarea,button")?.focus();
});
onUnmounted(() => {
  if (returnFocus?.isConnected) returnFocus.focus();
  if (props.sensitive) values.value = {};
});
</script>
<template>
  <AModal
    :open="true"
    :title="spec.title"
    :footer="null"
    :closable="false"
    :mask-closable="false"
    :keyboard="!busy"
    :width="820"
    @cancel="cancel"
    class="mutation-modal"
  >
    <div @keydown.capture="popupKeydown" @keydown="finishPopupKeydown">
      <AForm
        ref="form"
        :model="values"
        layout="vertical"
        @finish="submit"
        :disabled="busy"
        :required-mark="false"
      >
        <p>{{ spec.description }}</p>
        <AAlert
          v-if="spec.impact"
          type="warning"
          :message="spec.impact"
          show-icon
        />
        <p v-if="stored && !sensitive" class="muted">
          已恢复此账号的本地草稿；请核对后提交。
        </p>
        <div class="form-grid">
          <template v-for="f in spec.fields" :key="f.key">
            <AForm.Item
              v-if="!f.when || f.when(values)"
              :name="f.key"
              :label="f.label"
              :html-for="'field-' + f.key"
              :rules="rules(f)"
              :class="{
                wide:
                  f.wide ||
                  [
                    'textarea',
                    'definitions',
                    'results',
                    'criteria',
                    'multi',
                    'dispositions',
                  ].includes(f.type ?? ''),
              }"
            >
              <AInput.TextArea
                v-if="f.type === 'textarea'"
                :id="'field-' + f.key"
                v-model:value="values[f.key]"
                :maxlength="f.max ?? 6000"
                :rows="3"
              />
              <ASelect
                v-else-if="f.type === 'select'"
                :id="'field-' + f.key"
                :value="values[f.key]"
                :options="f.optionsFor ? f.optionsFor(values) : f.options"
                :allow-clear="!f.required"
                @update:value="values[f.key] = $event ?? ''"
              />
              <ACheckbox.Group
                v-else-if="f.type === 'multi'"
                :id="'field-' + f.key"
                v-model:value="values[f.key]"
                :options="f.optionsFor ? f.optionsFor(values) : f.options"
              />
              <ACheckbox
                v-else-if="f.type === 'checkbox'"
                :id="'field-' + f.key"
                v-model:checked="values[f.key]"
              />
              <ADatePicker
                v-else-if="f.type === 'date'"
                :id="'field-' + f.key"
                :value="values[f.key] || undefined"
                value-format="YYYY-MM-DD"
                format="YYYY-MM-DD"
                @openChange="datePopupOpen = $event"
                @update:value="values[f.key] = $event ?? ''"
              />
              <div v-else-if="f.type === 'definitions'">
                <div
                  v-for="(row, i) in values[f.key]"
                  :key="i"
                  class="check-row"
                >
                  <div>
                    <AForm.Item
                      label="条目编号"
                      :name="[f.key, i, 'id']"
                      :rules="textRules('条目编号', 128, true)"
                      ><AInput v-model:value="row.id" :maxlength="128"
                    /></AForm.Item>
                    <AForm.Item
                      label="条目说明"
                      :name="[f.key, i, 'text']"
                      :rules="textRules('条目说明', 2000, true)"
                      ><AInput.TextArea
                        v-model:value="row.text"
                        :maxlength="2000"
                    /></AForm.Item>
                    <ACheckbox v-model:checked="row.required"
                      >必需条目</ACheckbox
                    >
                    <AForm.Item
                      v-if="!row.required"
                      label="排除原因"
                      :name="[f.key, i, 'exclusionReason']"
                      :rules="textRules('排除原因', 2000, true)"
                      ><AInput.TextArea
                        v-model:value="row.exclusionReason"
                        :maxlength="2000"
                    /></AForm.Item>
                  </div>
                  <AButton @click="values[f.key].splice(i, 1)"
                    >移除条目</AButton
                  >
                </div>
                <AButton
                  :disabled="busy || values[f.key].length >= CHECK_ENTRY_LIMIT"
                  @click="
                    values[f.key].push({
                      id: newId(),
                      text: '',
                      required: true,
                    })
                  "
                  >添加条目</AButton
                >
              </div>
              <div v-else-if="f.type === 'results' || f.type === 'criteria'">
                <div
                  v-for="(row, i) in values[f.key]"
                  :key="i"
                  class="check-row"
                >
                  <div>
                    <strong>{{ row.text }}</strong
                    ><small class="muted"> · {{ row.checkId ?? row.id }}</small>
                    <AForm.Item
                      label="检查说明"
                      :name="[f.key, i, 'note']"
                      :rules="textRules('检查说明', 4000)"
                      ><AInput.TextArea
                        v-model:value="row.note"
                        :maxlength="4000"
                    /></AForm.Item>
                  </div>
                  <AForm.Item
                    label="条目结果"
                    :html-for="`result-${f.key}-${i}`"
                  >
                    <ASelect
                      v-if="f.type === 'results'"
                      :id="`result-${f.key}-${i}`"
                      v-model:value="row.result"
                      :options="[
                        { value: 'untested', label: '未测' },
                        { value: 'pass', label: '通过' },
                        { value: 'fail', label: '失败' },
                      ]"
                    />
                    <ASelect
                      v-else
                      :id="`result-${f.key}-${i}`"
                      :value="String(row.passed)"
                      :options="[
                        { value: 'false', label: '未通过' },
                        { value: 'true', label: '通过' },
                      ]"
                      @update:value="row.passed = $event === 'true'"
                    />
                  </AForm.Item>
                </div>
              </div>
              <div v-else-if="f.type === 'dispositions'">
                <div
                  v-for="row in values[f.key]"
                  :key="row.taskId"
                  class="check-row"
                >
                  <label :for="`disposition-${row.taskId}`"
                    >{{ row.title }}处置</label
                  ><ASelect
                    :id="`disposition-${row.taskId}`"
                    v-model:value="row.disposition"
                    :options="[
                      { value: 'cancel', label: '同步取消' },
                      { value: 'detach', label: '保留为独立任务' },
                    ]"
                  />
                </div>
              </div>
              <AInput
                v-else
                :id="'field-' + f.key"
                v-model:value="values[f.key]"
                :type="
                  f.type === 'url'
                    ? 'url'
                    : f.type === 'password'
                      ? 'password'
                      : 'text'
                "
                :maxlength="f.max ?? 200"
                :autocomplete="sensitive ? 'off' : undefined"
              />
              <small v-if="f.help" class="muted">{{ f.help }}</small>
            </AForm.Item>
          </template>
        </div>
        <ConflictNotice
          v-if="conflict"
          :current="conflict"
          :original-version="version"
          @adopt="adopt"
        />
        <AAlert
          v-else-if="error"
          type="error"
          role="alert"
          :message="error"
          show-icon
        />
        <ul v-if="reasons.length" class="error">
          <li v-for="r in reasons">
            {{ typeof r === "string" ? r : (r.message ?? r.code ?? r.reason) }}
          </li>
        </ul>
        <div class="form-actions">
          <AButton
            type="primary"
            html-type="submit"
            :disabled="busy || !!conflict"
            :loading="busy"
            >{{
              busy ? "正在提交…" : (spec.submit ?? `确认${spec.title}`)
            }}</AButton
          >
          <AButton :disabled="busy" @click="cancel">{{
            sensitive ? "取消" : "返回并保留草稿"
          }}</AButton>
          <span v-if="!sensitive" class="muted">仅保存本账号普通工作草稿</span>
        </div>
      </AForm>
    </div>
  </AModal>
</template>

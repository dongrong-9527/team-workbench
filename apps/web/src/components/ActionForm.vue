<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import { request, ApiError } from "../api/client";
import { state, zh } from "../state";
import ConflictNotice from "./ConflictNotice.vue";
import type { FormSpec } from "../forms";
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
  form = ref<HTMLFormElement>(),
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
function keydown(e: KeyboardEvent) {
  if (e.key === "Escape" && !busy.value) {
    persist();
    emit("cancel");
  }
  if (e.key === "Tab") {
    const els = Array.from(
      form.value?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input,select,textarea,a[href]",
      ) ?? [],
    );
    const first = els[0],
      last = els.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
}
onMounted(async () => {
  await nextTick();
  form.value
    ?.querySelector<HTMLElement>("input,select,textarea,button")
    ?.focus();
});
onUnmounted(() => {
  if (props.sensitive) values.value = {};
});
</script>
<template>
  <div class="dialog-backdrop">
    <section
      class="dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="spec.title"
    >
      <form ref="form" @submit.prevent="submit" @keydown="keydown">
        <h2>{{ spec.title }}</h2>
        <p>{{ spec.description }}</p>
        <p v-if="spec.impact" class="danger-note">{{ spec.impact }}</p>
        <p v-if="stored && !sensitive" class="muted">
          已恢复此账号的本地草稿；请核对后提交。
        </p>
        <div class="form-grid">
          <template v-for="f in spec.fields" :key="f.key"
            ><div
              v-if="!f.when || f.when(values)"
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
              <label :for="'field-' + f.key">{{ f.label }}</label
              ><textarea
                :id="'field-' + f.key"
                v-if="f.type === 'textarea'"
                v-model="values[f.key]"
                :required="f.required"
                :maxlength="f.max ?? 6000"
              /><select
                :id="'field-' + f.key"
                v-else-if="f.type === 'select'"
                v-model="values[f.key]"
                :required="f.required"
              >
                <option v-if="!f.required" value="">未选择</option>
                <option
                  v-for="op in f.optionsFor ? f.optionsFor(values) : f.options"
                  :value="op.value"
                >
                  {{ op.label }}
                </option></select
              ><span v-else-if="f.type === 'multi'" class="chips"
                ><label
                  v-for="op in f.optionsFor ? f.optionsFor(values) : f.options"
                  ><input
                    type="checkbox"
                    v-model="values[f.key]"
                    :value="op.value"
                  />{{ op.label }}</label
                ></span
              ><input
                :id="'field-' + f.key"
                v-else-if="f.type === 'checkbox'"
                type="checkbox"
                v-model="values[f.key]"
                :required="f.required"
              />
              <div v-else-if="f.type === 'definitions'">
                <div v-for="(row, i) in values[f.key]" class="check-row">
                  <div>
                    <label
                      >条目编号<input
                        v-model="row.id"
                        required
                        maxlength="128" /></label
                    ><label
                      >条目说明<input
                        v-model="row.text"
                        required
                        maxlength="2000" /></label
                    ><label
                      ><input
                        v-model="row.required"
                        type="checkbox"
                      />必需条目</label
                    ><label v-if="!row.required"
                      >排除原因<input
                        v-model="row.exclusionReason"
                        required
                        maxlength="2000"
                    /></label>
                  </div>
                  <button type="button" @click="values[f.key].splice(i, 1)">
                    移除条目
                  </button>
                </div>
                <button
                  type="button"
                  @click="
                    values[f.key].push({
                      id: newId(),
                      text: '',
                      required: true,
                    })
                  "
                >
                  添加条目
                </button>
              </div>
              <div v-else-if="f.type === 'results' || f.type === 'criteria'">
                <div v-for="row in values[f.key]" class="check-row">
                  <div>
                    <strong>{{ row.text }}</strong
                    ><small class="muted"> · {{ row.checkId ?? row.id }}</small
                    ><label
                      >检查说明<input v-model="row.note" maxlength="4000"
                    /></label>
                  </div>
                  <label
                    >条目结果<select
                      aria-label="条目结果"
                      v-if="f.type === 'results'"
                      v-model="row.result"
                    >
                      <option value="untested">未测</option>
                      <option value="pass">通过</option>
                      <option value="fail">失败</option></select
                    ><select aria-label="条目结果" v-else v-model="row.passed">
                      <option :value="false">未通过</option>
                      <option :value="true">通过</option>
                    </select></label
                  >
                </div>
              </div>
              <div v-else-if="f.type === 'dispositions'">
                <div v-for="row in values[f.key]" class="check-row">
                  <span>{{ row.title }}</span
                  ><select v-model="row.disposition">
                    <option value="cancel">同步取消</option>
                    <option value="detach">保留为独立任务</option>
                  </select>
                </div>
              </div>
              <input
                :id="'field-' + f.key"
                v-else
                v-model="values[f.key]"
                :type="f.type ?? 'text'"
                :required="f.required"
                :maxlength="f.max ?? 200"
                :autocomplete="sensitive ? 'off' : undefined"
              /><small v-if="f.help" class="muted">{{ f.help }}</small>
            </div></template
          >
        </div>
        <ConflictNotice
          v-if="conflict"
          :current="conflict"
          :original-version="version"
          @adopt="adopt"
        />
        <p v-else-if="error" class="error" role="alert">{{ error }}</p>
        <ul v-if="reasons.length" class="error">
          <li v-for="r in reasons">
            {{ typeof r === "string" ? r : (r.message ?? r.code ?? r.reason) }}
          </li>
        </ul>
        <div class="form-actions">
          <button class="primary" :disabled="busy || !!conflict">
            {{
              busy ? "正在提交…" : (spec.submit ?? `确认${spec.title}`)
            }}</button
          ><button
            type="button"
            :disabled="busy"
            @click="
              persist();
              emit('cancel');
            "
          >
            {{ sensitive ? "取消" : "返回并保留草稿" }}</button
          ><span v-if="!sensitive" class="muted">仅保存本账号普通工作草稿</span>
        </div>
      </form>
    </section>
  </div>
</template>

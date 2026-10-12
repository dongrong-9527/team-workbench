<script setup lang="ts">
import { ref, watch, computed, nextTick } from "vue";
import { state, today, nameOf } from "../state";
import { request, command, ApiError } from "../api/client";
import {
  REPORT_TEXT_LIMITS,
  type ReportVersion,
  type SeqPage,
  type ReportSourceChanges,
} from "../../../../packages/contracts/src/index";
import SourceList from "../components/SourceList.vue";
import ConflictNotice from "../components/ConflictNotice.vue";
const actor = state.member!.id,
  key = `workbench:reports:${actor}`;
let saved: any;
try {
  saved = JSON.parse(localStorage.getItem(key) ?? "null");
} catch {}
const date = ref(saved?.date ?? today()),
  timeZone = ref(saved?.timeZone ?? "Asia/Shanghai"),
  memberIds = ref<string[]>(saved?.memberIds ?? [actor]),
  projectIds = ref<string[]>(
    saved?.projectIds ??
      (state.projectId ? [state.projectId] : state.projects.map((p) => p.id)),
  ),
  current = ref<ReportVersion>(),
  editor = ref(saved?.editor ?? ""),
  history = ref<ReportVersion[]>([]),
  versions = ref<ReportVersion[]>([]),
  sourceChanges = ref<ReportSourceChanges>(),
  error = ref(""),
  notice = ref(""),
  busy = ref(false),
  manualCopy = ref(false),
  tab = ref("editor"),
  conflict = ref<Record<string, unknown>>(),
  confirmRegenerate = ref(false),
  regenerateIntent = ref(true),
  textarea = ref<HTMLTextAreaElement>();
const cmd = command(key + ":command");
const dirty = computed(
    () => !!current.value && editor.value !== current.value.text,
  ),
  mine = computed(() => current.value?.creatorId === actor);
function closeCurrent() {
  if (
    dirty.value &&
    !window.confirm("未保存内容将保留在本地副本，返回全部日报？")
  )
    return;
  if (dirty.value)
    localStorage.setItem(`${key}:previous:${current.value!.id}`, editor.value);
  current.value = undefined;
  editor.value = "";
  saved = null;
  localStorage.removeItem(key);
}
function persist() {
  localStorage.setItem(
    key,
    JSON.stringify({
      date: date.value,
      timeZone: timeZone.value,
      memberIds: memberIds.value,
      projectIds: projectIds.value,
      id: current.value?.id ?? saved?.id,
      editor: editor.value,
    }),
  );
}
watch([date, timeZone, memberIds, projectIds, editor], persist, { deep: true });
async function seqAll<T>(path: string) {
  let items: T[] = [],
    after = 0,
    cutoff: number | undefined;
  do {
    const p: SeqPage<T> = await request(
      path +
        `?limit=100&afterSeq=${after}` +
        (cutoff === undefined ? "" : `&cutoffSeq=${cutoff}`),
    );
    items.push(...p.items);
    cutoff = p.cutoffSeq;
    if (p.nextAfterSeq === null) return items;
    after = p.nextAfterSeq;
  } while (true);
}
async function list() {
  history.value = await seqAll<ReportVersion>("/api/reports");
}
async function select(r: ReportVersion, retain = false) {
  if (
    !retain &&
    dirty.value &&
    !window.confirm("此日报有未保存修改。切换前将保留本地副本，继续切换？")
  )
    return;
  if (dirty.value)
    localStorage.setItem(`${key}:previous:${current.value!.id}`, editor.value);
  current.value = r;
  if (!retain) editor.value = r.text;
  date.value = r.input.date;
  timeZone.value = r.input.timeZone;
  memberIds.value = [...r.input.memberIds];
  projectIds.value = [...r.input.projectIds];
  versions.value = await seqAll<ReportVersion>(`/api/reports/${r.id}/versions`);
  sourceChanges.value = await request(`/api/reports/${r.id}/source-changes`);
  persist();
}
async function init() {
  try {
    await list();
    if (saved?.id) {
      const r = await request<ReportVersion>("/api/reports/" + saved.id);
      await select(r, true);
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}
void init();
function fail(e: unknown) {
  error.value = (e as Error).message;
  if (e instanceof ApiError && e.current) conflict.value = e.current;
}
async function generate(regenerate = false) {
  if (busy.value) return;
  if (
    (dirty.value || (regenerate && current.value?.edited)) &&
    !confirmRegenerate.value
  ) {
    regenerateIntent.value = regenerate;
    confirmRegenerate.value = true;
    return;
  }
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const selection = {
      date: date.value,
      timeZone: timeZone.value,
      memberIds: [...memberIds.value],
      projectIds: [...projectIds.value],
    };
    if (dirty.value) {
      const original = await cmd.send<ReportVersion>(
        `/api/reports/${current.value!.id}/versions`,
        { text: editor.value, expectedVersion: current.value!.version },
      );
      await select(original, true);
      editor.value = original.text;
    }
    const c = current.value;
    const input = regenerate
      ? { ...c!.input, previousReportId: c!.id, expectedVersion: c!.version }
      : selection;
    const r = await cmd.send<ReportVersion>("/api/reports", input);
    editor.value = r.text;
    await select(r, true);
    await list();
    notice.value = regenerate
      ? "已生成新版本，旧稿仍在版本历史中。"
      : "日报草稿已生成，请核对来源。";
    confirmRegenerate.value = false;
  } catch (e) {
    confirmRegenerate.value = false;
    fail(e);
  } finally {
    busy.value = false;
  }
}
async function save() {
  busy.value = true;
  error.value = "";
  try {
    const r = await cmd.send<ReportVersion>(
      `/api/reports/${current.value!.id}/versions`,
      { text: editor.value, expectedVersion: current.value!.version },
    );
    await select(r, true);
    editor.value = r.text;
    await list();
    notice.value = "已保存新的稿件版本";
  } catch (e) {
    fail(e);
  } finally {
    busy.value = false;
  }
}
async function copy() {
  notice.value = "";
  try {
    await navigator.clipboard.writeText(editor.value);
    notice.value = "已复制";
    manualCopy.value = false;
  } catch {
    manualCopy.value = true;
    notice.value = "浏览器未允许复制，文本已保留。请选中文本后手动复制。";
    await nextTick();
    textarea.value?.focus();
    textarea.value?.select();
  }
}
async function latest() {
  try {
    const r = await request<ReportVersion>(
      "/api/reports/" + String(conflict.value?.id),
    );
    await select(r, true);
    conflict.value = undefined;
    error.value = "已切换到最新版本，保留你的文本。请核对后主动保存。";
  } catch (e) {
    fail(e);
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">有来源的汇总 · 人工核对</span>
      <h1>日报工作区</h1>
      <p>选择成员与项目，生成可追溯的纯文本草稿。</p>
    </div>
    <span class="badge">{{ timeZone }}</span>
  </div>
  <section class="panel panel-body">
    <div class="form-grid">
      <label>报告日期<input v-model="date" type="date" required /></label
      ><label>时区<input v-model="timeZone" required /></label>
      <div class="wide">
        <h3>成员范围</h3>
        <div class="chips">
          <label v-for="m in state.members"
            ><input type="checkbox" :value="m.id" v-model="memberIds" />{{
              m.displayName
            }}{{ m.active ? "" : "（已停用）" }}</label
          >
        </div>
      </div>
      <div class="wide">
        <h3>项目范围</h3>
        <div class="chips">
          <label v-for="p in state.projects"
            ><input type="checkbox" :value="p.id" v-model="projectIds" />{{
              p.name
            }}{{ p.archived ? "（归档）" : "" }}</label
          >
        </div>
      </div>
    </div>
    <div class="form-actions">
      <button
        class="primary"
        :disabled="busy || !memberIds.length || !projectIds.length"
        @click="generate(false)"
      >
        生成新日报</button
      ><small class="muted"
        >空缺保持“未填写”；生成稿上限
        {{ REPORT_TEXT_LIMITS.generated.toLocaleString() }}
        字符单位，人工编辑另保留 10,000。</small
      >
    </div>
  </section>
  <p v-if="error" class="error" role="alert">
    {{ error
    }}<span v-if="error.includes('422') || error.includes('fewer')"
      >请缩小成员或项目范围后重新生成，已填写文本不会被清空。</span
    >
  </p>
  <ConflictNotice
    v-if="conflict"
    :current="conflict"
    :original-version="current?.version"
    @adopt="latest"
  />
  <p v-if="notice" class="success" role="status">{{ notice }}</p>
  <div class="detail-layout">
    <section class="panel panel-body">
      <template v-if="current"
        ><div class="section-heading" style="padding: 0 0 20px">
          <div>
            <h2>
              {{ current.input.date }} 日报
              <span class="badge"
                >V{{ current.version }} ·
                {{ current.edited ? "人工编辑" : "生成稿" }}</span
              >
            </h2>
            <p>
              创建人 {{ nameOf(current.creatorId) }} · {{ current.createdAt }}
            </p>
          </div>
        </div>
        <p class="revision">
          来源截止 #{{ current.sourceCutoffSeq }} · 状态截止
          {{ current.stateCutoff.time }} · 生成于 {{ current.generatedAt }}
        </p>
        <div class="chips">
          <span class="badge">完成任务 {{ current.counts.tasksDone }}</span
          ><span class="badge">关闭 Bug {{ current.counts.bugsClosed }}</span
          ><span class="badge"
            >验收需求 {{ current.counts.requirementsAccepted }}</span
          >
        </div>
        <p v-if="sourceChanges?.changed" class="danger-note">
          有更新可重新生成。旧稿与来源快照保留不变。
        </p>
        <div class="tabs" style="margin-top: 20px">
          <button @click="tab = 'editor'">稿件编辑</button
          ><button @click="tab = 'sources'">
            查看来源（{{ current.sources.length }}）
          </button>
        </div>
        <template v-if="tab === 'editor'"
          ><label
            >日报文本<textarea
              ref="textarea"
              v-model="editor"
              class="report-editor"
              :readonly="!mine || busy"
              :maxlength="REPORT_TEXT_LIMITS.edited"
            />
          </label>
          <div class="editor-count">
            {{ editor.length.toLocaleString() }} /
            {{ REPORT_TEXT_LIMITS.edited.toLocaleString() }} 字符单位（UTF-16）
          </div>
          <div class="form-actions">
            <button
              v-if="mine"
              class="primary"
              :disabled="busy || !dirty"
              @click="save"
            >
              保存稿件版本</button
            ><button :disabled="busy" @click="copy">复制纯文本</button
            ><button v-if="mine" :disabled="busy" @click="generate(true)">
              重新生成
            </button>
          </div>
          <button
            v-if="manualCopy"
            @click="
              textarea?.focus();
              textarea?.select();
            "
          >
            全选文本，手动复制
          </button>
          <p v-if="!mine" class="muted">
            仅创建人可编辑和重生成此稿件。
          </p></template
        ><SourceList v-else :id="current.id"
      /></template>
      <div v-else class="empty">
        <h2>把今天的协作汇总成一份草稿</h2>
        <p>选择报告范围后开始生成。已有日报可从右侧打开。</p>
      </div>
    </section>
    <aside>
      <section class="panel panel-body">
        <h2>{{ current ? "本日报版本" : "已保存日报" }}</h2>
        <ul class="history">
          <li v-for="r in (current ? versions : history).slice().reverse()">
            <button @click="select(r)">
              {{ r.input.date }} · V{{ r.version }}
              {{ r.edited ? "人工编辑" : "生成稿" }}</button
            ><time>{{ r.createdAt }}</time
            ><span>{{ nameOf(r.creatorId) }}</span>
          </li>
        </ul>
        <button v-if="current" @click="closeCurrent()">返回全部日报</button>
        <p v-if="!history.length" class="muted">暂无已保存日报</p>
      </section>
      <div class="hint-card">
        <div>
          <strong>核对后再分享</strong>
          <p>复制仅写入剪贴板。稿件的手工改动不改变任何人的原始工作记录。</p>
        </div>
      </div>
    </aside>
  </div>
  <div v-if="confirmRegenerate" class="dialog-backdrop">
    <section
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="确认重新生成"
    >
      <h2>保留旧稿，再生成新版本</h2>
      <p>
        当前稿件包含人工修改。继续后先保存这份修改稿，再依据最新来源创建新版本。所有历史版本保持可读。
      </p>
      <button
        class="primary"
        :disabled="busy"
        @click="generate(regenerateIntent)"
      >
        保留旧稿并重新生成</button
      ><button :disabled="busy" @click="confirmRegenerate = false">
        返回编辑
      </button>
    </section>
  </div>
</template>

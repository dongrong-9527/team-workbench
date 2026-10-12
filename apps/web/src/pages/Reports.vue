<script setup lang="ts">
import { ref, watch, computed, nextTick, onBeforeUnmount } from "vue";
import { state, today, nameOf } from "../state";
import { request, command, ApiError, allSeqPages } from "../api/client";
import { useReadScope } from "../composables/readScope";
import {
  REPORT_TEXT_LIMITS,
  type ReportVersion,
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
let alive = true;
onBeforeUnmount(() => {
  alive = false;
});
const date = ref(saved?.date ?? today()),
  timeZone = ref(saved?.timeZone ?? "Asia/Shanghai"),
  memberIds = ref<string[]>(saved?.memberIds ?? [actor]),
  projectIds = ref<string[]>(
    saved?.projectIds ??
      (state.projectId ? [state.projectId] : state.projects.map((p) => p.id)),
  ),
  current = ref<ReportVersion>(),
  editor = ref(""),
  expectedVersion = ref<number>(),
  history = ref<ReportVersion[]>([]),
  versions = ref<ReportVersion[]>([]),
  sourceChanges = ref<ReportSourceChanges>(),
  error = ref(""),
  metadataError = ref(""),
  notice = ref(""),
  busy = ref(false),
  manualCopy = ref(false),
  tab = ref("editor"),
  conflict = ref<Record<string, unknown>>(),
  confirmRegenerate = ref(false),
  regenerateIntent = ref(true),
  textarea = ref<HTMLTextAreaElement>();
interface LocalDraft {
  id: string;
  text: string;
  expectedVersion: number;
}
const recoverable = ref<LocalDraft[]>([]),
  draftId = ref<string>(crypto.randomUUID());
const generateCommand = command(key + ":generate-command");
const dirty = computed(
    () => !!current.value && editor.value !== current.value.text,
  ),
  mine = computed(() => current.value?.creatorId === actor);
const metadataReads = useReadScope(() => current.value?.id ?? ""),
  listReads = useReadScope(() => actor);
const draftPrefix = (r: ReportVersion) => `${key}:draft:${r.id}:${r.version}`;
const draftKey = (r: ReportVersion, id = draftId.value) =>
  `${draftPrefix(r)}:${id}`;
function persist() {
  localStorage.setItem(
    key,
    JSON.stringify({
      date: date.value,
      timeZone: timeZone.value,
      memberIds: memberIds.value,
      projectIds: projectIds.value,
      id: current.value?.id,
    }),
  );
}
watch([date, timeZone, memberIds, projectIds], persist, { deep: true });
function persistDraft() {
  const r = current.value;
  if (!r || !mine.value || recoverable.value.length) return;
  if (dirty.value)
    localStorage.setItem(
      draftKey(r),
      JSON.stringify({
        id: draftId.value,
        text: editor.value,
        expectedVersion: expectedVersion.value,
      }),
    );
  else localStorage.removeItem(draftKey(r));
}
function readDrafts(r: ReportVersion): LocalDraft[] {
  try {
    const legacy = JSON.parse(localStorage.getItem(draftPrefix(r)) ?? "null");
    const previous = localStorage.getItem(`${key}:previous:${r.id}`);
    const old =
      legacy?.text ??
      previous ??
      (saved?.id === r.id ? saved.editor : undefined);
    if (typeof old === "string" && old !== r.text) {
      const id = crypto.randomUUID();
      localStorage.setItem(
        draftKey(r, id),
        JSON.stringify({
          id,
          text: old,
          expectedVersion: legacy?.expectedVersion ?? r.version,
        }),
      );
      localStorage.removeItem(draftPrefix(r));
      localStorage.removeItem(`${key}:previous:${r.id}`);
      if (saved?.id === r.id) delete saved.editor;
    }
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(draftPrefix(r) + ":"))
      .flatMap((k) => {
        try {
          const draft = JSON.parse(localStorage.getItem(k) ?? "null");
          return draft &&
            typeof draft.id === "string" &&
            typeof draft.text === "string" &&
            Number.isSafeInteger(draft.expectedVersion)
            ? [draft]
            : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
function restoreDraft(draft: LocalDraft) {
  editor.value = draft.text;
  expectedVersion.value = draft.expectedVersion;
  draftId.value = draft.id;
  recoverable.value = [];
  notice.value = "已恢复本地草稿，请核对原版本后主动保存。";
}
function discardDraft(draft: LocalDraft) {
  if (current.value) localStorage.removeItem(draftKey(current.value, draft.id));
  recoverable.value = recoverable.value.filter((d) => d.id !== draft.id);
  notice.value = "已丢弃这一份本地草稿，保存的历史稿件未变。";
}
function closeCurrent() {
  if (
    dirty.value &&
    !window.confirm("未保存内容将保留在本地副本，返回全部日报？")
  )
    return;
  persistDraft();
  metadataReads.invalidate();
  current.value = undefined;
  editor.value = "";
  recoverable.value = [];
  versions.value = [];
  sourceChanges.value = undefined;
  metadataError.value = "";
  saved = null;
  persist();
}
function adopt(r: ReportVersion, retain = false, offerDraft = true) {
  const text = editor.value;
  current.value = r;
  editor.value = retain ? text : r.text;
  expectedVersion.value = r.version;
  draftId.value = crypto.randomUUID();
  recoverable.value = offerDraft && r.creatorId === actor ? readDrafts(r) : [];
  conflict.value = undefined;
  date.value = r.input.date;
  timeZone.value = r.input.timeZone;
  memberIds.value = [...r.input.memberIds];
  projectIds.value = [...r.input.projectIds];
  persist();
}
async function list() {
  const read = listReads.begin();
  if (!read) return;
  try {
    const rows = await allSeqPages<ReportVersion>("/api/reports", read.valid);
    read.commit(() => {
      history.value = rows;
    });
  } catch (e) {
    if (read.valid()) metadataError.value = (e as Error).message;
  } finally {
    read.finish(() => {});
  }
}
async function loadMetadata() {
  const r = current.value,
    read = metadataReads.begin();
  if (!r || !read) return;
  metadataError.value = "";
  versions.value = [];
  sourceChanges.value = undefined;
  try {
    const [rows, changes] = await Promise.all([
      allSeqPages<ReportVersion>(`/api/reports/${r.id}/versions`, read.valid),
      request<ReportSourceChanges>(`/api/reports/${r.id}/source-changes`),
    ]);
    read.commit(() => {
      versions.value = rows;
      sourceChanges.value = changes;
    });
  } catch (e) {
    if (read.valid()) metadataError.value = (e as Error).message;
  } finally {
    read.finish(() => {});
  }
}
async function select(r: ReportVersion) {
  if (busy.value) return;
  if (
    dirty.value &&
    !window.confirm("此日报有未保存修改。切换前将保留本地副本，继续切换？")
  )
    return;
  persistDraft();
  adopt(r);
  await loadMetadata();
}
async function init() {
  await list();
  if (alive && !current.value && saved?.id) {
    const id = saved.id;
    try {
      const r = await request<ReportVersion>("/api/reports/" + id);
      if (alive && !current.value) {
        adopt(r);
        await loadMetadata();
      }
    } catch (e) {
      if (alive) fail(e);
    }
  }
}
void init();
function fail(e: unknown) {
  error.value = (e as Error).message;
  if (e instanceof ApiError && e.current) conflict.value = e.current;
}
async function saveMutation() {
  const base = current.value!,
    savingDraftId = draftId.value;
  const saveCommand = command(`${key}:save-command:${savingDraftId}`);
  const r = await saveCommand.send<ReportVersion>(
    `/api/reports/${base.id}/versions`,
    { text: editor.value, expectedVersion: expectedVersion.value },
  );
  // An acknowledged mutation is complete even if a later metadata read fails.
  localStorage.removeItem(draftKey(base, savingDraftId));
  saveCommand.reset();
  if (alive) adopt(r, false, false);
  return r;
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
    if (dirty.value) await saveMutation();
    if (!alive) return;
    const c = current.value;
    const input = regenerate
      ? {
          ...c!.input,
          previousReportId: c!.id,
          expectedVersion: expectedVersion.value,
        }
      : selection;
    const r = await generateCommand.send<ReportVersion>("/api/reports", input);
    generateCommand.reset();
    if (!alive) return;
    adopt(r, false, false);
    notice.value = regenerate
      ? "已生成新版本，旧稿仍在版本历史中。"
      : "日报草稿已生成，请核对来源。";
    await Promise.all([loadMetadata(), list()]);
  } catch (e) {
    if (alive) fail(e);
  } finally {
    if (alive) {
      confirmRegenerate.value = false;
      busy.value = false;
    }
  }
}
async function save() {
  if (busy.value || !current.value) return;
  busy.value = true;
  error.value = "";
  try {
    await saveMutation();
    if (alive) {
      notice.value = "已保存新的稿件版本";
      await Promise.all([loadMetadata(), list()]);
    }
  } catch (e) {
    if (alive) fail(e);
  } finally {
    if (alive) busy.value = false;
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
    if (!alive) return;
    persistDraft();
    adopt(r, true, false);
    persistDraft();
    error.value = "已切换到最新版本，保留你的文本。请核对后主动保存。";
    await loadMetadata();
  } catch (e) {
    if (alive) fail(e);
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
    :original-version="expectedVersion"
    @adopt="latest"
  />
  <p v-if="metadataError" class="error" role="alert">
    稿件内容已保留，附加信息读取失败：{{ metadataError }}
    <button
      :disabled="busy"
      @click="
        loadMetadata();
        list();
      "
    >
      重试读取日报信息
    </button>
  </p>
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
        <section
          v-if="recoverable.length"
          class="panel panel-body"
          aria-label="本地草稿恢复"
        >
          <h3>发现本版本的本地草稿</h3>
          <article v-for="draft in recoverable" :key="draft.id">
            <p>
              原并发版本
              {{
                draft.expectedVersion
              }}。恢复后仍需主动保存，历史稿件不会自动改变。
            </p>
            <p class="body-text">{{ draft.text.slice(0, 160) }}</p>
            <button @click="restoreDraft(draft)">恢复本地草稿</button
            ><button @click="discardDraft(draft)">丢弃本地草稿</button>
          </article>
        </section>
        <template v-if="tab === 'editor'"
          ><label
            >日报文本<textarea
              ref="textarea"
              v-model="editor"
              @input="persistDraft"
              class="report-editor"
              :readonly="!mine || busy || recoverable.length > 0"
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
            <button :disabled="busy" @click="select(r)" :data-report-id="r.id">
              {{ r.input.date }} · V{{ r.version }}
              {{ r.edited ? "人工编辑" : "生成稿" }}</button
            ><time>{{ r.createdAt }}</time
            ><span>{{ nameOf(r.creatorId) }}</span>
          </li>
        </ul>
        <button v-if="current" :disabled="busy" @click="closeCurrent()">
          返回全部日报
        </button>
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

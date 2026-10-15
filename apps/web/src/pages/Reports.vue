<script setup lang="ts">
import ATag from "ant-design-vue/es/tag";
import ADatePicker from "ant-design-vue/es/date-picker";
import AInput, { Textarea as ATextarea } from "ant-design-vue/es/input";
import ASelect from "ant-design-vue/es/select";
import {
  HistoryOutlined,
  ReloadOutlined,
  CopyOutlined,
  FileTextOutlined,
} from "@ant-design/icons-vue";
import AModal from "ant-design-vue/es/modal";
import AButton from "ant-design-vue/es/button";
import AAlert from "ant-design-vue/es/alert";
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
  copying = ref(false),
  manualCopy = ref(false),
  sourcePanel = ref<HTMLElement>(),
  conflict = ref<Record<string, unknown>>(),
  confirmRegenerate = ref(false),
  regenerateIntent = ref(true),
  textarea = ref<{
    focus: () => void;
    resizableTextArea: { textArea: HTMLTextAreaElement };
  }>();
const navigation = ref<{ message: string; action: () => void }>();
const navigationCancel = ref<{ focus: () => void }>();
const regenerateCancel = ref<{ focus: () => void }>();
let confirmationTrigger: HTMLElement | undefined;
let nextConfirmationTrigger: HTMLElement | undefined;
watch(
  () => !!navigation.value || confirmRegenerate.value,
  async (open) => {
    if (open)
      confirmationTrigger =
        nextConfirmationTrigger ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined);
    nextConfirmationTrigger = undefined;
    await nextTick();
    if (!alive) return;
    if (open)
      (navigation.value
        ? navigationCancel.value
        : regenerateCancel.value
      )?.focus();
    else if (confirmationTrigger?.isConnected) confirmationTrigger.focus();
  },
);
function confirmNavigation() {
  const action = navigation.value?.action;
  navigation.value = undefined;
  if (alive && !busy.value) action?.();
}
function selectText() {
  textarea.value?.focus();
  textarea.value?.resizableTextArea.textArea.select();
}
type ReportDialog =
  | { kind: "copy"; id: string; text: string }
  | { kind: "history"; id?: string }
  | { kind: "sources"; id: string };
const reportDialog = ref<ReportDialog>(),
  dialogBusy = ref(false),
  dialogError = ref(""),
  dialogVersions = ref<ReportVersion[]>([]),
  dialogChanges = ref<ReportSourceChanges>(),
  dialogCancel = ref<{ focus: () => void }>(),
  manualTextarea = ref<{
    focus: () => void;
    resizableTextArea: { textArea: HTMLTextAreaElement };
  }>();
let reportDialogTrigger: HTMLElement | undefined;
let copyGeneration = 0;
const dialogReads = useReadScope(
  () =>
    `${state.member?.id}:${current.value?.id ?? ""}:${reportDialog.value?.kind ?? ""}:${reportDialog.value?.id ?? ""}`,
);
const reportDialogTitle = computed(() => {
  if (reportDialog.value?.kind === "copy") return "复制失败";
  if (reportDialog.value?.kind === "history") return "日报历史版本";
  return dialogChanges.value?.changed ? "来源记录有更新" : "来源更新核对";
});
function restoreReportDialogFocus() {
  if (
    alive &&
    state.member?.id === actor &&
    !reportDialog.value &&
    !navigation.value &&
    !confirmRegenerate.value &&
    reportDialogTrigger?.isConnected
  )
    reportDialogTrigger.focus();
}
function closeReportDialog() {
  if (busy.value) return;
  dialogReads.invalidate();
  reportDialog.value = undefined;
  dialogBusy.value = false;
  dialogError.value = "";
}
function resetReportPresentation() {
  copyGeneration++;
  copying.value = false;
  manualCopy.value = false;
  dialogReads.invalidate();
  reportDialog.value = undefined;
  dialogBusy.value = false;
  dialogError.value = "";
  dialogChanges.value = undefined;
  dialogVersions.value = [];
}
async function loadReportDialog() {
  const dialog = reportDialog.value;
  if (!alive || state.member?.id !== actor || !dialog || dialog.kind === "copy")
    return;
  const read = dialogReads.begin();
  if (!read) return;
  dialogBusy.value = true;
  dialogError.value = "";
  try {
    if (dialog.kind === "history") {
      const rows = await allSeqPages<ReportVersion>(
        dialog.id ? `/api/reports/${dialog.id}/versions` : "/api/reports",
        read.valid,
      );
      read.commit(() => {
        dialogVersions.value = rows;
      });
    } else {
      const changes = await request<ReportSourceChanges>(
        `/api/reports/${dialog.id}/source-changes`,
      );
      read.commit(() => {
        dialogChanges.value = changes;
        sourceChanges.value = changes;
      });
    }
  } catch (e) {
    if (read.valid()) dialogError.value = (e as Error).message;
  } finally {
    read.finish(() => {
      dialogBusy.value = false;
    });
  }
}
function openReportDialog(dialog: ReportDialog, trigger?: HTMLElement) {
  if (
    !alive ||
    busy.value ||
    state.member?.id !== actor ||
    navigation.value ||
    confirmRegenerate.value
  )
    return;
  if (dialog.kind !== "copy") {
    copyGeneration++;
    copying.value = false;
  }
  reportDialogTrigger =
    trigger ??
    (document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined);
  dialogChanges.value = undefined;
  dialogVersions.value = [];
  dialogError.value = "";
  reportDialog.value = dialog;
  void loadReportDialog();
}
watch(reportDialog, async (dialog) => {
  if (!dialog) return;
  await nextTick();
  if (!alive || reportDialog.value !== dialog) return;
  if (dialog.kind === "copy") {
    manualTextarea.value?.focus();
    manualTextarea.value?.resizableTextArea.textArea.select();
  } else dialogCancel.value?.focus();
});
async function selectHistoryVersion(r: ReportVersion) {
  if (
    !alive ||
    state.member?.id !== actor ||
    busy.value ||
    dialogBusy.value ||
    reportDialog.value?.kind !== "history"
  )
    return;
  if (dirty.value) nextConfirmationTrigger = reportDialogTrigger;
  closeReportDialog();
  await select(r);
}
async function regenerateFromSources() {
  if (
    !alive ||
    state.member?.id !== actor ||
    busy.value ||
    dialogBusy.value ||
    !current.value ||
    !mine.value ||
    reportDialog.value?.kind !== "sources" ||
    reportDialog.value.id !== current.value.id
  )
    return;
  if (dirty.value || current.value.edited)
    nextConfirmationTrigger = reportDialogTrigger;
  closeReportDialog();
  await generate(true);
}
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
function closeCurrent(confirmed = false) {
  if (!alive || busy.value) return;
  if (dirty.value && !confirmed) {
    navigation.value = {
      message: "未保存内容将保留在本地副本，返回全部日报？",
      action: () => closeCurrent(true),
    };
    return;
  }
  persistDraft();
  resetReportPresentation();
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
  resetReportPresentation();
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
async function select(r: ReportVersion, confirmed = false) {
  if (!alive || busy.value) return;
  if (dirty.value && !confirmed) {
    navigation.value = {
      message: "此日报有未保存修改。切换前将保留本地副本，继续切换？",
      action: () => {
        void select(r, true);
      },
    };
    return;
  }
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
function validateEditor() {
  // Ant TextArea maxlength counts codepoints; the report API counts UTF-16 units.
  // Keep oversized restored/pasted drafts intact and block their mutation locally.
  if (editor.value.length > REPORT_TEXT_LIMITS.edited) {
    error.value = `日报文本最多 ${REPORT_TEXT_LIMITS.edited} 个字符单位（UTF-16）`;
    return false;
  }
  return true;
}
async function generate(regenerate = false) {
  if (busy.value || (!regenerate && !date.value)) return;
  if (dirty.value && !validateEditor()) return;
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
  if (busy.value || !current.value || !validateEditor()) return;
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
  if (
    !alive ||
    state.member?.id !== actor ||
    copying.value ||
    busy.value ||
    !current.value
  )
    return;
  const id = current.value.id,
    text = editor.value,
    generation = ++copyGeneration;
  const trigger =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  const valid = () =>
    alive &&
    state.member?.id === actor &&
    current.value?.id === id &&
    generation === copyGeneration;
  copying.value = true;
  notice.value = "";
  try {
    await navigator.clipboard.writeText(text);
    if (!valid()) return;
    notice.value = "已复制";
    manualCopy.value = false;
  } catch {
    if (!valid()) return;
    manualCopy.value = true;
    notice.value = "浏览器未允许复制，文本已保留。请选中文本后手动复制。";
    await nextTick();
    if (!valid()) return;
    selectText();
    openReportDialog({ kind: "copy", id, text }, trigger);
  } finally {
    if (valid()) copying.value = false;
  }
}
async function latest() {
  if (busy.value || !conflict.value) return;
  busy.value = true;
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
  } finally {
    if (alive) busy.value = false;
  }
}
</script>
<template>
  <div class="reports-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">DAILY REPORT</span>
        <h1>微信日报</h1>
        <p>从实际记录生成草稿，核对来源后复制到微信。</p>
      </div>
      <AButton
        :disabled="busy"
        @click="openReportDialog({ kind: 'history', id: current?.id })"
        ><HistoryOutlined aria-hidden="true" />历史版本</AButton
      >
    </div>
    <section class="panel report-filters" aria-label="日报生成范围">
      <div class="report-filter date-filter">
        <label for="report-date">报告日期</label
        ><ADatePicker
          id="report-date"
          :value="date || undefined"
          @update:value="date = typeof $event === 'string' ? $event : ''"
          value-format="YYYY-MM-DD"
          format="YYYY-MM-DD"
          :disabled="busy"
        />
      </div>
      <div class="report-filter member-filter">
        <label for="report-members">成员范围</label>
        <ASelect
          id="report-members"
          v-model:value="memberIds"
          mode="multiple"
          :disabled="busy"
          :max-tag-count="1"
          :max-tag-text-length="12"
          placeholder="选择成员"
          :options="
            state.members.map((m) => ({
              value: m.id,
              label: m.displayName + (m.active ? '' : '（已停用）'),
            }))
          "
        />
      </div>
      <div class="report-filter project-filter">
        <label for="report-projects">项目范围</label>
        <ASelect
          id="report-projects"
          v-model:value="projectIds"
          mode="multiple"
          :disabled="busy"
          :max-tag-count="1"
          :max-tag-text-length="12"
          placeholder="选择项目"
          :options="
            state.projects.map((p) => ({
              value: p.id,
              label: p.name + (p.archived ? '（归档）' : ''),
            }))
          "
        />
      </div>
      <div class="report-filter zone-filter">
        <label for="report-zone">时区</label
        ><AInput
          id="report-zone"
          v-model:value="timeZone"
          required
          :disabled="busy"
        />
      </div>
      <AButton
        type="primary"
        :disabled="
          busy || !date || !timeZone || !memberIds.length || !projectIds.length
        "
        :loading="busy"
        @click="generate(false)"
        ><ReloadOutlined aria-hidden="true" />生成新日报</AButton
      >
    </section>
    <AAlert v-if="error" type="error" show-icon role="alert"
      ><template #message>
        {{ error
        }}<span v-if="error.includes('422') || error.includes('fewer')"
          >请缩小成员或项目范围后重新生成，已填写文本不会被清空。</span
        >
      </template></AAlert
    >
    <ConflictNotice
      v-if="conflict"
      :current="conflict"
      :original-version="expectedVersion"
      @adopt="latest"
    />
    <AAlert v-if="metadataError" type="error" show-icon role="alert"
      ><template #message>
        稿件内容已保留，附加信息读取失败：{{ metadataError }}
        <AButton
          :disabled="busy"
          @click="
            loadMetadata();
            list();
          "
          >重试读取日报信息</AButton
        >
      </template></AAlert
    >
    <AAlert
      v-if="notice"
      :message="notice"
      type="success"
      role="status"
      show-icon
    />
    <div v-if="current" class="report-columns">
      <section
        ref="sourcePanel"
        class="panel report-sources"
        aria-label="来源核对"
        tabindex="-1"
      >
        <div class="report-panel-heading">
          <h2>来源核对</h2>
          <ATag>{{ current.sources.length }} 条来源</ATag>
        </div>
        <SourceList :id="current.id" />
        <p class="report-footnote">
          没有记录时显示“未填写”，不推断没有工作。来源快照与生成截止点对应。
        </p>
      </section>
      <section class="panel report-draft" aria-label="微信纯文本草稿">
        <header class="report-draft-heading">
          <div class="report-title-row">
            <h2>微信纯文本草稿</h2>
            <ATag :color="dirty ? 'orange' : 'blue'">{{
              dirty ? "有未保存修改" : "已保存 · V" + current.version
            }}</ATag>
          </div>
          <p>
            {{ current.input.date }} ·
            {{ current.input.memberIds.map(nameOf).join("、") }} ·
            {{ current.input.timeZone }}
          </p>
          <p class="report-cutoff">
            创建人 {{ nameOf(current.creatorId) }} ·
            {{ current.edited ? "人工编辑" : "生成稿" }} ·
            {{ current.createdAt }}
          </p>
        </header>
        <section
          v-if="recoverable.length"
          class="report-recovery"
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
            <div class="report-inline-actions">
              <AButton @click="restoreDraft(draft)">恢复本地草稿</AButton
              ><AButton @click="discardDraft(draft)">丢弃本地草稿</AButton>
            </div>
          </article>
        </section>
        <div class="report-editor-body">
          <label for="report-text" class="sr-only">日报文本</label>
          <ATextarea
            id="report-text"
            ref="textarea"
            :rows="20"
            v-model:value="editor"
            @input="persistDraft"
            class="report-editor"
            :readonly="!mine || busy || recoverable.length > 0"
            :maxlength="REPORT_TEXT_LIMITS.edited"
          />
          <div class="editor-count">
            {{ editor.length.toLocaleString() }} /
            {{ REPORT_TEXT_LIMITS.edited.toLocaleString() }} 字符单位（UTF-16）
          </div>
          <p class="report-editor-note">
            编辑只修改汇总稿，不更改原始进展与他人贡献。提测、测试通过、产品验收和上线分别表达。
          </p>
          <p v-if="!mine" class="report-editor-note">
            仅创建人可编辑和重生成此稿件。
          </p>
          <div v-if="manualCopy" class="report-copy-fallback">
            <AButton @click="selectText()">全选文本，手动复制</AButton>
            <p>复制受限时可手动复制，稿件与来源仍保留。</p>
          </div>
        </div>
        <footer class="report-draft-actions">
          <AButton
            type="link"
            :disabled="busy"
            @click="openReportDialog({ kind: 'sources', id: current.id })"
            >查看来源更新</AButton
          >
          <div class="report-inline-actions">
            <AButton v-if="mine" :disabled="busy || !dirty" @click="save"
              >保存稿件版本</AButton
            >
            <AButton type="primary" :disabled="busy || copying" @click="copy"
              ><CopyOutlined aria-hidden="true" />复制纯文本</AButton
            >
          </div>
        </footer>
      </section>
    </div>
    <section v-else class="panel report-empty">
      <div class="report-empty-icon">
        <FileTextOutlined aria-hidden="true" />
      </div>
      <h2>把今天的协作汇总成一份草稿</h2>
      <p>选择成员、项目与日期后生成，或从下方打开已保存日报。</p>
      <p>所有内容都来自实际记录，空缺保持“未填写”。</p>
    </section>
    <section
      v-if="current"
      class="panel report-source-changes"
      aria-label="来源更新与生成截止"
    >
      <header class="report-panel-heading">
        <h2>来源更新与生成截止</h2>
        <AButton v-if="mine" :disabled="busy" @click="generate(true)"
          ><ReloadOutlined aria-hidden="true" />重新生成</AButton
        >
      </header>
      <div class="report-metadata">
        <AAlert
          v-if="sourceChanges?.changed"
          type="warning"
          show-icon
          message="来源记录有更新"
          description="现有稿件与来源快照保持不变。重新生成将保留旧稿，并使用新的来源截止点。"
        />
        <p v-else-if="sourceChanges">截至本次核对，未发现来源变化。</p>
        <div v-if="sourceChanges" class="report-change-counts">
          <span>新增 {{ sourceChanges.added.length }}</span
          ><span>更新 {{ sourceChanges.updated.length }}</span
          ><span>移除 {{ sourceChanges.removed.length }}</span
          ><span>核对时间 {{ sourceChanges.checkedAt }}</span>
        </div>
        <p class="report-cutoff">
          来源截止 #{{ current.sourceCutoffSeq }} · 状态截止
          {{ current.stateCutoff.time }} · 生成于 {{ current.generatedAt }}
        </p>
        <div class="report-metrics">
          <ATag>完成任务 {{ current.counts.tasksDone }}</ATag
          ><ATag>关闭 Bug {{ current.counts.bugsClosed }}</ATag
          ><ATag>验收需求 {{ current.counts.requirementsAccepted }}</ATag>
        </div>
      </div>
    </section>
    <section
      class="panel report-history"
      tabindex="-1"
      aria-label="日报版本历史"
    >
      <header class="report-panel-heading">
        <h2>{{ current ? "本日报版本" : "已保存日报" }}</h2>
        <AButton v-if="current" :disabled="busy" @click="closeCurrent()"
          >返回全部日报</AButton
        >
      </header>
      <ul class="history report-history-list">
        <li
          v-for="r in (current ? versions : history).slice().reverse()"
          :key="r.id"
        >
          <div>
            <AButton
              type="link"
              :disabled="busy"
              @click="select(r)"
              :data-report-id="r.id"
              >{{ r.input.date }} · V{{ r.version }}
              {{ r.edited ? "人工编辑" : "生成稿" }}</AButton
            >
            <p>
              {{ nameOf(r.creatorId) }} · <time>{{ r.createdAt }}</time>
            </p>
          </div>
          <ATag v-if="current?.id === r.id" color="blue">当前查看</ATag>
        </li>
      </ul>
      <p
        v-if="!(current ? versions : history).length"
        class="report-history-empty"
      >
        {{ current ? "暂无可显示的版本" : "暂无已保存日报" }}
      </p>
      <p class="report-footnote">
        历史日报保留当时的文本与来源截止点，不被之后的负责人或状态变化改写。
      </p>
    </section>
    <p class="report-page-note">
      核对后再分享 · 复制仅写入剪贴板，由你手动发送。生成稿上限
      {{ REPORT_TEXT_LIMITS.generated.toLocaleString() }}
      字符单位，人工编辑另保留 10,000。
    </p>
    <AModal
      :open="!!reportDialog"
      :title="reportDialogTitle"
      :width="reportDialog?.kind === 'history' ? 680 : 540"
      :footer="null"
      :closable="!busy"
      :keyboard="!busy"
      :mask-closable="false"
      :focus-trigger-after-close="false"
      wrap-class-name="report-inspection-modal"
      destroy-on-close
      @cancel="closeReportDialog"
      :after-close="restoreReportDialogFocus"
    >
      <template v-if="reportDialog?.kind === 'copy'">
        <p class="report-modal-note">
          浏览器未允许自动复制。可选中下方纯文本手动复制，草稿与来源仍保留。
        </p>
        <ATextarea
          ref="manualTextarea"
          :value="reportDialog.text"
          :rows="8"
          readonly
          aria-label="可手动复制的日报文本"
          class="report-manual-text"
        />
        <div class="report-modal-actions report-modal-actions-start">
          <AButton @click="closeReportDialog">返回草稿</AButton>
        </div>
      </template>
      <template v-else>
        <p v-if="dialogBusy" class="report-modal-note" role="status">
          正在读取{{
            reportDialog?.kind === "history" ? "历史版本" : "来源变化"
          }}…
        </p>
        <AAlert v-if="dialogError" type="error" role="alert" show-icon>
          <template #message
            >{{ dialogError
            }}<AButton @click="loadReportDialog">重试读取</AButton></template
          >
        </AAlert>
        <template v-if="reportDialog?.kind === 'history'">
          <ul class="report-dialog-history" aria-label="已保存的日报版本">
            <li v-for="r in dialogVersions.slice().reverse()" :key="r.id">
              <div>
                <strong
                  >{{ r.input.date }} · V{{ r.version }} ·
                  {{ r.edited ? "人工编辑" : "生成稿" }}</strong
                >
                <p>
                  {{ r.input.memberIds.map(nameOf).join("、") }} · 来源截止 #{{
                    r.sourceCutoffSeq
                  }}
                  · {{ r.createdAt }}
                </p>
                <span v-if="current?.id === r.id" class="report-dialog-current"
                  >当前查看</span
                >
              </div>
              <AButton
                size="small"
                :disabled="busy || dialogBusy"
                :data-report-id="r.id"
                @click="selectHistoryVersion(r)"
                >查看版本</AButton
              >
            </li>
          </ul>
          <p
            v-if="!dialogBusy && !dialogError && !dialogVersions.length"
            class="report-modal-note"
          >
            暂无已保存日报。
          </p>
          <p class="report-modal-note">
            历史日报按当时的生成截止点反映事实，文本和来源快照不会被之后的负责人或状态变化改写。
          </p>
        </template>
        <template v-else-if="dialogChanges && current">
          <div class="report-modal-source-summary">
            <ReloadOutlined aria-hidden="true" />
            <div>
              <strong>{{
                dialogChanges.changed
                  ? "来源记录有更新"
                  : "截至本次核对，未发现来源变化"
              }}</strong>
              <p>
                新增 {{ dialogChanges.added.length }} · 更新
                {{ dialogChanges.updated.length }} · 移除
                {{ dialogChanges.removed.length }}
              </p>
              <p>
                当前稿件来源截止 #{{ current.sourceCutoffSeq }} · 本次核对截止
                #{{ dialogChanges.sourceCutoffSeq }}
              </p>
              <p>核对时间 {{ dialogChanges.checkedAt }}</p>
            </div>
          </div>
          <p class="report-modal-note">
            现有草稿不会悄悄变化。重新生成会使用新的来源截止点，并保留旧稿；成员原始记录保持不变。
          </p>
        </template>
        <div
          class="report-modal-actions"
          :class="{
            'report-modal-actions-start': reportDialog?.kind === 'sources',
          }"
        >
          <AButton
            ref="dialogCancel"
            :disabled="busy"
            @click="closeReportDialog"
            >返回草稿</AButton
          >
          <AButton
            v-if="reportDialog?.kind === 'sources' && mine"
            type="primary"
            :disabled="busy || dialogBusy || !!dialogError || !dialogChanges"
            @click="regenerateFromSources"
            >保留旧稿并重新生成</AButton
          >
        </div>
      </template>
    </AModal>
    <AModal
      :open="confirmRegenerate"
      title="确认重新生成"
      :width="540"
      :footer="null"
      :closable="!busy"
      :mask-closable="false"
      :keyboard="!busy"
      destroy-on-close
      @cancel="confirmRegenerate = false"
    >
      <div class="report-modal-warning">
        <strong>保留旧稿，再生成新版本</strong>
        <p>
          当前稿件包含人工修改。继续后先保存这份修改稿，再依据最新来源创建新版本。
        </p>
      </div>
      <p class="report-modal-note">
        新稿不会静默覆盖旧稿，也不会修改成员原始记录。所有历史版本保持可读。
      </p>
      <div class="report-modal-actions">
        <AButton
          ref="regenerateCancel"
          :disabled="busy"
          @click="confirmRegenerate = false"
          >返回编辑</AButton
        ><AButton
          type="primary"
          :disabled="busy"
          :loading="busy"
          @click="generate(regenerateIntent)"
          >保留旧稿并重新生成</AButton
        >
      </div>
    </AModal>
    <AModal
      :open="!!navigation"
      title="确认切换日报"
      :width="540"
      :footer="null"
      :mask-closable="false"
      destroy-on-close
      @cancel="navigation = undefined"
    >
      <div class="report-modal-warning">
        <strong>当前内容有未保存修改</strong>
      </div>
      <p class="report-modal-note">{{ navigation?.message }}</p>
      <div class="report-modal-actions">
        <AButton ref="navigationCancel" @click="navigation = undefined"
          >返回编辑</AButton
        ><AButton type="primary" @click="confirmNavigation"
          >保留副本并继续</AButton
        >
      </div>
    </AModal>
  </div>
</template>
<style scoped>
.reports-page {
  min-width: 0;
}
.reports-page > .ant-alert {
  margin-bottom: 18px;
}
.report-filters {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  padding: 18px 22px;
  margin-bottom: 22px;
}
.report-filter {
  min-width: 0;
}
.report-filter > label {
  display: block;
  color: #65738b;
  font-size: 12px;
  margin-bottom: 6px;
}
.report-filter :deep(.ant-select),
.report-filter :deep(.ant-picker) {
  width: 100%;
}
.date-filter {
  width: 155px;
}
.member-filter {
  flex: 1 1 200px;
}
.project-filter {
  flex: 1 1 190px;
}
.zone-filter {
  width: 160px;
}
.report-columns {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 22px;
  align-items: start;
  margin-bottom: 22px;
}
.report-columns > * {
  min-width: 0;
}
.report-panel-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 19px 22px;
  border-bottom: 1px solid #e4e9f1;
}
.report-panel-heading h2,
.report-draft-heading h2 {
  font-size: 15px;
  margin: 0;
  font-weight: 600;
}
.report-panel-heading .ant-tag,
.report-title-row .ant-tag {
  margin: 0;
  flex-shrink: 0;
}
.report-sources {
  align-self: stretch;
}
.report-draft-heading {
  padding: 21px 24px 17px;
  border-bottom: 1px solid #e4e9f1;
}
.report-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.report-draft-heading p {
  margin: 8px 0 0;
  color: #586b88;
  font-size: 12px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.report-draft-heading .report-cutoff {
  font-size: 11px;
  color: #748199;
}
.report-editor-body {
  padding: 22px 24px;
}
.report-editor {
  min-height: 560px;
  background: #fbfcff;
  padding: 18px;
  font-size: 13px;
  line-height: 2;
  font-family: inherit;
  border: 1px solid #dbe3f0;
  border-radius: 6px;
  resize: vertical;
  color: #17243b;
}
.editor-count {
  font-size: 11px;
  color: #748199;
  text-align: right;
  margin-top: 8px;
}
.report-editor-note {
  font-size: 12px;
  color: #65738b;
  line-height: 1.8;
  margin: 12px 0 0;
}
.report-draft-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 17px 24px;
  border-top: 1px solid #e4e9f1;
}
.report-draft-actions > .ant-btn-link {
  padding: 0;
  font-size: 12px;
}
.report-inline-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.report-footnote {
  background: #f8faff;
  padding: 16px 22px;
  margin: 0;
  color: #65738b;
  font-size: 12px;
  line-height: 1.8;
  border-top: 1px solid #e4e9f1;
}
.report-source-changes,
.report-history {
  margin-top: 22px;
}
.report-metadata {
  padding: 20px 22px;
  font-size: 12px;
  color: #65738b;
  line-height: 1.8;
}
.report-metadata > p {
  margin: 0 0 10px;
}
.report-metadata > .ant-alert {
  margin-bottom: 14px;
}
.report-change-counts {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.report-cutoff {
  overflow-wrap: anywhere;
}
.report-metrics {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.report-history-list {
  margin: 0;
  padding: 0 22px;
  list-style: none;
}
.report-history-list li {
  padding: 16px 0;
  border-bottom: 1px solid #e4e9f1;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}
.report-history-list li:last-child {
  border-bottom: 0;
}
.report-history-list .ant-btn {
  padding: 0;
  height: auto;
  white-space: normal;
  font-size: 13px;
  text-align: left;
}
.report-history-list p {
  margin: 6px 0 0;
  color: #748199;
  font-size: 12px;
}
.report-history-list time {
  display: inline;
}
.report-history-empty {
  color: #748199;
  padding: 20px 22px;
  margin: 0;
  font-size: 12px;
}
.report-page-note {
  color: #748199;
  font-size: 11px;
  line-height: 1.8;
  margin: 18px 0 0;
}
.report-empty {
  text-align: center;
  padding: 70px 24px;
}
.report-empty h2 {
  font-size: 21px;
  margin: 20px 0 12px;
}
.report-empty p {
  font-size: 13px;
  color: #65738b;
  margin: 8px 0;
}
.report-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 76px;
  height: 76px;
  margin: auto;
  border: 1px solid #dfe7f8;
  background: #edf3ff;
  border-radius: 20px;
  color: #245bdb;
  font-size: 30px;
}
.report-recovery {
  padding: 20px 24px;
  background: #fff9ee;
  border-bottom: 1px solid #f0e1c2;
}
.report-recovery h3 {
  font-size: 14px;
  margin: 0 0 12px;
}
.report-recovery article + article {
  border-top: 1px solid #f0e1c2;
  padding-top: 16px;
  margin-top: 16px;
}
.report-recovery p {
  font-size: 12px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.report-copy-fallback {
  padding: 14px;
  border: 1px solid #e4e9f1;
  border-radius: 6px;
  margin-top: 16px;
  background: #f8faff;
}
.report-copy-fallback p,
.report-modal-note {
  color: #65738b;
  font-size: 12px;
  line-height: 1.8;
  margin: 14px 0;
}
.report-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
  flex-wrap: wrap;
}
.report-modal-actions-start {
  justify-content: flex-start;
}
.report-manual-text {
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.8;
  max-height: 50vh;
  color: #17243b;
}
.report-dialog-history {
  padding: 0;
  margin: 0;
  list-style: none;
  max-height: 55vh;
  overflow-y: auto;
}
.report-dialog-history li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  padding: 19px 0;
  border-bottom: 1px solid #e4e9f1;
}
.report-dialog-history li > div {
  min-width: 0;
  overflow-wrap: anywhere;
}
.report-dialog-history strong {
  font-size: 13px;
  font-weight: 500;
}
.report-dialog-history p {
  font-size: 12px;
  color: #65738b;
  line-height: 1.8;
  margin: 6px 0 0;
}
.report-dialog-history .ant-btn {
  flex-shrink: 0;
}
.report-dialog-current {
  display: inline-block;
  margin-top: 5px;
  color: #245bdb;
  font-size: 11px;
}
.report-modal-source-summary {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px;
  border: 1px solid #dbe5f8;
  background: #f0f5ff;
  border-radius: 8px;
  overflow-wrap: anywhere;
}
.report-modal-source-summary > .anticon {
  color: #245bdb;
  font-size: 18px;
  margin-top: 2px;
}
.report-modal-source-summary strong {
  font-size: 13px;
  font-weight: 600;
}
.report-modal-source-summary p {
  color: #65738b;
  font-size: 12px;
  line-height: 1.8;
  margin: 5px 0 0;
}
:global(.report-inspection-modal .ant-modal-content) {
  padding: 0;
  overflow: hidden;
}
:global(.report-inspection-modal .ant-modal-header) {
  padding: 21px 24px;
  border-bottom: 1px solid #e4e9f1;
  margin: 0;
}
:global(.report-inspection-modal .ant-modal-title) {
  font-size: 17px;
}
:global(.report-inspection-modal .ant-modal-body) {
  padding: 22px 24px;
}
.report-modal-warning {
  background: #fff9ee;
  border: 1px solid #f0e1c2;
  border-radius: 7px;
  padding: 16px 18px;
  font-size: 13px;
  color: #17243b;
}
.report-modal-warning p {
  margin: 6px 0 0;
  color: #65738b;
  font-size: 12px;
  line-height: 1.8;
}
.report-sources:focus,
.report-history:focus {
  outline: 2px solid #93b4ff;
  outline-offset: 3px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 1150px) {
  .report-columns {
    grid-template-columns: 300px minmax(0, 1fr);
  }
  .zone-filter {
    width: 155px;
  }
}
@media (max-width: 850px) {
  .report-columns {
    grid-template-columns: minmax(0, 1fr);
  }
  .report-draft {
    order: -1;
  }
  .report-editor {
    min-height: 470px;
  }
}
@media (max-width: 600px) {
  .report-manual-text {
    font-size: 16px;
  }
  .report-dialog-history li {
    gap: 10px;
  }
  :global(.report-inspection-modal .ant-modal) {
    max-width: calc(100vw - 24px);
  }
  :global(.report-inspection-modal .ant-modal-body) {
    padding: 19px;
  }
  .report-filters {
    padding: 16px;
    gap: 12px 8px;
  }
  .date-filter {
    width: 155px;
  }
  .member-filter {
    flex-basis: 100%;
  }
  .project-filter {
    flex: 1 1 calc(100% - 170px);
  }
  .zone-filter {
    width: 155px;
  }
  .report-filters > .ant-btn {
    margin-left: auto;
  }
  .report-panel-heading,
  .report-draft-heading,
  .report-draft-actions {
    padding: 17px;
  }
  .report-editor-body {
    padding: 17px;
  }
  .report-editor {
    font-size: 16px;
    padding: 13px;
  }
  .report-title-row {
    gap: 8px;
  }
  .report-title-row h2 {
    font-size: 14px;
  }
  .report-draft-actions > .report-inline-actions {
    width: 100%;
    justify-content: space-between;
  }
  .report-history-list {
    padding: 0 17px;
  }
  .report-footnote,
  .report-metadata {
    padding: 16px 17px;
  }
  .report-recovery {
    padding: 17px;
  }
  .report-cutoff {
    font-size: 11px;
  }
  .report-modal-actions {
    align-items: stretch;
  }
}
</style>

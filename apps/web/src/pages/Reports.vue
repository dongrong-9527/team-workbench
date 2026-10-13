<script setup lang="ts">
import ATag from "ant-design-vue/es/tag";
import ADatePicker from "ant-design-vue/es/date-picker";
import AInput, { Textarea as ATextarea } from "ant-design-vue/es/input";
import ACheckbox, {
  CheckboxGroup as ACheckboxGroup,
} from "ant-design-vue/es/checkbox";
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
  manualCopy = ref(false),
  tab = ref("editor"),
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
watch(
  () => !!navigation.value || confirmRegenerate.value,
  async (open) => {
    if (open)
      confirmationTrigger =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined;
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
  notice.value = "";
  try {
    await navigator.clipboard.writeText(editor.value);
    notice.value = "已复制";
    manualCopy.value = false;
  } catch {
    manualCopy.value = true;
    notice.value = "浏览器未允许复制，文本已保留。请选中文本后手动复制。";
    await nextTick();
    selectText();
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
  <div class="page-heading">
    <div>
      <span class="eyebrow">有来源的汇总 · 人工核对</span>
      <h1>日报工作区</h1>
      <p>选择成员与项目，生成可追溯的纯文本草稿。</p>
    </div>
    <ATag>{{ timeZone }}</ATag>
  </div>
  <section class="panel panel-body">
    <div class="form-grid">
      <div>
        <label for="report-date">报告日期</label
        ><ADatePicker
          id="report-date"
          :value="date || undefined"
          @update:value="date = typeof $event === 'string' ? $event : ''"
          value-format="YYYY-MM-DD"
          format="YYYY-MM-DD"
        />
      </div>
      <div>
        <label for="report-zone">时区</label
        ><AInput id="report-zone" v-model:value="timeZone" required />
      </div>
      <div class="wide">
        <h3>成员范围</h3>
        <ACheckboxGroup v-model:value="memberIds" class="chips"
          ><ACheckbox v-for="m in state.members" :value="m.id"
            >{{ m.displayName }}{{ m.active ? "" : "（已停用）" }}</ACheckbox
          ></ACheckboxGroup
        >
      </div>
      <div class="wide">
        <h3>项目范围</h3>
        <ACheckboxGroup v-model:value="projectIds" class="chips"
          ><ACheckbox v-for="p in state.projects" :value="p.id"
            >{{ p.name }}{{ p.archived ? "（归档）" : "" }}</ACheckbox
          ></ACheckboxGroup
        >
      </div>
    </div>
    <div class="form-actions">
      <AButton
        type="primary"
        :disabled="
          busy || !date || !timeZone || !memberIds.length || !projectIds.length
        "
        @click="generate(false)"
      >
        生成新日报</AButton
      ><small class="muted"
        >空缺保持“未填写”；生成稿上限
        {{ REPORT_TEXT_LIMITS.generated.toLocaleString() }}
        字符单位，人工编辑另保留 10,000。</small
      >
    </div>
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
      >
        重试读取日报信息
      </AButton>
    </template></AAlert
  >
  <AAlert
    v-if="notice"
    :message="notice"
    type="success"
    role="status"
    show-icon
  />
  <div class="detail-layout">
    <section class="panel panel-body">
      <template v-if="current"
        ><div class="section-heading" style="padding: 0 0 20px">
          <div>
            <h2>
              {{ current.input.date }} 日报
              <ATag
                >V{{ current.version }} ·
                {{ current.edited ? "人工编辑" : "生成稿" }}</ATag
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
          <ATag>完成任务 {{ current.counts.tasksDone }}</ATag
          ><ATag>关闭 Bug {{ current.counts.bugsClosed }}</ATag
          ><ATag>验收需求 {{ current.counts.requirementsAccepted }}</ATag>
        </div>
        <AAlert v-if="sourceChanges?.changed" type="warning" show-icon
          ><template #message>
            有更新可重新生成。旧稿与来源快照保留不变。
          </template></AAlert
        >
        <div class="tabs" style="margin-top: 20px">
          <AButton @click="tab = 'editor'">稿件编辑</AButton
          ><AButton @click="tab = 'sources'">
            查看来源（{{ current.sources.length }}）
          </AButton>
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
            <AButton @click="restoreDraft(draft)">恢复本地草稿</AButton
            ><AButton @click="discardDraft(draft)">丢弃本地草稿</AButton>
          </article>
        </section>
        <template v-if="tab === 'editor'"
          ><label
            >日报文本<ATextarea
              ref="textarea"
              :rows="18"
              v-model:value="editor"
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
            <AButton
              v-if="mine"
              type="primary"
              :disabled="busy || !dirty"
              @click="save"
            >
              保存稿件版本</AButton
            ><AButton :disabled="busy" @click="copy">复制纯文本</AButton
            ><AButton v-if="mine" :disabled="busy" @click="generate(true)">
              重新生成
            </AButton>
          </div>
          <AButton v-if="manualCopy" @click="selectText()">
            全选文本，手动复制
          </AButton>
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
            <AButton :disabled="busy" @click="select(r)" :data-report-id="r.id">
              {{ r.input.date }} · V{{ r.version }}
              {{ r.edited ? "人工编辑" : "生成稿" }}</AButton
            ><time>{{ r.createdAt }}</time
            ><span>{{ nameOf(r.creatorId) }}</span>
          </li>
        </ul>
        <AButton v-if="current" :disabled="busy" @click="closeCurrent()">
          返回全部日报
        </AButton>
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
  <AModal
    :open="confirmRegenerate"
    title="确认重新生成"
    :footer="null"
    :closable="!busy"
    :mask-closable="false"
    :keyboard="!busy"
    destroy-on-close
    @cancel="confirmRegenerate = false"
  >
    <h2>保留旧稿，再生成新版本</h2>
    <p>
      当前稿件包含人工修改。继续后先保存这份修改稿，再依据最新来源创建新版本。所有历史版本保持可读。
    </p>
    <div class="form-actions">
      <AButton
        type="primary"
        :disabled="busy"
        :loading="busy"
        @click="generate(regenerateIntent)"
        >保留旧稿并重新生成</AButton
      ><AButton
        ref="regenerateCancel"
        :disabled="busy"
        @click="confirmRegenerate = false"
        >返回编辑</AButton
      >
    </div>
  </AModal>
  <AModal
    :open="!!navigation"
    title="确认切换日报"
    :footer="null"
    :mask-closable="false"
    destroy-on-close
    @cancel="navigation = undefined"
    ><p>{{ navigation?.message }}</p>
    <div class="form-actions">
      <AButton type="primary" @click="confirmNavigation">保留副本并继续</AButton
      ><AButton ref="navigationCancel" @click="navigation = undefined"
        >返回编辑</AButton
      >
    </div></AModal
  >
</template>

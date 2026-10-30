import {
  computed,
  onMounted,
  onUnmounted,
  reactive,
  watch,
  type Ref,
} from "vue";
import { ApiError, request } from "../api/client";
import { beginMutation, state } from "../state";
import type { FormSpec } from "../forms";
import { RequirementImageDelivery } from "../requirementImages";

interface Receipt {
  id: string;
  version: number;
  projectId: string;
  actorId: string;
  path: string;
}
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function useRequirementEditor(options: {
  spec: () => FormSpec;
  actor: string | undefined;
  stored: any;
  storageKey: string;
  values: Ref<Record<string, any>>;
  busy: Ref<boolean>;
  error: Ref<string>;
  command: () => { fingerprint: string; key: string };
  persist: () => void;
  reset: () => void;
  saved: (result: any) => void;
}) {
  const enabled = computed(() => !!options.spec().requirementEditor);
  const ui = reactive({
    detailsOpen: false,
    clearOpen: false,
    discardOpen: false,
    unknown: false,
    receipt: undefined as Receipt | undefined,
    restored: false,
    verified: false,
    savedTitle: "",
    savedState: "",
    existing: [] as { id: string }[],
    loadingImages: false,
    imageReadError: "",
    selectionError: "",
    creator: "",
    creatorError: "",
    receiptError: "",
    verifyingReceipt: false,
    filesLost: false,
  });
  let alive = true,
    result: any,
    discardResolve: ((ok: boolean) => void) | undefined;
  const valid = () => alive && state.member?.id === options.actor;
  const delivery = reactive(
    new RequirementImageDelivery({
      upload: async (command) => {
        if (!valid() || state.expired)
          throw new ApiError(401, "登录状态已变化，请重新登录本人账号后重试。");
        const body = new FormData();
        body.append("image", command.file);
        return request<{ id: string }>(
          `/api/objects/requirement/${encodeURIComponent(command.id)}/attachments?expectedVersion=${command.version}&size=${command.file.size}`,
          { method: "POST", body, headers: { "Idempotency-Key": command.key } },
        );
      },
      createPreview: (file) => URL.createObjectURL(file),
      revokePreview: (url) => URL.revokeObjectURL(url),
      newKey: () => crypto.randomUUID(),
    }),
  );
  const storedDelivery = options.stored?.requirementDelivery;
  function receipt(value: any): Receipt | undefined {
    const spec = options.spec();
    return value &&
      id(value.id) &&
      Number.isSafeInteger(value.version) &&
      value.version > 0 &&
      value.actorId === options.actor &&
      value.projectId === spec.projectId &&
      value.path === spec.path &&
      (!spec.requirementEditor?.id || spec.requirementEditor.id === value.id)
      ? {
          id: value.id,
          version: value.version,
          projectId: value.projectId,
          actorId: value.actorId,
          path: value.path,
        }
      : undefined;
  }
  if (enabled.value) {
    ui.receipt = receipt(storedDelivery?.receipt);
    ui.restored = !!ui.receipt;
    ui.filesLost = storedDelivery?.hadPendingImages === true;
    ui.unknown = !ui.receipt && storedDelivery?.unknown === true;
  }
  function persistBits() {
    return enabled.value
      ? {
          requirementDelivery: {
            unknown: ui.unknown,
            receipt: ui.receipt,
            hadPendingImages: delivery.hasUnsavedFiles || ui.filesLost,
          },
        }
      : {};
  }
  function pendingBody() {
    if (!enabled.value || !ui.unknown) return undefined;
    try {
      const command = options.command();
      const [path, method, body] = JSON.parse(command.fingerprint);
      if (
        !command.key ||
        path !== options.spec().path ||
        method !== (options.spec().method ?? "POST") ||
        !body ||
        typeof body !== "object"
      )
        throw new Error();
      if (
        options.spec().requirementEditor?.mode === "create"
          ? body.projectId !== options.spec().projectId
          : body.action !== options.spec().requirementEditor?.mode
      )
        throw new Error();
      return body;
    } catch {
      throw new Error(
        "无法恢复原保存请求，请先到需求列表核对；不会自动再次创建。",
      );
    }
  }
  function markPending() {
    if (enabled.value) ui.unknown = true;
  }
  function failed(error: unknown, previouslyUnknown: boolean) {
    if (!enabled.value) return;
    // A rejection of this retry cannot reconcile an earlier ambiguous command.
    if (
      !previouslyUnknown &&
      error instanceof ApiError &&
      ![0, 500, 502, 503, 504].includes(error.code)
    )
      ui.unknown = false;
    options.persist();
  }
  function add(files: File[]) {
    if (
      !valid() ||
      options.busy.value ||
      ui.unknown ||
      ui.restored ||
      state.expired ||
      ui.loadingImages ||
      ui.imageReadError
    )
      return;
    ui.selectionError = delivery.add(files, ui.existing.length).join("\n");
    options.persist();
  }
  function paste(event: ClipboardEvent) {
    if (!enabled.value || !event.clipboardData?.files.length) return;
    event.preventDefault();
    add(Array.from(event.clipboardData.files));
  }
  function finish() {
    if (!valid() || !ui.receipt || !ui.verified) return;
    localStorage.removeItem(options.storageKey);
    options.saved(result ?? ui.receipt);
  }
  async function deliver() {
    await delivery.uploadFailed();
    if (!valid()) return;
    if (delivery.allUploaded) finish();
    else options.persist();
  }
  async function acknowledged(value: any) {
    if (!enabled.value) return false;
    const confirmed = receipt({
      ...value,
      actorId: options.actor,
      path: options.spec().path,
    });
    if (!confirmed)
      throw new ApiError(0, "保存响应不完整，请按原请求重试确认。");
    delivery.bindTarget(confirmed);
    ui.receipt = confirmed;
    ui.verified = true;
    ui.unknown = false;
    ui.savedTitle = String(value.title ?? options.values.value.title ?? "");
    result = value;
    ui.savedState = String(value.state ?? "");
    if (ui.filesLost && !delivery.entries.length) ui.restored = true;
    options.persist();
    if (ui.restored) {
      // An idempotent POST can replay an older state. Lost image bytes make
      // this a restored receipt: verify the live object before enabling it.
      ui.verified = false;
      void verifyReceipt();
      void loadImages();
      return true;
    }
    await deliver();
    return true;
  }
  async function retry() {
    if (
      !valid() ||
      !ui.receipt ||
      !ui.verified ||
      options.busy.value ||
      state.mutationPending ||
      state.expired ||
      ui.restored
    )
      return;
    options.busy.value = true;
    const release = beginMutation();
    try {
      await deliver();
    } finally {
      release();
      if (alive) options.busy.value = false;
    }
  }
  async function adoptVersion() {
    if (!valid() || !ui.receipt || options.busy.value || state.mutationPending)
      return;
    options.busy.value = true;
    const release = beginMutation();
    try {
      const current = await request<any>(
        "/api/requirements/" + encodeURIComponent(ui.receipt.id),
      );
      if (!valid()) return;
      if (
        current.id !== ui.receipt.id ||
        current.projectId !== ui.receipt.projectId
      )
        throw new Error("需求上下文已变化，请查看已保存需求核对。");
      if (delivery.adoptConflictedVersion(current.version)) {
        ui.receipt.version = current.version;
        options.persist();
      }
    } catch (error) {
      if (valid()) options.error.value = (error as Error).message;
    } finally {
      release();
      if (alive) options.busy.value = false;
    }
  }
  async function loadImages() {
    const target = ui.receipt?.id ?? options.spec().requirementEditor?.id;
    if (!enabled.value || !target || ui.loadingImages) return;
    ui.loadingImages = true;
    ui.imageReadError = "";
    try {
      const page = await request<any>(
        `/api/objects/requirement/${encodeURIComponent(target)}/attachments?limit=100`,
      );
      if (!valid()) return;
      if (
        !Array.isArray(page?.items) ||
        page.items.length > 100 ||
        !page.items.every((entry: any) => id(entry?.id))
      )
        throw new Error("已保存图片数据无法读取。");
      ui.existing = page.items.map((entry: any) => ({ id: entry.id }));
    } catch (error) {
      if (valid()) ui.imageReadError = (error as Error).message;
    } finally {
      if (valid()) ui.loadingImages = false;
    }
  }
  async function loadCreator() {
    const target = options.spec().requirementEditor?.id;
    if (!enabled.value || !target) return;
    ui.creatorError = "";
    try {
      const page = await request<any>(
        `/api/objects/requirement/${encodeURIComponent(target)}/history?limit=20`,
      );
      if (!valid()) return;
      const created = page.items?.find(
        (entry: any) => entry.action === "created",
      );
      if (!created) throw new Error("未读取到创建事件，请查看活动历史。");
      ui.creator = String(
        created.actorName ?? created.after?.actorName ?? created.actorId ?? "",
      );
    } catch (error) {
      if (valid()) ui.creatorError = (error as Error).message;
    }
  }
  function discard(ok: boolean) {
    ui.discardOpen = false;
    if (ok) for (const item of [...delivery.entries]) delivery.remove(item.id);
    discardResolve?.(ok);
    discardResolve = undefined;
  }
  function confirmDiscard(): Promise<boolean> {
    if (ui.discardOpen || ui.clearOpen) return Promise.resolve(false);
    ui.discardOpen = true;
    return new Promise((resolve) => {
      discardResolve = resolve;
    });
  }
  async function allowNavigation() {
    if (options.busy.value || state.mutationPending) return false;
    if (!enabled.value || !delivery.hasUnsavedFiles) return true;
    return confirmDiscard();
  }
  async function allowClose() {
    if (!(await allowNavigation())) return false;
    if (ui.receipt) {
      finish();
      return false;
    }
    return true;
  }
  function clear() {
    if (!enabled.value || options.busy.value || ui.unknown || ui.receipt)
      return;
    for (const item of [...delivery.entries]) delivery.remove(item.id);
    options.values.value = JSON.parse(JSON.stringify(options.spec().initial));
    options.reset();
    ui.filesLost = false;
    ui.selectionError = "";
    ui.clearOpen = false;
    options.persist();
  }
  function beforeUnload(event: BeforeUnloadEvent) {
    if (enabled.value && delivery.hasUnsavedFiles) {
      event.preventDefault();
      event.returnValue = "";
    }
  }
  watch(
    () => state.member?.id,
    () => {
      if (!valid()) {
        delivery.dispose();
        discard(false);
      }
    },
  );
  async function verifyReceipt() {
    if (
      !enabled.value ||
      !ui.receipt ||
      ui.verifyingReceipt ||
      !valid() ||
      state.expired
    )
      return;
    ui.verifyingReceipt = true;
    ui.receiptError = "";
    const savedReceipt = ui.receipt;
    try {
      const current = await request<any>(
        "/api/requirements/" + encodeURIComponent(savedReceipt.id),
      );
      if (!valid() || ui.receipt !== savedReceipt) return;
      if (
        current.id !== savedReceipt.id ||
        current.projectId !== savedReceipt.projectId
      )
        throw new Error("保存回执与当前项目不一致。");
      result = current;
      ui.savedState = String(current.state ?? "");
      ui.savedTitle = current.title;
      ui.verified = true;
      delivery.bindTarget(savedReceipt);
    } catch (error) {
      if (valid()) ui.receiptError = (error as Error).message;
    } finally {
      if (valid()) ui.verifyingReceipt = false;
    }
  }
  onMounted(() => {
    if (!enabled.value) return;
    window.addEventListener("beforeunload", beforeUnload);
    if (ui.restored && ui.receipt) void verifyReceipt();
    void loadImages();
    void loadCreator();
  });
  onUnmounted(() => {
    alive = false;
    delivery.dispose();
    discard(false);
    window.removeEventListener("beforeunload", beforeUnload);
  });
  return {
    enabled,
    ui,
    delivery,
    persistBits,
    pendingBody,
    markPending,
    failed,
    acknowledged,
    add,
    paste,
    retry,
    adoptVersion,
    loadImages,
    loadCreator,
    verifyReceipt,
    discard,
    allowNavigation,
    allowClose,
    clear,
    finish,
  };
}

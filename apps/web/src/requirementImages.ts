export interface ImageUploadRequest {
  id: string;
  version: number;
  file: File;
  key: string;
}
export interface PendingRequirementImage {
  id: string;
  file: File;
  preview: string;
  key: string;
  boundVersion?: number;
  status: "pending" | "uploading" | "uploaded" | "failed";
  error: string;
  failureCode?: number;
  conflictVersion?: number;
}
interface ImagePorts {
  upload: (request: ImageUploadRequest) => Promise<{ id: string }>;
  createPreview: (file: File) => string;
  revokePreview: (url: string) => void;
  newKey: () => string;
}
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
// UI preflight keeps the existing defaults; actual server limits remain authoritative.
const maxBytes = 5 * 1024 * 1024,
  maxPerObject = 10;

export class RequirementImageDelivery {
  entries: PendingRequirementImage[] = [];
  busy = false;
  target?: { id: string; version: number };
  private alive = true;
  private generation = 0;
  constructor(private readonly ports: ImagePorts) {}

  get successfulCount() {
    return this.entries.filter((item) => item.status === "uploaded").length;
  }
  get failedCount() {
    return this.entries.filter((item) => item.status === "failed").length;
  }
  get hasUnsavedFiles() {
    return this.entries.some((item) => item.status !== "uploaded");
  }
  get allUploaded() {
    return this.entries.every((item) => item.status === "uploaded");
  }
  get conflictVersion() {
    return this.entries.reduce<number | undefined>(
      (latest, item) =>
        item.failureCode === 409 && item.conflictVersion
          ? Math.max(latest ?? 0, item.conflictVersion)
          : latest,
      undefined,
    );
  }

  add(files: File[], existingCount = 0): string[] {
    if (!this.alive || this.busy) return ["正在上传，暂不能添加图片。"];
    const rejected: string[] = [];
    for (const file of files) {
      let reason = "";
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
        reason = "仅支持 PNG、JPEG、WebP 格式。";
      else if (
        !Number.isSafeInteger(file.size) ||
        file.size < 1 ||
        file.size > maxBytes
      )
        reason = "图片需为非空文件，单张不能超过 5 MiB。";
      else if (
        !file.name ||
        file.name.length > 255 ||
        /[\\/\u0000-\u001f\u007f]/.test(file.name)
      )
        reason = "图片文件名不可用。";
      else if (existingCount + this.entries.length >= maxPerObject)
        reason = "每个对象最多 10 张图片。";
      if (reason) {
        rejected.push(file.name + "：" + reason);
        continue;
      }
      const key = this.ports.newKey();
      this.entries.push({
        id: key,
        file,
        key,
        preview: this.ports.createPreview(file),
        status: "pending",
        error: "",
      });
    }
    return rejected;
  }

  remove(id: string): boolean {
    if (this.busy) return false;
    const index = this.entries.findIndex(
      (item) => item.id === id && item.status !== "uploaded",
    );
    if (index < 0) return false;
    const [removed] = this.entries.splice(index, 1);
    this.ports.revokePreview(removed.preview);
    return true;
  }

  bindTarget(target: { id: string; version: number }) {
    if (
      !validId(target.id) ||
      !Number.isSafeInteger(target.version) ||
      target.version < 1
    )
      throw new Error("保存响应不完整，请按原请求重试确认。");
    if (this.target && this.target.id !== target.id)
      throw new Error("不能切换已保存图片的需求。");
    this.target = { ...target };
  }

  adoptConflictedVersion(version: number): boolean {
    if (
      !this.alive ||
      this.busy ||
      !this.target ||
      !Number.isSafeInteger(version) ||
      version < 1
    )
      return false;
    const conflicted = this.entries.filter(
      (item) =>
        item.status === "failed" &&
        item.failureCode === 409 &&
        item.conflictVersion &&
        version >= item.conflictVersion,
    );
    if (!conflicted.length) return false;
    this.target.version = version;
    for (const item of conflicted) {
      item.boundVersion = version;
      item.key = this.ports.newKey();
      item.status = "pending";
      item.failureCode = undefined;
      item.conflictVersion = undefined;
      item.error = "";
    }
    return true;
  }

  async uploadFailed(): Promise<void> {
    if (!this.alive || this.busy) return;
    if (!this.target) throw new Error("请先确认需求已保存，再上传图片。");
    this.busy = true;
    const generation = this.generation;
    const target = this.target;
    const valid = () => this.alive && this.generation === generation;
    try {
      for (const item of this.entries) {
        if (!valid()) break;
        if (item.status === "uploaded") continue;
        item.boundVersion ??= target.version;
        item.status = "uploading";
        item.error = "";
        try {
          const result = await this.ports.upload({
            id: target.id,
            version: item.boundVersion,
            file: item.file,
            key: item.key,
          });
          if (!valid()) break;
          if (!validId(result?.id))
            throw new Error("图片保存响应不完整，请按原请求重试。");
          item.status = "uploaded";
          item.failureCode = undefined;
          item.conflictVersion = undefined;
        } catch (failure) {
          if (!valid()) break;
          const error = failure as {
            message?: string;
            code?: number;
            current?: { version?: number };
          };
          item.status = "failed";
          item.error = error.message ?? "图片上传失败，请重试。";
          item.failureCode = error.code ?? 0;
          item.conflictVersion =
            error.code === 409 && Number.isSafeInteger(error.current?.version)
              ? error.current!.version
              : undefined;
        }
      }
    } finally {
      if (valid()) this.busy = false;
    }
  }

  dispose() {
    if (!this.alive) return;
    this.alive = false;
    this.generation++;
    for (const item of this.entries) this.ports.revokePreview(item.preview);
    this.entries = [];
    this.busy = false;
  }
}

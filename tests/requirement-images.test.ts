import { describe, expect, it, vi } from "vitest";
import { RequirementImageDelivery } from "../apps/web/src/requirementImages.js";

const image = (name = "synthetic.png", size = 3, type = "image/png") =>
  new File([new Uint8Array(size)], name, { type });
const error = (code: number, version?: number) =>
  Object.assign(new Error("Synthetic upload failure"), {
    code,
    ...(version ? { current: { version } } : {}),
  });
function queue(
  upload = vi.fn(
    async (_request: any): Promise<{ id: string }> => ({ id: "attachment-1" }),
  ),
) {
  let serial = 0;
  const ports = {
    upload,
    createPreview: vi.fn(() => "blob:synthetic-" + ++serial),
    revokePreview: vi.fn(),
    newKey: () => "synthetic-key-" + ++serial,
  };
  return { delivery: new RequirementImageDelivery(ports), ports };
}

describe("pending requirement image delivery", () => {
  it("reports invalid files and limits without persisting or silently accepting them", () => {
    const { delivery } = queue();
    const rejected = delivery.add([
      image(),
      image("bad.svg", 1, "image/svg+xml"),
      image("big.png", 5 * 1024 * 1024 + 1),
      image("empty.png", 0),
    ]);
    expect(delivery.entries).toHaveLength(1);
    expect(rejected).toHaveLength(3);
    expect(rejected.join(" ")).toMatch(/格式|PNG/);
    expect(rejected.join(" ")).toContain("5 MiB");
    expect(
      delivery.add(
        Array.from({ length: 10 }, (_, n) => image("image-" + n + ".png")),
        2,
      ),
    ).toHaveLength(3);
    expect(delivery.entries).toHaveLength(8);
  });

  it("sends sequentially, keeps partial failures and never retries successful entries", async () => {
    let active = 0,
      maxActive = 0;
    const seen: string[] = [];
    const upload = vi.fn(async (request: any) => {
      active++;
      maxActive = Math.max(maxActive, active);
      seen.push(request.file.name);
      await Promise.resolve();
      active--;
      if (
        request.file.name === "two.png" &&
        seen.filter((x) => x === "two.png").length === 1
      )
        throw error(503);
      return { id: "attachment-" + request.file.name.replace(/\./g, "-") };
    });
    const { delivery } = queue(upload);
    delivery.add([image("one.png"), image("two.png"), image("three.png")]);
    delivery.bindTarget({ id: "requirement-1", version: 2 });
    await delivery.uploadFailed();
    expect(maxActive).toBe(1);
    expect(delivery.successfulCount).toBe(2);
    expect(delivery.failedCount).toBe(1);
    expect(delivery.hasUnsavedFiles).toBe(true);
    await delivery.uploadFailed();
    expect(seen).toEqual(["one.png", "two.png", "three.png", "two.png"]);
    expect(delivery.allUploaded).toBe(true);
  });

  it("replays an unknown response with exactly the original file, version and key", async () => {
    const saved = new Map<string, { id: string }>();
    const upload = vi.fn(async (request: any) => {
      if (saved.has(request.key)) return saved.get(request.key)!;
      saved.set(request.key, { id: "one-server-attachment" });
      throw error(0);
    });
    const { delivery } = queue(upload);
    const file = image();
    delivery.add([file]);
    delivery.bindTarget({ id: "requirement-1", version: 4 });
    await delivery.uploadFailed();
    expect(delivery.adoptConflictedVersion(5)).toBe(false);
    await delivery.uploadFailed();
    expect(upload.mock.calls[1][0]).toEqual(upload.mock.calls[0][0]);
    expect(upload.mock.calls[1][0].file).toBe(file);
    expect(saved.size).toBe(1);
    expect(delivery.successfulCount).toBe(1);
  });

  it("only rebinds definitively conflicted items after explicit version adoption", async () => {
    const upload = vi.fn(async (_request: any): Promise<{ id: string }> => {
      throw error(409, 5);
    });
    const { delivery } = queue(upload);
    delivery.add([image()]);
    delivery.bindTarget({ id: "requirement-1", version: 4 });
    await delivery.uploadFailed();
    const prior = { ...upload.mock.calls[0][0] };
    expect(delivery.conflictVersion).toBe(5);
    expect(delivery.adoptConflictedVersion(5)).toBe(true);
    upload.mockResolvedValue({ id: "attachment-after-adopt" });
    await delivery.uploadFailed();
    const retry = upload.mock.calls[1][0];
    expect(retry.version).toBe(5);
    expect(retry.key).not.toBe(prior.key);
    expect(retry.file).toBe(prior.file);
  });

  it("blocks duplicate sends and selection while uploading", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const upload = vi.fn(async (_request: any) => {
      await pending;
      return { id: "one-attachment" };
    });
    const { delivery } = queue(upload);
    delivery.add([image()]);
    delivery.bindTarget({ id: "requirement-1", version: 1 });
    const first = delivery.uploadFailed();
    await delivery.uploadFailed();
    expect(delivery.add([image("extra.png")])).toHaveLength(1);
    expect(upload).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(delivery.entries).toHaveLength(1);
  });

  it("disposes file references/previews and ignores a late completion", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { delivery, ports } = queue(
      vi.fn(async (_request: any) => {
        await pending;
        return { id: "late-attachment" };
      }),
    );
    delivery.add([image()]);
    delivery.bindTarget({ id: "requirement-1", version: 1 });
    const request = delivery.uploadFailed();
    delivery.dispose();
    release();
    await request;
    expect(delivery.entries).toEqual([]);
    expect(delivery.busy).toBe(false);
    expect(ports.revokePreview).toHaveBeenCalledTimes(1);
    delivery.dispose();
    expect(ports.revokePreview).toHaveBeenCalledTimes(1);
  });

  it("removes only unsaved files and validates a confirmed object before sending", async () => {
    const { delivery, ports } = queue();
    delivery.add([image()]);
    await expect(delivery.uploadFailed()).rejects.toThrow(/保存/);
    expect(() =>
      delivery.bindTarget({ id: "../unsafe", version: 0 }),
    ).toThrow();
    const id = delivery.entries[0].id;
    delivery.remove(id);
    expect(ports.revokePreview).toHaveBeenCalledTimes(1);
    delivery.add([image()]);
    delivery.bindTarget({ id: "requirement-1", version: 1 });
    await delivery.uploadFailed();
    expect(delivery.remove(delivery.entries[0].id)).toBe(false);
    expect(delivery.successfulCount).toBe(1);
  });
});

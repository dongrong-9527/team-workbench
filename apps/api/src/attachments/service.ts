import type { Database } from "better-sqlite3";
import { constants } from "node:fs";
import { open, readFile, rename, unlink } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { createPolicy } from "../access/policy.js";
import { DomainError, mutate, type MutationContext } from "../db/mutate.js";
import type { Ref } from "../../../../packages/contracts/src/index.js";
import { safeDirectory, storagePath, syncDirectory } from "./files.js";
export interface Upload {
  stream: AsyncIterable<Uint8Array>;
  mime: string;
  name: string;
  size: number;
}
export interface Attachment {
  id: string;
  target: Ref;
  sha256: string;
  size: number;
  mime: string;
  storageKey: string;
}
export interface AttachmentOptions {
  directory: string;
  maxBytes?: number;
  maxPixels?: number;
  maxPerObject?: number;
  maxTotalBytes?: number;
  maxConcurrent?: number;
}
export const attachmentDefaults = {
  maxBytes: 5 * 1024 * 1024,
  maxPixels: 20_000_000,
  maxPerObject: 10,
  maxTotalBytes: 5 * 1024 ** 3,
  maxConcurrent: 2,
};
export function attachmentLimits(options: AttachmentOptions) {
  const limits = { ...attachmentDefaults, ...options };
  for (const key of Object.keys(
    attachmentDefaults,
  ) as (keyof typeof attachmentDefaults)[])
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1)
      throw new Error("Invalid attachment limit");
  return limits;
}
export function attachmentRef(kind: string, id: string): Ref {
  if (
    !["requirement", "task", "bug"].includes(kind) ||
    !id ||
    id.length > 128 ||
    /[\\/\u0000-\u001f]/.test(id)
  )
    throw new DomainError(400, "Invalid target");
  return { kind: kind as Ref["kind"], id };
}
export function attachmentRow(row: any): Attachment {
  return {
    id: row.id,
    target: { kind: row.target_kind, id: row.target_id },
    sha256: row.sha256,
    size: row.size,
    mime: row.mime,
    storageKey: row.storage_key,
  };
}
export function publicAttachment(a: Attachment) {
  const { storageKey, ...publicData } = a;
  return publicData;
}
const inFlight = new Map<string, number>();
export function createAttachmentService(
  db: Database,
  options: AttachmentOptions,
) {
  const limits = attachmentLimits(options);
  function authorize(ctx: MutationContext, target: Ref) {
    ctx.authorize(db);
    createPolicy(db).authorize(ctx.actorId, "attach", target);
  }
  async function storeAttachment(
    ctx: MutationContext,
    target: Ref,
    file: Upload,
  ): Promise<Attachment> {
    target = attachmentRef(target.kind, target.id);
    authorize(ctx, target);
    if (!Number.isSafeInteger(ctx.expectedVersion) || ctx.expectedVersion! < 1)
      throw new DomainError(400, "expectedVersion required");
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      file.size > limits.maxBytes
    )
      throw new DomainError(413, "Image size limit exceeded");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.mime))
      throw new DomainError(
        415,
        "Only PNG, JPEG and WebP images are supported",
      );
    if (
      !file.name ||
      file.name.length > 255 ||
      /[\\/\u0000-\u001f\u007f]/.test(file.name) ||
      file.name === "." ||
      file.name === ".."
    )
      throw new DomainError(400, "Invalid filename");
    const directory = await safeDirectory(options.directory, true);
    if ((inFlight.get(directory) ?? 0) >= limits.maxConcurrent)
      throw new DomainError(429, "Too many image uploads");
    inFlight.set(directory, (inFlight.get(directory) ?? 0) + 1);
    const key = randomBytes(32).toString("hex"),
      tmp = storagePath(directory, key) + ".tmp",
      path = storagePath(directory, key);
    let published = false;
    try {
      const f = await open(tmp, "wx", 0o600);
      let total = 0;
      const inputHash = createHash("sha256");
      try {
        for await (const chunk of file.stream) {
          total += chunk.length;
          if (total > limits.maxBytes)
            throw new DomainError(413, "Image size limit exceeded");
          inputHash.update(chunk);
          await f.writeFile(chunk);
        }
        await f.sync();
      } finally {
        await f.close();
      }
      if (total !== file.size)
        throw new DomainError(400, "Image size mismatch");
      const input = await readFile(tmp);
      const format = input
        .subarray(0, 8)
        .equals(Buffer.from("89504e470d0a1a0a", "hex"))
        ? "png"
        : input[0] === 255 && input[1] === 216 && input[2] === 255
          ? "jpeg"
          : input.toString("ascii", 0, 4) === "RIFF" &&
              input.toString("ascii", 8, 12) === "WEBP"
            ? "webp"
            : undefined;
      if (!format || file.mime !== `image/${format}`)
        throw new DomainError(415, "Image type mismatch");
      let encoded: Buffer;
      try {
        const decoder = sharp(input, {
          failOn: "warning",
          limitInputPixels: limits.maxPixels,
          animated: true,
        });
        const meta = await decoder.metadata();
        if (
          meta.format !== format ||
          (meta.pages ?? 1) !== 1 ||
          !meta.width ||
          !meta.height ||
          meta.width * meta.height > limits.maxPixels
        )
          throw new Error("Invalid image dimensions or frames");
        // Full decode and canonical re-encode strips metadata and trailing executable/polyglot bytes.
        encoded = await decoder
          .rotate()
          .toFormat(format)
          .timeout({ seconds: 15 })
          .toBuffer();
      } catch {
        throw new DomainError(
          415,
          "Invalid image or pixel/frame limit exceeded",
        );
      }
      if (encoded.length > limits.maxBytes)
        throw new DomainError(413, "Encoded image size limit exceeded");
      const staged = await open(tmp, "w", 0o600);
      try {
        await staged.writeFile(encoded);
        await staged.sync();
      } finally {
        await staged.close();
      }
      await rename(tmp, path);
      published = true;
      await syncDirectory(directory);
      const a: Attachment = {
        id: randomUUID(),
        target,
        sha256: createHash("sha256").update(encoded).digest("hex"),
        size: encoded.length,
        mime: file.mime,
        storageKey: key,
      };
      const bound = {
        ...ctx,
        bodyHash: createHash("sha256")
          .update(
            JSON.stringify([
              target,
              ctx.expectedVersion,
              file.name,
              file.mime,
              file.size,
              inputHash.digest("hex"),
            ]),
          )
          .digest("hex"),
        authorize: () => authorize(ctx, target),
      };
      return mutate(db, bound, () => {
        const object = db
          .prepare("SELECT version,current FROM objects WHERE id=? AND kind=?")
          .get(target.id, target.kind) as { version: number; current: string };
        if (object.version !== ctx.expectedVersion)
          throw new DomainError(409, "Version conflict", {
            id: target.id,
            version: object.version,
            current: JSON.parse(object.current),
          });
        const count = db
          .prepare("SELECT count(*) n FROM attachments WHERE target_id=?")
          .get(target.id) as { n: number };
        const used = db
          .prepare("SELECT coalesce(sum(size),0) n FROM attachments")
          .get() as { n: number };
        if (
          count.n >= limits.maxPerObject ||
          used.n + a.size > limits.maxTotalBytes
        )
          throw new DomainError(413, "Attachment quota exceeded");
        const now = new Date().toISOString();
        db.prepare(
          "INSERT INTO attachments(id,target_id,target_kind,sha256,size,mime,storage_key,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          a.id,
          target.id,
          target.kind,
          a.sha256,
          a.size,
          a.mime,
          key,
          ctx.actorId,
          now,
        );
        const actor = db
          .prepare("SELECT name FROM members WHERE id=?")
          .get(ctx.actorId) as { name: string };
        db.prepare(
          "INSERT INTO events(time,action,actor_id,target_kind,target_id,after_snapshot) VALUES(?,'attachmentAdded',?,?,?,?)",
        ).run(
          now,
          ctx.actorId,
          target.kind,
          target.id,
          JSON.stringify({
            actorName: actor.name,
            attachment: publicAttachment(a),
          }),
        );
        return a;
      });
    } finally {
      // Replay returns an older registered object. Only this attempt's unregistered candidate is removed.
      try {
        await unlink(tmp).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== "ENOENT") throw e;
        });
        if (
          published &&
          !db.prepare("SELECT 1 FROM attachments WHERE storage_key=?").get(key)
        )
          await unlink(path);
      } finally {
        inFlight.set(directory, (inFlight.get(directory) ?? 1) - 1);
      }
    }
  }
  return { storeAttachment, authorize, limits };
}

import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { requireRequest, mutationContext } from "../auth/guards.js";
import { DomainError } from "../db/mutate.js";
import { createPolicy } from "../access/policy.js";
import {
  createAttachmentService,
  attachmentRef,
  attachmentRow,
  publicAttachment,
  type AttachmentOptions,
} from "./service.js";
import { safeDirectory, storagePath } from "./files.js";
export function attachmentRoutes(
  app: FastifyInstance,
  db: Database,
  options: AttachmentOptions,
) {
  const service = createAttachmentService(db, options);
  app.register(async (scope) => {
    await scope.register(multipart, {
      preservePath: true,
      limits: {
        fileSize: service.limits.maxBytes,
        files: 1,
        fields: 0,
        parts: 1,
        headerPairs: 20,
      },
      throwFileSizeLimit: true,
    });
    scope.post<{
      Params: { kind: string; id: string };
      Querystring: { expectedVersion?: string; size?: string };
    }>(
      "/api/objects/:kind/:id/attachments",
      {
        onRequest: async (request) => {
          const ctx = mutationContext(db, request);
          service.authorize(
            ctx,
            attachmentRef(request.params.kind, request.params.id),
          );
        },
      },
      async (request) => {
        const target = attachmentRef(request.params.kind, request.params.id),
          ctx = mutationContext(db, request);
        if (
          Object.keys(request.query).some(
            (k) => !["expectedVersion", "size"].includes(k),
          )
        )
          throw new DomainError(400, "Invalid query");
        ctx.expectedVersion = Number(request.query.expectedVersion);
        try {
          const parts = request.parts(),
            first = await parts.next();
          if (
            first.done ||
            first.value.type !== "file" ||
            first.value.fieldname !== "image"
          )
            throw new DomainError(400, "One image is required");
          const part = first.value;
          async function* stream() {
            for await (const chunk of part.file) yield chunk;
            if (part.file.truncated)
              throw new DomainError(413, "Image size limit exceeded");
            if (!(await parts.next()).done)
              throw new DomainError(400, "One image is required");
          }
          return publicAttachment(
            await service.storeAttachment(ctx, target, {
              stream: stream(),
              mime: part.mimetype,
              name: part.filename,
              size: Number(request.query.size),
            }),
          );
        } catch (error) {
          if (
            error instanceof Error &&
            /^(Unexpected end of multipart data|.* terminated early due to unexpected end of multipart data|Multipart: Boundary not found)$/.test(
              error.message,
            )
          )
            throw new DomainError(400, "Malformed multipart image");
          throw error;
        }
      },
    );
  });
  app.get<{
    Params: { kind: string; id: string };
    Querystring: { after?: string; limit?: string };
  }>("/api/objects/:kind/:id/attachments", (request) => {
    const actor = requireRequest(db, request),
      target = attachmentRef(request.params.kind, request.params.id);
    createPolicy(db).authorize(actor.id, "read", target);
    const after = Number(request.query.after ?? 0),
      limit = Number(request.query.limit ?? 20);
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      Object.keys(request.query).some((k) => !["after", "limit"].includes(k))
    )
      throw new DomainError(400, "Invalid page");
    const rows = db
      .prepare(
        "SELECT * FROM attachments WHERE target_id=? AND target_kind=? AND seq>? ORDER BY seq LIMIT ?",
      )
      .all(target.id, target.kind, after, limit + 1) as any[];
    return {
      items: rows
        .slice(0, limit)
        .map((row) => publicAttachment(attachmentRow(row))),
      nextAfter: rows.length > limit ? rows[limit - 1].seq : null,
    };
  });
  app.get<{ Params: { id: string } }>(
    "/api/attachments/:id/content",
    async (request, reply) => {
      const actor = requireRequest(db, request);
      const row = db
        .prepare("SELECT * FROM attachments WHERE id=?")
        .get(request.params.id);
      if (!row) throw new DomainError(404, "Attachment not found");
      const a = attachmentRow(row);
      createPolicy(db).authorize(actor.id, "read", a.target);
      const dir = await safeDirectory(options.directory);
      const file = await open(
        storagePath(dir, a.storageKey),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== a.size) {
        await file.close();
        throw new Error("Attachment unavailable");
      }
      // Revalidate after file IO as sessions may be revoked while awaiting the disk.
      try {
        requireRequest(db, request);
        createPolicy(db).authorize(actor.id, "read", a.target);
      } catch (e) {
        await file.close();
        throw e;
      }
      return reply
        .header("Content-Type", a.mime)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .header("Content-Disposition", "inline")
        .header("Content-Length", a.size)
        .send(file.createReadStream());
    },
  );
}

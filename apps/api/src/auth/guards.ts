import { createHmac } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { FastifyRequest } from "fastify";
import { DomainError, type MutationContext } from "../db/mutate.js";
import { digest, requireMember, type Member } from "./session.js";

export function sessionToken(request: FastifyRequest): string {
  const cookies = (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim());
  const values = cookies.filter((part) => part.startsWith("session="));
  return values.length === 1 ? values[0]!.slice(8) : "";
}

export function checkOrigin(request: FastifyRequest, origin: string): void {
  if (request.headers.origin !== origin)
    throw new DomainError(403, "Origin denied");
}

export function requireRequest(
  db: Database,
  request: FastifyRequest,
  write = false,
): Member {
  const token = sessionToken(request);
  const member = requireMember(db, token, !write);
  if (write) {
    const csrf = request.headers["x-csrf-token"];
    const row = db
      .prepare("SELECT csrf_digest FROM sessions WHERE token_digest=?")
      .get(digest(token)) as { csrf_digest: string } | undefined;
    if (
      !row ||
      typeof csrf !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(csrf) ||
      digest(csrf) !== row.csrf_digest
    ) {
      throw new DomainError(403, "CSRF denied");
    }
  }
  return member;
}

export function mutationContext(
  db: Database,
  request: FastifyRequest,
  admin = false,
): MutationContext {
  const member = requireRequest(db, request, true);
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(key))
    throw new DomainError(400, "Invalid Idempotency-Key");
  const body = request.body as { expectedVersion?: number } | undefined;
  return {
    actorId: member.id,
    requestId: key,
    route: request.url,
    bodyHash:
      request.routeOptions.url === "/api/auth/password"
        ? createHmac("sha256", sessionToken(request))
            .update(JSON.stringify(request.body ?? {}))
            .digest("hex")
        : digest(JSON.stringify(request.body ?? {})),
    ...(body?.expectedVersion !== undefined
      ? { expectedVersion: body.expectedVersion }
      : {}),
    authorize: () => {
      const current = requireRequest(db, request, true);
      if (current.id !== member.id || (admin && !current.isAdmin))
        throw new DomainError(403, "Permission denied");
      requireMember(db, sessionToken(request));
    },
  };
}

export function fields(
  body: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new DomainError(400, "Invalid request");
  const result = body as Record<string, unknown>;
  if (
    Object.keys(result).some(
      (key) => ![...required, ...optional].includes(key),
    ) ||
    required.some((key) => !(key in result))
  ) {
    throw new DomainError(400, "Invalid request");
  }
  return result;
}

export function text(value: unknown, min: number, max: number): string {
  if (
    typeof value !== "string" ||
    Buffer.from(value).toString("utf8") !== value ||
    value.length < min ||
    value.length > max ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new DomainError(400, "Invalid request");
  }
  return value;
}

export function loginName(value: unknown): string {
  const login = text(value, 1, 64);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(login))
    throw new DomainError(400, "Invalid login");
  return login;
}

export function securityTransaction<T>(db: Database, run: () => T): T {
  try {
    return db.transaction(run).immediate();
  } catch (error) {
    if ((error as { code?: string }).code?.startsWith("SQLITE_BUSY"))
      throw new DomainError(503, "Database busy; retry later");
    throw error;
  }
}

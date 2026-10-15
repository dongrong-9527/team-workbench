import type { Database } from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { DomainError, mutate } from "../db/mutate.js";
import {
  getMember,
  memberEvent,
  snapshot,
  type MemberRow,
} from "../members/service.js";
import {
  fields,
  loginName,
  mutationContext,
  requireRequest,
  securityTransaction,
  text,
  sessionToken,
} from "./guards.js";
import {
  DUMMY_HASH,
  hashPassword,
  validatePassword,
  verifyPassword,
} from "./password.js";
import {
  clearCookie,
  cookie,
  csrfForSession,
  digest,
  issueSession,
  revokeSessions,
} from "./session.js";

const WINDOW = 15 * 60 * 1000;
const failure = (): DomainError => new DomainError(401, "Invalid credentials");

function rateBucket(request: FastifyRequest, identifier: string): string {
  return digest(`${request.routeOptions.url}\0${identifier}\0${request.ip}`);
}
function checkRate(db: Database, bucket: string): void {
  const row = db
    .prepare("SELECT failures,started_at FROM auth_failures WHERE bucket=?")
    .get(bucket) as { failures: number; started_at: number } | undefined;
  if (row && Date.now() - row.started_at < WINDOW && row.failures >= 5)
    throw new DomainError(429, "Too many attempts; retry later");
}
function failed(db: Database, bucket: string): never {
  const now = Date.now();
  db.prepare("DELETE FROM auth_failures WHERE started_at<=?").run(now - WINDOW);
  db.prepare(
    `INSERT INTO auth_failures VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET failures=failures+1`,
  ).run(bucket, now);
  throw failure();
}
function clearRate(db: Database, bucket: string): void {
  db.prepare("DELETE FROM auth_failures WHERE bucket=?").run(bucket);
}
interface Ticket {
  member_id: string;
  kind: string;
  expires_at: number;
}
function ticket(db: Database, token: string, kind: string): Ticket | undefined {
  const row = db
    .prepare(
      "SELECT member_id,kind,expires_at FROM auth_tickets WHERE token_digest=?",
    )
    .get(digest(token)) as Ticket | undefined;
  if (!row || row.kind !== kind || row.expires_at <= Date.now())
    return undefined;
  const member = getMember(db, row.member_id);
  if (!member.active || (kind === "activate" && member.password_hash !== null))
    return undefined;
  return row;
}

export function authRoutes(app: FastifyInstance, db: Database): void {
  app.get("/api/auth/session", (request) => ({
    member: requireRequest(db, request),
    csrfToken: csrfForSession(sessionToken(request)),
  }));
  app.post("/api/auth/login", async (request, reply) => {
    const body = fields(request.body, ["login", "password"]);
    const login = loginName(body.login);
    validatePassword(body.password);
    const bucket = rateBucket(request, login);
    checkRate(db, bucket);
    const member = db
      .prepare("SELECT * FROM members WHERE login=?")
      .get(login) as MemberRow | undefined;
    const valid = await verifyPassword(
      body.password,
      member?.password_hash ?? DUMMY_HASH,
    );
    const session = securityTransaction(db, () => {
      checkRate(db, bucket);
      const current = member ? getMember(db, member.id) : undefined;
      if (
        !valid ||
        !current?.active ||
        !current.password_hash ||
        current.password_hash !== member?.password_hash ||
        current.version !== member.version
      )
        return undefined;
      clearRate(db, bucket);
      return issueSession(db, current.id);
    });
    if (!session) return failed(db, bucket);
    reply.header("set-cookie", cookie(session.token));
    reply.header("cache-control", "no-store");
    return { csrfToken: session.csrfToken };
  });
  app.post("/api/auth/logout", (request, reply) => {
    fields(request.body, []);
    const ctx = mutationContext(db, request);
    const result = mutate(db, ctx, () => {
      db.prepare("DELETE FROM sessions WHERE token_digest=?").run(
        digest(sessionToken(request)),
      );
      return { loggedOut: true };
    });
    reply.header("set-cookie", clearCookie);
    return result;
  });
  for (const kind of ["activate", "reset"] as const) {
    app.post(`/api/auth/${kind}`, async (request) => {
      const passwordField = kind === "activate" ? "password" : "newPassword";
      const body = fields(request.body, ["token", passwordField]);
      const token = text(body.token, 43, 43);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token))
        throw new DomainError(400, "Invalid request");
      const password = body[passwordField];
      validatePassword(password);
      const bucket = rateBucket(request, "ticket-ip");
      checkRate(db, bucket);
      const initial = ticket(db, token, kind);
      if (!initial) return failed(db, bucket);
      const initialMember = getMember(db, initial.member_id);
      const hash = await hashPassword(password);
      const result = securityTransaction(db, () => {
        checkRate(db, bucket);
        const current = ticket(db, token, kind);
        if (
          !current ||
          getMember(db, current.member_id).version !== initialMember.version
        )
          return undefined;
        const before = snapshot(getMember(db, current.member_id));
        db.prepare(
          "UPDATE members SET password_hash=?,version=version+1 WHERE id=?",
        ).run(hash, current.member_id);
        db.prepare("DELETE FROM auth_tickets WHERE member_id=?").run(
          current.member_id,
        );
        revokeSessions(db, current.member_id);
        memberEvent(db, current.member_id, current.member_id, kind, before);
        clearRate(db, bucket);
        return { changed: true };
      });
      return result ?? failed(db, bucket);
    });
  }
  app.post("/api/auth/password", async (request) => {
    const body = fields(request.body, ["currentPassword", "newPassword"]);
    validatePassword(body.currentPassword);
    validatePassword(body.newPassword);
    const ctx = mutationContext(db, request);
    const initial = getMember(db, ctx.actorId);
    const bucket = rateBucket(request, ctx.actorId);
    checkRate(db, bucket);
    if (
      !(await verifyPassword(
        body.currentPassword,
        initial.password_hash ?? DUMMY_HASH,
      ))
    )
      return failed(db, bucket);
    const hash = await hashPassword(body.newPassword);
    return mutate(db, ctx, () => {
      checkRate(db, bucket);
      const current = getMember(db, ctx.actorId);
      if (
        current.password_hash !== initial.password_hash ||
        current.version !== initial.version
      )
        throw new DomainError(409, "Credentials changed; retry");
      db.prepare(
        "UPDATE members SET password_hash=?,version=version+1 WHERE id=?",
      ).run(hash, ctx.actorId);
      revokeSessions(db, ctx.actorId);
      db.prepare("DELETE FROM auth_tickets WHERE member_id=?").run(ctx.actorId);
      memberEvent(db, ctx.actorId, ctx.actorId, "password", snapshot(current));
      clearRate(db, bucket);
      return { changed: true };
    });
  });
}

import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";
import { DomainError } from "../db/mutate.js";

export interface Member {
  id: string;
  displayName: string;
  active: boolean;
  isAdmin: boolean;
}
export const IDLE_MS = 30 * 60 * 1000;
export const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
export const csrfForSession = (token: string): string =>
  createHmac("sha256", token).update("workbench csrf v1").digest("base64url");
export const opaqueToken = (): string => randomBytes(32).toString("base64url");
export const cookie = (token: string): string =>
  `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`;
export const clearCookie =
  "session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";

export function requireMember(
  db: Database,
  sessionToken: string,
  touch = true,
): Member {
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionToken))
    throw new DomainError(401, "Authentication required");
  const row = db
    .prepare(
      `SELECT m.id,m.name,m.active,m.is_admin,s.created_at,s.last_seen
    FROM sessions s JOIN members m ON m.id=s.member_id WHERE s.token_digest=?`,
    )
    .get(digest(sessionToken)) as
    | {
        id: string;
        name: string;
        active: number;
        is_admin: number;
        created_at: number;
        last_seen: number;
      }
    | undefined;
  const now = Date.now();
  if (
    !row ||
    !row.active ||
    now - row.created_at >= ABSOLUTE_MS ||
    now - row.last_seen >= IDLE_MS
  ) {
    throw new DomainError(401, "Authentication required");
  }
  if (touch)
    db.prepare("UPDATE sessions SET last_seen=? WHERE token_digest=?").run(
      now,
      digest(sessionToken),
    );
  return {
    id: row.id,
    displayName: row.name,
    active: true,
    isAdmin: Boolean(row.is_admin),
  };
}

export function issueSession(
  db: Database,
  memberId: string,
): { token: string; csrfToken: string } {
  const token = opaqueToken();
  const csrfToken = csrfForSession(token);
  const now = Date.now();
  db.prepare("INSERT INTO sessions VALUES (?,?,?,?,?)").run(
    digest(token),
    memberId,
    digest(csrfToken),
    now,
    now,
  );
  return { token, csrfToken };
}

export function revokeSessions(db: Database, memberId: string): void {
  db.prepare("DELETE FROM sessions WHERE member_id=?").run(memberId);
}

import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { DomainError, mutate, type MutationContext } from "../db/mutate.js";
import { digest, opaqueToken, revokeSessions } from "../auth/session.js";

export interface MemberRow {
  id: string;
  name: string;
  active: number;
  is_admin: number;
  login: string | null;
  password_hash: string | null;
  version: number;
}
export function getMember(db: Database, id: string): MemberRow {
  const row = db.prepare("SELECT * FROM members WHERE id=?").get(id) as
    | MemberRow
    | undefined;
  if (!row) throw new DomainError(404, "Member not found");
  return row;
}
export function snapshot(row: MemberRow): Record<string, unknown> {
  return {
    id: row.id,
    displayName: row.name,
    active: Boolean(row.active),
    isAdmin: Boolean(row.is_admin),
    version: row.version,
  };
}
export function memberEvent(
  db: Database,
  actor: string,
  id: string,
  action: string,
  before: Record<string, unknown> | null,
): void {
  db.prepare(
    `INSERT INTO events (time,action,actor_id,target_kind,target_id,before_snapshot,after_snapshot)
    VALUES (?,?,?,'member',?,?,?)`,
  ).run(
    new Date().toISOString(),
    action,
    actor,
    id,
    before ? JSON.stringify(before) : null,
    JSON.stringify(snapshot(getMember(db, id))),
  );
}
export function issueTicket(
  db: Database,
  id: string,
  kind: "activate" | "reset",
): string {
  const token = opaqueToken();
  db.prepare("DELETE FROM auth_tickets WHERE member_id=?").run(id);
  db.prepare("INSERT INTO auth_tickets VALUES (?,?,?,?)").run(
    digest(token),
    id,
    kind,
    Date.now() + 24 * 60 * 60 * 1000,
  );
  return token;
}
export function createMember(
  db: Database,
  ctx: MutationContext,
  login: string,
  displayName: string,
): Record<string, unknown> {
  let raw: string | undefined;
  const result = mutate(db, ctx, () => {
    if (db.prepare("SELECT 1 FROM members WHERE login=?").get(login))
      throw new DomainError(409, "Login already exists");
    const id = randomUUID();
    db.prepare("INSERT INTO members (id,name,login) VALUES (?,?,?)").run(
      id,
      displayName,
      login,
    );
    raw = issueTicket(db, id, "activate");
    memberEvent(db, ctx.actorId, id, "create", null);
    return { id, version: 1, ticketIssued: true };
  });
  return raw ? { ...result, activationToken: raw } : result;
}
export function manageMember(
  db: Database,
  ctx: MutationContext,
  id: string,
  action: "deactivate" | "reset",
): Record<string, unknown> {
  let raw: string | undefined;
  const result = mutate(db, ctx, () => {
    const old = getMember(db, id);
    if (ctx.expectedVersion === undefined)
      throw new DomainError(400, "expectedVersion is required");
    if (ctx.expectedVersion !== old.version)
      throw new DomainError(409, "Version conflict", snapshot(old));
    if (!old.active) throw new DomainError(422, "Member is inactive");
    if (
      action === "deactivate" &&
      old.is_admin &&
      !db
        .prepare(
          "SELECT 1 FROM members WHERE active=1 AND is_admin=1 AND id<>?",
        )
        .get(id)
    ) {
      throw new DomainError(422, "Cannot deactivate the last administrator");
    }
    const before = snapshot(old);
    db.prepare("UPDATE members SET active=?,version=version+1 WHERE id=?").run(
      action === "deactivate" ? 0 : old.active,
      id,
    );
    revokeSessions(db, id);
    db.prepare("DELETE FROM auth_tickets WHERE member_id=?").run(id);
    if (action === "reset") raw = issueTicket(db, id, "reset");
    memberEvent(db, ctx.actorId, id, action, before);
    return {
      id,
      version: old.version + 1,
      ...(action === "reset" ? { ticketIssued: true } : {}),
    };
  });
  // Ticket retries intentionally return only safe metadata. Lost responses require a fresh key/version.
  return raw ? { ...result, resetToken: raw } : result;
}

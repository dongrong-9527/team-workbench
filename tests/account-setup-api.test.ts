import { expect, it } from "vitest";
import { createTestKit } from "./helpers.js";

it.each(["activate", "reset"] as const)("%s keeps unknown, expired and wrong-type code errors identical without consuming the other type", async kind => {
  const f = await createTestKit();
  try {
    const created = await f.api("POST", "/api/members", { login: "synthetic.ticket.state", displayName: "Synthetic state" }, "admin", "create-state");
    const issued = kind === "activate" ? created : await f.api("POST", `/api/members/${created.body.id}/reset`, { expectedVersion: 1 }, "admin", "reset-state");
    const code = String(issued.body[kind === "activate" ? "activationToken" : "resetToken"]);
    const passwordField = kind === "activate" ? "password" : "newPassword";
    const body = { token: code, [passwordField]: "Synthetic-password-123" };
    const unknown = await f.api("POST", `/api/auth/${kind}`, { ...body, token: "x".repeat(43) }, "anonymous");
    f.db.prepare("UPDATE auth_tickets SET expires_at=0").run();
    const expired = await f.api("POST", `/api/auth/${kind}`, body, "anonymous");
    expect(expired.status).toBe(401);
    expect(expired).toEqual(unknown);
    f.db.prepare("UPDATE auth_tickets SET expires_at=?").run(Date.now() + 86_400_000);
    const other = kind === "activate" ? "reset" : "activate";
    const wrongType = await f.api("POST", `/api/auth/${other}`, { token: code, [other === "activate" ? "password" : "newPassword"]: "Synthetic-password-123" }, "anonymous");
    expect(wrongType).toEqual(unknown);
    const good = await f.api("POST", `/api/auth/${kind}`, body, "anonymous");
    expect(good.status).toBe(200);
    const used = await f.api("POST", `/api/auth/${kind}`, body, "anonymous");
    expect(used).toEqual(unknown);
    expect(JSON.stringify(used.body)).not.toContain(code);
    expect(JSON.stringify(f.events("member", String(created.body.id)))).not.toContain(code);
  } finally { await f.close(); }
});

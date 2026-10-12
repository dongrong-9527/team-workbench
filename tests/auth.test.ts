import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
let f: TestKit;
beforeEach(async () => {
  f = await createTestKit();
});
afterEach(async () => {
  await f.close();
});
it("task_02 rejects anonymous sessions and immediately revokes disabled members", async () => {
  expect(
    (await f.api("GET", "/api/auth/session", {}, "anonymous")).status,
  ).toBe(401);
  expect((await f.api("GET", "/api/auth/session", {}, "dev")).status).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        "/api/members/dev/deactivate",
        {},
        "admin",
        "disable-1",
      )
    ).status,
  ).toBe(200);
  expect((await f.api("GET", "/api/auth/session", {}, "dev")).status).toBe(401);
  expect(f.events("member", "dev").at(-1)?.action).toBe("deactivate");
});
it("task_02 issues activation tickets once and activates managed accounts", async () => {
  const created = await f.api(
    "POST",
    "/api/members",
    { login: "new-user", displayName: "New User" },
    "admin",
    "create-1",
  );
  expect(created.status).toBe(200);
  expect(created.body.activationToken).toBeTypeOf("string");
  const replay = await f.api(
    "POST",
    "/api/members",
    { login: "new-user", displayName: "New User" },
    "admin",
    "create-1",
  );
  expect(replay.body.activationToken).toBeUndefined();
  expect(
    (
      await f.api(
        "POST",
        "/api/auth/activate",
        {
          token: created.body.activationToken,
          password: "Fictional pass 123!",
        },
        "anonymous",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.api(
        "POST",
        "/api/auth/activate",
        {
          token: created.body.activationToken,
          password: "Fictional pass 123!",
        },
        "anonymous",
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await f.api(
        "POST",
        "/api/auth/login",
        { login: "new-user", password: "Fictional pass 123!" },
        "anonymous",
      )
    ).status,
  ).toBe(200);
});
it("task_02 enforces admin rights, Origin, CSRF, and strict fields", async () => {
  expect(
    (
      await f.api(
        "POST",
        "/api/members",
        { login: "new-user", displayName: "New" },
        "dev",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await f.api("POST", "/api/members", {
        login: "new-user",
        displayName: "New",
        isAdmin: true,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await f.api(
        "POST",
        "/api/auth/login",
        { login: "none", password: "Fictional pass 123!", extra: 1 },
        "anonymous",
      )
    ).status,
  ).toBe(400);
});
it("task_02 reset issuance revokes sessions and invalidates tickets; password change revokes all sessions", async () => {
  const first = await f.api(
    "POST",
    "/api/members/dev/reset",
    {},
    "admin",
    "reset-1",
  );
  expect(first.status).toBe(200);
  expect((await f.api("GET", "/api/auth/session", {}, "dev")).status).toBe(401);
  const second = await f.api(
    "POST",
    "/api/members/dev/reset",
    { expectedVersion: 2 },
    "admin",
    "reset-2",
  );
  expect(
    (
      await f.api(
        "POST",
        "/api/auth/reset",
        { token: first.body.resetToken, newPassword: "Fictional pass 123!" },
        "anonymous",
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await f.api(
        "POST",
        "/api/auth/reset",
        { token: second.body.resetToken, newPassword: "Fictional pass 123!" },
        "anonymous",
      )
    ).status,
  ).toBe(200);
  const login = await fetch(f.baseUrl + "/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://workbench.test",
    },
    body: JSON.stringify({ login: "dev", password: "Fictional pass 123!" }),
  });
  expect(login.status).toBe(200);
  const body = (await login.json()) as { csrfToken: string };
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const changed = await fetch(f.baseUrl + "/api/auth/password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://workbench.test",
      cookie,
      "x-csrf-token": body.csrfToken,
      "idempotency-key": "change-1",
    },
    body: JSON.stringify({
      currentPassword: "Fictional pass 123!",
      newPassword: "Different pass 456!",
    }),
  });
  expect(changed.status).toBe(200);
  expect(
    (await fetch(f.baseUrl + "/api/auth/session", { headers: { cookie } }))
      .status,
  ).toBe(401);
});
it("task_02 expires tickets and sessions and rolls back lifecycle when event fails", async () => {
  const issued = await f.api("POST", "/api/members/dev/reset", {});
  expect(issued.status).toBe(200);
  f.db.prepare("UPDATE auth_tickets SET expires_at=0").run();
  expect(
    (
      await f.api(
        "POST",
        "/api/auth/reset",
        { token: issued.body.resetToken, newPassword: "Fictional pass 123!" },
        "anonymous",
      )
    ).status,
  ).toBe(401);
  f.db.prepare("UPDATE sessions SET last_seen=0 WHERE member_id=?").run("dev2");
  expect((await f.api("GET", "/api/auth/session", {}, "dev2")).status).toBe(
    401,
  );
  await f.failNextEvent();
  expect(
    (await f.api("POST", "/api/members/tester/deactivate", {})).status,
  ).toBe(500);
  expect((await f.api("GET", "/api/auth/session", {}, "tester")).status).toBe(
    200,
  );
});
it("task_02 never persists raw tickets or credentials in events and replay responses", async () => {
  const issued = await f.api("POST", "/api/members", {
    login: "new-user",
    displayName: "New User",
  });
  expect(issued.status).toBe(200);
  const rows = JSON.stringify({
    events: f.events(),
    commands: f.db.prepare("SELECT * FROM idempotency").all(),
    tickets: f.db.prepare("SELECT * FROM auth_tickets").all(),
  });
  expect(rows).not.toContain(issued.body.activationToken);
  expect(rows).not.toContain("password_hash");
  expect(rows).not.toContain("csrf");
});
it("task_02 rejects malicious/missing origins, missing CSRF and fake identity headers", async () => {
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(f.baseUrl + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  expect(
    (
      await post("/api/auth/login", {
        login: "dev",
        password: "Fictional pass 123!",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await post(
        "/api/auth/activate",
        { token: "x".repeat(43), password: "Fictional pass 123!" },
        { origin: "https://evil.test" },
      )
    ).status,
  ).toBe(403);
  const { issueSession } = await import("../apps/api/src/auth/session.js");
  const session = issueSession(f.db, "admin");
  expect(
    (
      await post(
        "/api/members",
        { login: "new-user", displayName: "New" },
        {
          origin: "https://workbench.test",
          cookie: `session=${session.token}`,
          "idempotency-key": "no-csrf",
        },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(f.baseUrl + "/api/auth/session", {
        headers: { "x-test-actor": "admin" },
      })
    ).status,
  ).toBe(401);
});
it("task_02 applies uniform login failures and a persistent five failure limit", async () => {
  const responses = [];
  for (let i = 0; i < 5; i++)
    responses.push(
      await f.api(
        "POST",
        "/api/auth/login",
        { login: "missing", password: "Fictional pass 123!" },
        "anonymous",
      ),
    );
  expect(responses.every((response) => response.status === 401)).toBe(true);
  expect(
    (
      await f.api(
        "POST",
        "/api/auth/login",
        { login: "missing", password: "Fictional pass 123!" },
        "anonymous",
      )
    ).status,
  ).toBe(429);
  const disabled = await f.api(
    "POST",
    "/api/auth/login",
    { login: "dev", password: "Fictional pass 123!" },
    "anonymous",
  );
  expect(disabled.body).toEqual(responses[0]!.body);
}, 15000);
it("task_02 bounds scrypt parameters, validates encoding/length and limits running and queued work", async () => {
  const { hashPassword, verifyPassword, SCRYPT } = await import(
    "../apps/api/src/auth/password.js"
  );
  expect(SCRYPT).toEqual({ N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
  for (const invalid of ["short", "x".repeat(129), "\ud800" + "a".repeat(12)])
    await expect(hashPassword(invalid)).rejects.toMatchObject({
      statusCode: 400,
    });
  const password = "  Fictional pass 123!  ";
  const encoded = await hashPassword(password);
  expect(encoded).toMatch(
    /^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/,
  );
  expect(await verifyPassword(password, encoded)).toBe(true);
  expect(await verifyPassword(password.trim(), encoded)).toBe(false);
  expect(
    await verifyPassword(password, encoded.replace("$131072$", "$1048576$")),
  ).toBe(false);
  const work = Array.from({ length: 7 }, () =>
    hashPassword("Fictional pass 123!"),
  );
  const results = await Promise.allSettled(work);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(6);
  expect(
    results.filter((result) => result.status === "rejected"),
  ).toMatchObject([{ reason: { statusCode: 429 } }]);
}, 15000);
it("task_02 bootstrap requires a TTY and an atomically empty database", async () => {
  const module = await import("../apps/api/src/cli/bootstrap-admin.js");
  await expect(
    module.bootstrapAdmin(f.db, {
      login: "root",
      displayName: "Root",
      password: "Fictional pass 123!",
      isTTY: false,
    }),
  ).rejects.toThrow("terminal");
  await expect(
    module.bootstrapAdmin(f.db, {
      login: "root",
      displayName: "Root",
      password: "Fictional pass 123!",
      isTTY: true,
    }),
  ).rejects.toThrow("empty");
});
it("task_02 denies old sessions before replay after logout, absolute expiry, reset and admin revocation", async () => {
  const { issueSession, digest, ABSOLUTE_MS } = await import(
    "../apps/api/src/auth/session.js"
  );
  const session = issueSession(f.db, "admin");
  const headers = {
    "content-type": "application/json",
    origin: "https://workbench.test",
    cookie: `session=${session.token}`,
    "x-csrf-token": session.csrfToken,
    "idempotency-key": "replay-admin",
  };
  const send = () =>
    fetch(f.baseUrl + "/api/members", {
      method: "POST",
      headers,
      body: JSON.stringify({ login: "replay-user", displayName: "Replay" }),
    });
  expect((await send()).status).toBe(200);
  f.db.prepare("UPDATE members SET is_admin=0 WHERE id=?").run("admin");
  expect((await send()).status).toBe(403);
  f.db.prepare("UPDATE members SET is_admin=1 WHERE id=?").run("admin");
  f.db
    .prepare("UPDATE sessions SET created_at=? WHERE token_digest=?")
    .run(Date.now() - ABSOLUTE_MS, digest(session.token));
  expect((await send()).status).toBe(401);
  const other = issueSession(f.db, "dev");
  const logoutHeaders = {
    ...headers,
    cookie: `session=${other.token}`,
    "x-csrf-token": other.csrfToken,
    "idempotency-key": "logout",
  };
  expect(
    (
      await fetch(f.baseUrl + "/api/auth/logout", {
        method: "POST",
        headers: logoutHeaders,
        body: "{}",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await fetch(f.baseUrl + "/api/auth/logout", {
        method: "POST",
        headers: logoutHeaders,
        body: "{}",
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(f.baseUrl + "/api/auth/session", {
        headers: { cookie: `session=${other.token}` },
      })
    ).status,
  ).toBe(401);
});
it("task_02 rechecks live identity inside mutation authorization before replay", async () => {
  const { mutationContext } = await import("../apps/api/src/auth/guards.js");
  const { issueSession, digest } = await import(
    "../apps/api/src/auth/session.js"
  );
  const { mutate } = await import("../apps/api/src/db/mutate.js");
  const session = issueSession(f.db, "admin");
  const request = {
    headers: {
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrfToken,
      "idempotency-key": "inside",
    },
    url: "/test/security",
    routeOptions: { url: "/test/security" },
    body: {},
  } as unknown as Parameters<typeof mutationContext>[1];
  const ctx = mutationContext(f.db, request, true);
  expect(mutate(f.db, ctx, () => ({ ok: true }))).toEqual({ ok: true });
  f.db
    .prepare("DELETE FROM sessions WHERE token_digest=?")
    .run(digest(session.token));
  expect(() => mutate(f.db, ctx, () => ({ unexpected: true }))).toThrow(
    "Authentication required",
  );
});
it("task_02 rolls back activation/reset state on event failure and consumes concurrent tickets once", async () => {
  const issued = await f.api("POST", "/api/members", {
    login: "race-user",
    displayName: "Race",
  });
  expect(issued.status).toBe(200);
  await f.failNextEvent();
  expect(
    (
      await f.api(
        "POST",
        "/api/auth/activate",
        { token: issued.body.activationToken, password: "Fictional pass 123!" },
        "anonymous",
      )
    ).status,
  ).toBe(500);
  expect(
    f.db
      .prepare("SELECT password_hash FROM members WHERE id=?")
      .get(issued.body.id),
  ).toEqual({ password_hash: null });
  const results = await Promise.all(
    [1, 2].map(() =>
      f.api(
        "POST",
        "/api/auth/activate",
        { token: issued.body.activationToken, password: "Fictional pass 123!" },
        "anonymous",
      ),
    ),
  );
  expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
  expect(
    f
      .events("member", String(issued.body.id))
      .filter((event) => event.action === "activate"),
  ).toHaveLength(1);
});
it("task_02 cannot activate a ticket revoked while its password is hashing", async () => {
  const issued = await f.api("POST", "/api/members", {
    login: "race-user",
    displayName: "Race",
  });
  const request = fetch(f.baseUrl + "/api/auth/activate", {
    method: "POST",
    headers: {
      origin: "https://workbench.test",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      token: issued.body.activationToken,
      password: "Fictional pass 123!",
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(
    (await f.api("POST", `/api/members/${issued.body.id}/deactivate`, {}))
      .status,
  ).toBe(200);
  expect((await request).status).toBe(401);
  expect(
    f.db
      .prepare("SELECT password_hash FROM members WHERE id=?")
      .get(issued.body.id),
  ).toEqual({ password_hash: null });
});
it("task_02 recovers a stable session-bound CSRF token across page reloads", async () => {
  const { issueSession } = await import("../apps/api/src/auth/session.js");
  const session = issueSession(f.db, "admin");
  const read = () =>
    fetch(f.baseUrl + "/api/auth/session", {
      headers: { cookie: `session=${session.token}` },
    }).then((response) => response.json());
  expect((await read()).csrfToken).toBe(session.csrfToken);
  expect((await read()).csrfToken).toBe(session.csrfToken);
});
it("task_02 password mutation binding is not a cheap offline credential verifier", async () => {
  const { hashPassword } = await import("../apps/api/src/auth/password.js");
  const { issueSession, digest } = await import(
    "../apps/api/src/auth/session.js"
  );
  f.db
    .prepare("UPDATE members SET password_hash=? WHERE id=?")
    .run(await hashPassword("Fictional pass 123!"), "dev");
  const session = issueSession(f.db, "dev");
  const body = {
    currentPassword: "Fictional pass 123!",
    newPassword: "Different pass 456!",
  };
  const response = await fetch(f.baseUrl + "/api/auth/password", {
    method: "POST",
    headers: {
      origin: "https://workbench.test",
      "content-type": "application/json",
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrfToken,
      "idempotency-key": "secret-binding",
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  const row = f.db
    .prepare("SELECT body_hash,response FROM idempotency WHERE request_id=?")
    .get("secret-binding") as { body_hash: string; response: string };
  expect(row.body_hash).not.toBe(digest(JSON.stringify(body)));
  expect(row.response).not.toContain("pass");
});
it("task_02 password boundary lengths and salts preserve exact Unicode and whitespace", async () => {
  const { hashPassword, verifyPassword } = await import(
    "../apps/api/src/auth/password.js"
  );
  for (const password of ["a".repeat(12), "a".repeat(128), "😀".repeat(12)]) {
    const hash = await hashPassword(password);
    expect(await verifyPassword(password, hash)).toBe(true);
  }
  expect(await hashPassword("Fictional pass 123!")).not.toBe(
    await hashPassword("Fictional pass 123!"),
  );
}, 15000);
it("task_02 reset replay does not redisclose raw tokens and revoked sessions cannot replay writes", async () => {
  expect(
    (await f.api("POST", "/test/mutation", {}, "dev", "previous-write")).status,
  ).toBe(200);
  const reset = await f.api(
    "POST",
    "/api/members/dev/reset",
    {},
    "admin",
    "same-reset",
  );
  expect(reset.status).toBe(200);
  const replay = await f.api(
    "POST",
    "/api/members/dev/reset",
    {},
    "admin",
    "same-reset",
  );
  expect(replay.status).toBe(200);
  expect(replay.body.resetToken).toBeUndefined();
  expect(
    (await f.api("POST", "/test/mutation", {}, "dev", "previous-write")).status,
  ).toBe(401);
});
it("task_02 activation and reset reject reused and expired tickets, with IP protection", async () => {
  for (const route of ["activate", "reset"]) {
    const password =
      route === "activate"
        ? { password: "Fictional pass 123!" }
        : { newPassword: "Fictional pass 123!" };
    for (let i = 0; i < 5; i++)
      expect(
        (
          await f.api(
            "POST",
            `/api/auth/${route}`,
            { token: String(i).repeat(43), ...password },
            "anonymous",
          )
        ).status,
      ).toBe(401);
    expect(
      (
        await f.api(
          "POST",
          `/api/auth/${route}`,
          { token: "9".repeat(43), ...password },
          "anonymous",
        )
      ).status,
    ).toBe(429);
  }
});
it("task_02 bootstrap creates one administrator in empty database and rolls back on event failure", async () => {
  const { openDb } = await import("../apps/api/src/db/open.js");
  const { migrate } = await import("../apps/api/src/db/migrate.js");
  const { bootstrapAdmin } = await import(
    "../apps/api/src/cli/bootstrap-admin.js"
  );
  const db = openDb(":memory:");
  migrate(db);
  const input = {
    login: "root",
    displayName: "Root",
    password: "Fictional pass 123!",
    isTTY: true,
  };
  db.exec(
    "CREATE TEMP TRIGGER fail_bootstrap BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'event failure'); END;",
  );
  await expect(bootstrapAdmin(db, input)).rejects.toThrow("event failure");
  expect(db.prepare("SELECT * FROM members").all()).toHaveLength(0);
  db.exec("DROP TRIGGER fail_bootstrap");
  const outcomes = await Promise.allSettled([
    bootstrapAdmin(db, input),
    bootstrapAdmin(db, input),
  ]);
  expect(
    outcomes.filter((outcome) => outcome.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    db.prepare("SELECT is_admin,password_hash FROM members").all(),
  ).toMatchObject([
    { is_admin: 1, password_hash: expect.stringMatching(/^scrypt\$/) },
  ]);
  expect(db.prepare("SELECT * FROM events").all()).toHaveLength(1);
  db.close();
}, 15000);
it("task_02 migration upgrades a populated task1 database without altering immutable history", async () => {
  const { openDb } = await import("../apps/api/src/db/open.js");
  const { migrate } = await import("../apps/api/src/db/migrate.js");
  const { readFileSync } = await import("node:fs");
  const db = openDb(":memory:");
  db.exec(
    readFileSync(
      new URL("../apps/api/migrations/001_core.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec(
    "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES (1,'prior'); INSERT INTO members(id,name) VALUES ('prior','Prior');",
  );
  db.prepare(
    "INSERT INTO events(time,action,actor_id,target_kind,target_id) VALUES (?,'prior','prior','member','prior')",
  ).run(new Date().toISOString());
  const before = db.prepare("SELECT * FROM events").all();
  migrate(db);
  migrate(db);
  expect(db.prepare("SELECT * FROM events").all()).toEqual(before);
  expect(
    db.prepare("SELECT version FROM schema_migrations ORDER BY version").all(),
  ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }, { version: 10 }]);
  expect(() => db.exec("DELETE FROM events")).toThrow();
  db.close();
});
it("task_02 password changes with query strings still use secret-keyed binding", async () => {
  const { hashPassword } = await import("../apps/api/src/auth/password.js");
  const { issueSession, digest } = await import(
    "../apps/api/src/auth/session.js"
  );
  f.db
    .prepare("UPDATE members SET password_hash=? WHERE id=?")
    .run(await hashPassword("Fictional pass 123!"), "dev");
  const session = issueSession(f.db, "dev");
  const body = {
    currentPassword: "Fictional pass 123!",
    newPassword: "Different pass 456!",
  };
  const response = await fetch(f.baseUrl + "/api/auth/password?x=1", {
    method: "POST",
    headers: {
      origin: "https://workbench.test",
      "content-type": "application/json",
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrfToken,
      "idempotency-key": "query-binding",
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  const row = f.db
    .prepare("SELECT body_hash FROM idempotency WHERE request_id=?")
    .get("query-binding") as { body_hash: string };
  expect(row.body_hash).not.toBe(digest(JSON.stringify(body)));
});
it("task_02 uses identical errors for wrong-password, unknown, disabled and unactivated accounts", async () => {
  const { hashPassword } = await import("../apps/api/src/auth/password.js");
  f.db
    .prepare("UPDATE members SET password_hash=? WHERE id=?")
    .run(await hashPassword("Fictional pass 123!"), "dev");
  const wrong = await f.api(
    "POST",
    "/api/auth/login",
    { login: "dev", password: "Wrong fictional 789!" },
    "anonymous",
  );
  const unknown = await f.api(
    "POST",
    "/api/auth/login",
    { login: "missing", password: "Wrong fictional 789!" },
    "anonymous",
  );
  const unactivated = await f.api(
    "POST",
    "/api/auth/login",
    { login: "dev2", password: "Wrong fictional 789!" },
    "anonymous",
  );
  f.db.prepare("UPDATE members SET active=0 WHERE id=?").run("dev");
  const disabled = await f.api(
    "POST",
    "/api/auth/login",
    { login: "dev", password: "Fictional pass 123!" },
    "anonymous",
  );
  expect([
    wrong.status,
    unknown.status,
    unactivated.status,
    disabled.status,
  ]).toEqual([401, 401, 401, 401]);
  expect(wrong.body).toEqual(unknown.body);
  expect(wrong.body).toEqual(unactivated.body);
  expect(wrong.body).toEqual(disabled.body);
});
it("task_02 login cookie flags and persistent session data contain only digests", async () => {
  const { hashPassword } = await import("../apps/api/src/auth/password.js");
  const { digest } = await import("../apps/api/src/auth/session.js");
  f.db
    .prepare("UPDATE members SET password_hash=? WHERE id=?")
    .run(await hashPassword("Fictional pass 123!"), "dev");
  const response = await fetch(f.baseUrl + "/api/auth/login", {
    method: "POST",
    headers: {
      origin: "https://workbench.test",
      "content-type": "application/json",
    },
    body: JSON.stringify({ login: "dev", password: "Fictional pass 123!" }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!;
  for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
    expect(cookie).toContain(flag);
  const token = cookie.split(";")[0]!.slice(8);
  const body = (await response.json()) as { csrfToken: string };
  const stored = f.db
    .prepare("SELECT * FROM sessions WHERE token_digest=?")
    .get(digest(token));
  expect(stored).toMatchObject({
    token_digest: digest(token),
    csrf_digest: digest(body.csrfToken),
  });
  expect(JSON.stringify(stored)).not.toContain(token);
  expect(JSON.stringify(stored)).not.toContain(body.csrfToken);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("task_02 reset and password event failures preserve credentials, sessions and tickets atomically", async () => {
  const { hashPassword } = await import("../apps/api/src/auth/password.js");
  const { issueSession } = await import("../apps/api/src/auth/session.js");
  const original = await hashPassword("Fictional pass 123!");
  f.db
    .prepare("UPDATE members SET password_hash=? WHERE id=?")
    .run(original, "dev");
  const ticket = await f.api("POST", "/api/members/dev/reset", {});
  await f.failNextEvent();
  expect(
    (
      await f.api(
        "POST",
        "/api/auth/reset",
        { token: ticket.body.resetToken, newPassword: "Different pass 456!" },
        "anonymous",
      )
    ).status,
  ).toBe(500);
  expect(
    f.db.prepare("SELECT password_hash FROM members WHERE id=?").get("dev"),
  ).toEqual({ password_hash: original });
  expect(
    f.db.prepare("SELECT * FROM auth_tickets WHERE member_id=?").all("dev"),
  ).toHaveLength(1);
  const session = issueSession(f.db, "dev");
  await f.failNextEvent();
  const response = await fetch(f.baseUrl + "/api/auth/password", {
    method: "POST",
    headers: {
      origin: "https://workbench.test",
      "content-type": "application/json",
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrfToken,
      "idempotency-key": "rollback-pass",
    },
    body: JSON.stringify({
      currentPassword: "Fictional pass 123!",
      newPassword: "Different pass 456!",
    }),
  });
  expect(response.status).toBe(500);
  expect(
    (
      await fetch(f.baseUrl + "/api/auth/session", {
        headers: { cookie: `session=${session.token}` },
      })
    ).status,
  ).toBe(200);
  expect(
    f.db.prepare("SELECT password_hash FROM members WHERE id=?").get("dev"),
  ).toEqual({ password_hash: original });
  expect(
    f.db
      .prepare("SELECT * FROM idempotency WHERE request_id=?")
      .all("rollback-pass"),
  ).toHaveLength(0);
});
it("task_02 member create/reset issuance failures roll back tickets, sessions, member and command state", async () => {
  await f.failNextEvent();
  expect(
    (
      await f.api(
        "POST",
        "/api/members",
        { login: "rollback-user", displayName: "Rollback" },
        "admin",
        "rollback-create",
      )
    ).status,
  ).toBe(500);
  expect(
    f.db.prepare("SELECT * FROM members WHERE login=?").all("rollback-user"),
  ).toHaveLength(0);
  await f.failNextEvent();
  expect(
    (
      await f.api(
        "POST",
        "/api/members/dev/reset",
        {},
        "admin",
        "rollback-reset",
      )
    ).status,
  ).toBe(500);
  expect((await f.api("GET", "/api/auth/session", {}, "dev")).status).toBe(200);
  expect(f.db.prepare("SELECT * FROM auth_tickets").all()).toHaveLength(0);
  expect(
    f.db
      .prepare("SELECT * FROM idempotency WHERE request_id LIKE ?")
      .all("rollback-%"),
  ).toHaveLength(0);
});
it("task_02 successful authenticated writes refresh idle activity inside authorization", async () => {
  const { issueSession, digest } = await import(
    "../apps/api/src/auth/session.js"
  );
  const session = issueSession(f.db, "admin");
  const previous = Date.now() - 10 * 60 * 1000;
  f.db
    .prepare("UPDATE sessions SET last_seen=? WHERE token_digest=?")
    .run(previous, digest(session.token));
  const response = await fetch(f.baseUrl + "/api/members", {
    method: "POST",
    headers: {
      origin: "https://workbench.test",
      "content-type": "application/json",
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrfToken,
      "idempotency-key": "activity",
    },
    body: JSON.stringify({ login: "active-user", displayName: "Active" }),
  });
  expect(response.status).toBe(200);
  const row = f.db
    .prepare("SELECT last_seen,created_at FROM sessions WHERE token_digest=?")
    .get(digest(session.token)) as { last_seen: number; created_at: number };
  expect(row.last_seen).toBeGreaterThan(previous);
  expect(row.created_at).toBeLessThanOrEqual(row.last_seen);
});

it("encoded API routes preserve Origin and no-store protections", async () => {
  const { hashPassword } = await import("../apps/api/src/auth/password.js");
  const { issueSession } = await import("../apps/api/src/auth/session.js");
  f.db.prepare("UPDATE members SET password_hash=? WHERE id='dev'").run(await hashPassword("Fictional pass 123!"));
  const session = issueSession(f.db, "admin");
  const cases = [
    ["auth/login", { login: "dev", password: "Fictional pass 123!" }],
    ["auth/activate", { token: "a".repeat(43), password: "Fictional pass 123!" }],
    ["auth/reset", { token: "b".repeat(43), newPassword: "Fictional pass 123!" }],
    ["projects", { name: "Origin protected" }],
  ] as const;
  for (const [route, body] of cases) {
    for (const spelling of ["/api/", "/%61pi/"]) {
      for (const origin of [undefined, "https://evil.test"]) {
        const response = await fetch(f.baseUrl + spelling + route, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(origin ? { origin } : {}),
            cookie: `session=${session.token}`,
            "x-csrf-token": session.csrfToken,
            "idempotency-key": f.fresh("origin"),
          },
          body: JSON.stringify(body),
        });
        expect(response.status, spelling + route + String(origin)).toBe(403);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("set-cookie")).toBeNull();
      }
    }
  }
  for (const origin of [undefined, "https://evil.test"]) {
    const response = await fetch(f.baseUrl + "/test/mutation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
        cookie: `session=${session.token}`,
        "x-csrf-token": session.csrfToken,
        "idempotency-key": f.fresh("test-origin"),
      },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(403);
  }
  for (const [route, body] of cases.slice(1, 3))
    expect((await f.api("POST", "/%61pi/" + route, body, "anonymous")).status).toBe(401);
  expect((await f.api("POST", "/%61pi/auth/login", cases[0][1], "anonymous")).status).toBe(200);
  expect((await f.api("POST", "/%61pi/projects", { name: "Allowed encoded" })).status).toBe(200);
  for (const route of ["auth/session", "projects"]) {
    const response = await fetch(f.baseUrl + "/%61pi/" + route, { headers: { cookie: `session=${session.token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
});
it("lost create ticket recovers through reset issuance", async () => {
  const body = { login: "lost-ticket", displayName: "Lost Ticket" };
  const original = await f.api("POST", "/api/members", body, "admin", "lost-create");
  const replay = await f.api("POST", "/api/members", body, "admin", "lost-create");
  expect(replay.status).toBe(200);
  expect(Object.keys(replay.body).sort()).toEqual(["id", "ticketIssued", "version"]);
  expect((await f.api("POST", "/api/members", body)).status).toBe(409);
  const reset = await f.api("POST", `/api/members/${replay.body.id}/reset`, { expectedVersion: replay.body.version });
  expect(reset.status).toBe(200);
  expect((await f.api("POST", "/api/auth/activate", { token: original.body.activationToken, password: "Fictional pass 123!" }, "anonymous")).status).toBe(401);
  const stale = await f.api("POST", `/api/members/${replay.body.id}/reset`, { expectedVersion: replay.body.version });
  expect(stale.status).toBe(409);
  expect(stale.body.latest).toMatchObject({ id: replay.body.id, version: reset.body.version });
  expect((await f.api("POST", "/api/auth/reset", { token: reset.body.resetToken, newPassword: "Fictional pass 123!" }, "anonymous")).status).toBe(200);
});

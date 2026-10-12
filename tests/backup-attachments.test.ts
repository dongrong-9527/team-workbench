import sharp from "sharp";
import { afterEach, beforeEach, expect, test } from "vitest";
import { Readable } from "node:stream";
import { join, dirname } from "node:path";
import { readFile, readdir, writeFile, mkdir, symlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createTestKit, type TestKit } from "./helpers.js";
import { createAttachmentService } from "../apps/api/src/attachments/service.js";
import { backup } from "../scripts/backup.js";
import { restoreVerify } from "../scripts/restore-verify.js";
import { buildApp } from "../apps/api/src/app.js";
import { issueSession } from "../apps/api/src/auth/session.js";
import { stateAt, maxSeq } from "../apps/api/src/history/query.js";
import { generateReport } from "../apps/api/src/reports/service.js";
const png = await sharp({
  create: { width: 2, height: 2, channels: 3, background: "#55aa77" },
})
  .png()
  .toBuffer();
let f: TestKit;
beforeEach(async () => {
  f = await createTestKit();
  await f.api("POST", "/test/mutation", { title: "Image task" });
});
afterEach(async () => {
  await f.close();
});
const root = () => join(dirname(f.path), "images");
const service = (limits = {}) =>
  createAttachmentService(f.db, { directory: root(), ...limits });
const ctx = (key = randomUUID()) => ({
  ...f.context,
  requestId: key,
  bodyHash: key,
  expectedVersion: 1,
});
const upload = (data = png, mime = "image/png", name = "image.png") => ({
  stream: Readable.from(data),
  mime,
  name,
  size: data.length,
});
test("anonymous attachment requests are authenticated even for absent content", async () => {
  expect(
    (await f.api("GET", "/api/attachments/a1/content", {}, "anonymous")).status,
  ).toBe(401);
});
test("online snapshot restores isolated database, immutable image and exact report", async () => {
  const a = await service().storeAttachment(
    ctx(),
    { kind: "task", id: "t1" },
    upload(),
  );
  const out = join(dirname(f.path), "backup");
  const manifest = await backup(out, { db: f.db, attachmentDirectory: root() });
  const result = await restoreVerify(
    join(out, "manifest.json"),
    join(dirname(f.path), "restore"),
  );
  expect(manifest.schemaVersion).toBe(10);
  expect((await readdir(out)).sort()).toEqual(["attachments", "database.sqlite", "manifest.json"]);
  expect(result.integrityCheck).toBe("ok");
  expect(result.foreignKeyCheck).toEqual([]);
  expect(result.missingAttachments).toEqual([]);
  expect(result.attachmentsVerified).toBe(1);
  expect(result.reportText).toBe("");
  expect(await readFile(join(out, "attachments", a.storageKey))).toEqual(
    await readFile(join(root(), a.storageKey)),
  );
});
test("canonical pixels strip trailing polyglot payload, preserve workflow and emit immutable nested audit", async () => {
  const before = f.db.prepare("SELECT * FROM objects WHERE id=?").get("t1");
  const data = Buffer.concat([png, Buffer.from("<script>steal()</script>")]);
  const a = await service().storeAttachment(
    ctx(),
    { kind: "task", id: "t1" },
    upload(data),
  );
  expect(
    (await readFile(join(root(), a.storageKey))).includes(
      Buffer.from("<script>"),
    ),
  ).toBe(false);
  expect(f.db.prepare("SELECT * FROM objects WHERE id=?").get("t1")).toEqual(
    before,
  );
  const event = f.events().at(-1)!;
  expect(event.action).toBe("attachmentAdded");
  expect(event.after).toMatchObject({
    actorName: "admin",
    attachment: { id: a.id },
  });
  expect(event.after).not.toHaveProperty("state");
  expect(event.after).not.toHaveProperty("version");
  expect(() => f.db.prepare("UPDATE attachments SET size=1").run()).toThrow(
    "immutable",
  );
  expect(() =>
    f.db.prepare("DELETE FROM events WHERE action='attachmentAdded'").run(),
  ).toThrow("append-only");
});
test("historical state, actual participation and daily completion counts are unchanged by upload", async () => {
  // Use the normal history/report fixture in a fresh DB without the minimal t1.
  await f.close();
  f = await createTestKit();
  const input = f.seed("historicalReport");
  const before = stateAt(
    f.db,
    { kind: "task", id: "t1" },
    { time: "2099-01-01T00:00:00.000Z", seq: maxSeq(f.db) },
  );
  const report = generateReport(
    f.db,
    { ...f.context, requestId: "report-before" },
    input,
    () => new Date("2026-10-12T02:00:00.000Z"),
  );
  const a = await service().storeAttachment(
    { ...ctx(), expectedVersion: 3 },
    { kind: "task", id: "t1" },
    upload(),
  );
  const after = stateAt(
    f.db,
    { kind: "task", id: "t1" },
    { time: "2099-01-01T00:00:00.000Z", seq: maxSeq(f.db) },
  );
  expect(after).toEqual(before);
  const later = generateReport(
    f.db,
    { ...f.context, requestId: "report-after" },
    input,
    () => new Date("2026-10-12T02:00:00.000Z"),
  );
  expect(later.text).toBe(report.text);
  expect(later.counts).toEqual(report.counts);
  expect(
    f.db.prepare("SELECT count(*) n FROM execution_participations").get(),
  ).toEqual({ n: 0 });
  const out = join(dirname(f.path), "report-backup");
  await backup(out, { db: f.db, attachmentDirectory: root() });
  const result = await restoreVerify(
    join(out, "manifest.json"),
    join(dirname(f.path), "report-restore"),
  );
  expect(result.reportText).toBe(later.text);
  expect(result.reportsVerified).toBe(2);
});
test.each([
  "image/svg+xml",
  "image/gif",
  "application/octet-stream",
  "image/jpeg",
])("rejects unsupported/mismatched type %s", async (mime) => {
  await expect(
    service().storeAttachment(
      ctx(),
      { kind: "task", id: "t1" },
      upload(png, mime),
    ),
  ).rejects.toMatchObject({ statusCode: 415 });
});
test.each(["../escape.png", "a/b.png", "a\\b.png", "bad\u0000.png"])(
  "rejects unsafe filename %s",
  async (name) => {
    await expect(
      service().storeAttachment(
        ctx(),
        { kind: "task", id: "t1" },
        upload(png, "image/png", name),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  },
);
test("rejects truncated, malformed and excessive pixels; cleans every candidate", async () => {
  for (const data of [png.subarray(0, 40), Buffer.from("not an image")])
    await expect(
      service().storeAttachment(
        ctx(),
        { kind: "task", id: "t1" },
        upload(data),
      ),
    ).rejects.toMatchObject({ statusCode: 415 });
  await expect(
    service({ maxPixels: 1 }).storeAttachment(
      ctx(),
      { kind: "task", id: "t1" },
      upload(),
    ),
  ).rejects.toMatchObject({ statusCode: 415 });
  expect(await readdir(root())).toEqual([]);
});
test("bounds declared and actual stream bytes and checks size equality", async () => {
  const s = service({ maxBytes: png.length });
  await expect(
    s.storeAttachment(
      ctx(),
      { kind: "task", id: "t1" },
      upload(Buffer.concat([png, png])),
    ),
  ).rejects.toMatchObject({ statusCode: 413 });
  await expect(
    s.storeAttachment(
      ctx(),
      { kind: "task", id: "t1" },
      { ...upload(Buffer.concat([png, png])), size: png.length },
    ),
  ).rejects.toMatchObject({ statusCode: 413 });
  await expect(
    s.storeAttachment(
      ctx(),
      { kind: "task", id: "t1" },
      { ...upload(), size: png.length - 1 },
    ),
  ).rejects.toMatchObject({ statusCode: 400 });
  expect(await readdir(root())).toEqual([]);
});
test("idempotency replays exactly one row/event/file and rechecks current role/archive", async () => {
  const s = service(),
    c = ctx(),
    target = { kind: "task" as const, id: "t1" };
  const a = await s.storeAttachment(c, target, upload());
  expect(await s.storeAttachment(c, target, upload())).toEqual(a);
  expect(await readdir(root())).toEqual([a.storageKey]);
  expect(f.events().filter((e) => e.action === "attachmentAdded")).toHaveLength(
    1,
  );
  f.db.prepare("DELETE FROM roles WHERE member_id='admin'").run();
  await expect(s.storeAttachment(c, target, upload())).rejects.toMatchObject({
    statusCode: 403,
  });
  f.db
    .prepare(
      "INSERT INTO roles(project_id,member_id,role) VALUES('p1','admin','product')",
    )
    .run();
  f.db
    .prepare("UPDATE projects SET archived=1,version=version+1 WHERE id='p1'")
    .run();
  await expect(s.storeAttachment(c, target, upload())).rejects.toMatchObject({
    statusCode: 409,
  });
  expect(await readdir(root())).toEqual([a.storageKey]);
});
test("quota races serialize registration and clean losers", async () => {
  const s = service({ maxPerObject: 1 });
  const results = await Promise.allSettled([
    s.storeAttachment(ctx(), { kind: "task", id: "t1" }, upload()),
    s.storeAttachment(ctx(), { kind: "task", id: "t1" }, upload()),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await readdir(root())).toHaveLength(1);
  expect(f.db.prepare("SELECT count(*) n FROM attachments").get()).toEqual({
    n: 1,
  });
});
test("concurrent same-key retries keep only original file", async () => {
  const s = service(),
    c = ctx();
  const [a, b] = await Promise.all([
    s.storeAttachment(c, { kind: "task", id: "t1" }, upload()),
    s.storeAttachment(c, { kind: "task", id: "t1" }, upload()),
  ]);
  expect(a).toEqual(b);
  expect(await readdir(root())).toEqual([a.storageKey]);
});
test("total quota and stale version fail without registration", async () => {
  await expect(
    service({ maxTotalBytes: 1 }).storeAttachment(
      ctx(),
      { kind: "task", id: "t1" },
      upload(),
    ),
  ).rejects.toMatchObject({ statusCode: 413 });
  await expect(
    service().storeAttachment(
      { ...ctx(), expectedVersion: 2 },
      { kind: "task", id: "t1" },
      upload(),
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(await readdir(root())).toEqual([]);
});
test("registration failure rolls back row/event/idempotency and removes candidate", async () => {
  await f.failNextEvent();
  const c = ctx();
  await expect(
    service().storeAttachment(c, { kind: "task", id: "t1" }, upload()),
  ).rejects.toThrow("injected");
  expect(await readdir(root())).toEqual([]);
  expect(f.db.prepare("SELECT count(*) n FROM attachments").get()).toEqual({
    n: 0,
  });
  expect(
    f.db
      .prepare("SELECT 1 FROM idempotency WHERE request_id=?")
      .get(c.requestId),
  ).toBeUndefined();
});
test("stream failure does not leave files and reads/decode do not hold DB write lock", async () => {
  async function* failure() {
    expect(f.db.inTransaction).toBe(false);
    yield png;
    throw new Error("disk input failure");
  }
  await expect(
    service().storeAttachment(
      ctx(),
      { kind: "task", id: "t1" },
      { ...upload(), stream: failure() },
    ),
  ).rejects.toThrow("disk input failure");
  expect(await readdir(root())).toEqual([]);
});
test("reauthorizes role and target version after asynchronous staging", async () => {
  async function* revoke() {
    yield png;
    f.db.prepare("DELETE FROM roles WHERE member_id='admin'").run();
  }
  await expect(
    service().storeAttachment(
      ctx(),
      { kind: "task", id: "t1" },
      { ...upload(), stream: revoke() },
    ),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(await readdir(root())).toEqual([]);
});
async function routeApp() {
  const app = buildApp(f.db, {
    origin: "https://workbench.test",
    attachments: { directory: root() },
  });
  await app.ready();
  return app;
}
const multipartBody = (
  data = png,
  name = "evidence.png",
  mime = "image/png",
  extra = "",
) =>
  Buffer.concat([
    Buffer.from(
      `--test-boundary\r\nContent-Disposition: form-data; name="image"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n${extra}--test-boundary--\r\n`),
  ]);
test("HTTP multipart upload, paged metadata and authenticated no-store content with deactivated sessions", async () => {
  const app = await routeApp(),
    session = issueSession(f.db, "dev");
  try {
    const headers = {
      origin: "https://workbench.test",
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrfToken,
      "idempotency-key": "http-upload",
      "content-type": "multipart/form-data; boundary=test-boundary",
    };
    const post = await app.inject({
      method: "POST",
      url: `/api/objects/task/t1/attachments?expectedVersion=1&size=${png.length}`,
      headers,
      payload: multipartBody(),
    });
    expect(post.statusCode, post.body).toBe(200);
    const a = post.json();
    expect(a).not.toHaveProperty("storageKey");
    // A member with no role still reads cross-project attachments.
    f.db.prepare("DELETE FROM roles WHERE member_id='dev'").run();
    const list = await app.inject({
      url: "/api/objects/task/t1/attachments?limit=1",
      headers: { cookie: headers.cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);
    const get = await app.inject({
      url: `/api/attachments/${a.id}/content`,
      headers: { cookie: headers.cookie },
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers["content-type"]).toBe("image/png");
    expect(get.headers["x-content-type-options"]).toBe("nosniff");
    expect(get.headers["cache-control"]).toBe("no-store");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/objects/task/t1/attachments?expectedVersion=1&size=${png.length}`,
          headers,
          payload: multipartBody(),
        })
      ).statusCode,
    ).toBe(403);
    f.db.prepare("UPDATE members SET active=0 WHERE id='dev'").run();
    expect(
      (
        await app.inject({
          url: `/api/attachments/${a.id}/content`,
          headers: { cookie: headers.cookie },
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
  }
});
test("HTTP denies unauthenticated and CSRF uploads before reading multipart", async () => {
  const app = await routeApp();
  try {
    for (const headers of [
      { origin: "https://workbench.test" },
      {
        origin: "https://workbench.test",
        cookie: `session=${issueSession(f.db, "dev").token}`,
      },
    ]) {
      const r = await app.inject({
        method: "POST",
        url: "/api/objects/task/t1/attachments",
        headers: {
          ...headers,
          "content-type": "multipart/form-data; boundary=bad",
        },
        payload: "invalid",
      });
      expect([401, 403]).toContain(r.statusCode);
    }
  } finally {
    await app.close();
  }
});
test("rejects symlink storage and unavailable disk target", async () => {
  const outside = join(dirname(f.path), "outside");
  await mkdir(outside);
  await symlink(outside, root());
  await expect(
    service().storeAttachment(ctx(), { kind: "task", id: "t1" }, upload()),
  ).rejects.toThrow("Unsafe directory");
  expect(await readdir(outside)).toEqual([]);
});
test("backup snapshot includes WAL and excludes later upload after snapshot completion", async () => {
  const first = await service().storeAttachment(
    ctx(),
    { kind: "task", id: "t1" },
    upload(),
  );
  const realBackup = f.db.backup.bind(f.db);
  f.db.backup = async (...args: Parameters<typeof realBackup>) => {
    const result = await realBackup(...args);
    await service().storeAttachment(
      ctx(),
      { kind: "task", id: "t1" },
      upload(),
    );
    return result;
  };
  const out = join(dirname(f.path), "cutoff");
  const manifest = await backup(out, { db: f.db, attachmentDirectory: root() });
  expect(manifest.files.map((x) => x.path)).toEqual([
    "database.sqlite",
    `attachments/${first.storageKey}`,
  ]);
  const restored = await restoreVerify(
    join(out, "manifest.json"),
    join(dirname(f.path), "cutoff-restore"),
  );
  expect(restored.attachmentsVerified).toBe(1);
  expect(f.db.prepare("SELECT count(*) n FROM attachments").get()).toEqual({
    n: 2,
  });
});
test("backup refuses missing source image without a completed manifest", async () => {
  await service().storeAttachment(ctx(), { kind: "task", id: "t1" }, upload());
  const out = join(dirname(f.path), "missing-backup");
  await expect(
    backup(out, {
      db: f.db,
      attachmentDirectory: join(dirname(f.path), "absent"),
    }),
  ).rejects.toThrow();
  await expect(readFile(join(out, "manifest.json"))).rejects.toThrow();
});
test("restore rejects corrupt/missing files, unsafe paths, symlinks and reused scratch", async () => {
  const a = await service().storeAttachment(
    ctx(),
    { kind: "task", id: "t1" },
    upload(),
  );
  const out = join(dirname(f.path), "safe-backup");
  const manifest = await backup(out, { db: f.db, attachmentDirectory: root() });
  const file = join(out, "manifest.json"),
    scratch = join(dirname(f.path), "safe-restore");
  await restoreVerify(file, scratch);
  await expect(restoreVerify(file, scratch)).rejects.toThrow("empty");
  const saved = JSON.stringify(manifest);
  manifest.files[1]!.path = "../escape";
  await writeFile(file, JSON.stringify(manifest));
  await expect(restoreVerify(file, scratch + "-path")).rejects.toThrow(
    "Invalid manifest",
  );
  await writeFile(file, saved);
  await writeFile(join(out, "attachments", a.storageKey), "corrupt");
  await expect(restoreVerify(file, scratch + "-corrupt")).rejects.toThrow(
    "hash or size",
  );
  await symlink(out, scratch + "-symlink");
  await expect(restoreVerify(file, scratch + "-symlink")).rejects.toThrow(
    "Unsafe directory",
  );
  await expect(restoreVerify(file, join(out, "nested"))).rejects.toThrow(
    "isolated",
  );
});
test("rejects animated WebP and accepts genuine JPEG/WebP", async () => {
  for (const format of ["jpeg", "webp"] as const) {
    const data = await sharp(png).toFormat(format).toBuffer();
    expect(
      (
        await service().storeAttachment(
          ctx(),
          { kind: "task", id: "t1" },
          upload(data, `image/${format}`),
        )
      ).mime,
    ).toBe(`image/${format}`);
  }
  const animated = await sharp(
    Buffer.concat([Buffer.alloc(12, 30), Buffer.alloc(12, 210)]),
    { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } },
  )
    .webp({ loop: 0 })
    .toBuffer();
  expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
  await expect(
    service().storeAttachment(
      ctx(),
      { kind: "task", id: "t1" },
      upload(animated, "image/webp"),
    ),
  ).rejects.toMatchObject({ statusCode: 415 });
});
test("multipart extra fields/files, truncation and oversized input never register", async () => {
  const app = await routeApp(),
    session = issueSession(f.db, "dev");
  try {
    const headers = {
      origin: "https://workbench.test",
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrfToken,
      "content-type": "multipart/form-data; boundary=test-boundary",
    };
    const extra =
      '--test-boundary\r\nContent-Disposition: form-data; name="extra"\r\n\r\nvalue\r\n';
    for (const payload of [
      multipartBody(png, "evidence.png", "image/png", extra),
      multipartBody().subarray(0, 50),
      multipartBody(Buffer.alloc(5 * 1024 * 1024 + 1)),
    ]) {
      const r = await app.inject({
        method: "POST",
        url: `/api/objects/task/t1/attachments?expectedVersion=1&size=${png.length}`,
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload,
      });
      expect(r.statusCode, r.body).toBeGreaterThanOrEqual(400);
      expect(r.statusCode, r.body).toBeLessThan(500);
    }
    expect(f.db.prepare("SELECT count(*) n FROM attachments").get()).toEqual({
      n: 0,
    });
  } finally {
    await app.close();
  }
});
test("staging concurrency is bounded and rejected streams are never consumed", async () => {
  const s = service({ maxConcurrent: 1 });
  let release!: () => void, started!: () => void;
  const start = new Promise<void>((resolve) => (started = resolve)),
    wait = new Promise<void>((resolve) => (release = resolve));
  async function* slow() {
    started();
    await wait;
    yield png;
  }
  const first = s.storeAttachment(
    ctx(),
    { kind: "task", id: "t1" },
    { ...upload(), stream: slow() },
  );
  await start;
  let consumed = false;
  async function* second() {
    consumed = true;
    yield png;
  }
  await expect(
    s.storeAttachment(
      ctx(),
      { kind: "task", id: "t1" },
      { ...upload(), stream: second() },
    ),
  ).rejects.toMatchObject({ statusCode: 429 });
  expect(consumed).toBe(false);
  release();
  await first;
});
test("disk errors are visible, backup does not silently create missing live database", async () => {
  const file = join(dirname(f.path), "not-a-directory");
  await writeFile(file, "occupied");
  await expect(
    createAttachmentService(f.db, { directory: file }).storeAttachment(
      ctx(),
      { kind: "task", id: "t1" },
      upload(),
    ),
  ).rejects.toThrow();
  expect(f.db.prepare("SELECT count(*) n FROM attachments").get()).toEqual({
    n: 0,
  });
  const old = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = join(dirname(f.path), "absent.db");
  try {
    await expect(
      backup(join(dirname(f.path), "not-created")),
    ).rejects.toThrow();
    await expect(readFile(process.env.DATABASE_PATH)).rejects.toThrow();
  } finally {
    if (old === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = old;
  }
});
test("isolated recovery drill logs in and completes requirement, task, Bug, testing, acceptance and report", async () => {
  const { hashPassword } = await import("../apps/api/src/auth/password.js");
  const { openDb } = await import("../apps/api/src/db/open.js");
  const password = "Synthetic-restore-2026!";
  f.db
    .prepare("UPDATE members SET password_hash=?")
    .run(await hashPassword(password));
  async function live(path: string, body: any, actor: any = "product") {
    const r = await f.api<any>("POST", path, body, actor);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  }
  let r = await live("/api/requirements", {
    projectId: "p1",
    title: "Synthetic recovery requirement",
    source: { description: "Synthetic drill" },
    description: "Validate restored behavior",
    acceptorId: "product",
    criteria: [{ id: "c1", text: "Recovery works", required: true }],
    priority: "medium",
  });
  r = await live(`/api/requirements/${r.id}/actions`, {
    action: "refine",
    expectedVersion: r.version,
    description: "Recovery detail",
  });
  r = await live(`/api/requirements/${r.id}/actions`, {
    action: "makeReady",
    expectedVersion: r.version,
    source: {
      description: "Synthetic",
      status: "unable",
      reason: "Local drill",
    },
  });
  const t = await live("/api/tasks", {
    projectId: "p1",
    requirementId: r.id,
    title: "Synthetic recovery task",
    kind: "backend",
    definitionOfDone: "Restore and verify",
    priority: "medium",
    ownerId: "dev",
    reviewerId: "tester",
  });
  const a = await service().storeAttachment(
    { ...ctx(), expectedVersion: t.version },
    { kind: "task", id: t.id },
    upload(),
  );
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
  }).format(new Date());
  const selection = {
    date,
    timeZone: "Asia/Shanghai",
    memberIds: ["product", "dev", "tester"],
    projectIds: ["p1"],
  };
  const report = await live("/api/reports", selection);
  const drillRoot =
    process.env.TASK11_DRILL_DIR ?? join(dirname(f.path), "drill");
  const out = join(drillRoot, "backup"),
    scratch = join(drillRoot, "restore");
  const started = performance.now();
  const manifest = await backup(out, { db: f.db, attachmentDirectory: root() });
  const backupMs = performance.now() - started;
  const restoreStarted = performance.now();
  const verified = await restoreVerify(join(out, "manifest.json"), scratch);
  const restoreMs = performance.now() - restoreStarted;
  expect(verified.reportText).toBe(report.text);
  const restored = openDb(join(scratch, "database.sqlite")),
    app = buildApp(restored, {
      origin: "https://restore.test",
      attachments: { directory: join(scratch, "attachments") },
    });
  const sessions: Record<string, { cookie: string; csrf: string }> = {};
  try {
    for (const actor of ["product", "dev", "tester"]) {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: "https://restore.test" },
        payload: { login: actor, password },
      });
      expect(login.statusCode, login.body).toBe(200);
      sessions[actor] = {
        cookie: String(login.headers["set-cookie"]).split(";")[0]!,
        csrf: login.json().csrfToken,
      };
    }
    async function post(path: string, body: any, actor = "product") {
      const s = sessions[actor]!;
      const response = await app.inject({
        method: "POST",
        url: path,
        headers: {
          origin: "https://restore.test",
          cookie: s.cookie,
          "x-csrf-token": s.csrf,
          "idempotency-key": randomUUID(),
        },
        payload: body,
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json();
    }
    async function get(path: string, actor = "product") {
      const response = await app.inject({
        url: path,
        headers: { cookie: sessions[actor]!.cookie },
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json();
    }
    async function act(
      collection: string,
      id: string,
      action: string,
      body: any = {},
      actor = "dev",
    ) {
      const current = await get(`/api/${collection}/${id}`, actor);
      return post(
        `/api/${collection}/${id}/actions`,
        { action, expectedVersion: current.version, ...body },
        actor,
      );
    }
    expect((await get(`/api/reports/${report.id}`)).text).toBe(report.text);
    const content = await app.inject({
      url: `/api/attachments/${a.id}/content`,
      headers: { cookie: sessions.dev!.cookie },
    });
    expect(content.statusCode).toBe(200);
    await act("tasks", t.id, "start");
    await post(
      "/api/updates",
      {
        target: { kind: "task", id: t.id },
        workDate: date,
        done: "Restored workflow validated",
        contributionType: "development",
      },
      "dev",
    );
    await act("tasks", t.id, "submit", {
      evidence: {
        done: "Implemented recovery",
        selfCheck: "Local pass",
        environment: "isolated",
        targetVersion: "restore-1",
      },
    });
    const checked = await act(
      "tasks",
      t.id,
      "checkPass",
      {
        test: {
          target: { kind: "task", id: t.id },
          revision: 1,
          targetVersion: "restore-1",
          environment: "isolated",
          checks: [{ checkId: "completion", result: "pass" }],
        },
      },
      "tester",
    );
    expect(checked.state).toBe("done");
    let b = await post(
      "/api/bugs",
      {
        projectId: "p1",
        requirementId: r.id,
        taskId: t.id,
        title: "Synthetic recovery defect",
        role: "backend",
        expected: "Pass",
        actual: "Fail",
        reproduction: "Synthetic input",
        environment: "isolated",
        severity: "normal",
        priority: "medium",
      },
      "tester",
    );
    await act("bugs", b.id, "confirm", { reason: "Reproduced" }, "tester");
    await act("bugs", b.id, "claim");
    await act("bugs", b.id, "start");
    await act("bugs", b.id, "submit", {
      evidence: {
        fix: "Fixed",
        impact: "Input",
        selfCheck: "Pass",
        environment: "isolated",
        targetVersion: "restore-1",
      },
    });
    b = await act(
      "bugs",
      b.id,
      "verifyPass",
      {
        test: {
          target: { kind: "bug", id: b.id },
          revision: 1,
          targetVersion: "restore-1",
          environment: "isolated",
          checks: [{ checkId: "reproduction", result: "pass" }],
        },
      },
      "tester",
    );
    expect(b.state).toBe("closed");
    r = await get(`/api/requirements/${r.id}`);
    await post(
      "/api/tests",
      {
        target: { kind: "requirement", id: r.id },
        expectedVersion: r.version,
        revision: 1,
        targetVersion: "restore-1",
        environment: "isolated",
        checks: [{ checkId: "c1", result: "pass" }],
      },
      "tester",
    );
    r = await get(`/api/requirements/${r.id}`);
    r = await post(`/api/requirements/${r.id}/submit-acceptance`, {
      expectedVersion: r.version,
      revision: 1,
      targetVersion: "restore-1",
    });
    r = await post(`/api/requirements/${r.id}/acceptance`, {
      expectedVersion: r.version,
      revision: 1,
      targetVersion: "restore-1",
      decision: "pass",
      criteria: [{ id: "c1", passed: true }],
    });
    expect(r.state).toBe("accepted");
    const finalReport = await post("/api/reports", selection);
    expect(finalReport.counts).toMatchObject({
      tasksDone: 1,
      bugsClosed: 1,
      requirementsAccepted: 1,
    });
    expect((await f.api<any>("GET", `/api/tasks/${t.id}`)).body.state).toBe(
      t.state,
    );
    await writeFile(
      join(drillRoot, "verification.json"),
      JSON.stringify(
        {
          backupMs,
          restoreMs,
          backupBytes: manifest.files.reduce((n, x) => n + x.size, 0),
          ...verified,
          loginActors: Object.keys(sessions),
          workflow: { task: checked.state, bug: b.state, requirement: r.state },
          finalReportCounts: finalReport.counts,
          liveTaskState: t.state,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } finally {
    await app.close();
    restored.close();
  }
}, 30000);
test("HTTP explicitly rejects filename path traversal instead of silently renaming it", async () => {
  const app = await routeApp(),
    session = issueSession(f.db, "dev");
  try {
    const r = await app.inject({
      method: "POST",
      url: `/api/objects/task/t1/attachments?expectedVersion=1&size=${png.length}`,
      headers: {
        origin: "https://workbench.test",
        cookie: `session=${session.token}`,
        "x-csrf-token": session.csrfToken,
        "idempotency-key": randomUUID(),
        "content-type": "multipart/form-data; boundary=test-boundary",
      },
      payload: multipartBody(png, "../escape.png"),
    });
    expect(r.statusCode, r.body).toBe(400);
    expect(f.db.prepare("SELECT count(*) n FROM attachments").get()).toEqual({
      n: 0,
    });
  } finally {
    await app.close();
  }
});
test("restore rejects missing images and a recomputed manifest that contradicts database hashes", async () => {
  const { unlink } = await import("node:fs/promises");
  const { hashFile } = await import("../apps/api/src/attachments/files.js");
  const a = await service().storeAttachment(
    ctx(),
    { kind: "task", id: "t1" },
    upload(),
  );
  const out = join(dirname(f.path), "tamper-backup");
  const manifest = await backup(out, { db: f.db, attachmentDirectory: root() }),
    file = join(out, "attachments", a.storageKey);
  await unlink(file);
  await expect(
    restoreVerify(
      join(out, "manifest.json"),
      join(dirname(f.path), "missing-restore"),
    ),
  ).rejects.toThrow();
  await writeFile(file, "forged");
  manifest.files[1] = {
    path: `attachments/${a.storageKey}`,
    ...(await hashFile(file)),
  };
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest));
  await expect(
    restoreVerify(
      join(out, "manifest.json"),
      join(dirname(f.path), "tamper-restore"),
    ),
  ).rejects.toThrow("database hash mismatch");
});
test("idempotency binds file bytes and version changes during staging cannot register", async () => {
  const s = service(),
    c = ctx();
  await s.storeAttachment(c, { kind: "task", id: "t1" }, upload());
  const changed = await sharp(png).negate().png().toBuffer();
  await expect(
    s.storeAttachment(c, { kind: "task", id: "t1" }, upload(changed)),
  ).rejects.toMatchObject({ statusCode: 409 });
  async function* changeVersion() {
    yield png;
    f.db.prepare("UPDATE objects SET version=version+1 WHERE id='t1'").run();
  }
  await expect(
    s.storeAttachment(
      ctx(),
      { kind: "task", id: "t1" },
      { ...upload(), stream: changeVersion() },
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(await readdir(root())).toHaveLength(1);
});

test.each([
  ["missing sessions table", "DROP TABLE sessions"],
  ["missing immutable trigger", "DROP TRIGGER attachments_no_delete"],
  ["missing migration 5", "DELETE FROM schema_migrations WHERE version=5"],
  [
    "no-op immutable trigger",
    "DROP TRIGGER attachments_no_delete; CREATE TRIGGER attachments_no_delete BEFORE DELETE ON attachments BEGIN SELECT 1; END",
  ],
])("restore rejects unsupported schema: %s", async (_label, sql) => {
  await service().storeAttachment(ctx(), { kind: "task", id: "t1" }, upload());
  f.db.exec(sql);
  const out = join(dirname(f.path), "schema-backup"),
    scratch = join(dirname(f.path), "schema-restore");
  // Normal backup generation; the manifest and snapshot are never forged afterward.
  const manifest = await backup(out, { db: f.db, attachmentDirectory: root() });
  await expect(
    restoreVerify(join(out, "manifest.json"), scratch),
  ).rejects.toThrow(/schema|migration/i);
  const { hashFile } = await import("../apps/api/src/attachments/files.js");
  expect(await hashFile(join(scratch, "database.sqlite"))).toEqual({
    sha256: manifest.files[0]!.sha256,
    size: manifest.files[0]!.size,
  });
});
test("restore accepts the supported schema after SQLite ANALYZE and VACUUM", async () => {
  await service().storeAttachment(ctx(), { kind: "task", id: "t1" }, upload());
  f.db.exec("ANALYZE; VACUUM;");
  expect(
    f.db
      .prepare("SELECT name FROM sqlite_schema WHERE name='sqlite_stat1'")
      .get(),
  ).toEqual({ name: "sqlite_stat1" });
  const out = join(dirname(f.path), "analyzed-backup");
  await backup(out, { db: f.db, attachmentDirectory: root() });
  const result = await restoreVerify(
    join(out, "manifest.json"),
    join(dirname(f.path), "analyzed-restore"),
  );
  expect(result).toMatchObject({
    integrityCheck: "ok",
    foreignKeyCheck: [],
    missingAttachments: [],
    attachmentsVerified: 1,
    objectsVerified: 1,
  });
});

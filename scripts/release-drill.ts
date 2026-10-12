// Isolated synthetic package/fault/recovery drill; excluded from deployment artifacts.
import { spawn, execFileSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  chmod,
  open,
  statfs,
  rename,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";
import { seedLoad } from "./release-seed.js";
import { backup } from "./backup.js";
import { restoreVerify } from "./restore-verify.js";
import { rehearseRollback } from "./release-load.js";
import {
  verifyRuntime,
  fileHash,
  manifestHash,
  inventory,
} from "./verify-runtime.js";
const requireTrue = (value: unknown, message: string) => {
  if (!value) throw Error(message);
};
export async function releaseDrill(
  packageRoot: string,
  directory: string,
  fullDirectory: string,
) {
  await mkdir(directory, { recursive: true });
  const manifestPath = join(packageRoot, "release-manifest.json"),
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const runtime = await verifyRuntime(manifest, packageRoot);
  requireTrue(runtime.ok, JSON.stringify(runtime));
  const negatives = [];
  for (const change of [
    { arch: "wrong" },
    { nodeABI: "0" },
    { schemaVersion: 999 },
    { nodeVersion: "24.0.0" },
    { sqliteVersion: "0.0.0" },
  ]) {
    const bad = { ...manifest, ...change };
    bad.sha256 = manifestHash(bad);
    const r = await verifyRuntime(bad, packageRoot);
    requireTrue(!r.ok, "Wrong runtime accepted");
    negatives.push(r.failures);
  }
  const asset = manifest.files.find(
      (f: { path: string }) => f.path === "public/index.html",
    ).path,
    original = await readFile(join(packageRoot, asset));
  try {
    await writeFile(join(packageRoot, asset), "tampered");
    requireTrue(
      !(await verifyRuntime(manifest, packageRoot)).ok,
      "Tampered static file accepted",
    );
  } finally {
    await writeFile(join(packageRoot, asset), original);
  }
  const nativePath = join(
    packageRoot,
    "node_modules/better-sqlite3/prebuilds/linux-" + process.arch + ".node",
  );
  const nativeHeld = nativePath + ".held",
    manifestOriginal = await readFile(manifestPath);
  let nativeFailureExit = 0;
  try {
    await rename(nativePath, nativeHeld);
    await writeFile(nativePath, "invalid native ELF");
    const bad = { ...manifest, files: await inventory(packageRoot) };
    bad.sha256 = manifestHash(bad);
    await writeFile(manifestPath, JSON.stringify(bad));
    try {
      execFileSync(
        join(packageRoot, "runtime/node"),
        [
          join(packageRoot, "apps/api/dist/scripts/verify-runtime.js"),
          packageRoot,
        ],
        { stdio: "pipe" },
      );
    } catch (e) {
      nativeFailureExit = (e as { status: number }).status;
    }
    requireTrue(nativeFailureExit === 1, "Invalid native module was accepted");
  } finally {
    await unlink(nativePath);
    await rename(nativeHeld, nativePath);
    await writeFile(manifestPath, manifestOriginal);
  }
  const fixture = await seedLoad(join(directory, "data"), manifestPath, 9);
  const db = new Database(fixture.database);
  db.pragma("foreign_keys=ON");
  const start = async (database: string, attachments: string, port: number) => {
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(
      join(packageRoot, "runtime/node"),
      [join(packageRoot, "apps/api/dist/apps/api/src/server.js")],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          NODE_ENV: "production",
          HOST: "127.0.0.1",
          PORT: String(port),
          APP_ORIGIN: base,
          DATABASE_PATH: database,
          ATTACHMENT_PATH: attachments,
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let errors = "";
    child.stderr.on("data", (c) => (errors += c));
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/api/health/ready")).status === 200)
          return { child, base };
      } catch {}
      if (child.exitCode !== null)
        throw Error("Packaged server exited: " + errors);
      await new Promise((r) => setTimeout(r, 50));
    }
    child.kill();
    throw Error("Packaged server not ready");
  };
  const servers: ReturnType<typeof spawn>[] = [];
  const login = async (base: string, index = 0) => {
    const u = fixture.users[index];
    const r = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ login: u.login, password: u.password }),
    });
    requireTrue(r.status === 200, "Login failed");
    return {
      cookie: r.headers.get("set-cookie")!.split(";")[0],
      csrf: ((await r.json()) as any).csrfToken,
    };
  };
  const request = async (
    base: string,
    session: { cookie: string; csrf: string },
    route: string,
    body: unknown,
    key = randomUUID(),
  ) => {
    const r = await fetch(base + route, {
      method: "POST",
      headers: {
        origin: base,
        cookie: session.cookie,
        "x-csrf-token": session.csrf,
        "idempotency-key": key,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any, key };
  };
  const input = {
    projectId: fixture.projects[0],
    title: "Package drill",
    kind: "backend",
    definitionOfDone: "checked",
    priority: "medium",
  };
  let result: Record<string, unknown> = {};
  try {
    const app = await start(fixture.database, fixture.attachments, 39123);
    servers.push(app.child);
    const sessions: { cookie: string; csrf: string }[] = [];
    for (let i = 0; i < 9; i++) sessions.push(await login(app.base, i));
    const shared = await request(app.base, sessions[0], "/api/tasks", input);
    requireTrue(shared.status === 200, "create failed");
    const race = await Promise.all(
      sessions.map((s) =>
        request(app.base, s, `/api/tasks/${shared.body.id}/actions`, {
          action: "claim",
          expectedVersion: 1,
        }),
      ),
    );
    requireTrue(
      race.filter((r) => r.status === 200).length === 1 &&
        race.filter((r) => r.status === 409).length === 8,
      "Claim race not atomic",
    );
    const key = randomUUID(),
      replays = await Promise.all(
        Array.from({ length: 9 }, () =>
          request(
            app.base,
            sessions[0],
            "/api/tasks",
            { ...input, title: "Replay task" },
            key,
          ),
        ),
      );
    requireTrue(
      replays.every(
        (r) => r.status === 200 && r.body.id === replays[0].body.id,
      ),
      "Idempotency race failed",
    );
    requireTrue(
      (
        db
          .prepare(
            "SELECT count(*) n FROM events WHERE target_id=? AND action='created'",
          )
          .get(replays[0].body.id) as any
      ).n === 1,
      "Duplicate event",
    );
    // A distinct SQLite process holds the actual writer lock, then releases it.
    const locker = spawn(
      join(packageRoot, "runtime/node"),
      [
        "-e",
        `const D=require('better-sqlite3');const d=new D(process.argv[1]);d.exec('BEGIN IMMEDIATE');console.log('locked');setTimeout(()=>{d.exec('COMMIT');d.close()},250)`,
        fixture.database,
      ],
      { cwd: packageRoot, stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise<void>((r) => locker.stdout!.once("data", () => r()));
    const began = performance.now();
    const locked = await request(app.base, sessions[0], "/api/tasks", {
      ...input,
      title: "Waited for lock",
    });
    const lockRequestMs = performance.now() - began;
    requireTrue(
      locked.status === 200 && lockRequestMs >= 100,
      "No real lock wait",
    );
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#159f68" },
    })
      .png()
      .toBuffer();
    const upload = async (
      base: string,
      session: (typeof sessions)[number],
      id: string,
    ) => {
      const form = new FormData();
      form.append(
        "image",
        new Blob([new Uint8Array(png)], { type: "image/png" }),
        "synthetic.png",
      );
      const r = await fetch(
        `${base}/api/objects/task/${id}/attachments?expectedVersion=1&size=${png.length}`,
        {
          method: "POST",
          headers: {
            origin: base,
            cookie: session.cookie,
            "x-csrf-token": session.csrf,
            "idempotency-key": randomUUID(),
          },
          body: form,
        },
      );
      return { status: r.status, body: (await r.json()) as any };
    };
    const image = await upload(app.base, sessions[0], replays[0].body.id);
    requireTrue(image.status === 200, "Image failed");
    const report = await request(app.base, sessions[0], "/api/reports", {
      date: new Date().toISOString().slice(0, 10),
      memberIds: fixture.users.map((u) => u.id),
      projectIds: fixture.projects,
      timeZone: "UTC",
    });
    requireTrue(report.status === 200, "Report failed");
    await backup(join(directory, "snapshot"), {
      db,
      attachmentDirectory: fixture.attachments,
    });
    const restored = await restoreVerify(
      join(directory, "snapshot/manifest.json"),
      join(directory, "restored"),
    );
    requireTrue(
      restored.attachmentsVerified === 1 && restored.reportsVerified === 1,
      "Recovery incomplete",
    );
    const recovered = await start(
      join(directory, "restored/database.sqlite"),
      join(directory, "restored/attachments"),
      39124,
    );
    servers.push(recovered.child);
    const recoveredSession = await login(recovered.base);
    const business = await request(
      recovered.base,
      recoveredSession,
      "/api/tasks",
      { ...input, title: "Business write after isolated restore" },
    );
    requireTrue(business.status === 200, "Restored business write failed");
    requireTrue(
      !db.prepare("SELECT 1 FROM objects WHERE id=?").get(business.body.id),
      "Restore touched live data",
    );
    const imageResponse = await fetch(
      recovered.base + `/api/attachments/${image.body.id}/content`,
      { headers: { cookie: recoveredSession.cookie } },
    );
    requireTrue(
      imageResponse.status === 200 &&
        Buffer.from(await imageResponse.arrayBuffer()).equals(png),
      "Restored image differs",
    );
    const rollback = await rehearseRollback(join(directory, "rollback"));
    requireTrue(rollback.newWritesPreserved, "Rollback lost new write");
    await chmod(fixture.attachments, 0o500);
    const unavailable = await fetch(app.base + "/api/health/ready");
    await chmod(fixture.attachments, 0o700);
    requireTrue(unavailable.status === 503, "Read-only storage appeared ready");
    await mkdir(join(fullDirectory, "images"), { recursive: true });
    const fullApp = await start(
      fixture.database,
      join(fullDirectory, "images"),
      39125,
    );
    servers.push(fullApp.child);
    const fullSession = await login(fullApp.base);
    const fill = await open(join(fullDirectory, "fill"), "wx");
    let enospc = "";
    try {
      const chunk = Buffer.alloc(65536);
      for (let i = 0; i < 1024; i++) await fill.write(chunk);
    } catch (e) {
      enospc = (e as NodeJS.ErrnoException).code ?? "";
    } finally {
      await fill.close();
    }
    requireTrue(enospc === "ENOSPC", "Actual OS ENOSPC not reached");
    const attachmentsBefore = (
      db.prepare("SELECT count(*) n FROM attachments").get() as any
    ).n;
    const fullUpload = await upload(fullApp.base, fullSession, locked.body.id);
    requireTrue(
      fullUpload.status === 500,
      "Disk-full upload falsely succeeded",
    );
    requireTrue(
      (db.prepare("SELECT count(*) n FROM attachments").get() as any).n ===
        attachmentsBefore,
      "Bad attachment reference committed",
    );
    let backupFailed = false;
    try {
      await backup(join(fullDirectory, "backup"), {
        db,
        attachmentDirectory: fixture.attachments,
      });
    } catch {
      backupFailed = true;
    }
    requireTrue(backupFailed, "Full backup falsely succeeded");
    let successManifest = false;
    try {
      await readFile(join(fullDirectory, "backup/manifest.json"));
      successManifest = true;
    } catch {}
    requireTrue(!successManifest, "Failed backup published manifest");
    // Kill only our child while an authenticated burst of writes is in flight.
    const crashKeys = Array.from({ length: 100 }, () => randomUUID());
    let firstAcknowledged!: () => void;
    const firstAck = new Promise<void>((r) => (firstAcknowledged = r));
    let completed = 0;
    const pending = crashKeys.map((k) =>
      request(app.base, sessions[0], "/api/tasks", { ...input, title: k }, k)
        .then((r) => {
          completed++;
          if (r.status === 200) firstAcknowledged();
          return r;
        })
        .catch(() => {
          completed++;
          return null;
        }),
    );
    await firstAck;
    const inFlightAtKill = 100 - completed;
    requireTrue(inFlightAtKill > 0, "No requests pending at kill");
    app.child.kill("SIGKILL");
    const acknowledged = (await Promise.all(pending)).filter(
      (r) => r?.status === 200,
    );
    const restarted = await start(fixture.database, fixture.attachments, 39123);
    servers.push(restarted.child);
    let crashLost = 0;
    for (const row of acknowledged)
      if (
        !db
          .prepare(
            "SELECT 1 FROM idempotency WHERE actor_id=? AND request_id=?",
          )
          .get(fixture.users[0].id, row!.key)
      )
        crashLost++;
    requireTrue(
      acknowledged.length > 0 && crashLost === 0,
      "Acknowledged crash writes lost",
    );
    requireTrue(
      db.pragma("integrity_check", { simple: true }) === "ok" &&
        (db.pragma("foreign_key_check") as unknown[]).length === 0,
      "Crash damaged database",
    );
    const admin = await (
      await fetch(recovered.base + "/api/admin/runtime", {
        headers: { cookie: recoveredSession.cookie },
      })
    ).json();
    result = {
      ok: true,
      runtime,
      negativeRuntimeFailures: negatives,
      nativeFailureExit,
      sameObjectRace: race.map((r) => r.status),
      idempotentRace: replays.map((r) => r.status),
      lockRequestMs,
      readonlyReadyStatus: unavailable.status,
      enospc,
      fullUploadStatus: fullUpload.status,
      backupFailed,
      failedBackupManifestAbsent: !successManifest,
      crash: {
        signal: "SIGKILL",
        requested: 100,
        inFlightAtKill,
        acknowledged: acknowledged.length,
        lostWrites: crashLost,
        integrity: "ok",
        foreignKeys: [],
      },
      recovery: restored,
      restoredBusinessWrite: true,
      restoredImageBytesMatch: true,
      rollback,
      admin,
      commit: manifest.commit,
      packageManifestSha256: await fileHash(manifestPath),
      nodeVersion: process.versions.node,
      createdAt: new Date().toISOString(),
    };
    await writeFile(
      join(directory, "drill-result.json"),
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(directory, "drill-result.json.sha256"),
      await fileHash(join(directory, "drill-result.json")),
      { mode: 0o600 },
    );
    return result;
  } finally {
    for (const child of servers)
      if (child.exitCode === null) child.kill("SIGTERM");
    db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  console.log(
    JSON.stringify(
      await releaseDrill(
        resolve(process.argv[2]),
        resolve(process.argv[3]),
        resolve(process.argv[4]),
      ),
    ),
  );

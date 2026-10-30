import { isMain } from "./cli-main.js";
import { mkdir, readFile, writeFile, statfs } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { openDb } from "../apps/api/src/db/open.js";
import { migrate } from "../apps/api/src/db/migrate.js";
import { createTask, actTask } from "../apps/api/src/tasks/service.js";
import { backup } from "./backup.js";
import { restoreVerify } from "./restore-verify.js";
import { fileHash } from "./verify-runtime.js";
export interface LoadResult {
  lostWrites: number;
  duplicateEvents: number;
  p95Ms: number;
  oomCount: number;
}
export interface LoadFixture {
  database: string;
  attachments: string;
  users: { login: string; password: string; id: string; taskId: string }[];
  projects: string[];
  seedObjects: number;
  seedEvents: number;
  packageManifest: string;
  output: string;
  serverPid: number;
}
export async function rehearseRollback(
  scratchDir: string,
): Promise<{ newWritesPreserved: boolean }> {
  await mkdir(scratchDir, { recursive: true });
  const db = openDb(join(scratchDir, "live.sqlite"));
  try {
    migrate(db);
    db.exec(
      "INSERT INTO members(id,name,login) VALUES('actor','Synthetic','actor');INSERT INTO projects(id,name) VALUES('project','Synthetic');INSERT INTO roles(project_id,member_id,role) VALUES('project','actor','product')",
    );
    const ctx = {
      actorId: "actor",
      route: "/drill",
      bodyHash: "drill",
      requestId: "before",
      authorize: () => {},
    };
    const task = createTask(db, ctx, {
      projectId: "project",
      title: "Before snapshot",
      kind: "backend",
      definitionOfDone: "checked",
      priority: "medium",
    });
    await mkdir(join(scratchDir, "images"));
    await backup(join(scratchDir, "before"), {
      db,
      attachmentDirectory: join(scratchDir, "images"),
    });
    actTask(db, { ...ctx, requestId: "after", expectedVersion: 1 }, task.id, {
      action: "refine",
      title: "Acknowledged after snapshot",
    });
    await backup(join(scratchDir, "preserved-current"), {
      db,
      attachmentDirectory: join(scratchDir, "images"),
    });
    await restoreVerify(
      join(scratchDir, "preserved-current/manifest.json"),
      join(scratchDir, "isolated-current"),
    );
    const restored = new Database(
      join(scratchDir, "isolated-current/database.sqlite"),
      { readonly: true },
    );
    try {
      const row = restored
        .prepare("SELECT current,version FROM objects WHERE id=?")
        .get(task.id) as { current: string; version: number };
      return {
        newWritesPreserved:
          JSON.parse(row.current).title === "Acknowledged after snapshot" &&
          row.version === 2 &&
          !!restored
            .prepare("SELECT 1 FROM idempotency WHERE request_id='after'")
            .get(),
      };
    } finally {
      restored.close();
    }
  } finally {
    db.close();
  }
}
export async function runLoadScenario(
  baseUrl: string,
  users: number,
  durationSec: number,
): Promise<LoadResult> {
  if (!Number.isFinite(durationSec) || durationSec <= 0)
    throw Error("Positive duration required");
  if (!process.env.LOAD_FIXTURE)
    throw Error("Real authenticated LOAD_FIXTURE required");
  const fixture: LoadFixture = JSON.parse(
    await readFile(process.env.LOAD_FIXTURE, "utf8"),
  );
  if (users !== 9 || fixture.users.length !== users)
    throw Error("Nine distinct users required");
  const manifest = JSON.parse(await readFile(fixture.packageManifest, "utf8"));
  const db = new Database(fixture.database, { readonly: true });
  db.pragma("busy_timeout=3000");
  const seedObjects = (
      db.prepare("SELECT count(*) n FROM objects").get() as { n: number }
    ).n,
    seedEvents = (
      db.prepare("SELECT count(*) n FROM events").get() as { n: number }
    ).n,
    seedProjects = (
      db.prepare("SELECT count(*) n FROM projects").get() as { n: number }
    ).n;
  if (seedProjects !== 2 || seedObjects < 10000 || seedEvents < 100000)
    throw Error(
      "Actual database requires 2 projects, 10000 objects and 100000 events",
    );
  const cgroup = "/sys/fs/cgroup";
  const numberFile = async (name: string) =>
    Number((await readFile(join(cgroup, name), "utf8")).trim());
  const cpuMax = (await readFile(join(cgroup, "cpu.max"), "utf8")).trim(),
    memoryMax = await numberFile("memory.max");
  if (cpuMax !== "200000 100000" || memoryMax !== 2147483648)
    throw Error("Effective cgroup 2 CPU / 2 GiB required");
  const oom = async () =>
    Number(
      (await readFile(join(cgroup, "memory.events"), "utf8")).match(
        /^oom_kill (\d+)$/m,
      )?.[1] ?? NaN,
    );
  const oomBefore = await oom(),
    latencies: number[] = [],
    statuses: Record<string, number> = {},
    mix: Record<string, number> = {},
    ledger: { actor: string; key: string; title: string; id: string }[] = [],
    samples: unknown[] = [];
  let errors = 0,
    minAvailable = Infinity,
    minDiskFree = 1,
    maxRss = 0;
  const sample = async () => {
    const current = await numberFile("memory.current");
    const fs = await statfs(fixture.database);
    const available = memoryMax - current,
      free = fs.bavail / fs.blocks;
    const status = await readFile(`/proc/${fixture.serverPid}/status`, "utf8");
    const rss = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024;
    minAvailable = Math.min(minAvailable, available);
    minDiskFree = Math.min(minDiskFree, free);
    maxRss = Math.max(maxRss, rss);
    samples.push({
      time: new Date().toISOString(),
      memoryCurrent: current,
      available,
      diskFreeFraction: free,
      rss,
    });
  };
  // Real password hashing is included in the resource peak, sessions are never fabricated.
  await sample();
  const sessions: { cookie: string; csrf: string }[] = [];
  for (const user of fixture.users) {
    const r = await fetch(baseUrl + "/api/auth/login", {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ login: user.login, password: user.password }),
    });
    if (r.status !== 200) throw Error(`Authentication failed ${r.status}`);
    sessions.push({
      cookie: r.headers.get("set-cookie")!.split(";")[0],
      csrf: ((await r.json()) as { csrfToken: string }).csrfToken,
    });
    await sample();
  }
  const start = performance.now(),
    startedAt = new Date().toISOString();
  let stopped = false;
  const sampler = (async () => {
    let ticks = 0;
    while (!stopped) {
      await sample();
      if (ticks++ % 30 === 0)
        console.log(
          JSON.stringify({
            elapsedSec: (performance.now() - start) / 1000,
            requests: latencies.length,
            writes: ledger.length,
            errors,
            minAvailableBytes: minAvailable,
            minDiskFreeFraction: minDiskFree,
          }),
        );
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();
  try {
    await Promise.all(
      fixture.users.map(async (user, index) => {
        const session = sessions[index];
        let iteration = 0;
        while (performance.now() - start < durationSec * 1000) {
          const key = `load_${index}_${iteration}_${randomUUID()}`,
            title = key;
          const category = iteration % 10;
          let route = "/api/tasks?limit=20",
            body: unknown,
            method = "GET",
            label = "task-list";
          if (category === 1) {
            route = `/api/tasks/${user.taskId}`;
            label = "task-detail";
          }
          if (category === 2) {
            route = `/api/objects/task/${user.taskId}/history?limit=20`;
            label = "history";
          }
          if (category === 3) {
            route = "/api/projects?limit=20";
            label = "projects";
          }
          if (category === 4) {
            route = "/api/reports?limit=20";
            label = "reports";
          }
          if (category >= 6) {
            route = "/api/tasks";
            method = "POST";
            label = "create-task";
            body = {
              projectId: fixture.projects[index % 2],
              title,
              kind: "backend",
              definitionOfDone: "Synthetic load proof",
              priority: "medium",
            };
          }
          if (category === 5) {
            route = "/api/auth/session";
            label = "session";
          }
          const began = performance.now();
          try {
            const r = await fetch(baseUrl + route, {
              method,
              headers: {
                cookie: session.cookie,
                origin: baseUrl,
                "x-csrf-token": session.csrf,
                "idempotency-key": key,
                "content-type": "application/json",
              },
              ...(body ? { body: JSON.stringify(body) } : {}),
              signal: AbortSignal.timeout(10000),
            });
            const payload = (await r.json()) as { id?: string };
            latencies.push(performance.now() - began);
            statuses[r.status] = (statuses[r.status] ?? 0) + 1;
            mix[label] = (mix[label] ?? 0) + 1;
            if (r.status !== 200) errors++;
            else if (body && payload.id)
              ledger.push({ actor: user.id, key, title, id: payload.id });
          } catch {
            errors++;
            statuses.network = (statuses.network ?? 0) + 1;
            latencies.push(performance.now() - began);
          }
          iteration++;
          await new Promise((r) => setTimeout(r, 250));
        }
      }),
    );
  } finally {
    stopped = true;
    await sampler;
  }
  const elapsedSec = (performance.now() - start) / 1000;
  await sample();
  let lostWrites = 0,
    duplicateEvents = 0;
  const keyQuery = db.prepare(
      "SELECT response FROM idempotency WHERE actor_id=? AND request_id=?",
    ),
    eventQuery = db.prepare(
      "SELECT count(*) n FROM events WHERE target_kind='task' AND target_id=? AND action='created'",
    ),
    objectQuery = db.prepare("SELECT current FROM objects WHERE id=?");
  for (const row of ledger) {
    const key = keyQuery.get(row.actor, row.key) as
      | { response: string }
      | undefined;
    const object = objectQuery.get(row.id) as { current: string } | undefined;
    const count = (eventQuery.get(row.id) as { n: number }).n;
    if (
      !key ||
      JSON.parse(key.response).id !== row.id ||
      !object ||
      JSON.parse(object.current).title !== row.title ||
      count === 0
    )
      lostWrites++;
    duplicateEvents += Math.max(0, count - 1);
  }
  const telemetry = await (
    await fetch(baseUrl + "/api/admin/runtime", {
      headers: { cookie: sessions[0].cookie },
    })
  ).json();
  const integrity = db.pragma("integrity_check", { simple: true }),
    foreignKeys = db.pragma("foreign_key_check");
  db.close();
  latencies.sort((a, b) => a - b);
  const result = {
    lostWrites,
    duplicateEvents,
    p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1] ?? Infinity,
    oomCount: (await oom()) - oomBefore,
  };
  const report = {
    ...result,
    startedAt,
    finishedAt: new Date().toISOString(),
    elapsedSec,
    durationSec,
    users,
    seedObjects,
    seedEvents,
    seedProjects,
    requests: latencies.length,
    writes: ledger.length,
    requestsPerSec: latencies.length / elapsedSec,
    statuses,
    mix,
    errors,
    minAvailableBytes: minAvailable,
    minDiskFreeFraction: minDiskFree,
    maxServerRssBytes: maxRss,
    memoryPeakBytes: await numberFile("memory.peak"),
    cpuMax,
    memoryMax,
    integrity,
    foreignKeys,
    commit: manifest.commit,
    packageManifestSha256: await fileHash(fixture.packageManifest),
    runtime: { node: process.versions.node, arch: process.arch },
    paceMs: 250,
    telemetry,
    lockWaitMeasurement:
      "Actual elapsed before BEGIN IMMEDIATE callback; includes synchronous lock acquisition and driver overhead. SQLITE_BUSY counted in status503.",
    samples,
  };
  await writeFile(fixture.output, JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  await writeFile(fixture.output + ".sha256", await fileHash(fixture.output), {
    mode: 0o600,
  });
  return result;
}
if (isMain(import.meta.url))
  console.log(
    JSON.stringify(
      await runLoadScenario(
        process.argv[2],
        9,
        Number(process.argv[3] ?? 1800),
      ),
    ),
  );

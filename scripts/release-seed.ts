import { setImmediate as yieldToLoop } from "node:timers/promises";
// Explicit synthetic-only benchmark fixture. This file is excluded from release packages.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { openDb } from "../apps/api/src/db/open.js";
import { migrate } from "../apps/api/src/db/migrate.js";
import { createTask, actTask } from "../apps/api/src/tasks/service.js";
import { hashPassword } from "../apps/api/src/auth/password.js";
import type { LoadFixture } from "./release-load.js";
export async function seedLoad(
  directory: string,
  packageManifest: string,
  objects = 10000,
): Promise<LoadFixture> {
  await mkdir(directory, { recursive: true });
  const database = join(directory, "load.sqlite");
  const db = openDb(database);
  const users: LoadFixture["users"] = [];
  try {
    migrate(db);
    if ((db.prepare("SELECT count(*) n FROM members").get() as { n: number }).n)
      throw Error("Fresh synthetic database required");
    const password = `Synthetic-${randomUUID()}`,
      hash = await hashPassword(password);
    for (let i = 0; i < 9; i++) {
      const id = `load-user-${i}`;
      db.prepare(
        "INSERT INTO members(id,name,login,password_hash,is_admin) VALUES(?,?,?,?,?)",
      ).run(id, id, id, hash, i === 0 ? 1 : 0);
      users.push({ id, login: id, password, taskId: "" });
    }
    const projects = ["load-project-0", "load-project-1"];
    for (const project of projects) {
      db.prepare("INSERT INTO projects(id,name) VALUES(?,?)").run(
        project,
        project,
      );
      for (const user of users)
        for (const role of ["product", "backend", "test"])
          db.prepare(
            "INSERT INTO roles(project_id,member_id,role) VALUES(?,?,?)",
          ).run(project, user.id, role);
    }
    // Seed through the same domain mutations used by authenticated API routes; no trigger bypass or invented events.
    for (let i = 0; i < objects; i++) {
      const user = users[i % 9],
        ctx = {
          actorId: user.id,
          route: "/synthetic-seed",
          bodyHash: String(i),
          requestId: `seed-${i}`,
          authorize: () => {},
        };
      const task = createTask(db, ctx, {
        projectId: projects[i % 2],
        title: `Synthetic task ${i}`,
        kind: "backend",
        definitionOfDone: "Synthetic evidence checked",
        priority: "medium",
      });
      if (!user.taskId) user.taskId = task.id;
      for (let j = 1; j < 10; j++)
        actTask(
          db,
          { ...ctx, requestId: `seed-${i}-${j}`, expectedVersion: j },
          task.id,
          { action: "refine", title: `Synthetic task ${i} revision ${j}` },
        );
      // Drain native statement finalizers between bounded batches. A long synchronous
      // fixture loop otherwise retains native allocations until the event loop resumes.
      if (i % 100 === 99) await yieldToLoop();
      if (i % 1000 === 0)
        console.log(
          JSON.stringify({ seedObjects: i, time: new Date().toISOString() }),
        );
    }
    db.pragma("wal_checkpoint(TRUNCATE)");
    await mkdir(join(directory, "attachments"));
    const fixture: LoadFixture = {
      database,
      attachments: join(directory, "attachments"),
      users,
      projects,
      seedObjects: objects,
      seedEvents: (
        db.prepare("SELECT count(*) n FROM events").get() as { n: number }
      ).n,
      packageManifest,
      output: join(directory, "load-result.json"),
      serverPid: 0,
    };
    await writeFile(join(directory, "fixture.json"), JSON.stringify(fixture), {
      mode: 0o600,
    });
    return fixture;
  } finally {
    db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await seedLoad(
    resolve(process.argv[2]),
    resolve(process.argv[3]),
    Number(process.argv[4] ?? 10000),
  );

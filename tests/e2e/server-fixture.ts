import { join } from "node:path";
import { openDb } from "../../apps/api/src/db/open.js";
import { migrate } from "../../apps/api/src/db/migrate.js";
import { buildApp } from "../../apps/api/src/app.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { issueSession } from "../../apps/api/src/auth/session.js";
export async function startFixture(dir: string) {
  const db = openDb(join(dir, "browser.db"));
  migrate(db);
  const password = await hashPassword("Synthetic-demo-2026!");
  for (const [id, name, admin] of [
    ["admin", "演示管理员", 1],
    ["product", "林产品", 0],
    ["dev", "陈开发", 0],
    ["dev2", "许前端", 0],
    ["tester", "周测试", 0],
    ["viewer", "顾查看", 0],
    ["inactive", "叶归档", 0],
  ] as const)
    db.prepare(
      "INSERT INTO members(id,name,is_admin,login,password_hash,active) VALUES(?,?,?,?,?,?)",
    ).run(id, name, admin, id, password, id === "inactive" ? 0 : 1);
  for (const [id, name, description] of [
    ["p1", "星河协作计划", "统一需求、开发与测试，让每一步进展可追溯。"],
    ["p2", "青禾服务台", "面向团队的轻量服务与体验优化。"],
    ["pagination-access", "只读分页项目", "独立分页测试数据"],
    ["pagination-order", "顺序分页项目", "独立分页测试数据"],
  ])
    db.prepare("INSERT INTO projects(id,name,description) VALUES(?,?,?)").run(
      id,
      name,
      description,
    );
  for (const p of ["p1", "p2", "pagination-access", "pagination-order"])
    for (const [id, role, lead] of [
      ["admin", "product", 1],
      ["product", "product", 1],
      ["dev", "backend", 1],
      ["dev", "test", 0],
      ["dev2", "backend", 0],
      ["dev2", "frontend", 1],
      ["tester", "test", 1],
      ["inactive", "backend", 0],
    ] as const)
      db.prepare(
        "INSERT INTO roles(project_id,member_id,role,lead) VALUES(?,?,?,?)",
      ).run(p, id, role, lead);
  const app = buildApp(db, { origin: "https://127.0.0.1:4173" });
  const sessions = Object.fromEntries(
    ["admin", "product", "dev", "tester"].map((id) => [
      id,
      issueSession(db, id),
    ]),
  );
  let n = 0;
  async function post(path: string, body: any, actor = "product") {
    const s = sessions[actor]!;
    const r = await app.inject({
      method: "POST",
      url: path,
      headers: {
        origin: "https://127.0.0.1:4173",
        cookie: `session=${s.token}`,
        "x-csrf-token": s.csrfToken,
        "idempotency-key": `seed-${n++}`,
      },
      payload: body,
    });
    if (r.statusCode !== 200) throw new Error(r.body);
    return r.json();
  }
  for (const [title, p, owner] of [
    ["完善工作更新的字段校验", "p1", "dev"],
    ["统一服务台表单的键盘操作", "p2", "dev"],
    ["优化跨项目筛选与列表可读性", "p1", null],
    ["补充历史记录的来源说明", "p1", "inactive"],
  ] as const) {
    const t = await post("/api/tasks", {
      projectId: p,
      title,
      kind: "backend",
      definitionOfDone: "完成输入校验，并由检查人逐项验证正常与异常路径。",
      priority: "medium",
      ...(owner && owner !== "inactive" ? { ownerId: owner } : {}),
      reviewerId: "tester",
    });
    if (owner === "dev")
      await post(
        `/api/tasks/${t.id}/actions`,
        { action: "start", expectedVersion: 1 },
        "dev",
      );
    if (owner === "inactive")
      db.prepare(
        "UPDATE objects SET current=json_set(current,'$.ownerId','inactive'),version=version+1 WHERE id=?",
      ).run(t.id);
  }
  for (let i = 1; i <= 23; i++)
    await post("/api/tasks", {
      projectId: "p2",
      title: `服务台分页事项 ${String(i).padStart(2, "0")}`,
      kind: "backend",
      definitionOfDone: "完成可访问性验证",
      priority: "low",
      ownerId: "dev2",
      reviewerId: "tester",
    });
  for (const projectId of ["pagination-access", "pagination-order"])
    for (let i = 1; i <= 24; i++)
      await post("/api/tasks", {
        projectId,
        title: `${projectId} 分页事项 ${String(i).padStart(2, "0")}`,
        kind: "backend",
        definitionOfDone: "完成分页验证",
        priority: "low",
        ownerId: i === 1 ? "dev" : "dev2",
        reviewerId: "tester",
      });
  await app.listen({ host: "127.0.0.1", port: 4174 });
  return {
    close: async () => {
      await app.close();
      db.close();
    },
  };
}

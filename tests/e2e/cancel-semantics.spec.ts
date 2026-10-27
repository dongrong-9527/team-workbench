import { test, expect } from "./fixtures.js";
import { login } from "./helpers.js";
import { api, detail } from "./audit-helpers.js";

test("member reset and deactivation cancel, close and Escape never issue commands", async ({ page }, info) => {
  await login(page, "admin");
  await page.goto("/members");
  const row = page.getByRole("row").filter({ hasText: "顾查看" });
  const before = (await api(page, "GET", "/api/members?limit=100")).items.find((m: any) => m.id === "viewer");
  const writes: string[] = [];
  page.on("request", r => { if (r.method() === "POST" && /\/api\/members\/viewer\/(reset|deactivate)$/.test(new URL(r.url()).pathname)) writes.push(r.url()); });
  for (const [trigger, title] of [["重置密码", "签发密码重置票据"], ["停用", "停用成员"]]) {
    for (const close of ["button", "x", "escape", "mask"]) {
      await row.getByRole("button", { name: trigger, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeVisible();
      await expect(dialog).not.toContainText("本地草稿");
      await expect(dialog).not.toContainText("仅保存本账号普通工作草稿");
      if (close === "mask") {
        await page.mouse.click(3, 3);
        await expect(dialog).toBeVisible();
      }
      if (close === "x") {
        await expect(dialog.locator(".ant-modal-close")).toHaveCount(0);
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
      }
      else if (close === "escape") await page.keyboard.press("Escape");
      else await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
  }
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /^workbench:draft:admin:member:(reset|deactivate):viewer:/.test(key)))).toEqual([]);
  const after = (await api(page, "GET", "/api/members?limit=100")).items.find((m: any) => m.id === "viewer");
  expect(after).toMatchObject({ version: before.version, active: before.active, activated: before.activated });
  await expect(page.getByLabel("一次性票据")).toHaveCount(0);
  await row.getByRole("button", { name: "重置密码", exact: true }).click();
  await page.screenshot({ path: info.outputPath("reset-confirm-cancel.png"), fullPage: true });
});

test("short member input and authorization dialogs say cancel while preserving valid safe input", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/members");
  const writes: string[] = [];
  page.on("request", r => { if (["POST", "PUT"].includes(r.method()) && /\/api\/(members|projects\/[^/]+\/roles)/.test(new URL(r.url()).pathname)) writes.push(r.url()); });
  await page.getByRole("button", { name: "创建成员", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "创建成员", exact: true });
  await dialog.getByLabel("登录账号（小写英文或数字）").fill("synthetic.cancel");
  await dialog.getByLabel("显示名", { exact: true }).fill("未提交的安全输入");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "创建成员", exact: true }).click();
  await expect(dialog.getByLabel("显示名", { exact: true })).toHaveValue("未提交的安全输入");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "顾查看" });
  await row.getByRole("button", { name: "改名", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "修改显示名", exact: true });
  await dialog.getByLabel("显示名", { exact: true }).fill("未提交的显示名");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await row.getByRole("button", { name: "改名", exact: true }).click();
  await expect(dialog.getByLabel("显示名", { exact: true })).toHaveValue("未提交的显示名");
  await page.keyboard.press("Escape");
  await row.getByRole("button", { name: "授权", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "调整项目授权", exact: true });
  await dialog.getByLabel("前端", { exact: true }).first().check();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await row.getByRole("button", { name: "授权", exact: true }).click();
  await expect(dialog.getByLabel("前端", { exact: true }).first()).toBeChecked();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(writes).toEqual([]);
});

test("short work confirmation cancels without a write or false draft notice and long update restores", async ({ page }) => {
  await login(page, "product");
  const task = await api(page, "POST", "/api/tasks", { projectId: "p1", title: "合成取消语义任务", kind: "backend", priority: "medium", definitionOfDone: "实际核对" });
  await login(page, "dev");
  await detail(page, "task", task);
  const writes: string[] = [];
  page.on("request", r => { if (r.method() === "POST" && new URL(r.url()).pathname === `/api/tasks/${task.id}/actions`) writes.push(r.url()); });
  await page.getByRole("button", { name: "认领", exact: true }).click();
  const short = page.getByRole("dialog", { name: "认领", exact: true });
  await short.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByText("普通草稿已保留，可重新打开继续填写。", { exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
  expect((await api(page, "GET", `/api/tasks/${task.id}`)).ownerId).toBeFalsy();
  await page.getByRole("button", { name: "写工作更新", exact: true }).click();
  const long = page.getByRole("dialog", { name: "写工作更新", exact: true });
  await long.getByLabel("今天实际做了什么", { exact: true }).fill("保留实际填写，不提交进度");
  await long.getByRole("button", { name: "返回并保留草稿", exact: true }).click();
  await page.getByRole("button", { name: "写工作更新", exact: true }).click();
  await expect(long.getByLabel("今天实际做了什么", { exact: true })).toHaveValue("保留实际填写，不提交进度");
  await long.locator(".ant-drawer-close").click();
  await page.getByRole("button", { name: "写工作更新", exact: true }).click();
  await expect(long.getByLabel("今天实际做了什么", { exact: true })).toHaveValue("保留实际填写，不提交进度");
});

test("reset pending state blocks dismissal and unknown-result retry keeps its original command", async ({ page }) => {
  await login(page, "admin");
  const member = await api(page, "POST", "/api/members", { login: "synthetic.cancel.reset", displayName: "合成票据重试成员" });
  await page.goto("/members");
  const row = page.getByRole("row").filter({ hasText: "合成票据重试成员" });
  const path = `/api/members/${member.id}/reset`;
  await page.evaluate(id => localStorage.setItem(`workbench:draft:admin:member:reset:${id}:p1`, JSON.stringify({ values: { displayName: "过时的普通草稿" }, version: 999, fingerprint: "", key: "" })), member.id);
  const keys: string[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${path}`, async route => {
    keys.push(route.request().headers()["idempotency-key"]!);
    expect(route.request().postDataJSON().expectedVersion).toBe(member.version);
    expect((await route.fetch()).status()).toBe(200);
    await held;
    await route.abort("failed");
  });
  await row.getByRole("button", { name: "重置密码", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "签发密码重置票据", exact: true });
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "确认签发密码重置票据", exact: true }).click();
  await expect.poll(() => keys.length).toBe(1);
  await expect(dialog.locator(".mutation-cancel")).toBeDisabled();
  await expect(dialog.locator(".ant-modal-close")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.mouse.click(3, 3);
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog.getByRole("alert")).toContainText("网络");
  await dialog.locator(".mutation-cancel").click();
  const retry = await page.evaluate(id => JSON.parse(localStorage.getItem(`workbench:draft:admin:member:reset:${id}:p1`)! ), member.id);
  expect(Object.keys(retry).sort()).toEqual(["fingerprint", "key", "version"]);
  expect(retry.version).toBe(member.version);
  await page.unroute(`**${path}`);
  page.on("request", r => { if (r.method() === "POST" && new URL(r.url()).pathname === path) keys.push(r.headers()["idempotency-key"]!); });
  await row.getByRole("button", { name: "重置密码", exact: true }).click();
  await dialog.getByRole("button", { name: "确认签发密码重置票据", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  await expect(page.getByText("票据已签发；重复请求只返回安全元数据。", { exact: false })).toBeVisible();
  await expect(page.getByLabel("一次性票据")).toHaveCount(0);
  const history = await api(page, "GET", `/api/audit/member/${member.id}?limit=100&afterSeq=0`);
  expect(history.items.filter((e: any) => e.action === "reset")).toHaveLength(1);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/resetToken|activationToken|csrfToken|newPassword/);
});

test("project editor retains long drafts while archive and restore use cancel without writes", async ({ page }) => {
  await login(page, "admin");
  const project = await api(page, "POST", "/api/projects", { name: "合成项目取消语义", description: "原说明" });
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("button", { name: "编辑项目", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "编辑项目", exact: true });
  await dialog.getByLabel("项目简介", { exact: true }).fill("未提交的项目说明草稿");
  await dialog.getByRole("button", { name: "返回并保留草稿", exact: true }).click();
  await page.getByRole("button", { name: "编辑项目", exact: true }).click();
  await expect(dialog.getByLabel("项目简介", { exact: true })).toHaveValue("未提交的项目说明草稿");
  await page.keyboard.press("Escape");
  const writes: string[] = [];
  let watching = true;
  page.on("request", r => { if (watching && r.method() === "POST" && new URL(r.url()).pathname.startsWith(`/api/projects/${project.id}/`)) writes.push(r.url()); });
  await page.getByRole("button", { name: "归档项目", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "归档项目", exact: true });
  await expect(dialog).not.toContainText("普通工作草稿");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(writes).toEqual([]);
  watching = false;
  const current = await api(page, "GET", `/api/projects/${project.id}`);
  await api(page, "POST", `/api/projects/${project.id}/archive`, { expectedVersion: current.version });
  await page.reload();
  watching = true;
  await page.getByRole("button", { name: "恢复项目", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "恢复项目", exact: true });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(writes).toEqual([]);
  expect((await api(page, "GET", `/api/projects/${project.id}`)).archived).toBe(1);
});

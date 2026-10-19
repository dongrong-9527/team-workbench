import { test, expect } from "./fixtures.js";
import { login, submit, selectOption } from "./helpers.js";
import { api, detail } from "./audit-helpers.js";

async function createTask(page: import("@playwright/test").Page, title: string, ownerId = "dev") {
  await login(page, "product");
  return api(page, "POST", "/api/tasks", { projectId: "p1", title, kind: "backend", definitionOfDone: "实际核对", priority: "medium", ownerId, reviewerId: "tester" });
}
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

test("F03 light drafts use real saves at desktop and phone widths and keep later gates", async ({ page }, info) => {
  await login(page, "product");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/projects/p1");
    await page.getByRole("button", { name: "新建需求", exact: true }).click();
    await page.getByLabel("标题", { exact: true }).fill(`合成F03待细化需求${width}`);
    await page.getByLabel("腾讯文档 / 来源链接（仅 HTTPS）", { exact: true }).fill("https://docs.example.test/synthetic");
    await expect(page.getByLabel("条目说明", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`F03-draft-${width}.png`), fullPage: true });
    await submit(page, "确认新建需求");
    await expect(page).toHaveURL(/\/requirement\//);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const r = await api(page, "GET", `/api/requirements/${id}`);
    expect(r).toMatchObject({ state: "draft", description: "", criteria: [] });
    expect(r.acceptorId).toBeFalsy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("合成F03待补标准任务");
  await submit(page, "确认新建任务");
  await expect(page).toHaveURL(/\/task\//);
  const taskId = new URL(page.url()).pathname.split("/").at(-1)!;
  expect((await api(page, "GET", `/api/tasks/${taskId}`)).definitionOfDone).toBe("");
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "新建 Bug", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("合成F03口头问题");
  await submit(page, "确认新建Bug");
  await expect(page).toHaveURL(/\/bug\//);
  const bugId = new URL(page.url()).pathname.split("/").at(-1)!;
  const bug = await api(page, "GET", `/api/bugs/${bugId}`);
  expect(bug).toMatchObject({ state: "unconfirmed", expected: "", actual: "", reproduction: "", environment: "" });
  await api(page, "POST", `/api/bugs/${bugId}/actions`, { action: "confirm", expectedVersion: bug.version, reason: "尚待补充" }, 422);
});

test("F04 completed work remains discoverable for a real daily update after a read error", async ({ page }, info) => {
  let task = await createTask(page, "合成F04完成后补写日更");
  await login(page, "dev");
  task = await api(page, "POST", `/api/tasks/${task.id}/actions`, { action: "start", expectedVersion: task.version });
  task = await api(page, "POST", `/api/tasks/${task.id}/actions`, { action: "submit", expectedVersion: task.version, evidence: { done: "完成实际工作", selfCheck: "已自查", environment: "Synthetic", targetVersion: "build-1" } });
  await login(page, "tester");
  task = await api(page, "POST", `/api/tasks/${task.id}/actions`, { action: "checkPass", expectedVersion: task.version, test: { target: { kind: "task", id: task.id }, targetVersion: "build-1", environment: "Synthetic", checks: [{ checkId: "completion", result: "pass" }] } });
  expect(task.state).toBe("done");
  await login(page, "dev");
  let fail = true;
  await page.route("**/api/my-progress**", (route) => fail ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic progress temporarily unavailable" }) }) : route.continue());
  await page.getByRole("button", { name: "填写今日进展", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择要记录进展的工作", exact: true });
  await expect(picker).toContainText("Synthetic progress temporarily unavailable");
  fail = false;
  await picker.getByRole("button", { name: "重试读取事项", exact: true }).click();
  await picker.getByLabel("搜索可补记事项", { exact: true }).fill(task.title);
  await picker.getByRole("link", { name: task.title, exact: true }).click();
  const form = page.getByRole("dialog", { name: "写工作更新", exact: true });
  await form.getByLabel("今天实际做了什么", { exact: true }).fill("合成F04：完成后补记实际成果");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("F04-completed-update-mobile.png"), fullPage: true });
  await submit(page, "保存更新");
  const updates = await api(page, "GET", "/api/updates?limit=100&afterSeq=0");
  expect(updates.items.filter((x: any) => x.target.id === task.id)).toHaveLength(1);
  expect((await api(page, "GET", `/api/tasks/${task.id}`)).state).toBe("done");
});

test("F05 correction locks classification while saving a new original-author text version", async ({ page }) => {
  const task = await createTask(page, "合成F05贡献类型更正");
  await login(page, "dev");
  await api(page, "POST", "/api/updates", { target: { kind: "task", id: task.id }, workDate: today(), contributionType: "development", done: "原始实际贡献" });
  await detail(page, "task", task);
  await page.getByRole("button", { name: /^我的工作更新（/ }).click();
  await page.getByRole("button", { name: "更正此条更新", exact: true }).click();
  const form = page.getByRole("dialog", { name: "更正我的工作更新", exact: true });
  await expect(form.getByRole("combobox", { name: "实际贡献类型", exact: true })).toBeDisabled();
  await expect(form).toContainText("更正保留原实际贡献类型");
  await form.getByLabel("今天实际做了什么", { exact: true }).fill("更正实际文字，保留原贡献归类");
  await form.getByLabel("操作原因", { exact: true }).fill("文字核对");
  await submit(page, "保存更新");
  const update = (await api(page, "GET", "/api/updates?limit=100&afterSeq=0")).items.find((x: any) => x.target.id === task.id);
  expect(update).toMatchObject({ version: 2, contributionType: "development", done: "更正实际文字，保留原贡献归类" });
});

test("F06 revoked role is explained and product can reassign without restoring authority", async ({ page, browser, observeContext }, info) => {
  const task = await createTask(page, "合成F06撤岗工作交接", "dev2");
  const adminContext = await browser.newContext({ ignoreHTTPSErrors: true });
  await observeContext(adminContext);
  const admin = await adminContext.newPage();
  await login(admin, "admin");
  const original = (await api(admin, "GET", "/api/members?projectId=p1&limit=100")).items.find((x: any) => x.id === "dev2").roles;
  try {
    let project = await api(admin, "GET", "/api/projects/p1");
    await api(admin, "PUT", "/api/projects/p1/roles", { memberId: "dev2", roles: ["frontend"], leads: ["frontend"], expectedVersion: project.version });
    await page.goto(`/projects/p1?tab=tasks&q=${encodeURIComponent(task.title)}`);
    await expect(page.getByText("负责人岗位权限已变更", { exact: true }).first()).toBeVisible();
    expect((await api(page, "GET", "/api/my-work?limit=100")).items.map((x: any) => x.id)).toContain(task.id);
    await detail(page, "task", task);
    await page.getByRole("button", { name: "改派", exact: true }).click();
    await selectOption(page, "新的主负责人", { value: "dev", label: "陈开发" });
    await page.getByLabel("操作原因", { exact: true }).fill("原负责人岗位已调整");
    await page.getByLabel("交接说明", { exact: true }).fill("移交现有工作和检查记录");
    await page.screenshot({ path: info.outputPath("F06-reassignment-desktop.png"), fullPage: true });
    await submit(page, "确认改派");
    expect((await api(page, "GET", `/api/tasks/${task.id}`)).ownerId).toBe("dev");
  } finally {
    const project = await api(admin, "GET", "/api/projects/p1");
    await api(admin, "PUT", "/api/projects/p1/roles", { memberId: "dev2", roles: original.map((x: any) => x.role), leads: original.filter((x: any) => x.lead).map((x: any) => x.role), expectedVersion: project.version });
    await adminContext.close();
  }
});

test("F11 created accounts are identifiable and initial project guide lists real missing roles", async ({ page }, info) => {
  await login(page, "admin");
  const label = "合成F11待激活成员";
  await api(page, "POST", "/api/members", { login: "synthetic-pending-ui", displayName: label });
  await page.goto("/members");
  const row = page.getByRole("row").filter({ hasText: label });
  await expect(row.getByText("待激活", { exact: true })).toBeVisible();
  await expect(row.getByText(/账号标识：/)).toBeVisible();
  const project = await api(page, "POST", "/api/projects", { name: "合成F11仅管理员初始配置", description: "合成空配置引导" });
  expect((await api(page, "GET", `/api/projects/${project.id}/overview`)).myRoles).toEqual([]);
  await page.goto(`/projects/${project.id}`);
  const guide = page.getByRole("region", { name: "项目协作与权限", exact: true });
  await expect(guide).toContainText("尚未配置产品角色");
  await expect(guide).toContainText("尚未配置测试角色");
  await expect(guide.getByRole("link", { name: "管理本项目成员与角色", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("F11-initial-roles-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(guide).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { login, selectOption } from "./helpers.js";

function panel(page: Page, label: string) {
  return page.getByRole("region", { name: label, exact: true });
}

test("work filters start closed, discard drafts, and apply server fields in one first-page read", async ({ page }) => {
  await login(page);
  const filters = panel(page, "我的工作筛选");
  await expect(filters.getByRole("button", { name: "筛选（0）", exact: true })).toBeVisible();
  await expect(page.getByLabel("工作类型", { exact: true })).toHaveCount(0);
  await expect(page.locator(".work-main-panel .work-row").first()).toBeVisible();
  const requests: URL[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/my-work?")) requests.push(new URL(r.url())); });
  await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
  await selectOption(page, "工作类型", { value: "task", label: "任务" });
  await selectOption(page, "阻塞", { value: "true", label: "仅阻塞" });
  await page.getByLabel("筛选已加载工作").fill("temporary");
  await filters.getByRole("button", { name: "重置", exact: true }).click();
  await filters.getByRole("button", { name: "收起", exact: true }).click();
  expect(requests).toHaveLength(0);
  await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
  await expect(page.getByLabel("筛选已加载工作")).toHaveValue("");
  await selectOption(page, "工作类型", { value: "task", label: "任务" });
  await selectOption(page, "阻塞", { value: "true", label: "仅阻塞" });
  const loaded = page.waitForResponse((r) => r.url().includes("/api/my-work?") && r.request().method() === "GET");
  await filters.getByRole("button", { name: "确定", exact: true }).click();
  await loaded;
  expect(requests).toHaveLength(1);
  expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({ kind: "task", blocked: "true" });
  await expect(filters.getByRole("button", { name: "筛选（2）", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/filterKind=task/);
});

test("project directory search remains local and reset is temporary", async ({ page }, testInfo) => {
  await login(page, "admin");
  await page.goto("/projects?view=all");
  const filters = panel(page, "项目目录筛选");
  const cards = page.locator(".project-card");
  await expect(cards.first()).toBeVisible();
  const before = await cards.count();
  const requests: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/")) requests.push(r.url()); });
  await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
  await page.getByLabel("搜索项目名称").fill("no-project-has-this-name");
  expect(await cards.count()).toBe(before);
  await page.screenshot({ path: testInfo.outputPath("desktop-directory-pending.png"), fullPage: true });
  await filters.getByRole("button", { name: "确定", exact: true }).click();
  await expect(cards).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("desktop-directory-empty.png"), fullPage: true });
  expect(requests).toEqual([]);
  await filters.getByRole("button", { name: "筛选（1）", exact: true }).click();
  await filters.getByRole("button", { name: "重置", exact: true }).click();
  await expect(cards).toHaveCount(0);
  await filters.getByRole("button", { name: "收起", exact: true }).click();
  await expect(cards).toHaveCount(0);
});

test("my-work keywords stay local while confirmation and browser back reload the first page", async ({ page }) => {
  await login(page);
  await expect(page.locator(".work-main-panel .work-row").first()).toBeVisible();
  const before = await page.locator(".work-main-panel .work-row").count();
  const filters = panel(page, "我的工作筛选");
  const requests: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/my-work?")) requests.push(r.url()); });
  await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
  await page.getByLabel("筛选已加载工作").fill("no-loaded-work-matches");
  await expect(page.locator(".work-main-panel .work-row")).toHaveCount(before);
  await filters.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.locator(".work-main-panel .work-row")).toHaveCount(0);
  await expect.poll(() => requests.length).toBe(1);
  expect(Object.fromEntries(new URL(requests[0]!).searchParams)).toEqual({});
  await page.goBack();
  await expect(page.locator(".work-main-panel .work-row")).toHaveCount(before);
  await expect(filters.getByRole("button", { name: "筛选（0）", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => requests.length).toBe(2);
  expect(Object.fromEntries(new URL(requests[1]!).searchParams)).toEqual({});
});

test("member active filter uses one scoped read while keyword remains local and navigation stays outside", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/members?projectId=p1");
  const filters = panel(page, "成员列表筛选");
  await expect(page.getByRole("button", { name: "陈开发", exact: true })).toBeVisible();
  await expect(page.getByLabel("授权项目", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新权限", exact: true })).toBeVisible();
  const requests: URL[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/members?")) requests.push(new URL(r.url())); });
  await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
  await page.getByLabel("搜索已加载成员", { exact: true }).fill("不存在的显示名");
  await selectOption(page, "成员状态", { value: "false", label: "已停用" });
  await expect(page.getByRole("button", { name: "陈开发", exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await filters.getByRole("button", { name: "重置", exact: true }).click();
  await filters.getByRole("button", { name: "收起", exact: true }).click();
  expect(requests).toHaveLength(0);
  await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
  await page.getByLabel("搜索已加载成员", { exact: true }).fill("叶");
  await selectOption(page, "成员状态", { value: "false", label: "已停用" });
  const loaded = page.waitForResponse((r) => r.url().includes("/api/members?projectId=p1&active=false"));
  await filters.getByRole("button", { name: "确定", exact: true }).click();
  await loaded;
  await expect(page.getByRole("button", { name: "叶归档", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "陈开发", exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({ projectId: "p1", active: "false" });
  await expect(filters.getByRole("button", { name: "筛选（2）", exact: true })).toBeVisible();
});

test("project work applies mixed search fields atomically and restores a deep link on back", async ({ page }) => {
  await login(page, "viewer");
  await page.goto("/projects/p1?tab=tasks&filterOwner=dev&untouched=yes");
  const filters = panel(page, "项目工作筛选");
  await expect(page.getByRole("link", { name: "完善工作更新的字段校验", exact: true })).toBeVisible();
  await expect(filters.getByRole("button", { name: "筛选（1）", exact: true })).toHaveAttribute("aria-expanded", "false");
  const requests: URL[] = [];
  page.on("request", (r) => { if (/\/api\/(objects|search)\?/.test(r.url())) requests.push(new URL(r.url())); });
  await filters.getByRole("button", { name: "筛选（1）", exact: true }).click();
  await page.getByLabel("搜索编号或标题", { exact: true }).fill("字段校验");
  await selectOption(page, "阻塞", { value: "false", label: "未阻塞" });
  await selectOption(page, "状态", { value: "active", label: "进行中" });
  expect(requests).toHaveLength(0);
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/search");
  await filters.getByRole("button", { name: "确定", exact: true }).click();
  expect((await response).status()).toBe(200);
  expect(requests).toHaveLength(1);
  expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({ projectId: "p1", kind: "task", state: "active", ownerId: "dev", blocked: "false", q: "字段校验" });
  await expect(filters.getByRole("button", { name: "筛选（4）", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("untouched")).toBe("yes");
  await page.goBack();
  await expect(page).toHaveURL(/filterOwner=dev&untouched=yes$/);
  await expect(filters.getByRole("button", { name: "筛选（1）", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "完善工作更新的字段校验", exact: true })).toBeVisible();
});

test("project pagination ignores pending drafts and applying resets to the first page", async ({ page }) => {
  await login(page, "viewer");
  await page.goto("/projects/pagination-order?tab=tasks");
  await expect(page.locator(".project-work .work-row")).toHaveCount(20);
  const filters = panel(page, "项目工作筛选");
  await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
  await page.getByLabel("搜索编号或标题", { exact: true }).fill("分页事项");
  const more = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/objects" && new URL(r.url()).searchParams.has("cursor"));
  await page.getByRole("button", { name: "加载更多", exact: true }).click();
  const moreResponse = await more;
  expect(new URL(moreResponse.url()).searchParams.has("q")).toBe(false);
  await expect(page.locator(".project-work .work-row")).toHaveCount(24);
  const applied = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/search");
  await filters.getByRole("button", { name: "确定", exact: true }).click();
  const appliedResponse = await applied;
  expect(new URL(appliedResponse.url()).searchParams.has("cursor")).toBe(false);
  await expect(page.locator(".project-work .work-row")).toHaveCount(20);
  await expect(filters.getByRole("button", { name: "筛选（1）", exact: true })).toHaveAttribute("aria-expanded", "false");
});

test("global search opens the shared panel and keeps global selection distinct from an explicit project", async ({ page }) => {
  await login(page);
  await page.goto("/projects/p1?tab=tasks");
  await selectOption(page, "全局项目筛选", { value: "p2", label: "青禾服务台" });
  await expect(page.getByRole("heading", { name: "星河协作计划", exact: true })).toBeVisible();
  const navigationReads: URL[] = [];
  page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/objects") navigationReads.push(new URL(r.url())); });
  await page.getByRole("button", { name: "全局搜索", exact: true }).click();
  const filters = panel(page, "项目工作筛选");
  await expect(page).toHaveURL(/\/projects\?work=1$/);
  await expect(page.getByRole("heading", { name: "青禾服务台", exact: true })).toBeVisible();
  await expect(filters.getByRole("button", { name: "筛选（0）", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".project-work").getByRole("link", { name: "统一服务台表单的键盘操作", exact: true })).toBeVisible();
  expect(navigationReads).toHaveLength(1);
  await expect(page.getByLabel("搜索编号或标题", { exact: true })).toHaveCount(1);
  await page.getByLabel("搜索编号或标题", { exact: true }).fill("服务台分页");
  const applied = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/search");
  await filters.getByRole("button", { name: "确定", exact: true }).click();
  expect(Object.fromEntries(new URL((await applied).url()).searchParams)).toEqual({ projectId: "p2", q: "服务台分页" });
  await filters.getByRole("button", { name: "筛选（1）", exact: true }).click();
  await filters.getByRole("button", { name: "重置", exact: true }).click();
  await filters.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\?work=1$/);
  await expect(filters.getByRole("button", { name: "筛选（0）", exact: true })).toBeVisible();
});

test("global search from the all-project directory drops its route-only scope and tab filters", async ({ page }) => {
  await login(page);
  await page.goto("/projects?view=all&tab=bugs&queue=bugs&filterOwner=dev&filterBlocked=true");
  await selectOption(page, "全局项目筛选", { value: "p2", label: "青禾服务台" });
  await expect(panel(page, "项目目录筛选")).toBeVisible();
  await page.getByRole("button", { name: "全局搜索", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\?work=1$/);
  await expect(page.getByRole("heading", { name: "青禾服务台", exact: true })).toBeVisible();
  const filters = panel(page, "项目工作筛选");
  await expect(filters.getByRole("button", { name: "筛选（0）", exact: true })).toHaveAttribute("aria-expanded", "true");
});

test("applied filters keep controls accessible after a failed read and retry the same query", async ({ page }, testInfo) => {
  await login(page, "viewer");
  await page.goto("/projects/p1?tab=tasks");
  await expect(page.getByRole("link", { name: "完善工作更新的字段校验", exact: true })).toBeVisible();
  const filters = panel(page, "项目工作筛选");
  await page.route("**/api/objects?projectId=p1&kind=task&state=active", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "合成读取失败" }) }));
  await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
  await selectOption(page, "状态", { value: "active", label: "进行中" });
  await filters.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("合成读取失败");
  await expect(filters.getByRole("button", { name: "筛选（1）", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "新建任务", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("desktop-read-error-viewer.png"), fullPage: true });
  await page.unroute("**/api/objects?projectId=p1&kind=task&state=active");
  const loaded = page.waitForResponse((r) => r.url().endsWith("/api/objects?projectId=p1&kind=task&state=active"));
  await page.getByRole("button", { name: "重试加载", exact: true }).click();
  expect((await loaded).status()).toBe(200);
  await expect(page.getByRole("link", { name: "完善工作更新的字段校验", exact: true })).toBeVisible();
});

test("scope navigation discards a draft and late work responses cannot replace the new project", async ({ page }) => {
  await login(page);
  const filters = panel(page, "我的工作筛选");
  await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
  await page.getByLabel("筛选已加载工作").fill("private unfinished draft");
  let release!: () => void;
  let received!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const held = new Promise<void>((resolve) => { received = resolve; });
  await page.route("**/api/my-work?projectId=p1", async (route) => {
    const response = await route.fetch();
    received();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await selectOption(page, "全局项目筛选", { value: "p1", label: "星河协作计划" });
    await held;
    await expect(filters.getByRole("button", { name: "筛选（0）", exact: true })).toHaveAttribute("aria-expanded", "false");
    await selectOption(page, "全局项目筛选", { value: "p2", label: "青禾服务台" });
    await expect(page.getByRole("link", { name: "统一服务台表单的键盘操作", exact: true })).toBeVisible();
    const completed = page.waitForResponse((r) => r.url().endsWith("/api/my-work?projectId=p1"));
    release();
    await completed;
    await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
    await expect(page.getByLabel("筛选已加载工作")).toHaveValue("");
    await expect(page.getByRole("link", { name: "完善工作更新的字段校验", exact: true })).toHaveCount(0);
  } finally { release(); }
});

test("progress chooser stages its own server keyword without changing main filters", async ({ page }) => {
  await login(page);
  const opened = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/my-progress");
  await page.getByRole("button", { name: "填写今日进展", exact: true }).click();
  await opened;
  const filters = panel(page, "工作更新事项筛选");
  const requests: URL[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/my-progress?")) requests.push(new URL(r.url())); });
  await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
  await page.getByLabel("搜索可补记事项").fill("字段校验");
  expect(requests).toHaveLength(0);
  const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/my-progress");
  await filters.getByRole("button", { name: "确定", exact: true }).click();
  expect((await loaded).status()).toBe(200);
  expect(requests).toHaveLength(1);
  expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({ q: "字段校验" });
  await expect(page.getByRole("dialog").getByRole("link", { name: "完善工作更新的字段校验", exact: true })).toBeVisible();
  await expect(page.getByLabel("搜索可补记事项")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("filterKeyword")).toBeNull();
});

test("queue navigation stays outside filters and discards unconfirmed changes", async ({ page }) => {
  await login(page, "tester");
  await page.goto("/projects/p1?tab=tests");
  const filters = panel(page, "项目工作筛选");
  await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
  await page.getByLabel("搜索编号或标题", { exact: true }).fill("unconfirmed");
  await page.getByRole("button", { name: /^待验证 Bug/ }).click();
  await expect(filters.getByRole("button", { name: "筛选（0）", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { name: "待验证 Bug", exact: true })).toBeVisible();
  await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
  await expect(page.getByLabel("搜索编号或标题", { exact: true })).toHaveValue("");
});

for (const account of ["admin", "product", "dev", "tester", "viewer"]) {
  test(`${account} sees collapsed filters on mobile without hiding responsibility tabs`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, account);
    const filters = panel(page, "我的工作筛选");
    await expect(filters.getByRole("button", { name: "筛选（0）", exact: true })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("tab", { name: /^我负责/ })).toBeVisible();
    await expect(page.getByLabel("工作项目", { exact: true })).toBeVisible();
    await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
    await expect(page.getByLabel("筛选已加载工作", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (account === "dev") await page.screenshot({ path: testInfo.outputPath("mobile-filters.png"), fullPage: true });
  });
}

for (const target of [
  { path: "/my-work", label: "我的工作筛选", api: "/api/my-work" },
  { path: "/members?projectId=p1", label: "成员列表筛选", api: "/api/members" },
]) {
  test(`confirming unchanged filters on ${target.path} performs one fresh first-page read`, async ({ page }) => {
    await login(page, target.api === "/api/members" ? "admin" : "dev");
    await page.goto(target.path);
    if (target.api === "/api/members") await expect(page.getByRole("button", { name: "陈开发", exact: true })).toBeVisible();
    else await expect(page.locator(".work-main-panel .work-row").first()).toBeVisible();
    const filters = panel(page, target.label);
    const requests: URL[] = [];
    page.on("request", (r) => { if (new URL(r.url()).pathname === target.api) requests.push(new URL(r.url())); });
    await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
    await filters.getByRole("button", { name: "确定", exact: true }).click();
    await expect.poll(() => requests.length, { timeout: 1500 }).toBe(1);
    expect(requests[0]!.searchParams.has("cursor")).toBe(false);
    await expect(filters.getByRole("button", { name: "筛选（0）", exact: true })).toHaveAttribute("aria-expanded", "false");
  });
}

for (const target of [
  { path: "/my-work", label: "我的工作筛选", api: "/api/my-work", keyword: "字段校验", input: "筛选已加载工作", more: "加载更多", account: "dev" },
  { path: "/members?projectId=p1", label: "成员列表筛选", api: "/api/members", keyword: "演示管理员", input: "搜索已加载成员", more: "更多成员", account: "admin" },
]) {
  test(`local keyword confirmation on ${target.path} resets loaded pages without sending a server keyword`, async ({ page }) => {
    await login(page, target.account);
    const scoped = (url: URL) => url.pathname === target.api && (target.api !== "/api/members" || url.searchParams.get("projectId") === "p1");
    // Keep real API payloads and cursors, with small pages so both directories
    // exercise their second page without adding permanent fixture records.
    await page.route(`**${target.api}**`, async (route) => {
      const url = new URL(route.request().url());
      if (!scoped(url)) return route.continue();
      url.searchParams.set("limit", "2");
      const response = await route.fetch({ url: url.toString() });
      await route.fulfill({ response });
    });
    const initial = page.waitForResponse((r) => scoped(new URL(r.url())));
    await page.goto(target.path);
    const initialBody = await (await initial).json();
    expect(initialBody.items).toHaveLength(2);
    expect(initialBody.nextCursor).toBeTruthy();
    const rows = target.api === "/api/members" ? page.locator(".member-panel .ant-table-row") : page.locator(".work-main-panel .work-row");
    await expect(rows).toHaveCount(2);
    await page.getByRole("button", { name: target.more, exact: true }).click();
    await expect(rows).toHaveCount(4);
    const requests: URL[] = [];
    page.on("request", (r) => { const url = new URL(r.url()); if (scoped(url)) requests.push(url); });
    const filters = panel(page, target.label);
    await filters.getByRole("button", { name: "筛选（0）", exact: true }).click();
    await page.getByLabel(target.input, { exact: true }).fill(target.keyword);
    await expect(rows).toHaveCount(4);
    expect(requests).toHaveLength(0);
    await filters.getByRole("button", { name: "确定", exact: true }).click();
    await expect.poll(() => requests.length, { timeout: 1500 }).toBe(1);
    expect(Object.fromEntries(requests[0]!.searchParams)).toEqual(target.api === "/api/members" ? { projectId: "p1" } : {});
    await expect(rows).toHaveCount(1);
    if (target.api === "/api/members") await expect(page.locator(".member-footer")).toContainText("已加载 2 位成员");
    else await expect(page.getByRole("tab", { name: /^全部相关/ })).toHaveText("全部相关2");
    await page.goBack();
    await expect.poll(() => requests.length).toBe(2);
    expect(Object.fromEntries(requests[1]!.searchParams)).toEqual(target.api === "/api/members" ? { projectId: "p1" } : {});
    await expect(rows).toHaveCount(2);
    await page.getByRole("button", { name: target.more, exact: true }).click();
    await expect.poll(() => requests.length).toBe(3);
    expect(requests[2]!.searchParams.get("cursor")).toBe(initialBody.nextCursor);
    expect(requests[2]!.searchParams.has("q")).toBe(false);
    expect(requests[2]!.searchParams.has("filterKeyword")).toBe(false);
    await expect(rows).toHaveCount(4);
  });
}

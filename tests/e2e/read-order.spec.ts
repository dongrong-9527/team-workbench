import { test, expect } from "./fixtures.js";
import { login, action, submit } from "./helpers.js";

test("task_10 reversed project responses never replace the selected scope", async ({
  page,
}) => {
  await login(page);
  let release!: () => void;
  let received!: () => void;
  const held = new Promise<void>((r) => (received = r));
  await page.route("**/api/my-work?projectId=p1", async (route) => {
    const response = await route.fetch();
    await new Promise<void>((r) => {
      release = r;
      received();
    });
    await route.fulfill({ response });
  });
  await page.getByLabel("全局项目筛选").selectOption("p1");
  await held;
  await page.getByLabel("全局项目筛选").selectOption("p2");
  await expect(
    page.getByRole("link", { name: "统一服务台表单的键盘操作", exact: true }),
  ).toBeVisible();
  const complete = page.waitForResponse((r) =>
    r.url().endsWith("/api/my-work?projectId=p1"),
  );
  release();
  await complete;
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await expect(
    page.getByRole("link", { name: "完善工作更新的字段校验", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("全局项目筛选")).toHaveValue("p2");
  await expect(
    page.getByRole("link", { name: "统一服务台表单的键盘操作", exact: true }),
  ).toBeVisible();
});
test("task_10 project pagination stays bound to the newer query after reversed responses", async ({
  page,
}) => {
  await login(page, "viewer");
  await page.goto("/projects");
  let release!: () => void;
  let received!: () => void;
  const held = new Promise<void>((r) => (received = r));
  await page.route("**/api/objects?projectId=p1", async (route) => {
    const response = await route.fetch();
    await new Promise<void>((r) => {
      release = r;
      received();
    });
    await route.fulfill({ response });
  });
  await page.getByLabel("全局项目筛选").selectOption("p1");
  await held;
  await page.getByLabel("全局项目筛选").selectOption("p2");
  await expect(
    page.getByRole("link", { name: "统一服务台表单的键盘操作", exact: true }),
  ).toBeVisible();
  const completed = page.waitForResponse((r) =>
    r.url().endsWith("/api/objects?projectId=p1"),
  );
  release();
  await completed;
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await expect(
    page.getByRole("link", { name: "完善工作更新的字段校验", exact: true }),
  ).toHaveCount(0);
  const next = page.waitForResponse((r) =>
    r.url().includes("/api/objects?projectId=p2&cursor="),
  );
  await page.getByRole("button", { name: "加载更多", exact: true }).click();
  expect((await next).status()).toBe(200);
  await expect(
    page.getByRole("link", { name: "服务台分页事项 23", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".work-row")).toHaveCount(24);
});
test("task_10 member project roles ignore an older pending project response", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/projects");
  await action(page, "新建项目");
  await page.getByLabel("项目名称", { exact: true }).fill("目录竞态的合成项目");
  await submit(page, "确认新建项目");
  const projectLink = page.getByRole("link", {
    name: "目录竞态的合成项目 ↗",
    exact: true,
  });
  const id = (await projectLink.getAttribute("href"))!.split("/").at(-1)!;
  await page.goto("/members");
  await page.getByLabel("授权项目").selectOption(id);
  await expect(
    page.getByRole("row").filter({
      has: page.getByRole("button", { name: "陈开发", exact: true }),
    }),
  ).toContainText("全项目可读");
  let release!: () => void;
  let received!: () => void;
  const held = new Promise<void>((r) => (received = r));
  await page.route("**/api/members?projectId=p1", async (route) => {
    const response = await route.fetch();
    await new Promise<void>((r) => {
      release = r;
      received();
    });
    await route.fulfill({ response });
  });
  await page.getByLabel("授权项目").selectOption("p1");
  await held;
  await page.getByLabel("授权项目").selectOption(id);
  await expect(
    page.getByRole("row").filter({
      has: page.getByRole("button", { name: "陈开发", exact: true }),
    }),
  ).toContainText("全项目可读");
  const completed = page.waitForResponse((r) =>
    r.url().endsWith("/api/members?projectId=p1"),
  );
  release();
  await completed;
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await expect(
    page.getByRole("row").filter({
      has: page.getByRole("button", { name: "陈开发", exact: true }),
    }),
  ).not.toContainText("后端负责人");
  await expect(page.getByLabel("授权项目")).toHaveValue(id);
});
test("task_10 immutable report sources ignore an older version response", async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto("/reports");
  let generated = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/reports" &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  const first = await (await generated).json();
  await expect(page.getByRole("status")).toContainText("日报草稿已生成");
  const other = await context.newPage();
  await other.goto("/my-work");
  await other
    .getByRole("link", { name: "完善工作更新的字段校验", exact: true })
    .click();
  await action(other, "写工作更新");
  await other
    .getByLabel("今天实际做了什么", { exact: true })
    .fill("只在较新来源版本出现的贡献");
  await submit(other, "保存更新");
  await other.close();
  generated = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/reports" &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  const second = await (await generated).json();
  await expect(page.getByRole("status")).toContainText("已生成新版本");
  await page.getByRole("button", { name: /查看来源/ }).click();
  await expect(
    page.getByText("只在较新来源版本出现的贡献", { exact: true }),
  ).toBeVisible();
  let release!: () => void;
  let received!: () => void;
  const held = new Promise<void>((r) => (received = r));
  await page.route(`**/api/reports/${first.id}/sources?*`, async (route) => {
    const response = await route.fetch();
    await new Promise<void>((r) => {
      release = r;
      received();
    });
    await route.fulfill({ response });
  });
  await page.locator(`[data-report-id="${first.id}"]`).click();
  await held;
  await page.locator(`[data-report-id="${second.id}"]`).click();
  await expect(
    page.getByText("只在较新来源版本出现的贡献", { exact: true }),
  ).toBeVisible();
  const completed = page.waitForResponse((r) =>
    r.url().includes(`/api/reports/${first.id}/sources?`),
  );
  release();
  await completed;
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await expect(
    page.getByText("只在较新来源版本出现的贡献", { exact: true }),
  ).toBeVisible();
});
test("task_10 a detail response released after unmount cannot start stale dependent reads", async ({
  page,
}) => {
  await login(page);
  const first = (await page
    .getByRole("link", { name: "完善工作更新的字段校验", exact: true })
    .getAttribute("href"))!
    .split("/")
    .at(-1)!;
  let release!: () => void;
  let received!: () => void;
  const held = new Promise<void>((r) => (received = r));
  const staleReads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(`/api/tests?kind=task&id=${first}`))
      staleReads.push(request.url());
  });
  await page.route(`**/api/tasks/${first}`, async (route) => {
    const response = await route.fetch();
    await new Promise<void>((r) => {
      release = r;
      received();
    });
    await route.fulfill({ response });
  });
  await page
    .getByRole("link", { name: "完善工作更新的字段校验", exact: true })
    .click();
  await held;
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: /我的工作/ })
    .click();
  await page
    .getByRole("link", { name: "统一服务台表单的键盘操作", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "统一服务台表单的键盘操作",
      exact: true,
    }),
  ).toBeVisible();
  const completed = page.waitForResponse((r) =>
    r.url().endsWith(`/api/tasks/${first}`),
  );
  release();
  await completed;
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await expect(
    page.getByRole("heading", { name: "完善工作更新的字段校验", exact: true }),
  ).toHaveCount(0);
  expect(staleReads).toEqual([]);
});

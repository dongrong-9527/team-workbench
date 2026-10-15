import { test, expect } from "./fixtures.js";
import { login } from "./helpers.js";
import type { Page } from "@playwright/test";

async function presentationApi(
  page: Page,
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  const result = await page.evaluate(
    async ({ method, path, body }) => {
      const session = await (await fetch("/api/auth/session")).json();
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": session.csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    },
    { method, path, body },
  );
  expect(result.status, `${method} ${path}`).toBe(200);
  return result.body;
}

async function executableRequirement(page: Page, title: string) {
  await login(page, "product");
  let requirement = await presentationApi(page, "POST", "/api/requirements", {
    projectId: "p1",
    title,
    description: "合成整页证据与产品验收表单回归",
    source: { description: "产品人工核对的合成来源" },
    acceptorId: "product",
    priority: "medium",
    criteria: [
      { id: "first", text: "第一个行为正确", required: true },
      { id: "second", text: "第二个行为正确", required: true },
    ],
  });
  const path = `/api/requirements/${requirement.id}/actions`;
  requirement = await presentationApi(page, "POST", path, {
    action: "refine",
    expectedVersion: requirement.version,
    description: "明确两个必需行为的检查范围",
  });
  requirement = await presentationApi(page, "POST", path, {
    action: "makeReady",
    expectedVersion: requirement.version,
    source: {
      description: "产品人工核对的合成来源",
      status: "checked",
      checkedAt: new Date().toISOString(),
    },
  });
  return presentationApi(page, "POST", path, {
    action: "start",
    expectedVersion: requirement.version,
    reason: "进入真实执行与检查流程",
  });
}

test("independent tests use an inline page with live results and preserve a mobile draft", async ({
  page,
}) => {
  const requirement = await executableRequirement(page, "合成整页测试记录");
  await login(page, "tester");
  await page.goto(`/requirement/${requirement.id}`);
  await page.getByRole("button", { name: "新增测试记录", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "新增测试记录",
    exact: true,
  });
  await expect(page.locator("#main > .page-action-form")).toHaveCount(1);
  await expect(dialog).toHaveAttribute("aria-modal", "false");
  const summary = dialog.getByRole("complementary", { name: "测试结论摘要" });
  await expect(
    summary.getByText("未测", { exact: true }).locator(".."),
  ).toContainText("2 项");
  await dialog
    .getByLabel("目标版本", { exact: true })
    .fill("synthetic-page-build");
  await dialog.getByLabel("检查环境", { exact: true }).fill("合成浏览器环境");
  const first = dialog
    .getByRole("combobox", { name: "条目结果", exact: true })
    .first();
  await first.focus();
  await first.press("ArrowDown");
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("通过", { exact: true })
    .click();
  await expect(
    summary.getByText("通过", { exact: true }).locator(".."),
  ).toContainText("1 项");
  await expect(
    summary.getByText("未测", { exact: true }).locator(".."),
  ).toContainText("1 项");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "新增测试记录", exact: true }).click();
  await expect(dialog.getByLabel("目标版本", { exact: true })).toHaveValue(
    "synthetic-page-build",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/tests" &&
      response.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "确认新增测试记录", exact: true })
    .click();
  const response = await saved;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    testerId: "tester",
    target: { kind: "requirement", id: requirement.id },
    checks: expect.arrayContaining([{ checkId: "first", result: "pass" }]),
  });
  await expect(dialog).toHaveCount(0);
});

test("product acceptance uses an inline page and submits a real independent decision", async ({
  page,
}) => {
  let requirement = await executableRequirement(page, "合成整页产品验收");
  await login(page, "tester");
  await presentationApi(page, "POST", "/api/tests", {
    target: { kind: "requirement", id: requirement.id },
    expectedVersion: requirement.version,
    revision: requirement.revision,
    targetVersion: "synthetic-acceptance-build",
    environment: "合成验收环境",
    checks: [
      { checkId: "first", result: "pass" },
      { checkId: "second", result: "pass" },
    ],
  });
  await login(page, "product");
  requirement = await presentationApi(
    page,
    "GET",
    `/api/requirements/${requirement.id}`,
  );
  requirement = await presentationApi(
    page,
    "POST",
    `/api/requirements/${requirement.id}/submit-acceptance`,
    {
      expectedVersion: requirement.version,
      revision: requirement.revision,
      targetVersion: "synthetic-acceptance-build",
    },
  );
  await page.goto(`/requirement/${requirement.id}`);
  await page.getByRole("button", { name: "产品验收", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "产品验收", exact: true });
  await expect(page.locator("#main > .page-action-form")).toHaveCount(1);
  const summary = dialog.getByRole("complementary", { name: "验收核对摘要" });
  await expect(summary).toContainText("提交时由服务器校验");
  await expect(
    summary.getByText("待核对", { exact: true }).locator(".."),
  ).toContainText("2 项");
  for (const control of await dialog
    .getByRole("combobox", { name: "条目结果", exact: true })
    .all()) {
    await control.scrollIntoViewIfNeeded();
    await control.focus();
    await control.press("ArrowDown");
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText("通过", { exact: true })
      .click();
    await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
  }
  await expect(
    summary.getByText("已核对", { exact: true }).locator(".."),
  ).toContainText("2 项");
  await dialog
    .getByLabel("操作原因", { exact: true })
    .fill("指定产品验收人独立核对两个实际行为");
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/requirements/${requirement.id}/acceptance` &&
      response.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "确认产品验收", exact: true })
    .click();
  const response = await saved;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ state: "accepted" });
  await expect(dialog).toHaveCount(0);
});

test("pending creation keeps the session intact until the command settles", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await page
    .getByLabel("标题", { exact: true })
    .fill("整页创建等待响应的退出保护");
  await page
    .getByLabel("完成标准", { exact: true })
    .fill("等待响应期间不能撤销自己的会话");
  let release!: () => void;
  let received!: () => void;
  const held = new Promise<void>((resolve) => {
    received = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const logouts: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/auth/logout") logouts.push(r.url());
  });
  await page.route("**/api/tasks", async (route) => {
    received();
    await gate;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  try {
    await page
      .getByRole("button", { name: "确认新建任务", exact: true })
      .click();
    await held;
    const logout = page.getByRole("button", { name: "退出登录", exact: true });
    await expect(logout).toBeDisabled();
    await logout.evaluate((button: HTMLButtonElement) => button.click());
    expect(logouts).toHaveLength(0);
    await expect(page.getByRole("dialog")).toBeVisible();
  } finally {
    release();
  }
  await expect(page).toHaveURL(/\/task\//);
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeEnabled();
});

test("creation uses an inline main dialog and preserves drafts on Escape", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  const trigger = page.getByRole("button", { name: "新建任务", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "新建任务", exact: true });
  await expect(page.locator("#main > .page-action-form")).toHaveCount(1);
  await expect(dialog).toHaveAttribute("aria-modal", "false");
  await expect(
    dialog.getByRole("heading", { name: "填写顺序", exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("标题", { exact: true }).fill("合成页面创建草稿");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog.getByLabel("标题", { exact: true })).toHaveValue(
    "合成页面创建草稿",
  );
  await dialog
    .getByRole("button", { name: "返回并保留草稿", exact: true })
    .click();
  await expect(trigger).toBeVisible();
});

test("progress opens a right drawer and keeps popup Escape local", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("link", { name: "完善工作更新的字段校验", exact: true })
    .click();
  await expect(page).toHaveURL(/\/task\//);
  const trigger = page.getByRole("button", { name: "写工作更新", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(
    page.locator(".ant-drawer-right .mutation-content"),
  ).toBeVisible();
  const close = dialog.locator(".ant-drawer-close");
  const save = dialog.getByRole("button", { name: "保存更新", exact: true });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(save).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await dialog
    .getByLabel("今天实际做了什么", { exact: true })
    .fill("合成抽屉进展草稿");
  const date = dialog.getByLabel("工作日期", { exact: true });
  await date.click();
  await date.press("Escape");
  await expect(dialog).toBeVisible();
  await date.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

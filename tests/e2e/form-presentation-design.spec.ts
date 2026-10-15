import { test, expect } from "./fixtures.js";
import { login } from "./helpers.js";

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

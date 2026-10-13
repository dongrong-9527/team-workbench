import { test, expect } from "./fixtures.js";
import { login, selectOption, expectSelectedOption } from "./helpers.js";

test("Ant workbench controls preserve keyboard filters, clearing and report navigation", async ({
  page,
}) => {
  await login(page);
  await expect(
    page.getByRole("button", { name: "刷新", exact: true }),
  ).toHaveClass(/ant-btn/);
  const kind = page.getByRole("combobox", { name: "工作类型", exact: true });
  await expect(kind).toHaveAttribute("id", "work-kind");
  await kind.focus();
  await kind.press("ArrowDown");
  const filtered = page.waitForResponse((r) =>
    r.url().includes("/api/my-work?kind=task"),
  );
  await kind.press("Enter");
  await filtered;
  await expect(page.locator(".filters .ant-select").first()).toContainText(
    "任务",
  );
  const keyboardReset = page.waitForResponse((r) =>
    r.url().endsWith("/api/my-work?"),
  );
  await kind.press("ArrowUp");
  await kind.press("Enter");
  await keyboardReset;
  await expect(page.locator(".filters .ant-select").first()).toContainText(
    "全部类型",
  );
  await selectOption(page, "工作类型", { value: "task", label: "任务" });
  const cleared = page.waitForResponse((r) =>
    r.url().endsWith("/api/my-work?"),
  );
  await page.locator(".filters .ant-select").first().hover();
  await page
    .locator(".filters .ant-select")
    .first()
    .locator(".ant-select-clear")
    .click();
  await cleared;
  await expect(page.locator(".filters .ant-select").first()).toContainText(
    "全部类型",
  );
  await page.getByRole("link", { name: /生成今日日报/ }).click();
  await expect(page).toHaveURL(/\/reports$/);
});

test("Ant project select and global search retain server scope and query semantics", async ({
  page,
}) => {
  await login(page);
  const project = page.getByRole("combobox", { name: "全局项目筛选" });
  await expect(project).toHaveAttribute("id", "global-project");
  await project.focus();
  await project.press("ArrowDown");
  await project.press("Escape");
  await expect(project).toBeFocused();
  await page.getByLabel("搜索编号或标题").fill("字段校验");
  await expect(page.getByLabel("搜索编号或标题")).toHaveClass(/ant-input/);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\?q=/);
  expect(new URL(page.url()).searchParams.get("q")).toBe("字段校验");
});

test("mobile drawer traps focus, closes on Escape and restores its trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const trigger = page.getByRole("button", { name: "展开导航" });
  await trigger.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.locator("xpath=ancestor::div[contains(@class, 'ant-drawer-content')][1]")).toHaveCSS("background-color", "rgb(14, 28, 47)");
  await drawer.getByRole("link", { name: "成员管理", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(drawer.getByRole("link", { name: "账号设置" })).toBeFocused();
  await drawer.getByRole("button", { name: "退出登录" }).focus();
  await page.keyboard.press("Tab");
  await expect(drawer.getByRole("button", { name: "收起导航" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("button", { name: "退出登录" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await drawer.getByRole("link", { name: "日报", exact: true }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(drawer).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("all scope filters send existing string values and clear back to an unfiltered request", async ({
  page,
}) => {
  await login(page);
  for (const filter of [
    {
      name: "全局项目筛选",
      value: "p1",
      label: "星河协作计划",
      key: "projectId",
    },
    { name: "负责人", value: "dev", label: "陈开发", key: "ownerId" },
    { name: "状态", value: "active", label: "进行中", key: "state" },
    { name: "阻塞", value: "false", label: "未阻塞", key: "blocked" },
  ]) {
    const response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/my-work" &&
        new URL(r.url()).searchParams.get(filter.key) === filter.value,
    );
    await selectOption(page, filter.name, filter);
    expect((await response).status()).toBe(200);
    await expectSelectedOption(page, filter.name, filter);
    const input = page.getByRole("combobox", {
      name: filter.name,
      exact: true,
    });
    const container = input.locator(
      'xpath=ancestor::div[contains(@class,"ant-select") and not(contains(@class,"ant-select-selector"))][1]',
    );
    const reset = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/my-work" &&
        new URL(r.url()).search === "",
    );
    await container.hover();
    await container.locator(".ant-select-clear").click();
    expect((await reset).status()).toBe(200);
  }
  await expect(
    page.getByRole("link", { name: "完善工作更新的字段校验", exact: true }),
  ).toBeVisible();
});

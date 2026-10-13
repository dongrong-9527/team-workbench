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
  await expect(
    drawer.locator(
      "xpath=ancestor::div[contains(@class, 'ant-drawer-content')][1]",
    ),
  ).toHaveCSS("background-color", "rgb(14, 28, 47)");
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

test("Ant mutation form validates, keeps popup Escape local and restores drafts", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  const trigger = page.getByRole("button", { name: "新建任务", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("form")).toHaveClass(/ant-form/);
  await dialog.getByRole("button", { name: "确认新建任务" }).click();
  await expect(dialog.getByText("请填写标题", { exact: true })).toBeVisible();
  await page.getByLabel("标题", { exact: true }).fill("键盘草稿");
  const owner = page.getByRole("combobox", { name: "主负责人", exact: true });
  await owner.focus();
  await owner.press("ArrowDown");
  await expect(page.locator(".ant-select-dropdown:visible")).toBeVisible();
  await owner.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(owner).toBeFocused();
  await owner.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue(
    "键盘草稿",
  );
  await dialog.getByRole("button", { name: "返回并保留草稿" }).click();
  await expect(dialog).toHaveCount(0);
});

test("Ant mutation clear and pending submission retain command and navigation semantics", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects");
  await page
    .getByRole("link", { name: "星河协作计划 ↗", exact: true })
    .click();
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("待提交导航检查");
  await page.getByLabel("完成标准", { exact: true }).fill("保存一次");
  await selectOption(page, "主负责人", { value: "dev", label: "陈开发" });
  const owner = page
    .getByRole("combobox", { name: "主负责人", exact: true })
    .locator(
      'xpath=ancestor::div[contains(@class,"ant-select") and not(contains(@class,"ant-select-selector"))][1]',
    );
  await owner.hover();
  await owner.locator(".ant-select-clear").click();
  await selectOption(page, "检查人", { value: "tester", label: "周测试" });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bodies: any[] = [];
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postDataJSON());
    await gate;
    await route.continue();
  });
  await page
    .getByRole("button", { name: "确认新建任务", exact: true })
    .dblclick();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).not.toHaveProperty("ownerId");
  expect(bodies[0].reviewerId).toBe("tester");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "返回并保留草稿" }),
  ).toBeDisabled();
  await page.goBack();
  await expect(page).toHaveURL(/\/projects\/p1$/);
  release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/task\//);
  expect(bodies).toHaveLength(1);
});

test("Ant auth and definition rules block short passwords and missing custom fields", async ({
  page,
}) => {
  await page.goto("/activate");
  await page.getByLabel("管理员票据", { exact: true }).fill("a".repeat(43));
  await page.getByLabel("新密码", { exact: true }).fill("short");
  await page.getByLabel("确认密码", { exact: true }).fill("short");
  await page.getByRole("button", { name: "激活账号", exact: true }).click();
  await expect(page.getByText("至少 12 个字符", { exact: true })).toHaveCount(
    2,
  );
  await login(page, "product");
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "新建需求", exact: true }).click();
  await page.getByRole("button", { name: "确认新建需求" }).click();
  await expect(page.getByText("请填写条目说明", { exact: true })).toBeVisible();
  await page.getByLabel("必需条目", { exact: true }).uncheck();
  await page.getByRole("button", { name: "确认新建需求" }).click();
  await expect(page.getByText("请填写排除原因", { exact: true })).toBeVisible();
  await expect(page.getByLabel("条目编号", { exact: true })).toHaveAttribute(
    "maxlength",
    "128",
  );
  await page.getByLabel("条目说明", { exact: true }).fill("验".repeat(2001));
  await expect(page.getByLabel("条目说明", { exact: true })).toHaveValue(
    "验".repeat(2000),
  );
});

test("Ant work date clear blocks submission and keeps YYYY-MM-DD payloads", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("link", { name: "完善工作更新的字段校验", exact: true })
    .click();
  await page.getByRole("button", { name: "写工作更新", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const date = page.getByLabel("工作日期", { exact: true });
  const original = await date.inputValue();
  expect(original).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await date.click();
  await expect(
    page
      .locator(".ant-picker-dropdown:visible")
      .getByText("一", { exact: true }),
  ).toBeVisible();
  await date.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.locator(".ant-picker").hover();
  await dialog.locator(".ant-picker-clear").click();
  await page
    .getByLabel("今天实际做了什么", { exact: true })
    .fill("日期选择保持业务日期");
  await page.getByRole("button", { name: "保存更新", exact: true }).click();
  await expect(page.getByText("请填写工作日期", { exact: true })).toBeVisible();
  await date.click();
  await page
    .locator(
      `.ant-picker-dropdown:visible td[title="${original}"] .ant-picker-cell-inner`,
    )
    .click();
  await expect(date).toHaveValue(original);
  await expect(page.locator(".ant-picker-dropdown:visible")).toHaveCount(0);
  await expect(
    page.getByText("请填写工作日期", { exact: true }),
  ).not.toBeVisible();
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/api/updates") && r.method() === "POST",
  );
  if (process.env.WORKBENCH_UI_SCREENSHOTS) {
    await page.screenshot({
      path: process.env.WORKBENCH_UI_SCREENSHOTS + "/mutation-desktop.png",
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: process.env.WORKBENCH_UI_SCREENSHOTS + "/mutation-mobile.png",
      fullPage: false,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  if (process.env.WORKBENCH_UI_SCREENSHOTS) {
    await page
      .getByRole("button", { name: "保存更新", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path:
        process.env.WORKBENCH_UI_SCREENSHOTS + "/mutation-mobile-actions.png",
    });
  }
  await page.getByRole("button", { name: "保存更新", exact: true }).click();
  expect((await sent).postDataJSON().workDate).toBe(original);
  await expect(dialog).toHaveCount(0);
});

test("nested supplementary-character bounds block requests and restored drafts use UTF-16 limits", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "新建需求", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("嵌套字符边界");
  await page.getByLabel("来源说明", { exact: true }).fill("合成评审");
  await page
    .getByLabel("需求细化说明", { exact: true })
    .fill("验证 UTF-16 长度边界");
  await selectOption(page, "产品验收人", { value: "product", label: "林产品" });
  const requests: any[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/requirements", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postDataJSON());
    await gate;
    await route.continue();
  });
  await page.getByLabel("条目说明", { exact: true }).fill("😀".repeat(1001));
  await page.getByRole("button", { name: "确认新建需求", exact: true }).click();
  await expect(
    page.getByText("条目说明最多 2000 个字符", { exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByLabel("条目说明", { exact: true }).fill("😀".repeat(1000));
  await page
    .getByRole("button", { name: "返回并保留草稿", exact: true })
    .click();
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("workbench:draft:product:"),
    )!;
    const draft = JSON.parse(localStorage.getItem(key)!);
    draft.values.criteria[0].id = "😀".repeat(65);
    draft.values.criteria[0].required = false;
    draft.values.criteria[0].exclusionReason = "😀".repeat(1001);
    localStorage.setItem(key, JSON.stringify(draft));
  });
  await page.getByRole("button", { name: "新建需求", exact: true }).click();
  await page.getByRole("button", { name: "确认新建需求", exact: true }).click();
  await expect(
    page.getByText("条目编号最多 128 个字符", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("排除原因最多 2000 个字符", { exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByLabel("条目编号", { exact: true }).fill("😀".repeat(64));
  await page.getByLabel("排除原因", { exact: true }).fill("😀".repeat(1000));
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/requirements") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "确认新建需求", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "添加条目", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("条目说明", { exact: true })).toHaveCount(1);
  expect(requests[0].criteria[0].id.length).toBe(128);
  expect(requests[0].criteria[0].text.length).toBe(2000);
  expect(requests[0].criteria[0].exclusionReason.length).toBe(2000);
  release();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

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
  ).toHaveCSS("background-color", "rgb(255, 255, 255)");
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
  await page.getByRole("button", { name: "添加条目", exact: true }).click();
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
  await page.getByRole("button", { name: "添加条目", exact: true }).click();
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

test("report calendar keeps local date through clear and reselection in non-UTC browser", async ({
  browser,
  observeContext,
}) => {
  const context = await browser.newContext({
    timezoneId: "America/Los_Angeles",
    ignoreHTTPSErrors: true,
  });
  await observeContext(context);
  const page = await context.newPage();
  await login(page);
  await page.goto("/reports");
  const date = page.getByLabel("报告日期", { exact: true });
  const original = await date.inputValue();
  await expect(
    date.locator('xpath=ancestor::div[contains(@class,"ant-picker")][1]'),
  ).toHaveCount(1);
  const picker = page.locator(".ant-picker");
  await picker.hover();
  await picker.locator(".ant-picker-clear").click();
  await expect(
    page.getByRole("button", { name: "生成新日报", exact: true }),
  ).toBeDisabled();
  await date.click();
  await page
    .locator(
      `.ant-picker-dropdown:visible td[title="${original}"] .ant-picker-cell-inner`,
    )
    .click();
  await expect(date).toHaveValue(original);
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/api/reports") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  expect((await sent).postDataJSON().date).toBe(original);
  await expect(page.getByLabel("日报文本", { exact: true })).toBeVisible();
  if (process.env.WORKBENCH_UI_SCREENSHOTS) {
    await page.screenshot({
      path: process.env.WORKBENCH_UI_SCREENSHOTS + "/reports-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: process.env.WORKBENCH_UI_SCREENSHOTS + "/reports-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await context.close();
});

test("project and member filters clear without changing payload types", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/projects/p1");
  for (const filter of [
    { name: "工作类型", value: "task", label: "任务", key: "kind" },
    { name: "负责人", value: "dev", label: "陈开发", key: "ownerId" },
    { name: "状态", value: "active", label: "进行中", key: "state" },
    { name: "阻塞", value: "false", label: "未阻塞", key: "blocked" },
  ]) {
    const selected = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/objects" &&
        new URL(r.url()).searchParams.get(filter.key) === filter.value,
    );
    await selectOption(page, filter.name, filter);
    expect((await selected).status()).toBe(200);
    const container = page
      .getByRole("combobox", { name: filter.name, exact: true })
      .locator(
        'xpath=ancestor::div[contains(@class,"ant-select") and not(contains(@class,"ant-select-selector"))][1]',
      );
    const cleared = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/objects" &&
        !new URL(r.url()).searchParams.has(filter.key),
    );
    await container.hover();
    await container.locator(".ant-select-clear").click();
    expect((await cleared).status()).toBe(200);
  }
  if (process.env.WORKBENCH_UI_SCREENSHOTS) {
    await page.screenshot({
      path: process.env.WORKBENCH_UI_SCREENSHOTS + "/projects-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: process.env.WORKBENCH_UI_SCREENSHOTS + "/projects-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.goto("/members");
  await selectOption(page, "成员状态", { value: "false", label: "已停用" });
  await expect(
    page.getByRole("row").filter({ hasText: "叶归档" }),
  ).toBeVisible();
  const container = page
    .getByRole("combobox", { name: "成员状态", exact: true })
    .locator(
      'xpath=ancestor::div[contains(@class,"ant-select") and not(contains(@class,"ant-select-selector"))][1]',
    );
  const cleared = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/members" &&
      !new URL(r.url()).searchParams.has("active"),
  );
  await container.hover();
  await container.locator(".ant-select-clear").click();
  expect((await cleared).status()).toBe(200);
  await expect(
    page.getByRole("row").filter({ hasText: "陈开发" }),
  ).toBeVisible();
  if (process.env.WORKBENCH_UI_SCREENSHOTS) {
    await page.screenshot({
      path: process.env.WORKBENCH_UI_SCREENSHOTS + "/members-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: process.env.WORKBENCH_UI_SCREENSHOTS + "/members-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("member multiple roles preserve exact arrays and cancellation preserves the draft", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/members");
  await page
    .getByRole("row")
    .filter({ hasText: "顾查看" })
    .getByRole("button", { name: "授权", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("前端", { exact: true }).first().check();
  await dialog.getByLabel("测试", { exact: true }).first().check();
  await dialog.getByRole("button", { name: "返回并保留草稿" }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "顾查看" })
    .getByRole("button", { name: "授权", exact: true })
    .click();
  await expect(
    dialog.getByLabel("前端", { exact: true }).first(),
  ).toBeChecked();
  await expect(
    dialog.getByLabel("测试", { exact: true }).first(),
  ).toBeChecked();
  const sent = page.waitForRequest(
    (r) => r.url().includes("/roles") && r.method() === "PUT",
  );
  await dialog.getByRole("button", { name: "确认调整项目授权" }).click();
  const body = (await sent).postDataJSON();
  expect(body.roles).toEqual(["frontend", "test"]);
  expect(body.leads).toEqual([]);
  expect(body.memberId).toBe("viewer");
  await expect(dialog).toHaveCount(0);
});

test("report confirmation cancellation and late metadata retain draft and navigation ownership", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports");
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  const editor = page.getByLabel("日报文本", { exact: true });
  await expect(editor).toBeVisible();
  await editor.fill("保留未保存稿件");
  const trigger = page.getByRole("button", {
    name: "返回全部日报",
    exact: true,
  });
  await trigger.click();
  await expect(
    page.getByRole("dialog", { name: "确认切换日报" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor).toHaveValue("保留未保存稿件");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("button", { name: "保留副本并继续" }).click();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let received = false;
  await page.route("**/api/reports/*/source-changes", async (route) => {
    const response = await route.fetch();
    received = true;
    await gate;
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: /V1 生成稿/ })
    .first()
    .click();
  await expect.poll(() => received).toBe(true);
  await page.getByRole("button", { name: "返回全部日报", exact: true }).click();
  const completed = page.waitForResponse((r) =>
    r.url().includes("/source-changes"),
  );
  release();
  await completed;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    page.getByRole("heading", { name: "已保存日报", exact: true }),
  ).toBeVisible();
  await expect(editor).toHaveCount(0);
});

test("report UTF-16 limit retains oversized drafts and sends the exact accepted boundary", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports");
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  const editor = page.getByLabel("日报文本", { exact: true });
  await expect(editor).toBeVisible();
  const sent: any[] = [];
  await page.route("**/api/reports/*/versions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent.push(route.request().postDataJSON());
    await route.continue();
  });
  const oversized = "😀".repeat(100001);
  await editor.fill(oversized);
  await page.getByRole("button", { name: "保存稿件版本", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "日报文本最多 200000 个字符单位（UTF-16）",
  );
  expect(sent).toHaveLength(0);
  await expect(editor).toHaveValue(oversized);
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(sent).toHaveLength(0);
  await page.reload();
  await page.getByRole("button", { name: "恢复本地草稿", exact: true }).click();
  await expect(editor).toHaveValue(oversized);
  await page.getByRole("button", { name: "保存稿件版本", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "日报文本最多 200000 个字符单位（UTF-16）",
  );
  expect(sent).toHaveLength(0);
  const boundary = "😀".repeat(100000);
  await editor.fill(boundary);
  const response = page.waitForResponse(
    (r) => r.url().includes("/versions") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存稿件版本", exact: true }).click();
  expect((await response).status()).toBe(200);
  expect(sent).toHaveLength(1);
  expect(sent[0].text.length).toBe(200000);
  await expect(editor).toHaveValue(boundary);
});


test("current-route mobile navigation closes and restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const trigger = page.getByRole("button", { name: "展开导航" });
  await trigger.click();
  await page.getByRole("dialog").getByRole("link", { name: "我的工作", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/\/my-work$/);
});

test("workbench metric icons are decorative in the accessibility tree", async ({ page }) => {
  await login(page);
  await expect(page.locator(".metric")).toHaveCount(4);
  await expect(page.locator(".metrics").getByRole("img")).toHaveCount(0);
});

test("initial workbench defers unrelated route modules until navigation", async ({ page }) => {
  const pages: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/src/pages/")) pages.push(request.url());
  });
  await login(page);
  expect(pages.some(url => /\/(Reports|Members|Projects)\.vue/.test(url))).toBe(false);
  await page.getByRole("link", { name: "日报", exact: true }).click();
  await expect(page.getByRole("button", { name: "生成新日报", exact: true })).toBeVisible();
  expect(pages.some(url => url.includes("/Reports.vue"))).toBe(true);
});

test("member table handles delayed empty layout and mobile keyboard scrolling", async ({ page }) => {
  await login(page, "admin");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/members?*", async route => { if (new URL(route.request().url()).searchParams.has("projectId")) await held; await route.continue(); });
  try {
    await page.goto("/members");
    await expect(page.getByRole("columnheader", { name: "成员", exact: true })).toBeVisible();
    // Let the empty layout render before releasing its data, reproducing cold route loading.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    release();
    await expect(page.getByRole("row").filter({ hasText: "演示管理员" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const table = page.getByRole("region", { name: "成员目录，可横向滚动" });
    await expect(table).toBeVisible();
    await expect(page.getByText("左右滑动可查看完整成员信息与操作")).toBeVisible();
    await table.focus();
    await table.press("ArrowRight");
    await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { release(); }
});

for (const path of ["/activate", "/reset"]) {
  test(`cold ${path} navigation preserves the public route while its module loads`, async ({ page }) => {
    await page.route("**/src/pages/Activate.vue", async route => {
      // Model a slower route chunk than the unauthenticated session response.
      await new Promise(resolve => setTimeout(resolve, 300));
      await route.continue();
    });
    await page.goto(path + "?ticket=synthetic-route-only");
    await expect(page.getByLabel("管理员票据")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(path);
    expect(new URL(page.url()).searchParams.get("ticket")).toBe("synthetic-route-only");
  });
}


test("cold private navigation redirects unauthenticated users to the login form", async ({ page }) => {
  await page.goto("/reports");
  await expect(page.getByRole("button", { name: "登录工作台" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

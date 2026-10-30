import { test, expect } from "./fixtures.js";
import { login, selectOption, openFilters, applyFilters } from "./helpers.js";
import { api, pendingAcceptance } from "./audit-helpers.js";

test("management-visible unassigned associations do not claim the viewer has the execution role", async ({
  page,
}) => {
  await login(page, "admin");
  const project = await api(page, "POST", "/api/projects", {
    name: "合成关联资格",
    description: "产品管理关注非同岗位任务",
  });
  const grant = async (memberId: string, roles: string[]) => {
    const current = await api(
      page,
      "GET",
      `/api/projects/${project.id}/overview`,
    );
    return api(page, "PUT", `/api/projects/${project.id}/roles`, {
      memberId,
      roles,
      leads: [],
      expectedVersion: current.project.version,
    });
  };
  await grant("product", ["product"]);
  await grant("tester", ["test"]);
  await login(page, "product");
  const task = await api(page, "POST", "/api/tasks", {
    projectId: project.id,
    title: "合成未分配后端任务",
    kind: "backend",
    definitionOfDone: "只读管理关联",
    priority: "medium",
    reviewerId: "tester",
  });
  await login(page, "admin");
  await grant("tester", []);
  await login(page, "product");
  const actual = await api(
    page,
    "GET",
    `/api/my-work?projectId=${project.id}&limit=5`,
  );
  expect(
    actual.items.find((item: any) => item.id === task.id)?.responsibility,
  ).toBe("claimable");
  await page.goto(`/projects/${project.id}`);
  const related = page.getByRole("region", {
    name: "与我相关的工作",
    exact: true,
  });
  const row = related
    .locator(".related-work-row")
    .filter({ hasText: task.title });
  await expect(row).toContainText("未分配关联");
  await expect(row).not.toContainText("同岗位");
  await expect(
    row.getByRole("link", { name: "查看详情：" + task.title, exact: true }),
  ).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
});

test("project acceptance metric clears search while ordinary project tabs retain it", async ({
  page,
}) => {
  const requirement = await pendingAcceptance(page, "合成统计穿透待验收");
  await page.goto("/projects/p1?q=no-matching-search-synthetic");
  const navigation = page.getByRole("navigation", {
    name: "项目导航",
    exact: true,
  });
  await navigation.getByRole("link", { name: "任务", exact: true }).click();
  await expect(page).toHaveURL(/q=no-matching-search-synthetic/);
  await navigation.getByRole("link", { name: "概览", exact: true }).click();
  await page.getByRole("button", { name: /^待验收需求/ }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.has("q"))
    .toBe(false);
  await expect(
    page.getByRole("heading", { name: "产品验收队列", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".project-work")
      .getByRole("link", { name: requirement.title, exact: true }),
  ).toBeVisible();
});

test("mobile navigation includes the project search in its keyboard focus loop after no matches", async ({
  page,
}) => {
  await login(page, "dev");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "展开导航", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "团队工作区", exact: true });
  const search = drawer.getByRole("textbox", {
    name: "筛选移动项目",
    exact: true,
  });
  await search.fill("no-synthetic-match");
  await expect(
    drawer.getByText("没有匹配的项目", { exact: true }),
  ).toBeVisible();
  const logout = drawer.getByRole("button", { name: "退出登录", exact: true });
  await logout.focus();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  const close = drawer.getByRole("button", { name: "收起导航", exact: true });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(search).toBeFocused();
  await search.fill("星河");
  await drawer.getByRole("link", { name: "星河协作计划", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(
    page.getByRole("button", { name: "展开导航", exact: true }),
  ).toBeFocused();
});

test("directory separates matching active and archived projects and clears every filter", async ({
  page,
}, info) => {
  await login(page, "admin");
  const active = await api(page, "POST", "/api/projects", {
    name: "合成分区活跃",
    description: "distinct-description-layout",
  });
  const archived = await api(page, "POST", "/api/projects", {
    name: "合成分区归档",
    description: "distinct-description-layout",
  });
  await api(page, "POST", `/api/projects/${archived.id}/archive`, {
    expectedVersion: archived.version,
  });
  await page.goto("/projects?view=all");
  await openFilters(page, "项目目录筛选");
  await page.getByRole("textbox", { name: "搜索项目名称", exact: true }).fill("distinct-description-layout");
  await applyFilters(page, "项目目录筛选");
  const live = page.getByRole("region", { name: "进行中项目", exact: true });
  const history = page.getByRole("region", { name: "已归档项目", exact: true });
  await expect(live.getByRole("link", { name: "合成分区活跃 ↗", exact: true })).toBeVisible();
  await openFilters(page, "项目目录筛选");
  await page.getByRole("button", { name: "已归档", exact: true }).click();
  await applyFilters(page, "项目目录筛选");
  await expect(live).toHaveCount(0);
  await expect(history.getByRole("link", { name: "合成分区归档 ↗", exact: true })).toBeVisible();
  await openFilters(page, "项目目录筛选");
  await page.getByRole("textbox", { name: "搜索项目名称", exact: true }).fill("does-not-match-any-project");
  await applyFilters(page, "项目目录筛选");
  await expect(page.getByText("没有符合条件的项目", { exact: false })).toBeVisible();
  const panel = await openFilters(page, "项目目录筛选");
  await panel.getByRole("button", { name: "重置", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "搜索项目名称", exact: true })).toHaveValue("");
  await applyFilters(page, "项目目录筛选");
  await expect(live.getByRole("link", { name: "合成分区活跃 ↗", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("directory-all-desktop.png"), fullPage: true, animations: "disabled" });
  await openFilters(page, "项目目录筛选");
  await page.getByRole("textbox", { name: "搜索项目名称", exact: true }).fill(active.id);
  await applyFilters(page, "项目目录筛选");
  await expect(live.locator(".project-card")).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("directory-desktop.png"), fullPage: true, animations: "disabled" });
});

test("shared project header and settings segments retain multi-role grants and real audit history", async ({
  page,
}, info) => {
  await login(page, "admin");
  const p = await api(page, "POST", "/api/projects", {
    name: "合成统一导航",
    description: "实际设置与审计",
  });
  await api(page, "PUT", `/api/projects/${p.id}/roles`, {
    memberId: "dev",
    roles: ["backend", "test"],
    leads: ["backend", "test"],
    expectedVersion: p.version,
  });
  await page.goto(`/projects/${p.id}?tab=settings`);
  const nav = page.getByRole("navigation", {
    name: "项目设置导航",
    exact: true,
  });
  await expect(page.locator(".project-header")).toBeVisible();
  await nav.getByRole("link", { name: "成员与角色", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/members\\?projectId=" + p.id));
  await expect(page.locator(".project-header")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "陈开发" });
  await expect(row.getByRole("cell").nth(6)).toHaveText("后端、测试");
  await row.getByRole("button", { name: "授权", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "调整项目授权",
    exact: true,
  });
  const leads = dialog
    .locator(".ant-form-item")
    .filter({ has: page.getByText("角色负责人", { exact: true }) });
  await expect(
    leads.getByRole("checkbox", { name: "后端", exact: true }),
  ).toBeChecked();
  await expect(
    leads.getByRole("checkbox", { name: "测试", exact: true }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.screenshot({
    path: info.outputPath("roles-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await nav.getByRole("link", { name: "归档与历史", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "活动历史", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".history")).toContainText("调整项目权限");
  await page
    .locator(".history li")
    .filter({ hasText: "调整项目权限" })
    .getByText("查看变更内容", { exact: true })
    .click();
  await expect(page.locator(".history")).toContainText("后端负责人");
  await expect(page.locator(".history")).toContainText("测试负责人");
  await page.getByRole("button", { name: "归档项目", exact: true }).click();
  await page
    .getByRole("dialog", { name: "归档项目", exact: true })
    .getByRole("button", { name: "确认归档项目", exact: true })
    .click();
  await expect(page.locator(".history")).toContainText("归档项目");
  await page.getByRole("button", { name: "恢复项目", exact: true }).click();
  await page
    .getByRole("dialog", { name: "恢复项目", exact: true })
    .getByRole("button", { name: "确认恢复项目", exact: true })
    .click();
  await expect(page.locator(".history")).toContainText("恢复项目");
  await page.screenshot({
    path: info.outputPath("project-history-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.goBack();
  await expect(
    nav.getByRole("link", { name: "成员与角色", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("related records paginate, reject late project reads and clear old rows on failure", async ({
  page,
}) => {
  await login(page, "product");
  for (let i = 0; i < 6; i++)
    await api(page, "POST", "/api/tasks", {
      projectId: "p2",
      title: "合成关联分页" + i,
      kind: "backend",
      definitionOfDone: "实际关联",
      priority: "medium",
      ownerId: "dev",
      reviewerId: "tester",
    });
  await login(page, "dev");
  await page.goto("/projects/p1");
  const related = page.getByRole("region", {
    name: "与我相关的工作",
    exact: true,
  });
  await expect(
    related.getByRole("button", { name: "刷新关联", exact: true }),
  ).toBeEnabled();
  let release!: () => void, received!: () => void;
  const held = new Promise<void>((resolve) => {
    received = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/my-work?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("projectId") !== "p1")
      return route.continue();
    const response = await route.fetch();
    received();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await related
      .getByRole("button", { name: "刷新关联", exact: true })
      .click();
    await held;
    await selectOption(page, "切换当前项目", {
      value: "p2",
      label: "青禾服务台",
    });
    await expect(related.locator(".related-work-row")).toHaveCount(5);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
  await related
    .getByRole("button", { name: "加载更多关联", exact: true })
    .click();
  const expected = await api(
    page,
    "GET",
    "/api/my-work?projectId=p2&limit=100",
  );
  await expect(related.locator(".related-work-row")).toHaveCount(
    expected.items.length,
  );
  for (const o of expected.items)
    await expect(
      related.getByRole("link", { name: o.title, exact: true }),
    ).toBeVisible();
  await page.route("**/api/my-work?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic read failure" }),
    }),
  );
  await related.getByRole("button", { name: "刷新关联", exact: true }).click();
  await expect(related.getByRole("alert")).toContainText(
    "Synthetic read failure",
  );
  await expect(related.locator(".related-work-row")).toHaveCount(0);
  await page.unroute("**/api/my-work?*");
  await related.getByRole("button", { name: "刷新关联", exact: true }).click();
  await expect(related.locator(".related-work-row")).toHaveCount(5);
});

test("overview related work is scoped and honest while only exact acceptance counts drill into its queue", async ({
  page,
}, info) => {
  await login(page, "dev");
  await page.goto("/projects/p1");
  const related = page.getByRole("region", {
    name: "与我相关的工作",
    exact: true,
  });
  await expect(related).toBeVisible();
  const expected = await api(page, "GET", "/api/my-work?projectId=p1&limit=5");
  await expect(related.locator(".related-work-row")).toHaveCount(
    expected.items.length,
  );
  for (const o of expected.items)
    await expect(
      related.getByRole("link", { name: o.title, exact: true }),
    ).toBeVisible();
  await expect(related).not.toContainText("按紧急度排序");
  await expect(
    related.getByRole("button", { name: /领取|开始|提交|验收/ }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("overview-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: /^待验收需求/ }).click();
  await expect(page).toHaveURL(/tab=tests&queue=acceptance/);
  await expect(
    page.getByRole("heading", { name: "产品验收队列", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "项目导航", exact: true })
      .getByRole("link", { name: "测试与验收", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await login(page, "viewer");
  await page.goto("/projects/p1");
  await expect(
    page.getByRole("button", {
      name: /新建需求|新建任务|新建 Bug|归档项目|编辑项目/,
    }),
  ).toHaveCount(0);
});

test("all project shortcuts remain searchable and long project context stays usable on phones", async ({
  page,
}, info) => {
  await login(page, "admin");
  const name = "合成长项目名称".repeat(8);
  const p = await api(page, "POST", "/api/projects", {
    name,
    description: "长描述".repeat(100),
  });
  await page.goto("/projects?view=all");
  const sidebar = page.locator(".sidebar .project-shortcuts");
  await sidebar
    .getByRole("textbox", { name: "筛选侧栏项目", exact: true })
    .fill(p.id);
  await expect(sidebar.getByRole("link", { name, exact: true })).toHaveCount(1);
  await sidebar.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 850, height: 1000 });
  await expect(sidebar).toBeHidden();
  await expect(
    page.getByRole("combobox", { name: "切换当前项目", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 851, height: 1000 });
  await expect(sidebar).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("navigation", { name: "项目导航", exact: true })
    .getByRole("link", { name: "项目设置", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "项目设置导航", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("settings-long-name-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "展开导航", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "团队工作区", exact: true });
  await drawer
    .getByRole("textbox", { name: "筛选移动项目", exact: true })
    .fill("星河");
  await drawer.getByRole("link", { name: "星河协作计划", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/p1$/);
  await expect(drawer).toBeHidden();
});

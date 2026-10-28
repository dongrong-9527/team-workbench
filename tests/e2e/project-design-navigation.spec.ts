import { test, expect } from "./fixtures.js";
import { login, selectOption, action, submit } from "./helpers.js";

test("project tabs retain route scope and browser history while filtering real server lists", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/projects/p1");
  await expect(
    page.getByRole("navigation", { name: "项目导航" }),
  ).toBeVisible();
  // A conflicting global selection must not change an explicit route project.
  await selectOption(page, "全局项目筛选", {
    value: "p2",
    label: "青禾服务台",
  });
  const navigation = page.getByRole("navigation", { name: "项目导航" });
  const tasks = page.waitForResponse((r) => {
    const u = new URL(r.url());
    return (
      u.pathname === "/api/objects" &&
      u.searchParams.get("projectId") === "p1" &&
      u.searchParams.get("kind") === "task"
    );
  });
  await navigation.getByRole("link", { name: "任务", exact: true }).click();
  expect((await tasks).status()).toBe(200);
  await expect(page).toHaveURL(/\/projects\/p1\?tab=tasks$/);
  await expect(
    navigation.getByRole("link", { name: "任务", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "全部任务", exact: true }),
  ).toBeVisible();
  await navigation.getByRole("link", { name: "需求", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "全部需求", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "全部任务", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "全部需求", exact: true }),
  ).toBeVisible();
});

test("project review queues ignore late reads from the previous selected queue", async ({
  page,
}) => {
  await login(page, "tester");
  await page.goto("/projects/p1?tab=tests");
  await expect(
    page.getByRole("heading", { name: "待检查任务", exact: true }),
  ).toBeVisible();
  let release!: () => void;
  let received!: () => void;
  const held = new Promise<void>((resolve) => {
    received = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/objects?*", async (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get("state") !== "pending_verify")
      return route.continue();
    const response = await route.fetch();
    received();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: /^待验证 Bug/ }).click();
    await held;
    await page.getByRole("button", { name: /^产品验收队列/ }).click();
    await expect(
      page.getByRole("heading", { name: "产品验收队列", exact: true }),
    ).toBeVisible();
    const complete = page.waitForResponse(
      (r) => new URL(r.url()).searchParams.get("state") === "pending_verify",
    );
    release();
    await complete;
    await expect(page).toHaveURL(/tab=tests&queue=acceptance/);
    await expect(
      page.getByRole("heading", { name: "产品验收队列", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^产品验收队列/ }),
    ).toHaveAttribute("aria-pressed", "true");
    const expected = await page.evaluate(async () =>
      (
        await (
          await fetch(
            "/api/objects?projectId=p1&kind=requirement&state=pending_acceptance",
          )
        ).json()
      ).items.map((o: any) => o.title),
    );
    for (const title of expected)
      await expect(
        page.getByRole("link", { name: title, exact: true }),
      ).toBeVisible();
    await expect(page.locator(".project-work .work-title:visible")).toHaveCount(
      expected.length,
    );
  } finally {
    release();
  }
});

test("project cards open the chosen versioned edit form and preserve its draft", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/projects?view=all");
  const card = page.locator(".project-card").filter({
    has: page.getByRole("link", { name: "星河协作计划 ↗", exact: true }),
  });
  await card.getByRole("button", { name: "编辑项目", exact: true }).click();
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(
    "星河协作计划",
  );
  await page
    .getByLabel("项目简介", { exact: true })
    .fill("仅用于验证取消后的项目草稿");
  await page
    .getByRole("button", { name: "返回", exact: true })
    .click();
  await card.getByRole("button", { name: "编辑项目", exact: true }).click();
  await expect(page.getByLabel("项目简介", { exact: true })).toHaveValue(
    "仅用于验证取消后的项目草稿",
  );
  await page
    .getByRole("button", { name: "返回", exact: true })
    .click();
});

test("project role navigation keeps explicit project context and remains usable at 390px", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/members?projectId=p1");
  await expect(
    page.getByRole("link", { name: "返回项目 · 星河协作计划", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "产品", exact: true }),
  ).toBeVisible();
  await selectOption(page, "授权项目", { value: "p2", label: "青禾服务台" });
  await expect(
    page.getByRole("link", { name: "返回项目 · 青禾服务台", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("link", { name: "返回项目 · 星河协作计划", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const region = page.getByRole("region", { name: "成员目录，可横向滚动" });
  await expect(region).toBeVisible();
  await region.focus();
  await region.press("ArrowRight");
  await expect
    .poll(() => region.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "基本信息", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/p1\?tab=settings$/);
  await expect(
    page.getByRole("heading", { name: "项目基本信息", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("project creation follow-up survives route remount and cannot be forged by a URL marker", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/projects?view=all");
  await action(page, "新建项目");
  await page.getByLabel("项目名称", { exact: true }).fill("项目创建回执回归");
  await submit(page, "确认新建项目");
  const followUp = page.locator(".created-project");
  await expect(
    followUp.getByRole("heading", {
      name: "项目创建回执回归已创建",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/[^/?]+$/);
  const projectPath = new URL(page.url()).pathname;
  const actual = await page.evaluate(
    async (path) => await (await fetch("/api" + path + "/overview")).json(),
    projectPath,
  );
  expect(actual.project.name).toBe("项目创建回执回归");
  expect(actual.myRoles).toEqual([]);
  await followUp.getByRole("button", { name: "进入项目", exact: true }).click();
  await expect(followUp).toHaveCount(0);
  // The consumed acknowledgement cannot be replayed through an existing-project URL.
  await page.goto(projectPath + "?created=1");
  await expect(
    page.getByRole("heading", { name: "项目创建回执回归", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".created-project")).toHaveCount(0);
  await expect(page).toHaveURL(/\/projects\/[^/?]+$/);
});

test("project unresolved Bug metric includes confirmed ready Bugs from authoritative counts", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  await action(page, "新建 Bug");
  for (const [label, value] of [
    ["标题", "待修复 Bug 概览计数回归"],
    ["预期行为", "概览包含已确认待修复缺陷"],
    ["实际行为", "待修复状态需要计入未闭环范围"],
    ["复现步骤", "登记并确认缺陷后核对概览"],
    ["复现环境", "合成浏览器回归环境"],
  ])
    await page.getByLabel(label!, { exact: true }).fill(value!);
  await submit(page, "确认新建Bug");
  await action(page, "确认 Bug");
  await page
    .getByLabel("操作原因", { exact: true })
    .fill("合成缺陷已确认，等待修复");
  await submit(page, "确认确认 Bug");
  const actual = await page.evaluate(
    async () =>
      (await (await fetch("/api/projects/p1/overview")).json()).counts,
  );
  expect(
    actual.some(
      (c: any) => c.kind === "bug" && c.state === "ready" && c.count > 0,
    ),
  ).toBe(true);
  const expected = actual
    .filter(
      (c: any) =>
        c.kind === "bug" &&
        ["unconfirmed", "ready", "fixing", "pending_verify"].includes(c.state),
    )
    .reduce((sum: number, c: any) => sum + c.count, 0);
  await page.goto("/projects/p1");
  await expect(
    page
      .locator(".project-metrics > div")
      .filter({ has: page.getByText("未闭环 Bug", { exact: true }) })
      .locator("strong"),
  ).toHaveText(String(expected));
});

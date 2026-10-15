import { test, expect } from "./fixtures.js";
import {
  expectSelectedOption,
  selectOption,
  login,
  action,
  submit,
  task,
} from "./helpers.js";
test("task_10 two contexts claim one task and show safe conflict without overwrite", async ({
  page,
  browser,
  observeContext,
}) => {
  const url = await task(page, "双人认领竞争", "");
  const other = await browser.newContext({ ignoreHTTPSErrors: true });
  await observeContext(other);
  const p2 = await other.newPage();
  await login(page, "dev");
  await login(p2, "dev2");
  await page.goto(url);
  await p2.goto(url);
  await action(page, "认领");
  await action(p2, "认领");
  await Promise.all([
    page.getByRole("button", { name: "确认认领", exact: true }).click(),
    p2.getByRole("button", { name: "确认认领", exact: true }).click(),
  ]);
  await expect
    .poll(
      async () =>
        (await page.getByRole("dialog").count()) +
        (await p2.getByRole("dialog").count()),
    )
    .toBe(1);
  const loser = (await page.getByRole("dialog").count()) ? page : p2;
  await expect(
    loser.getByRole("heading", { name: "版本冲突：请核对最新记录" }),
  ).toBeVisible();
  await expect(
    loser.getByRole("button", { name: "采用最新版本并重新核对" }),
  ).toBeVisible();
  await other.close();
});
test("task_10 session expiry retains own draft, identity switch isolates it, mobile IME and keyboard are usable", async ({
  page,
  context,
}) => {
  const url = await task(
    page,
    "中文长标题与窄屏验证：成员责任与下一步动作都需要完整清楚地呈现",
  );
  await login(page, "dev");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await action(page, "写工作更新");
  const input = page.getByLabel("今天实际做了什么", { exact: true });
  await input.focus();
  await expect(input).toBeFocused();
  await input.dispatchEvent("compositionstart");
  await input.fill("中文输入尚未保存");
  await input.dispatchEvent("compositionend", { data: "中文输入尚未保存" });
  await page.getByRole("button", { name: "返回并保留草稿" }).click();
  await page.goBack();
  await page.goto(url);
  await action(page, "写工作更新");
  await expect(input).toHaveValue("中文输入尚未保存");
  await context.clearCookies();
  await page.getByRole("button", { name: "保存更新", exact: true }).click();
  const expired = page.getByRole("dialog", {
    name: "登录会话已失效",
    exact: true,
  });
  await expect(expired.getByRole("alert")).toContainText("登录已过期");
  await expired.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "返回并保留草稿" }).click();
  await page.getByRole("link", { name: "重新登录", exact: true }).click();
  await page.getByLabel("登录账号").fill("dev2");
  await page.getByLabel("密码", { exact: true }).fill("Synthetic-demo-2026!");
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(page.getByRole("heading", { name: /中文长标题/ })).toBeVisible();
  await action(page, "写工作更新");
  await expect(input).toHaveValue("");
  await page.getByRole("button", { name: "返回并保留草稿" }).click();
  await login(page, "dev");
  await page.goto(url);
  await action(page, "写工作更新");
  await expect(input).toHaveValue("中文输入尚未保存");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "展开导航" }).click();
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "账号设置" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "账号设置" })
    .click();
  await expect(page.getByLabel("当前密码")).toBeVisible();
  await page.getByRole("button", { name: "展开导航" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "退出登录" })
    .click();
  await expect(page.getByRole("button", { name: "登录工作台" })).toBeVisible();
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toContain("Synthetic-demo-2026!");
  expect(storage).not.toMatch(
    /csrfToken|activationToken|resetToken|currentPassword/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("task_10 admin creation activation password reset and deactivation use actual forms", async ({
  page,
  browser,
  observeContext,
}) => {
  await login(page, "admin");
  await page.goto("/members");
  await action(page, "创建成员");
  await page.getByLabel("登录账号（小写英文或数字）").fill("synthetic.new");
  await page.getByLabel("显示名", { exact: true }).fill("合成新成员");
  await submit(page, "确认创建成员");
  const activation = await page.getByLabel("一次性票据").inputValue();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await observeContext(context);
  const p = await context.newPage();
  await p.goto("/activate");
  await p.getByLabel("管理员票据").fill(activation);
  await p.getByLabel("新密码", { exact: true }).fill("Synthetic-demo-2026!");
  await p.getByLabel("确认密码").fill("Synthetic-demo-2026!");
  await p.getByRole("button", { name: "激活账号", exact: true }).click();
  await expect(p.getByRole("status")).toContainText("设置成功");
  await login(p, "synthetic.new");
  await p.goto("/password");
  await p.getByLabel("当前密码").fill("Synthetic-demo-2026!");
  await p.getByLabel("新密码", { exact: true }).fill("Synthetic-changed-2026!");
  await p.getByLabel("确认密码").fill("Synthetic-changed-2026!");
  await p.getByRole("button", { name: "修改密码", exact: true }).click();
  await expect(p.getByRole("status")).toContainText("密码已修改");
  const row = page.getByRole("row").filter({ hasText: "合成新成员" });
  async function refreshMember() {
    const previousRow = await row.elementHandle();
    expect(previousRow).not.toBeNull();
    await expectSelectedOption(page, "授权项目", {
      value: "p1",
      label: "星河协作计划",
    });
    const projectId = "p1";
    const refreshed = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return (
        r.request().method() === "GET" &&
        url.pathname === "/api/members" &&
        url.searchParams.get("projectId") === projectId
      );
    });
    await page.getByRole("button", { name: "刷新权限" }).click();
    const response = await refreshed;
    expect(response.status()).toBe(200);
    const member = (await response.json()).items.find(
      (m: { displayName: string }) => m.displayName === "合成新成员",
    );
    expect(member).toBeDefined();
    // The directory refresh precedes the table read. Wait for the old row to
    // detach and the fresh row to render before opening a versioned command.
    await expect
      .poll(() => previousRow!.evaluate((element) => element.isConnected))
      .toBe(false);
    await expect(row).toBeVisible();
    await previousRow!.dispose();
    return member;
  }
  await page.getByRole("button", { name: "隐藏票据" }).click();
  const activatedMember = await refreshMember();
  await row.getByRole("button", { name: "重置密码" }).click();
  const resetting = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname ===
        `/api/members/${activatedMember.id}/reset` &&
      r.request().method() === "POST",
  );
  await submit(page, "确认签发密码重置票据");
  const resetResponse = await resetting;
  expect(resetResponse.status()).toBe(200);
  expect(resetResponse.request().postDataJSON().expectedVersion).toBe(
    activatedMember.version,
  );
  const reset = await page.getByLabel("一次性票据").inputValue();
  await p.goto("/reset");
  await p.getByLabel("管理员票据").fill(reset);
  await p.getByLabel("新密码", { exact: true }).fill("Synthetic-demo-2026!");
  await p.getByLabel("确认密码").fill("Synthetic-demo-2026!");
  await p.getByRole("button", { name: "确认重置" }).click();
  await expect(p.getByRole("status")).toContainText("设置成功");
  await login(p, "synthetic.new");
  await page.getByRole("button", { name: "隐藏票据" }).click();
  const resetMember = await refreshMember();
  await row.getByRole("button", { name: "停用", exact: true }).click();
  const deactivating = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname ===
        `/api/members/${resetMember.id}/deactivate` &&
      r.request().method() === "POST",
  );
  await submit(page, "确认停用成员");
  const deactivateResponse = await deactivating;
  expect(deactivateResponse.status()).toBe(200);
  expect(deactivateResponse.request().postDataJSON().expectedVersion).toBe(
    resetMember.version,
  );
  await p.reload();
  await expect(p.getByRole("button", { name: "登录工作台" })).toBeVisible();
  await expect(row.getByText("已停用", { exact: true })).toBeVisible();
  await context.close();
});
test("task_10 revoked role hides actions after refresh and old open form is rejected", async ({
  page,
  browser,
  observeContext,
}) => {
  const url = await task(page, "撤权后的旧表单", "dev2", "p2");
  const c = await browser.newContext({ ignoreHTTPSErrors: true });
  await observeContext(c);
  const p = await c.newPage();
  await login(p, "dev2");
  await p.goto(url);
  await action(p, "开始处理");
  await login(page, "admin");
  await page.goto("/members");
  await selectOption(page, "授权项目", { value: "p2", label: "青禾服务台" });
  const row = page.getByRole("row").filter({ hasText: "许前端" });
  await row.getByRole("button", { name: "授权", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("后端", { exact: true })
    .first()
    .uncheck();
  await submit(page, "确认调整项目授权");
  await p.getByRole("button", { name: "确认开始处理" }).click();
  await expect(p.getByRole("dialog").getByRole("alert")).toContainText("权限");
  await p.getByRole("button", { name: "返回并保留草稿" }).click();
  await p.reload();
  await expect(
    p.getByRole("button", { name: "开始处理", exact: true }),
  ).toHaveCount(0);
  await row.getByRole("button", { name: "授权", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("后端", { exact: true })
    .first()
    .check();
  await submit(page, "确认调整项目授权");
  await c.close();
});
test("task_10 read-only viewer cross-project reads, 500 recovery, real pagination and filtering", async ({
  page,
}) => {
  await login(page, "viewer");
  await expect(page.getByText("当前筛选下没有待处理事项。")).toBeVisible();
  const expected = await page.evaluate(async () =>
    (
      await (
        await fetch("/api/objects?projectId=pagination-access&limit=100")
      ).json()
    ).items.map((x: any) => `/task/${x.id}`),
  );
  expect(expected).toHaveLength(24);
  expect(new Set(expected).size).toBe(24);
  await page.goto("/projects/pagination-access");
  await expect(
    page.getByRole("button", { name: "新建任务", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "新建 Bug", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".work-row")).toHaveCount(20);
  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page.locator(".work-row")).toHaveCount(expected.length);
  expect(
    await page
      .locator(".work-title")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href"))),
  ).toEqual(expected);
  await expect(
    page.getByRole("button", { name: "加载更多", exact: true }),
  ).toHaveCount(0);
  await selectOption(page, "负责人", { value: "dev", label: "陈开发" });
  await expect(page.locator(".work-row")).toHaveCount(1);
  await page.route("**/api/my-work?*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Internal server error" }),
    }),
  );
  await page.goto("/my-work");
  await expect(page.getByRole("alert")).toContainText("服务暂时异常");
  await page.unroute("**/api/my-work?*");
  await page.getByRole("button", { name: "重试加载" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.goto("/members");
  await expect(page.getByRole("button", { name: "创建成员" })).toHaveCount(0);
});
test("task_10 double click and lost successful response replay one command; archive preserves read access", async ({
  page,
}) => {
  const url = await task(page, "响应丢失也只认领一次", "");
  await login(page, "dev");
  await page.goto(url);
  await action(page, "认领");
  let count = 0;
  const keys: string[] = [];
  await page.route("**/api/tasks/*/actions", async (route) => {
    count++;
    keys.push(route.request().headers()["idempotency-key"]!);
    if (count === 1) {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "确认认领", exact: true })
    .evaluate((b: HTMLButtonElement) => {
      b.click();
      b.click();
    });
  await expect(page.getByRole("alert")).toContainText("网络");
  expect(count).toBe(1);
  await submit(page, "确认认领");
  expect(keys[1]).toBe(keys[0]);
  await page.unroute("**/api/tasks/*/actions");
  await page.getByRole("button", { name: "刷新详情" }).click();
  await expect(
    page.getByRole("button", { name: "认领", exact: true }),
  ).toHaveCount(0);
  await login(page, "admin");
  await page.goto("/projects");
  await action(page, "新建项目");
  await page.getByLabel("项目名称", { exact: true }).fill("合成归档项目");
  await submit(page, "确认新建项目");
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(
    page.getByRole("heading", { name: "合成归档项目", exact: true }),
  ).toBeVisible();
  await action(page, "归档项目");
  await expect(page.getByText(/归档后所有成员只能阅读/)).toBeVisible();
  await submit(page, "确认归档项目");
  await expect(page.getByText(/项目已归档，保留只读历史/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "新建任务", exact: true }),
  ).toHaveCount(0);
  await action(page, "恢复项目");
  await submit(page, "确认恢复项目");
});

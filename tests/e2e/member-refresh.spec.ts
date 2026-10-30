import { test, expect } from "./fixtures.js";
import { login, action, submit } from "./helpers.js";

for (const failedRefresh of [false, true]) {
  test(`member authorization waits for ${failedRefresh ? "directory recovery" : "fresh project version"} before another write`, async ({
    page,
  }, testInfo) => {
    await login(page, "admin");
    await page.goto("/projects");
    await action(page, "新建项目");
    await page.getByLabel("项目名称", { exact: true }).fill("合成连续授权刷新");
    await submit(page, "确认新建项目");
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    const projectId = page.url().split("/").at(-1)!;
    await page
      .getByRole("link", { name: "管理本项目成员与角色", exact: true })
      .click();
    const grant = (name: string) =>
      page
        .getByRole("row")
        .filter({ hasText: name })
        .getByRole("button", { name: "授权", exact: true });
    await grant("陈开发").click();
    await page
      .getByRole("dialog")
      .locator("#field-roles")
      .getByLabel("后端", { exact: true })
      .check();
    let release!: () => void;
    let received!: () => void;
    const held = new Promise<void>((resolve) => {
      received = resolve;
    });
    await page.route(/\/api\/projects(?:\?|$)/, async (route) => {
      const response = await route.fetch();
      await new Promise<void>((resolve) => {
        release = resolve;
        received();
      });
      if (failedRefresh)
        await route.fulfill({
          status: 503,
          json: { error: "Synthetic directory unavailable" },
        });
      else await route.fulfill({ response });
    });
    try {
      await submit(page, "确认调整项目授权");
      await held;
      await expect(grant("许前端")).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "创建成员", exact: true }),
      ).toBeDisabled();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath("member-refresh-desktop.png"),
        fullPage: true,
        animations: "disabled",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: testInfo.outputPath("member-refresh-mobile.png"),
        fullPage: true,
        animations: "disabled",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      await page.setViewportSize({ width: 1440, height: 1000 });
      release();
      await page.unrouteAll({ behavior: "wait" });
      if (failedRefresh) {
        await expect(page.getByRole("alert")).toContainText(
          "Synthetic directory unavailable",
        );
        await expect(grant("许前端")).toBeDisabled();
        await page.screenshot({
          path: testInfo.outputPath("member-refresh-error.png"),
          fullPage: true,
          animations: "disabled",
        });
        await page
          .getByRole("button", { name: "刷新权限", exact: true })
          .click();
      }
      await grant("许前端").click();
      await page
        .getByRole("dialog")
        .locator("#field-roles")
        .getByLabel("前端", { exact: true })
        .check();
      const saved = page.waitForResponse(
        (r) =>
          r.request().method() === "PUT" &&
          new URL(r.url()).pathname === "/api/projects/" + projectId + "/roles",
      );
      await submit(page, "确认调整项目授权");
      const response = await saved;
      expect(response.request().postDataJSON().expectedVersion).toBe(2);
      expect(response.status()).toBe(200);
      await expect(grant("许前端")).toBeEnabled();
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "许前端" })
          .getByRole("checkbox", {
            name: "许前端 · 前端当前授权",
            exact: true,
          }),
      ).toBeChecked();
      await expect(
        page.getByRole("heading", { name: "版本冲突：请核对最新记录" }),
      ).toHaveCount(0);
    } finally {
      release?.();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}

test("member authorization refreshes versions after leaving a pending refresh and navigating back", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/projects");
  await action(page, "新建项目");
  await page.getByLabel("项目名称", { exact: true }).fill("合成返回后连续授权");
  await submit(page, "确认新建项目");
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const projectId = page.url().split("/").at(-1)!;
  await page
    .getByRole("link", { name: "管理本项目成员与角色", exact: true })
    .click();
  const grant = (name: string) =>
    page
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "授权", exact: true });
  await grant("陈开发").click();
  await page
    .getByRole("dialog")
    .locator("#field-roles")
    .getByLabel("后端", { exact: true })
    .check();
  let release!: () => void;
  let received!: () => void;
  const held = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route(/\/api\/projects(?:\?|$)/, async (route) => {
    const response = await route.fetch();
    await new Promise<void>((resolve) => {
      release = resolve;
      received();
    });
    await route.fulfill({ response });
  });
  try {
    await submit(page, "确认调整项目授权");
    await held;
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { name: "我的工作", exact: true })
      .click();
    await expect(page).toHaveURL(/\/my-work/);
    release();
    await page.unrouteAll({ behavior: "wait" });
    // Browser back keeps the SPA directory cache, so a full reload cannot mask
    // the version left stale by the intentionally discarded unmounted read.
    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp("/members\\?projectId=" + projectId),
    );
    await grant("许前端").click();
    await page
      .getByRole("dialog")
      .locator("#field-roles")
      .getByLabel("前端", { exact: true })
      .check();
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        new URL(r.url()).pathname === "/api/projects/" + projectId + "/roles",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认调整项目授权", exact: true })
      .click();
    const response = await saved;
    expect(response.request().postDataJSON().expectedVersion).toBe(2);
    expect(response.status()).toBe(200);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(grant("许前端")).toBeEnabled();
  } finally {
    release?.();
    await page.unrouteAll({ behavior: "wait" });
  }
});

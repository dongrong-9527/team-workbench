import { test, expect } from "./fixtures.js";
import { login } from "./helpers.js";

test("work tabs keep loaded responsibility distinct and survive browser history", async ({
  page,
}) => {
  await login(page);
  const owned = page.getByRole("link", {
    name: "完善工作更新的字段校验",
    exact: true,
  });
  const claimable = page.getByRole("link", {
    name: "优化跨项目筛选与列表可读性",
    exact: true,
  });
  await expect(owned).toBeVisible();
  await page.getByRole("tab", { name: /^可领取/ }).click();
  await expect(claimable).toBeVisible();
  await expect(owned).toHaveCount(0);
  await page.getByRole("tab", { name: /^我负责/ }).click();
  await expect(owned).toBeVisible();
  await expect(claimable).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("tab", { name: /^可领取/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(claimable).toBeVisible();
});

test("mobile work cards expose next actions and a safe progress chooser", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.getByRole("button", { name: "填写今日进展", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "选择要记录进展的工作" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "完善工作更新的字段校验", exact: true }),
  ).toHaveAttribute("href", /action=update/);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("tablet navigation retains an explicit logout action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await login(page);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("登录账号", { exact: true })).toBeVisible();
});

test("tablet work table permits keyboard scrolling to the next action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await login(page);
  const region = page.getByRole("region", {
    name: "工作事项，可横向滚动",
    exact: true,
  });
  await expect(region).toBeVisible();
  await region.focus();
  await region.press("ArrowRight");
  await expect
    .poll(() => region.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  const action = region
    .getByRole("link", { name: "写进展 →", exact: true })
    .first();
  await action.focus();
  await expect(action).toBeInViewport();
});

import { test, expect } from "./fixtures.js";
import { login } from "./helpers.js";

test("report editor and immutable source snapshot can be checked together", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports");
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  await expect(page.getByLabel("日报文本", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "本版本的来源快照", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("日报文本", { exact: true })
    .fill("来源核对时保留的人工草稿");
  await page.getByRole("button", { name: /查看来源/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "返回草稿", exact: true })
    .click();
  await expect(page.getByLabel("日报文本", { exact: true })).toHaveValue(
    "来源核对时保留的人工草稿",
  );
  await expect(
    page.getByRole("button", { name: "保存稿件版本", exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await page
    .getByLabel("日报文本", { exact: true })
    .boundingBox();
  const sources = await page
    .getByRole("heading", { name: "本版本的来源快照", exact: true })
    .boundingBox();
  expect(editor).not.toBeNull();
  expect(sources).not.toBeNull();
  expect(editor!.y).toBeLessThan(sources!.y);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "复制纯文本", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "复制纯文本", exact: true }),
  ).toBeInViewport();
});

test("login introduces the workspace and keeps credentials usable at mobile width", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "每一步推进，都有明确的下一步。" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("登录账号", { exact: true })).toBeVisible();
  await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "登录工作台", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("登录账号", { exact: true }).fill("dev");
  await page.getByLabel("密码", { exact: true }).fill("Synthetic-demo-2026!");
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的工作", exact: true }),
  ).toBeVisible();
});

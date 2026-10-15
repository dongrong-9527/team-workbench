import { test, expect } from "./fixtures.js";
import { login, task } from "./helpers.js";

test("detail action links open once, keep drafts and never submit automatically", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("link", { name: "完善工作更新的字段校验", exact: true })
    .click();
  await expect(page).toHaveURL(/\/task\//);
  const path = new URL(page.url()).pathname;
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/updates"
    )
      writes.push(request.url());
  });
  await page.goto(path + "?action=update");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(path + "$"));
  await page
    .getByLabel("今天实际做了什么", { exact: true })
    .fill("合成导航草稿，尚未提交");
  await dialog
    .getByRole("button", { name: "返回并保留草稿", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "写工作更新", exact: true }),
  ).toBeEnabled();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "写工作更新", exact: true }).click();
  await expect(
    page.getByLabel("今天实际做了什么", { exact: true }),
  ).toHaveValue("合成导航草稿，尚未提交");
  expect(writes).toHaveLength(0);
});

test("claim action links require a permitted unassigned object and open without mutation", async ({
  page,
}) => {
  const url = await task(page, "合成认领入口", "");
  await login(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/actions"))
      writes.push(request.url());
  });
  await page.goto(new URL(url).pathname + "?action=claim");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("认领");
  expect(new URL(page.url()).searchParams.has("action")).toBe(false);
  expect(writes).toHaveLength(0);
});

test("detail ignores claim action links for an already assigned object", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("link", { name: "完善工作更新的字段校验", exact: true })
    .click();
  await expect(page).toHaveURL(/\/task\//);
  await page.goto(new URL(page.url()).pathname + "?action=claim");
  await expect(
    page.getByRole("button", { name: "刷新详情", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

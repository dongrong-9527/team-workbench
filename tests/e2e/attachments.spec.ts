import { test, expect } from "./fixtures.js";
import { login, task, action, submit } from "./helpers.js";
import sharp from "sharp";
test("attachment retry keeps its key, failed upload preserves valid text save, all members can view", async ({
  page,
}) => {
  const url = await task(page, "图片与文字独立保存");
  await login(page);
  await page.goto(url);
  const panel = page.getByRole("region", { name: "图片附件" });
  await expect(panel.getByLabel("选择图片")).toHaveCount(1);
  await expect(panel.getByLabel("选择图片")).toBeHidden();
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#5577aa" },
  })
    .png()
    .toBuffer();
  await panel.getByLabel("选择图片").setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: png,
  });
  const keys: string[] = [];
  await page.route(
    "**/api/objects/task/*/attachments?expectedVersion=*",
    (route) => {
      keys.push(route.request().headers()["idempotency-key"]!);
      return route.abort();
    },
  );
  await panel.getByRole("button", { name: "上传图片", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("网络");
  await panel.getByRole("button", { name: "重试上传图片" }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  await action(page, "写工作更新");
  await page
    .getByLabel("今天实际做了什么", { exact: true })
    .fill("上传失败期间正常保存文字");
  await submit(page, "保存更新");
  await expect(page.getByText("工作更新已保存", { exact: true })).toBeVisible();
  await page.unroute("**/api/objects/task/*/attachments?expectedVersion=*");
  await panel.getByRole("button", { name: "重试上传图片" }).click();
  await expect(panel.getByText("图片已保存", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "查看图片" }).click();
  await expect(panel.getByRole("img")).toBeVisible();
  await expect
    .poll(() =>
      panel
        .getByRole("img")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(8);
  await login(page, "viewer");
  await page.goto(url);
  await expect(panel.getByLabel("选择图片")).toHaveCount(0);
  await panel.getByRole("button", { name: "查看图片" }).click();
  await expect
    .poll(() =>
      panel
        .getByRole("img")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(8);
});
test("malformed successful attachment list is a recoverable panel error, never a render exception", async ({
  page,
}) => {
  await task(page, "附件响应校验");
  await page.route("**/api/objects/task/*/attachments?*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.reload();
  const panel = page.getByRole("region", { name: "图片附件" });
  await expect(panel.getByRole("alert")).toContainText("附件数据无法读取");
  await page.unroute("**/api/objects/task/*/attachments?*");
  await panel.getByRole("button", { name: "重新读取附件" }).click();
  await expect(panel.getByText("暂无图片附件")).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
});

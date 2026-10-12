import { test, expect } from "./fixtures.js";
import { login, task, action, submit } from "./helpers.js";
test("task_10 report source versions editing regeneration clipboard denial and immutable old draft", async ({
  page,
  context,
}) => {
  await login(page, "dev");
  await page.goto("/reports");
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  await expect(page.getByLabel("日报文本")).toBeVisible();
  const old = await page.getByLabel("日报文本").inputValue();
  await page.getByLabel("日报文本").fill(old + "\n人工核对说明：仅为云端演示");
  await page.getByRole("button", { name: "保存稿件版本" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "确认重新生成" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回编辑", exact: true }).click();
  await expect(page.getByLabel("日报文本")).toHaveValue(
    old + "\n人工核对说明：仅为云端演示",
  );
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await page.getByRole("button", { name: "保留旧稿并重新生成" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /V2 人工编辑/ })).toBeVisible();
  await page.getByRole("button", { name: /V2 人工编辑/ }).click();
  await expect(page.getByLabel("日报文本")).toHaveValue(
    old + "\n人工核对说明：仅为云端演示",
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () =>
          Promise.reject(new DOMException("Denied", "NotAllowedError")),
      },
      configurable: true,
    }),
  );
  await page.getByRole("button", { name: "复制纯文本" }).click();
  await expect(page.getByRole("status")).toContainText("浏览器未允许复制");
  await expect(page.getByRole("status")).not.toContainText("已复制");
  await expect(
    page.getByRole("button", { name: "全选文本，手动复制" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /查看来源/ }).click();
  await expect(
    page.getByRole("heading", { name: "本版本的来源快照" }),
  ).toBeVisible();
});
test("task_10 failed report generation retains edits and copy only reports awaited success", async ({
  page,
}) => {
  await login(page, "dev");
  await page.goto("/reports");
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  await expect(page.getByLabel("日报文本")).toBeVisible();
  await page.getByLabel("日报文本").fill("不会丢失的中文核对稿");
  await page.route("**/api/reports", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ error: "Select fewer members or projects" }),
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "确认重新生成" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保留旧稿并重新生成" }).click();
  await expect(page.getByRole("alert")).toContainText("缩小成员");
  await expect(page.getByLabel("日报文本")).toHaveValue("不会丢失的中文核对稿");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () =>
          new Promise<void>((resolve) => setTimeout(resolve, 500)),
      },
      configurable: true,
    }),
  );
  await page.getByRole("button", { name: "复制纯文本" }).click();
  await expect(page.getByText("已复制", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("已复制");
});

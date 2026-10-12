import { test, expect } from "./fixtures.js";
import { login, action, submit } from "./helpers.js";

test("task_10 owner transfer request sends only the accepted fields", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("link", { name: "完善工作更新的字段校验", exact: true })
    .click();
  await action(page, "申请转交");
  await page.getByLabel("操作原因", { exact: true }).fill("需要负责人协调");
  await page.getByLabel("交接说明", { exact: true }).fill("已完成输入校验");
  const response = page.waitForResponse(
    (r) => r.url().includes("/actions") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "确认申请转交", exact: true }).click();
  const r = await response;
  expect(r.status()).toBe(200);
  expect(Object.keys(r.request().postDataJSON()).sort()).toEqual([
    "action",
    "expectedVersion",
    "handoff",
    "reason",
  ]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

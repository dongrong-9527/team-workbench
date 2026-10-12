import { test, expect } from "./fixtures.js";
import { login, action, submit } from "./helpers.js";

test("task_10 acknowledged report generation starts a fresh command and includes new work", async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto("/reports");
  const requests: any[] = [];
  page.on("response", async (r) => {
    if (
      new URL(r.url()).pathname === "/api/reports" &&
      r.request().method() === "POST"
    )
      requests.push({
        key: r.request().headers()["idempotency-key"],
        body: await r.json(),
      });
  });
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("日报草稿已生成");
  const other = await context.newPage();
  await other.goto("/my-work");
  await other
    .getByRole("link", { name: "完善工作更新的字段校验", exact: true })
    .click();
  await action(other, "写工作更新");
  await other
    .getByLabel("今天实际做了什么", { exact: true })
    .fill("完成后再次生成应包含的真实贡献");
  await submit(other, "保存更新");
  await other.close();
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].key).not.toBe(requests[0].key);
  await expect(page.getByLabel("日报文本")).toHaveValue(
    /完成后再次生成应包含的真实贡献/,
  );
  expect(requests[1].body.id).not.toBe(requests[0].body.id);
});
test("task_10 a report draft can be explicitly restored after leaving and reopening", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports");
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("日报草稿已生成");
  await page.getByLabel("日报文本").fill("未保存但可恢复的独立草稿");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "返回全部日报", exact: true }).click();
  await page
    .getByRole("button", { name: /V1 生成稿/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "恢复本地草稿", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("日报文本")).not.toHaveValue(
    "未保存但可恢复的独立草稿",
  );
  await page.getByRole("button", { name: "恢复本地草稿", exact: true }).click();
  await expect(page.getByLabel("日报文本")).toHaveValue(
    "未保存但可恢复的独立草稿",
  );
});
test("task_10 unknown generation response retries the same key while metadata retry never repeats mutation", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports");
  const attempts: { key: string; id: string }[] = [];
  let lose = true;
  await page.route("**/api/reports", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      id: body.id,
    });
    if (lose) {
      lose = false;
      await route.abort();
    } else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("网络");
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("日报草稿已生成");
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  let failMetadata = true;
  await page.route("**/api/reports/*/source-changes", (route) =>
    failMetadata
      ? route.fulfill({
          status: 500,
          json: { error: "Synthetic read failure" },
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("附加信息读取失败");
  await expect(page.getByLabel("日报文本")).not.toHaveValue("");
  expect(attempts).toHaveLength(3);
  expect(attempts[2].key).not.toBe(attempts[1].key);
  failMetadata = false;
  await page
    .getByRole("button", { name: "重试读取日报信息", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(attempts).toHaveLength(3);
});
test("task_10 restored version draft retains its expected version and stays isolated from another version", async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto("/reports");
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/reports" &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  const first = await (await response).json();
  await expect(page.getByRole("status")).toContainText("日报草稿已生成");
  const other = await context.newPage();
  await other.goto("/reports");
  await expect(other.getByLabel("日报文本")).toBeEditable();
  await page.getByLabel("日报文本").fill("V1独立恢复文字");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "返回全部日报", exact: true }).click();
  await other.getByLabel("日报文本").fill("另一页面已保存V2");
  await other
    .getByRole("button", { name: "保存稿件版本", exact: true })
    .click();
  await expect(other.getByRole("status")).toContainText("已保存");
  await page.locator(`[data-report-id="${first.id}"]`).click();
  await page.getByRole("button", { name: "恢复本地草稿", exact: true }).click();
  await expect(page.getByLabel("日报文本")).toHaveValue("V1独立恢复文字");
  const save = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/reports/${first.id}/versions`) &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存稿件版本", exact: true }).click();
  const conflict = await save;
  expect(conflict.status()).toBe(409);
  expect(conflict.request().postDataJSON().expectedVersion).toBe(1);
  await page.getByRole("button", { name: "采用最新版本并重新核对" }).click();
  await expect(page.getByLabel("日报文本")).toHaveValue("V1独立恢复文字");
  await page.getByRole("button", { name: "保存稿件版本", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await page.getByRole("button", { name: /V1 生成稿/ }).click();
  await expect(
    page.getByRole("button", { name: "恢复本地草稿", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "丢弃本地草稿", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "恢复本地草稿", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("日报文本")).not.toHaveValue("V1独立恢复文字");
  await other.close();
});
test("task_10 report draft recovery remains owned by its author after an account change", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports");
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/reports" &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  const r = await (await response).json();
  await expect(page.getByRole("status")).toContainText("日报草稿已生成");
  await page.getByLabel("日报文本").fill("仅陈开发本人可恢复的草稿");
  await login(page, "viewer");
  await page.goto("/reports");
  await page.locator(`[data-report-id="${r.id}"]`).click();
  await expect(page.getByLabel("日报文本")).not.toHaveValue(
    "仅陈开发本人可恢复的草稿",
  );
  await expect(page.getByLabel("日报文本")).not.toBeEditable();
  await expect(
    page.getByRole("button", { name: "恢复本地草稿", exact: true }),
  ).toHaveCount(0);
  await login(page, "dev");
  await page.goto("/reports");
  await page.getByRole("button", { name: "恢复本地草稿", exact: true }).click();
  await expect(page.getByLabel("日报文本")).toHaveValue(
    "仅陈开发本人可恢复的草稿",
  );
});

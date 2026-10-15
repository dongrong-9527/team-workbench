import { test, expect } from "./fixtures.js";
import { login, action, submit } from "./helpers.js";
import type { Page } from "@playwright/test";
import type {
  ReportVersion,
  ReportSourceChanges,
} from "../../packages/contracts/src/index.js";

async function generateReport(page: Page) {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/reports" &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "生成新日报", exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  await expect(page.getByLabel("日报文本", { exact: true })).toBeVisible();
  return (await result.json()) as ReportVersion;
}

test("D27 clipboard denial opens a mobile manual-copy modal and closing or late rejection preserves the author's draft", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports");
  const report = await generateReport(page);
  const draft = "D27 人工核对草稿：复制失败也不能丢失。\n" + report.text;
  const editor = page.getByLabel("日报文本", { exact: true });
  await editor.fill(draft);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          Promise.reject(new DOMException("Denied", "NotAllowedError")),
      },
    }),
  );
  const copy = page.getByRole("button", { name: "复制纯文本", exact: true });
  await copy.click();
  const dialog = page.getByRole("dialog", { name: "复制失败", exact: true });
  await expect(dialog).toBeVisible();
  const manual = dialog.getByLabel("可手动复制的日报文本", { exact: true });
  await expect(manual).toHaveValue(draft);
  await expect(manual).not.toBeEditable();
  await expect(manual).toBeFocused();
  expect(
    await manual.evaluate((el) => {
      const input = el as HTMLTextAreaElement;
      return [input.selectionStart, input.selectionEnd];
    }),
  ).toEqual([0, draft.length]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(copy).toBeFocused();
  await expect(editor).toHaveValue(draft);
  await copy.click();
  await dialog.getByRole("button", { name: "返回草稿", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editor).toHaveValue(draft);

  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((_resolve, reject) => {
            (window as any).__rejectReportCopy = () =>
              reject(new DOMException("Late denial", "NotAllowedError"));
          }),
      },
    }),
  );
  await copy.click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).__rejectReportCopy))
    .toBe("function");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "我的工作", exact: true }).click();
  await expect(page).toHaveURL(/\/my-work$/);
  await page.evaluate(() => (window as any).__rejectReportCopy());
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("浏览器未允许复制", { exact: false }),
  ).toHaveCount(0);
  await login(page, "viewer");
  await page.goto("/reports");
  await page.locator(`[data-report-id="${report.id}"]`).click();
  await expect(editor).not.toHaveValue(draft);
  await expect(editor).not.toBeEditable();
  await login(page, "dev");
  await page.goto("/reports");
  await page.getByRole("button", { name: "恢复本地草稿", exact: true }).click();
  await expect(editor).toHaveValue(draft);
});

test("D29 history modal reads real immutable versions and uses the existing dirty-switch confirmation", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports");
  const original = await generateReport(page);
  const editor = page.getByLabel("日报文本", { exact: true });
  const savedText = "D29 已保存的人工版本\n" + original.text;
  await editor.fill(savedText);
  const savedResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/reports/${original.id}/versions`) &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存稿件版本", exact: true }).click();
  const saved = (await (await savedResponse).json()) as ReportVersion;
  await expect(page.getByRole("status")).toContainText("已保存");
  const draft = savedText + "\n仍未保存的独立核对意见";
  await editor.fill(draft);
  const trigger = page.getByRole("button", { name: "历史版本", exact: true });
  await trigger.click();
  const history = page.getByRole("dialog", {
    name: "日报历史版本",
    exact: true,
  });
  await expect(history).toBeVisible();
  await expect(
    history.locator(`[data-report-id="${original.id}"]`),
  ).toBeVisible();
  await expect(history.locator(`[data-report-id="${saved.id}"]`)).toBeVisible();
  await expect(history).toContainText(String(original.sourceCutoffSeq));
  await page.keyboard.press("Escape");
  await expect(history).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(editor).toHaveValue(draft);

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await history.locator(`[data-report-id="${original.id}"]`).click();
  const confirmation = page.getByRole("dialog", {
    name: "确认切换日报",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "返回编辑", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expect(editor).toHaveValue(draft);
  await trigger.click();
  await history.locator(`[data-report-id="${original.id}"]`).click();
  await confirmation
    .getByRole("button", { name: "保留副本并继续", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor).toHaveValue(original.text);
  const immutable = await page.request.get(`/api/reports/${original.id}`);
  expect(immutable.status()).toBe(200);
  expect(await immutable.json()).toMatchObject({
    text: original.text,
    version: original.version,
    sourceCutoffSeq: original.sourceCutoffSeq,
  });
  await trigger.click();
  await history.locator(`[data-report-id="${saved.id}"]`).click();
  await expect(history).toHaveCount(0);
  await expect(editor).toHaveValue(savedText);
  await page.getByRole("button", { name: "恢复本地草稿", exact: true }).click();
  await expect(editor).toHaveValue(draft);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("D30 source-update modal refreshes real changes, rejects a closed late read and preserves the old draft before regeneration", async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto("/reports");
  const original = await generateReport(page);
  const editor = page.getByLabel("日报文本", { exact: true });
  const draft = "D30 重新生成前必须保留的人工文字\n" + original.text;
  await editor.fill(draft);
  const other = await context.newPage();
  await other.goto("/my-work");
  await other
    .getByRole("link", { name: "完善工作更新的字段校验", exact: true })
    .click();
  await action(other, "写工作更新");
  const contribution = "D30 来源弹窗真实新增贡献";
  await other
    .getByLabel("今天实际做了什么", { exact: true })
    .fill(contribution);
  await submit(other, "保存更新");
  await other.close();
  await page.setViewportSize({ width: 390, height: 844 });

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fulfilled!: () => void;
  const routeCompleted = new Promise<void>((resolve) => {
    fulfilled = resolve;
  });
  let received = false;
  await page.route(
    `**/api/reports/${original.id}/source-changes`,
    async (route) => {
      const response = await route.fetch();
      received = true;
      await gate;
      await route.fulfill({ response });
      fulfilled();
    },
  );
  const trigger = page.getByRole("button", {
    name: "查看来源更新",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: /来源(?:记录有更新|更新核对)/,
  });
  const heldResponse = page.waitForResponse((r) =>
    r.url().endsWith(`/api/reports/${original.id}/source-changes`),
  );
  await expect(dialog).toBeVisible();
  try {
    await expect.poll(() => received).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(editor).toHaveValue(draft);
  } finally {
    release();
    await routeCompleted;
    await (await heldResponse).finished();
  }
  await page.unroute(`**/api/reports/${original.id}/source-changes`);
  await expect(dialog).toHaveCount(0);
  const changesResponse = page.waitForResponse((r) =>
    r.url().endsWith(`/api/reports/${original.id}/source-changes`),
  );
  await trigger.click();
  const changes = (await (await changesResponse).json()) as ReportSourceChanges;
  expect(changes.changed).toBe(true);
  expect(changes.added.length + changes.updated.length).toBeGreaterThan(0);
  await expect(
    page.getByRole("dialog", { name: "来源记录有更新", exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText(`新增 ${changes.added.length}`);
  await expect(dialog).toContainText(`更新 ${changes.updated.length}`);
  await expect(dialog).toContainText(String(original.sourceCutoffSeq));
  await expect(editor).toHaveValue(draft);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await dialog
    .getByRole("button", { name: "保留旧稿并重新生成", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "确认重新生成",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "返回编辑", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expect(editor).toHaveValue(draft);
  const immutable = await page.request.get(`/api/reports/${original.id}`);
  expect(await immutable.json()).toMatchObject({
    text: original.text,
    version: 1,
  });

  await trigger.click();
  await dialog
    .getByRole("button", { name: "保留旧稿并重新生成", exact: true })
    .click();
  const regeneratedResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/reports" &&
      r.request().method() === "POST",
  );
  const savedResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/reports/${original.id}/versions`) &&
      r.request().method() === "POST",
  );
  await confirmation
    .getByRole("button", { name: "保留旧稿并重新生成", exact: true })
    .click();
  const preserved = (await (await savedResponse).json()) as ReportVersion;
  const regenerated = (await (
    await regeneratedResponse
  ).json()) as ReportVersion;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(preserved.text).toBe(draft);
  expect(regenerated.text).toContain(contribution);
  expect(regenerated.sourceCutoffSeq).toBeGreaterThan(original.sourceCutoffSeq);
  expect(regenerated.id).not.toBe(original.id);
  const oldVersion = await page.request.get(`/api/reports/${original.id}`);
  expect(await oldVersion.json()).toMatchObject({
    text: original.text,
    version: 1,
  });
  await page.locator(`[data-report-id="${preserved.id}"]`).click();
  await expect(editor).toHaveValue(draft);
});

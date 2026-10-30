import { test, expect } from "./fixtures.js";
import { login } from "./helpers.js";
import { api } from "./audit-helpers.js";

test("F09 report source shows frozen plans obstacles and actual entry time for another author", async ({ page }, info) => {
  await login(page, "product");
  const task = await api(page, "POST", "/api/tasks", { projectId: "p1", title: "合成F09来源核对", kind: "backend", definitionOfDone: "核对原文", priority: "medium", ownerId: "dev" });
  await login(page, "dev");
  const update = await api(page, "POST", "/api/updates", { target: { kind: "task", id: task.id }, workDate: "2026-10-18", contributionType: "development", done: "合成F09原始实际贡献", next: "原始计划\n保留原行", obstacle: "原始协助需求" });
  const report = await api(page, "POST", "/api/reports", { date: "2026-10-18", timeZone: "Asia/Shanghai", memberIds: ["dev"], projectIds: ["p1"] });
  await api(page, "POST", "/api/updates", { target: { kind: "task", id: task.id }, workDate: update.workDate, contributionType: update.contributionType,
    done: update.done, next: "后来更正的计划", obstacle: "后来更正的障碍", correctsId: update.id, expectedVersion: update.version, reason: "后续事实" });
  await login(page, "product");
  await page.goto("/reports");
  await page.locator(`[data-report-id="${report.id}"]`).click();
  const source = page.locator(".source-record").filter({ hasText: "合成F09原始实际贡献" });
  await expect(source.getByText("补记", { exact: true })).toBeVisible();
  await expect(source).toContainText("原始协助需求");
  expect(await source.locator('[data-source-field="next"]').textContent()).toBe("原始计划\n保留原行");
  await expect(source.locator("time")).toHaveAttribute("datetime", update.recordedAt);
  await expect(source).not.toContainText("后来更正的计划");
  await page.screenshot({ path: info.outputPath("F09-frozen-source-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(source).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("F09-frozen-source-mobile.png"), fullPage: true });
  expect((await api(page, "GET", `/api/reports/${report.id}`)).text).toBe(report.text);
});

import { test, expect } from "./fixtures.js";
import { login, selectOption, checks, submit } from "./helpers.js";
import { api, detail, pendingAcceptance, requirement } from "./audit-helpers.js";

test("F12 accepted requirement offers no unsupported cancel action", async ({ page }) => {
  let r = await pendingAcceptance(page, "合成F12已验收取消边界");
  r = await api(page, "POST", `/api/requirements/${r.id}/acceptance`, { expectedVersion: r.version, revision: r.revision,
    targetVersion: "build-1", decision: "pass", criteria: [{ id: "a", passed: true }] });
  await api(page, "POST", `/api/requirements/${r.id}/actions`, { action: "cancel", expectedVersion: r.version, reason: "Synthetic unsupported action", taskDisposition: [] }, 409);
  await detail(page, "requirement", r);
  await expect(page.getByRole("button", { name: "取消工作", exact: true })).toHaveCount(0);
});

for (const cancelled of [false, true]) test(`F12 ${cancelled ? "cancelled" : "unconfirmed scope"} requirement does not offer executable testing`, async ({ page }) => {
  await login(page, "product");
  let r = await requirement(page, `合成F12测试边界${cancelled}`);
  if (cancelled) r = await api(page, "POST", `/api/requirements/${r.id}/actions`, { action: "cancel", expectedVersion: r.version, reason: "Synthetic cancellation", taskDisposition: [] });
  await login(page, "tester");
  await api(page, "POST", "/api/tests", { target: { kind: "requirement", id: r.id }, expectedVersion: r.version, revision: r.revision,
    targetVersion: "build-1", environment: "Synthetic", checks: [{ checkId: "a", result: "pass" }] }, 422);
  await detail(page, "requirement", r);
  await expect(page.getByRole("button", { name: "新增测试记录", exact: true })).toHaveCount(0);
});

test("F12 draft-parent task is explained and excluded from claimable work", async ({ page }) => {
  await login(page, "product");
  const r = await requirement(page, "合成F12未确认父需求");
  const task = await api(page, "POST", "/api/tasks", { projectId: "p1", requirementId: r.id, title: "合成F12尚不可领取任务",
    kind: "backend", definitionOfDone: "Synthetic standard", priority: "medium" });
  await login(page, "dev");
  await api(page, "POST", `/api/tasks/${task.id}/actions`, { action: "claim", expectedVersion: task.version }, 422);
  await detail(page, "task", task);
  await expect(page.getByRole("button", { name: "认领", exact: true })).toHaveCount(0);
  await expect(page.getByText(/需求尚不可执行/).first()).toBeVisible();
  await page.goto("/my-work?workTab=claim");
  await expect(page.getByRole("heading", { name: "我的工作", exact: true })).toBeVisible();
  await expect(page.locator(".work-list").getByRole("link", { name: task.title, exact: true })).toHaveCount(0);
});

test("F01 regression retains a return-only product acceptance entry", async ({ page }) => {
  const r = await pendingAcceptance(page, "合成F01验收回退后的正式退回");
  const bug = await api(page, "POST", "/api/bugs", { projectId: "p1", requirementId: r.id, title: "合成F01返工差异",
    role: "backend", expected: "符合约定", actual: "存在差异", reproduction: "Synthetic", environment: "Synthetic", severity: "critical", priority: "high" });
  const current = await api(page, "GET", `/api/requirements/${r.id}`);
  expect(current.state).toBe("active");
  await detail(page, "requirement", current);
  await page.getByRole("button", { name: "记录验收退回", exact: true }).click();
  const form = page.getByRole("dialog", { name: "记录验收退回", exact: true });
  await expect(form.getByRole("combobox", { name: "验收结论", exact: true })).toBeDisabled();
  await form.getByLabel("检查说明", { exact: true }).fill("业务结果实际有差异");
  await form.getByLabel("操作原因", { exact: true }).fill("本轮退回并关联返工");
  await form.getByLabel(bug.title, { exact: true }).check();
  await form.getByRole("button", { name: "确认记录验收退回", exact: true }).click();
  await page.getByRole("dialog", { name: "退回产品验收", exact: true }).getByRole("button", { name: "确认退回", exact: true }).click();
  await expect(form).toHaveCount(0);
  const history = await api(page, "GET", `/api/requirements/${r.id}/acceptance?limit=100&afterSeq=0`);
  expect(history.items.at(-1)).toMatchObject({ decision: "return", bugIds: [bug.id] });
  expect((await api(page, "GET", `/api/requirements/${r.id}`)).state).toBe("active");
});

test("F02 other frontend task gives its designated tester a real check action", async ({ page }) => {
  await login(page, "product");
  let task = await api(page, "POST", "/api/tasks", { projectId: "p1", title: "合成F02其他前端工作", kind: "other", role: "frontend",
    definitionOfDone: "实际检查", priority: "medium", ownerId: "dev2", reviewerId: "tester" });
  await login(page, "dev2");
  task = await api(page, "POST", `/api/tasks/${task.id}/actions`, { action: "start", expectedVersion: task.version });
  task = await api(page, "POST", `/api/tasks/${task.id}/actions`, { action: "submit", expectedVersion: task.version,
    evidence: { done: "完成实际工作", selfCheck: "自查", environment: "Synthetic", targetVersion: "build-1" } });
  await login(page, "tester");
  await detail(page, "task", task);
  await page.getByRole("button", { name: "检查通过", exact: true }).click();
  await checks(page);
  await submit(page, "确认检查通过");
  expect((await api(page, "GET", `/api/tasks/${task.id}`)).state).toBe("done");
});

test("F12 a legal empty-task requirement cancellation submits without array validation errors", async ({ page }) => {
  await login(page, "product");
  const r = await requirement(page, "合成F12无子任务取消");
  await detail(page, "requirement", r);
  await page.getByRole("button", { name: "取消工作", exact: true }).click();
  await page.getByLabel("操作原因", { exact: true }).fill("停止未开始的草稿");
  await submit(page, "确认取消工作");
  expect((await api(page, "GET", `/api/requirements/${r.id}`)).state).toBe("cancelled");
});

test("F08 failing test can register a contextual Bug in another page and retain entered evidence", async ({ page }) => {
  test.setTimeout(70000);
  await login(page, "product");
  let task = await api(page, "POST", "/api/tasks", { projectId: "p1", title: "合成F08测试登记Bug", kind: "backend", definitionOfDone: "实际检查", priority: "medium", ownerId: "dev", reviewerId: "tester" });
  await login(page, "dev");
  task = await api(page, "POST", `/api/tasks/${task.id}/actions`, { action: "start", expectedVersion: task.version });
  task = await api(page, "POST", `/api/tasks/${task.id}/actions`, { action: "submit", expectedVersion: task.version, evidence: { done: "实际完成", selfCheck: "自查", environment: "Synthetic", targetVersion: "build-1" } });
  await login(page, "tester");
  await detail(page, "task", task);
  await page.getByRole("button", { name: "检查退回", exact: true }).click();
  await checks(page, "fail");
  await page.getByLabel("检查说明", { exact: true }).fill("实际发现失败，保留这段证据");
  const popupEvent = page.waitForEvent("popup");
  await page.getByRole("link", { name: "在新页登记 Bug", exact: true }).click();
  const popup = await popupEvent;
  await expect(popup.getByRole("dialog", { name: "新建Bug", exact: true })).toBeVisible();
  await expect(popup.getByLabel("关联任务编号", { exact: true })).toHaveValue(task.id);
  await popup.getByLabel("标题", { exact: true }).fill("合成F08现场登记差异");
  await submit(popup, "确认新建Bug");
  await expect(popup).toHaveURL(/\/bug\//);
  const bugId = new URL(popup.url()).pathname.split("/").at(-1)!;
  await popup.close();
  await expect(page.getByLabel("检查说明", { exact: true })).toHaveValue("实际发现失败，保留这段证据");
  await page.getByRole("button", { name: "刷新 Bug 列表", exact: true }).click();
  await selectOption(page, "关联 Bug", { value: bugId, label: `合成F08现场登记差异 · ${bugId.slice(0, 8)}` });
  await submit(page, "确认检查退回");
  const records = await api(page, "GET", `/api/tests?kind=task&id=${task.id}&limit=100&afterSeq=0`);
  expect(records.items.at(-1).bugId).toBe(bugId);
  expect((await api(page, "GET", `/api/bugs/${bugId}`)).taskId).toBe(task.id);
});

test("F07 canonical recheck is shown as evidence at desktop and phone while the impact record remains", async ({ page }, info) => {
  test.setTimeout(70000);
  let r = await pendingAcceptance(page, "合成F07修订重检展示");
  let task = await api(page, "POST", "/api/tasks", { projectId: "p1", requirementId: r.id, title: "合成F07受影响工作", kind: "backend", definitionOfDone: "实际重检", priority: "medium", ownerId: "dev", reviewerId: "tester" });
  for (const revision of [1, 2]) {
    await login(page, "dev");
    task = await api(page, "GET", `/api/tasks/${task.id}`);
    if (task.state === "pending") task = await api(page, "POST", `/api/tasks/${task.id}/actions`, { action: "start", expectedVersion: task.version });
    task = await api(page, "POST", `/api/tasks/${task.id}/actions`, { action: "submit", expectedVersion: task.version, evidence: { done: `完成R${revision}实际工作`, selfCheck: "自查", environment: "Synthetic", targetVersion: `build-${revision}` } });
    await login(page, "tester");
    task = await api(page, "POST", `/api/tasks/${task.id}/actions`, { action: "checkPass", expectedVersion: task.version, test: { target: { kind: "task", id: task.id }, revision, targetVersion: `build-${revision}`, environment: "Synthetic", checks: [{ checkId: "completion", result: "pass" }] } });
    if (revision === 1) {
      await login(page, "product");
      r = await api(page, "GET", `/api/requirements/${r.id}`);
      r = await api(page, "POST", `/api/requirements/${r.id}/actions`, { action: "revise", expectedVersion: r.version, kind: "behavior", reason: "需要实际重检", impactConfirmed: true, affectedTaskIds: [task.id], affectedCheckIds: ["a"] });
      r = await api(page, "POST", `/api/requirements/${r.id}/actions`, { action: "makeReady", expectedVersion: r.version, source: { description: "Synthetic source", status: "checked", checkedAt: new Date().toISOString() } });
    }
  }
  await login(page, "product");
  await detail(page, "task", task);
  await expect(page.getByText(/R2 修订影响已于 R2 \/ build-2 重检完成/)).toBeVisible();
  const view = await api(page, "GET", `/api/tasks/${task.id}`);
  expect(view.pendingChange).toMatchObject({ requirementId: r.id, revision: 2 });
  expect(view.revisionImpact.needsAttention).toBe(false);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/projects/p1?tab=tasks&q=${encodeURIComponent(task.title)}`);
    await expect(page.locator(".work-list").getByText("R2影响已重检", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`F07-rechecked-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

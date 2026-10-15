import type { Page, Locator } from "@playwright/test";
import { test, expect } from "./fixtures.js";
import { login, evidence, checks, expectSelectedOption } from "./helpers.js";

async function api(page: Page, path: string, body: Record<string, unknown>) {
  const result = await page.evaluate(
    async ({ path, body }) => {
      const session = await (await fetch("/api/auth/session")).json();
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": session.csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, body },
  );
  expect(result.status, path).toBe(200);
  return result.body;
}

async function expectResponsiveDrawer(page: Page, dialog: Locator) {
  await expect(
    page.locator(".ant-drawer-right .mutation-content"),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox();
        return box
          ? {
              right: Math.round(box.x + box.width),
              width: Math.round(box.width),
            }
          : null;
      })
      .toEqual({ right: width, width: Math.min(540, width) });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      dialog.getByRole("button", { name: "返回并保留草稿", exact: true }),
    ).toBeVisible();
  }
}

for (const kind of ["task", "bug"] as const) {
  test(`${kind} submission and independent review use responsive right drawers and retain drafts`, async ({
    page,
  }) => {
    const bug = kind === "bug";
    const collection = bug ? "bugs" : "tasks";
    await login(page, "product");
    let object = await api(
      page,
      `/api/${collection}`,
      bug
        ? {
            projectId: "p1",
            title: "合成抽屉：Bug修复与独立验证",
            role: "backend",
            expected: "异常输入显示提示",
            actual: "异常输入没有提示",
            reproduction: "清空字段后提交",
            environment: "合成浏览器环境",
            severity: "normal",
            priority: "medium",
          }
        : {
            projectId: "p1",
            title: "合成抽屉：任务提交与独立检查",
            kind: "backend",
            definitionOfDone: "正常与异常输入均按约定处理",
            priority: "medium",
            ownerId: "dev",
            reviewerId: "tester",
          },
    );
    const path = `/api/${collection}/${object.id}/actions`;
    if (bug)
      object = await api(page, path, {
        action: "confirm",
        expectedVersion: object.version,
        reason: "合成缺陷已复现",
      });
    await login(page, "dev");
    if (bug)
      object = await api(page, path, {
        action: "claim",
        expectedVersion: object.version,
      });
    object = await api(page, path, {
      action: "start",
      expectedVersion: object.version,
    });
    await page.goto(`/${kind}/${object.id}`);
    const submitLabel = bug ? "提交修复" : "提交检查";
    const trigger = page.getByRole("button", {
      name: submitLabel,
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expectResponsiveDrawer(page, dialog);
    await evidence(page, bug);
    await dialog
      .getByRole("button", { name: "返回并保留草稿", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(
      dialog.getByLabel(bug ? "修复内容" : "完成内容", { exact: true }),
    ).toHaveValue(bug ? "修正遗漏校验" : "已完成字段校验");
    const submitted = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path &&
        response.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: `确认${submitLabel}`, exact: true })
      .click();
    const submission = await submitted;
    expect(submission.status()).toBe(200);
    expect(submission.request().postDataJSON()).toMatchObject({
      action: "submit",
      expectedVersion: object.version,
      evidence: { targetVersion: "build-1" },
    });
    expect(await submission.json()).toMatchObject({
      state: bug ? "pending_verify" : "pending_check",
    });
    await expect(dialog).toHaveCount(0);

    await login(page, "tester");
    await page.goto(`/${kind}/${object.id}`);
    const reviewLabel = bug ? "验证通过" : "检查通过";
    const reviewTrigger = page.getByRole("button", {
      name: reviewLabel,
      exact: true,
    });
    await reviewTrigger.click();
    await expectResponsiveDrawer(page, dialog);
    await checks(page);
    await dialog
      .getByRole("button", { name: "返回并保留草稿", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await reviewTrigger.click();
    await expectSelectedOption(page, "条目结果", {
      value: "pass",
      label: "通过",
    });
    const reviewed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path &&
        response.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: `确认${reviewLabel}`, exact: true })
      .click();
    const review = await reviewed;
    expect(review.status()).toBe(200);
    expect(review.request().postDataJSON()).toMatchObject({
      action: bug ? "verifyPass" : "checkPass",
      test: { target: { kind, id: object.id }, targetVersion: "build-1" },
    });
    expect(await review.json()).toMatchObject({
      state: bug ? "closed" : "done",
    });
    await expect(dialog).toHaveCount(0);
  });
}

test("requirement task splitting uses a responsive drawer and preserves its initial relationship", async ({
  page,
}) => {
  await login(page, "product");
  let requirement = await api(page, "/api/requirements", {
    projectId: "p1",
    title: "合成抽屉：需求拆分任务",
    source: { description: "合成范围，产品人工核对" },
    description: "把明确的验收范围拆为可执行工作",
    acceptorId: "product",
    priority: "medium",
    criteria: [
      { id: "first", text: "拆分工作符合当前需求范围", required: true },
    ],
  });
  const path = `/api/requirements/${requirement.id}/actions`;
  requirement = await api(page, path, {
    action: "refine",
    expectedVersion: requirement.version,
    description: "已明确拆分工作的验收范围",
  });
  requirement = await api(page, path, {
    action: "makeReady",
    expectedVersion: requirement.version,
    source: {
      description: "合成范围，产品人工核对",
      status: "checked",
      checkedAt: new Date().toISOString(),
    },
  });
  await page.goto(`/requirement/${requirement.id}`);
  const trigger = page.getByRole("button", { name: "拆分任务", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expectResponsiveDrawer(page, dialog);
  await expect(dialog.getByLabel("关联需求编号", { exact: true })).toHaveValue(
    requirement.id,
  );
  await dialog.getByLabel("标题", { exact: true }).fill("合成拆分工作的草稿");
  await dialog
    .getByLabel("完成标准", { exact: true })
    .fill("按需求条目完成实际执行工作");
  await dialog
    .getByRole("button", { name: "返回并保留草稿", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await expect(dialog.getByLabel("标题", { exact: true })).toHaveValue(
    "合成拆分工作的草稿",
  );
  await expect(dialog.getByLabel("关联需求编号", { exact: true })).toHaveValue(
    requirement.id,
  );
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/tasks" &&
      response.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "确认新建任务", exact: true })
    .click();
  const response = await saved;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toMatchObject({
    requirementId: requirement.id,
  });
  expect(await response.json()).toMatchObject({
    requirementId: requirement.id,
    state: "pending",
  });
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(`/requirement/${requirement.id}`);
});

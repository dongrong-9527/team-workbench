import { test, expect } from "./fixtures.js";
import { login } from "./helpers.js";
import type { Page } from "@playwright/test";

async function api(
  page: Page,
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  const result = await page.evaluate(
    async ({ method, path, body }) => {
      const session = await (await fetch("/api/auth/session")).json();
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": session.csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    },
    { method, path, body },
  );
  expect(result.status, `${method} ${path}`).toBe(200);
  return result.body;
}

async function executable(page: Page, title: string, allPassed = true) {
  await login(page, "product");
  let r = await api(page, "POST", "/api/requirements", {
    projectId: "p1",
    title,
    description: "合成权威验收条件回归",
    source: { description: "产品人工核对来源" },
    acceptorId: "product",
    priority: "medium",
    criteria: [
      { id: "first", text: "第一个行为", required: true },
      { id: "second", text: "第二个行为", required: true },
    ],
  });
  const path = `/api/requirements/${r.id}/actions`;
  r = await api(page, "POST", path, {
    action: "refine",
    expectedVersion: r.version,
    description: "明确行为范围",
  });
  r = await api(page, "POST", path, {
    action: "makeReady",
    expectedVersion: r.version,
    source: {
      description: "产品人工核对来源",
      status: "checked",
      checkedAt: new Date().toISOString(),
    },
  });
  r = await api(page, "POST", path, {
    action: "start",
    expectedVersion: r.version,
    reason: "开始实际工作",
  });
  await login(page, "tester");
  await api(page, "POST", "/api/tests", {
    target: { kind: "requirement", id: r.id },
    expectedVersion: r.version,
    revision: r.revision,
    targetVersion: "readiness-build",
    environment: "合成检查环境",
    checks: [
      { checkId: "first", result: "pass" },
      {
        checkId: "second",
        result: allPassed ? "pass" : "fail",
        ...(!allPassed ? { note: "第二个行为尚未通过" } : {}),
      },
    ],
  });
  await login(page, "product");
  return api(page, "GET", `/api/requirements/${r.id}`);
}

test("blocked readiness shows the real 3/5 gate and linked critical Bug at desktop and mobile widths", async ({
  page,
}) => {
  const r = await executable(page, "合成受阻验收条件", false);
  const bug = await api(page, "POST", "/api/bugs", {
    projectId: "p1",
    requirementId: r.id,
    title: "合成严重缺陷阻塞验收",
    role: "backend",
    expected: "第二个行为正确",
    actual: "第二个行为失败",
    reproduction: "输入异常值",
    environment: "合成环境",
    severity: "critical",
    priority: "high",
  });
  await login(page, "viewer");
  await page.goto(`/requirement/${r.id}`);
  await page.getByRole("button", { name: /^产品验收（/ }).click();
  await page
    .getByLabel("验收目标版本", { exact: true })
    .fill("readiness-build");
  const conditions = page.getByRole("region", {
    name: "验收条件",
    exact: true,
  });
  await expect(
    conditions.getByText("3 / 5 满足", { exact: true }),
  ).toBeVisible();
  await expect(conditions).toContainText("当前修订必测项未全部通过");
  await expect(conditions).toContainText("严重 Bug 尚未闭环，不能豁免");
  await expect(conditions.locator(`a[href="/bug/${bug.id}"]`)).toContainText(
    bug.title,
  );
  await expect(
    page.getByRole("button", { name: "产品验收", exact: true }),
  ).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(conditions).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("acceptance page uses server 5/5 and disables pass for a build without matching evidence", async ({
  page,
}) => {
  let r = await executable(page, "合成就绪产品验收");
  r = await api(page, "POST", `/api/requirements/${r.id}/submit-acceptance`, {
    expectedVersion: r.version,
    revision: r.revision,
    targetVersion: "readiness-build",
  });
  await page.goto(`/requirement/${r.id}`);
  await page.getByRole("button", { name: "产品验收", exact: true }).click();
  const form = page.getByRole("dialog", { name: "产品验收", exact: true });
  const conditions = form.getByRole("region", {
    name: "验收条件",
    exact: true,
  });
  const confirm = form.getByRole("button", {
    name: "确认产品验收",
    exact: true,
  });
  await expect(
    conditions.getByText("5 / 5 满足", { exact: true }),
  ).toBeVisible();
  await form.getByLabel("目标版本", { exact: true }).fill("unverified-build");
  await expect(
    conditions.getByText("4 / 5 满足", { exact: true }),
  ).toBeVisible();
  await expect(confirm).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(conditions).toBeVisible();
  await form.getByLabel("目标版本", { exact: true }).fill("readiness-build");
  await expect(
    conditions.getByText("5 / 5 满足", { exact: true }),
  ).toBeVisible();
  for (const control of await form
    .getByRole("combobox", { name: "条目结果", exact: true })
    .all()) {
    await control.scrollIntoViewIfNeeded();
    await control.focus();
    await control.press("ArrowDown");
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText("通过", { exact: true })
      .click();
    await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
  }
  await form
    .getByLabel("操作原因", { exact: true })
    .fill("指定产品独立核对两个当前业务条目");
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/requirements/${r.id}/acceptance` &&
      response.request().method() === "POST",
  );
  await confirm.click();
  const response = await saved;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ state: "accepted" });
  await expect(form).toHaveCount(0);
});

test("readiness rejects late build results and clears a stale green result on read failure", async ({
  page,
}) => {
  const r = await executable(page, "合成门禁读取顺序");
  await page.goto(`/requirement/${r.id}`);
  await page.getByRole("button", { name: /^产品验收（/ }).click();
  const target = page.getByLabel("验收目标版本", { exact: true });
  const conditions = page.getByRole("region", {
    name: "验收条件",
    exact: true,
  });
  await target.fill("readiness-build");
  await expect(
    conditions.getByText("5 / 5 满足", { exact: true }),
  ).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fetched!: () => void;
  const observed = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  const delayed = `**/api/requirements/${r.id}/acceptance-readiness?targetVersion=old-build`;
  await page.route(delayed, async (route) => {
    const response = await route.fetch();
    fetched();
    await held;
    await route.fulfill({ response });
  });
  await target.fill("old-build");
  await observed;
  await target.fill("readiness-build");
  await expect(
    conditions.getByText("5 / 5 满足", { exact: true }),
  ).toBeVisible();
  const completed = page.waitForResponse(
    (response) =>
      new URL(response.url()).searchParams.get("targetVersion") ===
        "old-build" &&
      new URL(response.url()).pathname.endsWith("/acceptance-readiness"),
  );
  release();
  await completed;
  await page.unroute(delayed);
  await expect(target).toHaveValue("readiness-build");
  await expect(
    conditions.getByText("5 / 5 满足", { exact: true }),
  ).toBeVisible();
  const failed = `**/api/requirements/${r.id}/acceptance-readiness?targetVersion=failed-read`;
  await page.route(failed, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic unavailable read" }),
    }),
  );
  await target.fill("failed-read");
  await expect(conditions.getByRole("alert")).toBeVisible();
  await expect(conditions.getByText("5 / 5 满足", { exact: true })).toHaveCount(
    0,
  );
  await page.unroute(failed);
  await conditions
    .getByRole("button", { name: "刷新验收条件", exact: true })
    .click();
  await expect(
    conditions.getByText("4 / 5 满足", { exact: true }),
  ).toBeVisible();
});

test("a stale acceptance draft explicitly adopts the current revision and preserves its original notes", async ({
  page,
  browser,
  observeContext,
}) => {
  let r = await executable(page, "合成新修订验收草稿恢复");
  r = await api(page, "POST", `/api/requirements/${r.id}/submit-acceptance`, {
    expectedVersion: r.version,
    revision: r.revision,
    targetVersion: "readiness-build",
  });
  await page.goto(`/requirement/${r.id}`);
  await page.getByRole("button", { name: "产品验收", exact: true }).click();
  const form = page.getByRole("dialog", { name: "产品验收", exact: true });
  await form
    .getByLabel("操作原因", { exact: true })
    .fill("保留我已经填写的验收说明");
  await form
    .getByLabel("检查说明", { exact: true })
    .first()
    .fill("旧修订的实际人工核对说明");
  const otherContext = await browser.newContext({
    baseURL: "https://127.0.0.1:4173",
    ignoreHTTPSErrors: true,
  });
  await observeContext(otherContext);
  const other = await otherContext.newPage();
  try {
    await login(other, "product");
    r = await api(other, "POST", `/api/requirements/${r.id}/actions`, {
      action: "revise",
      kind: "behavior",
      impactConfirmed: true,
      expectedVersion: r.version,
      reason: "明确合成修订影响",
      affectedTaskIds: [],
      affectedCheckIds: ["first"],
      criteria: [
        { id: "first", text: "第一个行为的新范围", required: true },
        { id: "second", text: "第二个行为", required: true },
      ],
    });
    r = await api(other, "POST", `/api/requirements/${r.id}/actions`, {
      action: "makeReady",
      expectedVersion: r.version,
      source: {
        description: "人工重新核对修订来源",
        status: "checked",
        checkedAt: new Date().toISOString(),
      },
    });
    r = await api(other, "POST", `/api/requirements/${r.id}/actions`, {
      action: "start",
      expectedVersion: r.version,
      reason: "执行当前修订",
    });
    await login(other, "tester");
    await api(other, "POST", "/api/tests", {
      target: { kind: "requirement", id: r.id },
      expectedVersion: r.version,
      revision: r.revision,
      targetVersion: "readiness-build",
      environment: "当前修订合成测试",
      checks: [
        { checkId: "first", result: "pass" },
        { checkId: "second", result: "pass" },
      ],
    });
    await login(other, "product");
    r = await api(other, "GET", `/api/requirements/${r.id}`);
    r = await api(
      other,
      "POST",
      `/api/requirements/${r.id}/submit-acceptance`,
      {
        expectedVersion: r.version,
        revision: r.revision,
        targetVersion: "readiness-build",
      },
    );
    await form
      .getByRole("button", { name: "刷新验收条件", exact: true })
      .click();
    await expect(
      form.getByRole("heading", {
        name: "版本冲突：请核对最新记录",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      form.getByRole("button", { name: "确认产品验收", exact: true }),
    ).toBeDisabled();
    await form
      .getByRole("button", { name: "采用最新版本并重新核对", exact: true })
      .click();
    await expect(form.getByLabel("需求修订", { exact: true })).toHaveValue(
      "R2",
    );
    await expect(
      form
        .getByRole("region", { name: "验收条件", exact: true })
        .getByText("5 / 5 满足", { exact: true }),
    ).toBeVisible();
    await expect(form.getByLabel("操作原因", { exact: true })).toHaveValue(
      "保留我已经填写的验收说明",
    );
    await expect(
      form.getByLabel("检查说明", { exact: true }).first(),
    ).toHaveValue("旧修订的实际人工核对说明");
    await form
      .getByText("原修订核对记录（仅供参考，不会提交）", { exact: true })
      .click();
    await expect(form.locator(".prior-acceptance-notes")).toContainText(
      "旧修订的实际人工核对说明",
    );
    for (const control of await form
      .getByRole("combobox", { name: "条目结果", exact: true })
      .all()) {
      await control.scrollIntoViewIfNeeded();
      await control.focus();
      await control.press("ArrowDown");
      await page
        .locator(".ant-select-dropdown:visible")
        .getByText("通过", { exact: true })
        .click();
      await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
    }
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/requirements/${r.id}/acceptance` &&
        response.request().method() === "POST",
    );
    await form
      .getByRole("button", { name: "确认产品验收", exact: true })
      .click();
    const response = await saved;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({
      expectedVersion: r.version,
      revision: 2,
    });
    expect(await response.json()).toMatchObject({
      state: "accepted",
      revision: 2,
    });
  } finally {
    await otherContext.close();
  }
});

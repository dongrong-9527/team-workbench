import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures.js";
import { login, selectOption } from "./helpers.js";

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

test("tester participation keeps a partially tested requirement in the review tab and count", async ({
  page,
}) => {
  // A dedicated real project makes the expected tab count independent of other
  // fixture records, pagination and mutations made by earlier browser tests.
  await login(page, "admin");
  let project = await api(page, "POST", "/api/projects", {
    name: `合成测试参与后持续待检查 ${Date.now()}`,
    description: "真实角色、需求状态与逐项测试证据的回归用例",
  });
  for (const [memberId, role] of [
    ["product", "product"],
    ["tester", "test"],
  ]) {
    project = await api(page, "PUT", `/api/projects/${project.id}/roles`, {
      expectedVersion: project.version,
      memberId,
      roles: [role],
      leads: [],
    });
  }

  await login(page, "product");
  const title = "合成需求：逐项测试完成前保留检查待办";
  let requirement = await api(page, "POST", "/api/requirements", {
    projectId: project.id,
    title,
    source: { description: "合成需求原文，由产品人工核对" },
    description: "两个必需验收条目分别记录，部分通过仍需继续测试。",
    acceptorId: "product",
    priority: "medium",
    criteria: [
      { id: "first", text: "第一个行为正确", required: true },
      { id: "remaining", text: "第二个行为正确", required: true },
    ],
  });
  const actionsPath = `/api/requirements/${requirement.id}/actions`;
  requirement = await api(page, "POST", actionsPath, {
    action: "refine",
    expectedVersion: requirement.version,
    description: "已明确两个必需行为的检查范围。",
  });
  requirement = await api(page, "POST", actionsPath, {
    action: "makeReady",
    expectedVersion: requirement.version,
    source: {
      description: "合成需求原文，由产品人工核对",
      status: "checked",
      checkedAt: new Date().toISOString(),
    },
  });
  requirement = await api(page, "POST", actionsPath, {
    action: "start",
    expectedVersion: requirement.version,
    reason: "开始真实需求执行与逐项测试",
  });
  expect(requirement).toMatchObject({ state: "active", scopeConfirmed: true });

  await login(page, "tester");
  await selectOption(page, "全局项目筛选", {
    value: project.id,
    label: project.name,
  });
  const reviewTab = page.getByRole("tab", { name: /^待我检查/ });
  await reviewTab.click();
  const work = page.getByRole("link", { name: title, exact: true });
  await expect(reviewTab).toHaveText(/^待我检查\s*1$/);
  await expect(work).toBeVisible();

  const record = await api(page, "POST", "/api/tests", {
    target: { kind: "requirement", id: requirement.id },
    expectedVersion: requirement.version,
    revision: requirement.revision,
    targetVersion: "synthetic-partial-build",
    environment: "合成浏览器回归环境",
    checks: [{ checkId: "first", result: "pass" }],
  });
  expect(record).toMatchObject({
    testerId: "tester",
    target: { kind: "requirement", id: requirement.id },
  });

  const coverage = await api(
    page,
    "GET",
    `/api/tests/coverage?kind=requirement&id=${requirement.id}&revision=${requirement.revision}&targetVersion=synthetic-partial-build`,
  );
  expect(coverage.passed).toBe(false);
  expect(coverage.checks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ checkId: "first", result: "pass" }),
      expect.objectContaining({ checkId: "remaining", result: "untested" }),
    ]),
  );
  const mine = await api(
    page,
    "GET",
    `/api/my-work?projectId=${project.id}&limit=100`,
  );
  expect(mine.items).toEqual([
    expect.objectContaining({
      id: requirement.id,
      state: "active",
      scopeConfirmed: true,
      responsibility: "participant",
    }),
  ]);

  // The API's historical participation label must not remove the actor's
  // current project-test duty while this confirmed requirement remains active.
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(reviewTab).toHaveAttribute("aria-selected", "true");
  await expect(reviewTab).toHaveText(/^待我检查\s*1$/);
  await expect(work).toBeVisible();
  await page.reload();
  await selectOption(page, "全局项目筛选", {
    value: project.id,
    label: project.name,
  });
  await expect(reviewTab).toHaveAttribute("aria-selected", "true");
  await expect(reviewTab).toHaveText(/^待我检查\s*1$/);
  await expect(work).toBeVisible();
});

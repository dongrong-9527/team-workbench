import { test, expect } from "./fixtures.js";
import { login, action, task } from "./helpers.js";
import type { Page } from "@playwright/test";
async function api(page: Page, method: string, path: string, body?: any) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const session = await (await fetch("/api/auth/session")).json();
      const r = await fetch(path, {
        method,
        headers: {
          "content-type": "application/json",
          "x-csrf-token": session.csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: await r.json() };
    },
    { method, path, body },
  );
}
test("multiline work update saves unchanged and can be reopened for correction", async ({
  page,
}) => {
  const url = await task(page, "段落工作更新");
  await login(page, "dev");
  await page.goto(url);
  await action(page, "写工作更新");
  const prose = "  完成输入校验\n补充边界用例  ";
  await page.getByLabel("今天实际做了什么").fill(prose);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/updates") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存更新", exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(200);
  expect((await saved.json()).done).toBe(prose);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /我的工作更新/ }).click();
  await expect(
    page.locator(".source-item").filter({ hasText: "补充边界用例" }),
  ).toContainText(prose);
  await expect(page.locator(".source-item p").first()).toHaveCSS(
    "white-space",
    "pre-wrap",
  );
  await page.getByRole("button", { name: "更正此条更新", exact: true }).click();
  await expect(page.getByLabel("今天实际做了什么")).toHaveValue(prose);
});
test("a full Chinese update field fits the advertised form limit", async ({
  page,
}) => {
  const url = await task(page, "中文长工作更新");
  await login(page, "dev");
  await page.goto(url);
  await action(page, "写工作更新");
  const content = "验".repeat(6000);
  // Ant TextArea enforces the cap itself instead of exposing native maxlength.
  await page.getByLabel("今天实际做了什么").fill(content + "验");
  await expect(page.getByLabel("今天实际做了什么")).toHaveValue(content);
  for (const label of ["今天实际做了什么", "下一步计划", "遇到的障碍"])
    await page.getByLabel(label).fill(content);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/updates") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存更新", exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(200);
  expect((await saved.json()).done).toBe(content);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("evidence and scope panels retain recorded names after directory renames", async ({
  page,
}) => {
  await login(page, "product");
  let r = await api(page, "POST", "/api/requirements", {
    projectId: "p1",
    title: "证据署名",
    description: "历史",
    source: { description: "来源" },
    criteria: [{ id: "c", text: "通过" }],
    priority: "medium",
    acceptorId: "product",
  });
  expect(r.status).toBe(200);
  const id = r.body.id;
  r = await api(page, "POST", `/api/requirements/${id}/actions`, {
    action: "refine",
    expectedVersion: 1,
    description: "历史细化",
  });
  expect(r.status).toBe(200);
  r = await api(page, "POST", `/api/requirements/${id}/actions`, {
    action: "makeReady",
    expectedVersion: 2,
    source: {
      description: "来源",
      status: "checked",
      checkedAt: new Date().toISOString(),
    },
  });
  expect(r.status).toBe(200);
  r = await api(page, "POST", `/api/requirements/${id}/actions`, {
    action: "start",
    expectedVersion: r.body.version,
    reason: "进入执行",
  });
  expect(r.status).toBe(200);
  await login(page, "tester");
  r = await api(page, "POST", "/api/tests", {
    target: { kind: "requirement", id },
    expectedVersion: r.body.version,
    revision: 1,
    targetVersion: "build",
    environment: "local",
    checks: [{ checkId: "c", result: "pass" }],
  });
  expect(r.status).toBe(200);
  const testBefore = (
    await api(page, "GET", `/api/tests?kind=requirement&id=${id}`)
  ).body;
  await login(page, "product");
  r = await api(page, "GET", `/api/requirements/${id}`);
  r = await api(page, "POST", `/api/requirements/${id}/submit-acceptance`, {
    expectedVersion: r.body.version,
    revision: 1,
    targetVersion: "build",
  });
  expect(r.status).toBe(200);
  r = await api(page, "POST", `/api/requirements/${id}/acceptance`, {
    expectedVersion: r.body.version,
    revision: 1,
    targetVersion: "build",
    decision: "pass",
    criteria: [{ id: "c", passed: true }],
  });
  expect(r.status).toBe(200);
  const acceptanceBefore = (
    await api(page, "GET", `/api/requirements/${id}/acceptance`)
  ).body;
  const scopesBefore = (
    await api(page, "GET", `/api/requirements/${id}/revision-history`)
  ).body;
  await login(page, "admin");
  const members = (await api(page, "GET", "/api/members?limit=100")).body.items;
  try {
    for (const actor of ["tester", "product"]) {
      const member = members.find((m: any) => m.id === actor);
      expect(
        (
          await api(page, "POST", `/api/members/${actor}/rename`, {
            expectedVersion: member.version,
            displayName: `改名后的${actor}`,
          })
        ).status,
      ).toBe(200);
    }
    await page.goto(`/requirement/${id}`);
    await page.getByRole("button", { name: /测试证据/ }).click();
    await expect(page.locator(".source-item strong")).toContainText("周测试");
    await page.getByRole("button", { name: /产品验收（/ }).click();
    await expect(page.locator(".source-item strong")).toContainText("林产品");
    await page.getByRole("button", { name: /修订.*范围/ }).click();
    await expect(page.locator(".source-item small").first()).toContainText(
      "林产品",
    );
    expect(
      (await page.locator(".source-item").allTextContents()).join(""),
    ).not.toContain("改名后的");
    expect(
      (await api(page, "GET", `/api/tests?kind=requirement&id=${id}`)).body,
    ).toEqual(testBefore);
    expect(
      (await api(page, "GET", `/api/requirements/${id}/acceptance`)).body,
    ).toEqual(acceptanceBefore);
    expect(
      (await api(page, "GET", `/api/requirements/${id}/revision-history`)).body,
    ).toEqual(scopesBefore);
    await page.goto("/members");
    await expect(
      page.getByRole("button", { name: "改名后的tester", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "改名后的product", exact: true }),
    ).toBeVisible();
  } finally {
    const current = (await api(page, "GET", "/api/members?limit=100")).body
      .items;
    for (const actor of ["tester", "product"]) {
      const member = current.find((m: any) => m.id === actor);
      const original = members.find((m: any) => m.id === actor);
      expect(
        (
          await api(page, "POST", `/api/members/${actor}/rename`, {
            expectedVersion: member.version,
            displayName: original.displayName,
          })
        ).status,
      ).toBe(200);
    }
  }
});

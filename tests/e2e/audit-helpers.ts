import type { Page } from "@playwright/test";
import { expect } from "./fixtures.js";
import { login } from "./helpers.js";

export async function api(page: Page, method: string, path: string, body?: Record<string, unknown>, status = 200): Promise<any> {
  const result = await page.evaluate(async ({ method, path, body }) => {
    const session = await (await fetch("/api/auth/session")).json();
    const response = await fetch(path, { method, headers: {
      "content-type": "application/json", "x-csrf-token": session.csrfToken,
      "idempotency-key": crypto.randomUUID(),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { method, path, body });
  expect(result.status, `${method} ${path}: ${JSON.stringify(result.body)}`).toBe(status);
  return result.body;
}

export async function requirement(page: Page, title: string) {
  return api(page, "POST", "/api/requirements", { projectId: "p1", title,
    source: { description: "Synthetic approved source" }, description: "Synthetic verifiable behavior",
    acceptorId: "product", priority: "medium", criteria: [{ id: "a", text: "符合约定", required: true }],
  });
}

export async function pendingAcceptance(page: Page, title: string) {
  await login(page, "product");
  let r = await requirement(page, title);
  for (const command of [{ action: "refine", description: r.description },
    { action: "makeReady", source: { description: "Synthetic checked source", status: "checked", checkedAt: new Date().toISOString() } },
    { action: "start", reason: "Synthetic execution" }])
    r = await api(page, "POST", `/api/requirements/${r.id}/actions`, { ...command, expectedVersion: r.version });
  await login(page, "tester");
  await api(page, "POST", "/api/tests", { target: { kind: "requirement", id: r.id }, expectedVersion: r.version,
    revision: r.revision, targetVersion: "build-1", environment: "Synthetic", checks: [{ checkId: "a", result: "pass" }] });
  await login(page, "product");
  r = await api(page, "GET", `/api/requirements/${r.id}`);
  return api(page, "POST", `/api/requirements/${r.id}/submit-acceptance`, { expectedVersion: r.version, revision: r.revision, targetVersion: "build-1" });
}

export async function detail(page: Page, kind: string, object: any) {
  await page.goto(`/${kind}/${object.id}`);
  await expect(page.getByRole("heading", { name: object.title, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新详情", exact: true })).toBeEnabled();
}

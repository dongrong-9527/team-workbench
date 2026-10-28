import type { Page, Locator } from "@playwright/test";
import sharp from "sharp";
import { test, expect } from "./fixtures.js";
import { login, selectOption } from "./helpers.js";

async function api(page: Page, path: string, body?: Record<string, unknown>) {
  const result = await page.evaluate(
    async ({ path, body }) => {
      const session = await (await fetch("/api/auth/session")).json();
      const response = await fetch(path, {
        method: body ? "POST" : "GET",
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
    { path, body },
  );
  expect(result.status, path).toBe(200);
  return result.body;
}

async function ownedTask(page: Page, title: string) {
  await login(page, "product");
  const task = await api(page, "/api/tasks", {
    projectId: "p1",
    title,
    kind: "backend",
    priority: "medium",
    definitionOfDone: "真实接口保存成功且不产生重复记录",
    ownerId: "dev",
    reviewerId: "tester",
  });
  await login(page, "dev");
  await page.goto(`/task/${task.id}`);
  return task;
}

async function expectMobileModal(page: Page, dialog: Locator) {
  await expect(dialog.locator(".ant-modal-content")).toBeVisible();
  // Ant 4 names the full-screen modal wrap as dialog. Measure the actual panel.
  const panel = dialog.locator(".ant-modal");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect
    .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
    .toBe(540);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
    .toBe(Math.min(540, 390 - 24));
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("expired session opens one central modal, blocks writes and preserves the actor's draft", async ({
  page,
  context,
}) => {
  const object = await ownedTask(page, "合成会话弹窗与草稿保护");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "写工作更新", exact: true }).click();
  const form = page.getByRole("dialog", { name: "写工作更新", exact: true });
  const draft = "登录失效时保留的真实工作草稿";
  await form.getByLabel("今天实际做了什么", { exact: true }).fill(draft);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/updates" &&
      request.method() === "POST"
    )
      writes.push(request.url());
  });
  await context.clearCookies();
  const rejected = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/updates" &&
      response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "保存更新", exact: true }).click();
  expect((await rejected).status()).toBe(401);
  const modal = page.getByRole("dialog", {
    name: "登录会话已失效",
    exact: true,
  });
  await expectMobileModal(page, modal);
  await expect(modal).toContainText("草稿");
  await modal.getByRole("button", { name: "重新登录", exact: true }).focus();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    expect(
      await modal.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(
    form.getByLabel("今天实际做了什么", { exact: true }),
  ).toHaveValue(draft);
  const save = form.getByRole("button", { name: "保存更新", exact: true });
  await expect(save).toBeDisabled();
  await save.evaluate((button: HTMLButtonElement) => button.click());
  expect(writes).toHaveLength(1);
  await form
    .getByRole("button", { name: "返回", exact: true })
    .click();
  await page.getByRole("link", { name: "重新登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?return=/);
  await page.getByLabel("登录账号").fill("dev");
  await page.getByLabel("密码", { exact: true }).fill("Synthetic-demo-2026!");
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/task/${object.id}$`));
  await page.getByRole("button", { name: "写工作更新", exact: true }).click();
  await expect(
    form.getByLabel("今天实际做了什么", { exact: true }),
  ).toHaveValue(draft);
  await expect(
    form.getByRole("button", { name: "保存更新", exact: true }),
  ).toBeEnabled();
});

test("acceptance return confirms the real page inputs and sends one guarded original command", async ({
  page,
}) => {
  await login(page, "product");
  let requirement = await api(page, "/api/requirements", {
    projectId: "p1",
    title: "合成验收退回确认",
    description: "独立检查后由产品决定退回",
    source: { description: "合成来源已由产品核对" },
    acceptorId: "product",
    priority: "medium",
    criteria: [{ id: "criterion", text: "实际结果符合约定", required: true }],
  });
  const actions = `/api/requirements/${requirement.id}/actions`;
  requirement = await api(page, actions, {
    action: "refine",
    expectedVersion: requirement.version,
    description: "明确当前验收范围",
  });
  requirement = await api(page, actions, {
    action: "makeReady",
    expectedVersion: requirement.version,
    source: {
      description: "合成来源已由产品核对",
      status: "checked",
      checkedAt: new Date().toISOString(),
    },
  });
  requirement = await api(page, actions, {
    action: "start",
    expectedVersion: requirement.version,
    reason: "进入实际执行",
  });
  const task = await api(page, "/api/tasks", {
    projectId: "p1",
    requirementId: requirement.id,
    title: "合成非必需后续返工",
    kind: "backend",
    definitionOfDone: "按产品指出的差异返工",
    ownerId: "dev",
    reviewerId: "tester",
    priority: "medium",
    required: false,
    exclusionReason: "非本次通过所必需，保留为后续返工工作",
  });
  await login(page, "tester");
  await api(page, "/api/tests", {
    target: { kind: "requirement", id: requirement.id },
    expectedVersion: requirement.version,
    revision: requirement.revision,
    targetVersion: "return-build",
    environment: "合成验收环境",
    checks: [{ checkId: "criterion", result: "pass" }],
  });
  await login(page, "product");
  requirement = await api(page, `/api/requirements/${requirement.id}`);
  requirement = await api(
    page,
    `/api/requirements/${requirement.id}/submit-acceptance`,
    {
      expectedVersion: requirement.version,
      revision: requirement.revision,
      targetVersion: "return-build",
    },
  );
  await page.goto(`/requirement/${requirement.id}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "产品验收", exact: true }).click();
  const form = page.getByRole("dialog", { name: "产品验收", exact: true });
  await selectOption(page, "验收结论", { value: "return", label: "退回返工" });
  const reason = "产品实际核对发现与约定不符，交回关联任务返工";
  await form.getByLabel("操作原因", { exact: true }).fill(reason);
  await form
    .getByLabel("检查说明", { exact: true })
    .fill("当前条目的实际结果仍需返工");
  await form.getByRole("checkbox", { name: task.title, exact: true }).check();
  const path = `/api/requirements/${requirement.id}/acceptance`;
  const bodies: Record<string, unknown>[] = [];
  let release!: () => void;
  let received!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postDataJSON());
    received();
    await gate;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  const confirm = page.getByRole("dialog", {
    name: "退回产品验收",
    exact: true,
  });
  try {
    await form
      .getByRole("button", { name: "确认产品验收", exact: true })
      .click();
    await expectMobileModal(page, confirm);
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(bodies).toHaveLength(0);
    await expect(confirm).toContainText(reason);
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(form.getByLabel("操作原因", { exact: true })).toHaveValue(
      reason,
    );
    await form
      .getByRole("button", { name: "确认产品验收", exact: true })
      .click();
    await confirm
      .getByRole("button", { name: "确认退回", exact: true })
      .click();
    await held;
    await expect(
      confirm.getByRole("button", { name: /确认退回$/ }),
    ).toBeDisabled();
    await expect(
      confirm.getByRole("button", { name: "取消", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(confirm).toBeVisible();
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeDisabled();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      decision: "return",
      expectedVersion: requirement.version,
      revision: requirement.revision,
      targetVersion: "return-build",
      reason,
      reworkTaskIds: [task.id],
      criteria: [
        { id: "criterion", passed: false, note: "当前条目的实际结果仍需返工" },
      ],
    });
  } finally {
    release();
  }
  await expect(confirm).toHaveCount(0);
  await expect(form).toHaveCount(0);
  expect(await api(page, `/api/requirements/${requirement.id}`)).toMatchObject({
    state: "active",
  });
  const records = await api(page, `${path}?limit=20`);
  expect(records.items).toHaveLength(1);
  expect(records.items[0]).toMatchObject({ decision: "return", reason });
});

test("upload failure modal retains the original file and retries a lost real response without duplication", async ({
  page,
}) => {
  const object = await ownedTask(page, "合成附件失败弹窗与原命令重试");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "写工作更新", exact: true }).click();
  await page
    .getByLabel("今天实际做了什么", { exact: true })
    .fill("上传在途期间不能另起保存命令");
  await page
    .getByRole("button", { name: "返回", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "图片附件", exact: true });
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#245bdb" },
  })
    .png()
    .toBuffer();
  await panel
    .getByLabel("选择图片")
    .setInputFiles({
      name: "synthetic-retry.png",
      mimeType: "image/png",
      buffer: png,
    });
  const commands: {
    key: string;
    version: string | null;
    size: string | null;
  }[] = [];
  const otherWrites: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/updates"
    )
      otherWrites.push(request.url());
  });
  let release!: () => void;
  let received!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route(
    `**/api/objects/task/${object.id}/attachments?expectedVersion=*`,
    async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      commands.push({
        key: request.headers()["idempotency-key"]!,
        version: url.searchParams.get("expectedVersion"),
        size: url.searchParams.get("size"),
      });
      if (commands.length <= 2) {
        // The real server commits once. Only the transport response is lost;
        // retry must recover the original idempotent result, not create another file.
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
        return;
      }
      received();
      await gate;
      await route.continue();
    },
  );
  const modal = page.getByRole("dialog", { name: "附件上传失败", exact: true });
  try {
    await panel.getByRole("button", { name: "上传图片", exact: true }).click();
    await expectMobileModal(page, modal);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(modal).toContainText("synthetic-retry.png");
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeEnabled();
    await expect(panel).toContainText("synthetic-retry.png");
    await panel
      .getByRole("button", { name: "重试上传图片", exact: true })
      .click();
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "重试上传", exact: true }).click();
    await held;
    await expect(
      modal.getByRole("button", { name: "重试上传", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeDisabled();
    // Bypass only the overlay to exercise the independent command guard.
    // The filled draft is valid; its save must remain disabled while upload owns pending.
    await page
      .getByRole("button", { name: "写工作更新", exact: true })
      .evaluate((button: HTMLButtonElement) => button.click());
    const update = page.getByRole("dialog", {
      name: "写工作更新",
      exact: true,
    });
    const save = update.getByRole("button", { name: "保存更新", exact: true });
    await expect(save).toBeDisabled();
    await save.evaluate((button: HTMLButtonElement) => button.click());
    expect(otherWrites).toHaveLength(0);
    await update
      .getByRole("button", { name: "返回", exact: true })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(update).toHaveCount(0);
    // Unmounting that unrelated form must not release the upload's token.
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeDisabled();
    await page
      .locator('a[href="/my-work"]')
      .first()
      .evaluate((link: HTMLAnchorElement) => link.click());
    await expect(page).toHaveURL(new RegExp(`/task/${object.id}$`));
    await page.keyboard.press("Escape");
    await expect(modal).toBeVisible();
    expect(commands).toHaveLength(3);
    expect(commands[0].key).toBeTruthy();
    expect(commands[0]).toMatchObject({
      version: String(object.version),
      size: String(png.length),
    });
    expect(commands[1]).toEqual(commands[0]);
    expect(commands[2]).toEqual(commands[0]);
  } finally {
    release();
  }
  await expect(modal).toHaveCount(0);
  await expect(panel.getByText("图片已保存", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeEnabled();
  const attachments = await api(
    page,
    `/api/objects/task/${object.id}/attachments?limit=20`,
  );
  expect(attachments.items).toHaveLength(1);
  expect(attachments.items[0]).toMatchObject({
    target: { kind: "task", id: object.id },
    mime: "image/png",
  });
});

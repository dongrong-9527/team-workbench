import { test, expect } from "./fixtures.js";
import { login } from "./helpers.js";
import { api } from "./audit-helpers.js";
import type { Page } from "@playwright/test";

async function fill(page: Page, label: string, code: string, password: string, confirmation = password) {
  await page.getByLabel(label, { exact: true }).fill(code);
  await page.getByLabel("新密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码", { exact: true }).fill(confirmation);
}

test("both account forms block invalid codes, code point lengths and mismatched passwords before requests", async ({ page }, info) => {
  const writes: string[] = [];
  page.on("request", r => { if (r.method() === "POST") writes.push(new URL(r.url()).pathname); });
  for (const [path, label, button] of [["/activate", "激活码", "激活账号"], ["/reset", "密码重置码", "确认重置"]]) {
    await page.goto(path!);
    await expect(page.getByText(/不是登录账号/)).toBeVisible();
    await expect(page.getByText(/12–128 个 Unicode 字符/)).toBeVisible();
    for (const code of ["a".repeat(42), "a".repeat(44), "a".repeat(42) + "+"]) {
      await fill(page, label!, code, "😀".repeat(12));
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect(page.locator(".ant-form-item-explain-error").first()).toContainText("43");
      await expect(page.getByLabel(label!, { exact: true })).toHaveValue(code);
    }
    for (const password of ["😀".repeat(11), "😀".repeat(129)]) {
      await fill(page, label!, "a".repeat(43), password);
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect(page.locator(".ant-form-item-explain-error").first()).toContainText("12–128");
    }
    await fill(page, label!, "a".repeat(43), "Synthetic-password-123", "different-password");
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page.locator(".ant-form-item-explain-error").first()).toContainText("两次密码不一致");
    await page.getByLabel("确认密码", { exact: true }).fill("Synthetic-password-123");
    await page.getByLabel("新密码", { exact: true }).fill("Synthetic-password-changed");
    await page.getByLabel("确认密码", { exact: true }).focus();
    await page.getByLabel(label!, { exact: true }).focus();
    await expect(page.locator(".ant-form-item-explain-error").first()).toContainText("两次密码不一致");
    if (path === "/activate") await page.screenshot({ path: info.outputPath("activate-desktop-validation.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(path!.slice(1) + "-mobile-validation.png"), fullPage: true });
  }
  expect(writes).toEqual([]);
});

test("real activation and reset accept exact Unicode boundaries and preserve password whitespace", async ({ page, browser, observeContext }) => {
  await login(page, "admin");
  const member = await api(page, "POST", "/api/members", { login: "synthetic.unicode.setup", displayName: "合成激活边界" });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  await observeContext(ctx);
  const person = await ctx.newPage();
  await person.goto("https://127.0.0.1:4173/activate");
  const first = "😀".repeat(12);
  await fill(person, "激活码", member.activationToken, first);
  await person.getByRole("button", { name: "激活账号", exact: true }).click();
  await expect(person.getByRole("status")).toContainText("设置成功");
  const issued = await api(page, "POST", `/api/members/${member.id}/reset`, { expectedVersion: 2 });
  await person.goto("https://127.0.0.1:4173/reset");
  const second = " " + "😀".repeat(126) + " ";
  await fill(person, "密码重置码", issued.resetToken, second);
  await person.getByRole("button", { name: "确认重置", exact: true }).click();
  await expect(person.getByRole("status")).toContainText("设置成功");
  await person.getByRole("link", { name: "返回登录", exact: true }).click();
  await person.getByLabel("登录账号", { exact: true }).fill("synthetic.unicode.setup");
  await person.getByLabel("密码", { exact: true }).fill(second);
  await person.getByRole("button", { name: "登录工作台", exact: true }).click();
  await expect(person.getByRole("heading", { name: "我的工作", exact: true })).toBeVisible();
  expect(await person.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(second);
  expect(await person.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(issued.resetToken);
  await ctx.close();
});

test("wrong type remains merged failure, fixed entry switch clears secrets and does not guess", async ({ page }) => {
  await login(page, "admin");
  const member = await api(page, "POST", "/api/members", { login: "synthetic.wrong.kind", displayName: "合成类型隔离" });
  await page.goto("/reset");
  await fill(page, "密码重置码", member.activationToken, "Synthetic-password-123");
  await page.getByRole("button", { name: "确认重置", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("无效、已过期或已使用");
  await expect(page.getByRole("alert")).toContainText("联系管理员重新签发");
  await expect(page.getByRole("alert")).not.toContainText("Invalid credentials");
  await page.getByRole("link", { name: "前往激活账号", exact: true }).click();
  await expect(page.getByLabel("激活码", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("新密码", { exact: true })).toHaveValue("");
  await page.goBack();
  await expect(page.getByLabel("密码重置码", { exact: true })).toHaveValue("");
  await page.goForward();
  await fill(page, "激活码", member.activationToken, "Synthetic-password-123");
  await page.getByRole("button", { name: "激活账号", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("设置成功");
});

test("pending and lost activation responses prevent duplicate clicks and explain uncertain recovery", async ({ page }) => {
  await login(page, "admin");
  const member = await api(page, "POST", "/api/members", { login: "synthetic.lost.setup", displayName: "合成丢失响应" });
  await page.goto("/activate");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route("**/api/auth/activate", async route => {
    calls++;
    expect((await route.fetch()).status()).toBe(200);
    await held;
    await route.abort("failed");
  });
  await fill(page, "激活码", member.activationToken, "Synthetic-password-123");
  const button = page.locator(".auth-submit");
  await button.click();
  await expect.poll(() => calls).toBe(1);
  await expect(button).toBeDisabled();
  await expect(page.getByLabel("新密码", { exact: true })).toBeDisabled();
  await page.locator("form").dispatchEvent("submit");
  await page.getByRole("link", { name: "前往重置密码", exact: true }).click();
  await expect(page).toHaveURL(/\/activate$/);
  expect(calls).toBe(1);
  release();
  await expect(page.getByRole("alert")).toContainText("返回登录");
  await page.unroute("**/api/auth/activate");
  await button.click();
  await expect(page.getByRole("alert")).toContainText("无效、已过期或已使用");
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(member.activationToken);
});

test("create invitation copies submitted login, one-time code and fixed entry without issuing again", async ({ page }, info) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { (window as any).__copiedInvitation = text; } } }));
  await login(page, "admin");
  await page.goto("/members");
  let writes = 0;
  page.on("request", r => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/members") writes++; });
  await page.getByRole("button", { name: "创建成员", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建成员", exact: true });
  await dialog.getByLabel("登录账号（小写英文或数字）").fill("synthetic.copy.invite");
  await dialog.getByLabel("显示名", { exact: true }).fill("合成复制邀请");
  await dialog.getByRole("button", { name: "确认创建成员", exact: true }).click();
  const code = await page.getByLabel("一次性票据", { exact: true }).inputValue();
  await page.getByRole("button", { name: "复制激活邀请", exact: true }).click();
  const text = await page.evaluate(() => (window as any).__copiedInvitation);
  expect(text).toContain("登录账号：synthetic.copy.invite");
  expect(text).toContain("激活码：" + code);
  expect(text).toContain("激活入口：https://127.0.0.1:4173/activate\n");
  expect(text).toContain("24 小时");
  await expect(page.getByRole("status").filter({ hasText: "已复制" })).toBeVisible();
  expect(writes).toBe(1);
  expect(new URL((await page.getByRole("link", { name: "打开本人激活表单", exact: true }).getAttribute("href"))!, page.url()).search).toBe("");
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(code);
  await page.screenshot({ path: info.outputPath("synthetic-invitation-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "关闭查看", exact: true }).click();
  await expect(page.getByRole("button", { name: "复制激活邀请", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("一次性票据")).toHaveCount(0);
});

test("reset copy rejection offers selectable instructions without guessing login or persisting code", async ({ page }, info) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new DOMException("Synthetic denial", "NotAllowedError"); } } }));
  await login(page, "admin");
  const member = await api(page, "POST", "/api/members", { login: "synthetic.reset.copy", displayName: "合成重置复制" });
  await page.goto("/members");
  const row = page.getByRole("row").filter({ hasText: "合成重置复制" });
  await row.getByRole("button", { name: "重置密码", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "签发密码重置票据", exact: true });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("button", { name: "复制密码重置说明", exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: "重置密码", exact: true }).click();
  await dialog.getByRole("button", { name: "确认签发密码重置票据", exact: true }).click();
  const code = await page.getByLabel("一次性票据", { exact: true }).inputValue();
  await page.getByRole("button", { name: "复制密码重置说明", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "手动复制" })).toBeVisible();
  const manual = page.getByLabel("手动复制说明", { exact: true });
  const text = await manual.inputValue();
  expect(text).toContain("账号标识：" + member.id);
  expect(text).toContain("登录账号请使用原账号");
  expect(text).toContain("重置入口：https://127.0.0.1:4173/reset\n");
  expect(text).not.toContain("synthetic.reset.copy");
  await page.getByRole("button", { name: "全选说明", exact: true }).click();
  expect(await manual.evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart)).toBeGreaterThan(100);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(code);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("synthetic-reset-manual-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "关闭查看", exact: true }).click();
  await expect(manual).toHaveCount(0);
});

test("lost member creation response replays the same command without reconstructing an invitation", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/members");
  const keys: string[] = [];
  await page.route("**/api/members", async route => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]!);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (keys.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "创建成员", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建成员", exact: true });
  await dialog.getByLabel("登录账号（小写英文或数字）").fill("synthetic.lost.create");
  await dialog.getByLabel("显示名", { exact: true }).fill("合成创建重试");
  await dialog.getByRole("button", { name: "确认创建成员", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("网络");
  await dialog.getByRole("button", { name: "确认创建成员", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  await expect(page.getByRole("button", { name: "复制激活邀请", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("一次性票据")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "激活码 · 仅本次显示", exact: true })).toHaveCount(0);
  await expect(page.getByText("票据已签发；重复请求只返回安全元数据。", { exact: false })).toBeVisible();
  const rows = (await api(page, "GET", "/api/members?limit=100")).items.filter((m: any) => m.displayName === "合成创建重试");
  expect(rows).toHaveLength(1);
});

test("administrator self-reset preserves the already-authorized one-time handoff after session revocation", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { (window as any).__copiedInvitation = text; } } }));
  await login(page, "admin");
  await page.goto("/members");
  const row = page.getByRole("row").filter({ hasText: "演示管理员" });
  let writes = 0;
  page.on("request", r => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/members/admin/reset") writes++; });
  await row.getByRole("button", { name: "重置密码", exact: true }).click();
  await page.getByRole("dialog", { name: "签发密码重置票据", exact: true }).getByRole("button", { name: "确认签发密码重置票据", exact: true }).click();
  const expired = page.getByRole("dialog", { name: "登录会话已失效", exact: true });
  await expect(expired).toBeVisible();
  await expired.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel("一次性票据", { exact: true })).toBeVisible();
  const code = await page.getByLabel("一次性票据", { exact: true }).inputValue();
  await page.getByRole("button", { name: "复制密码重置说明", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__copiedInvitation)).toContain("密码重置码：" + code);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(code);
  expect(writes).toBe(1);
  // Issuance revokes sessions, not the old password. A fresh login discards the handoff.
  await login(page, "admin");
  await page.goto("/members");
  await expect(page.getByLabel("一次性票据")).toHaveCount(0);
});

import { test, expect } from "./fixtures.js";
import { login, selectOption } from "./helpers.js";
import { api } from "./audit-helpers.js";
import sharp from "sharp";

async function openNew(page: import("@playwright/test").Page) {
  await login(page, "product");
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "新建需求", exact: true }).click();
  return page.getByRole("dialog", { name: "新建需求", exact: true });
}
async function image(name: string) {
  return {
    name,
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#6688aa" },
    })
      .png()
      .toBuffer(),
  };
}

test("requirement modal keeps its layout, collapses extra detail and saves real prose as a server draft", async ({
  page,
}, info) => {
  const editor = await openNew(page);
  await expect(editor.locator(".requirement-editor")).toBeVisible();
  await expect(
    editor.getByText("当前提交人：林产品", { exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole("textbox", { name: "期望完成时间", exact: true }),
  ).toBeHidden();
  await editor.getByLabel("标题", { exact: true }).fill("合成需求新布局");
  await editor
    .getByLabel("来源说明", { exact: true })
    .fill("真实背景对应原来源说明");
  await editor.getByText("补充细节", { exact: true }).click();
  const expectedCompletion =
    "  本周五前\n下个版本 <img src=x onerror=window.syntheticXSS=1>  ";
  await editor
    .getByLabel("期望完成时间", { exact: true })
    .fill(expectedCompletion);
  await page.screenshot({
    path: info.outputPath("requirement-create-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/requirements" &&
      r.request().method() === "POST",
  );
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  const saved = await (await response).json();
  expect(saved.state).toBe("draft");
  expect(saved.expectedCompletion).toBe(expectedCompletion);
  await expect(page).toHaveURL(new RegExp("/requirement/" + saved.id + "$"));
  await expect(
    page.getByText("期望完成时间：" + expectedCompletion, { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).syntheticXSS),
  ).toBeUndefined();
});

test("partially delivered creation retries only failed images with its original key after a lost successful response", async ({
  page,
}) => {
  const editor = await openNew(page);
  let creations = 0,
    savedId = "",
    lost = true;
  const secondKeys: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/requirements"
    )
      creations++;
  });
  page.on("response", async (response) => {
    if (
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/requirements" &&
      response.ok()
    )
      savedId = (await response.json()).id;
  });
  await page.route(
    "**/api/objects/requirement/*/attachments?*",
    async (route) => {
      if (
        !route
          .request()
          .postDataBuffer()
          ?.includes(Buffer.from('filename="two.png"'))
      )
        return route.continue();
      secondKeys.push(route.request().headers()["idempotency-key"]!);
      if (!lost) return route.continue();
      lost = false;
      await route.fetch();
      await route.abort();
    },
  );
  await editor.getByLabel("标题", { exact: true }).fill("合成部分图片交付");
  await editor
    .getByLabel("来源说明", { exact: true })
    .fill("先保存需求再上传两张合成图");
  await editor
    .getByLabel("选择需求截图", { exact: true })
    .setInputFiles([await image("one.png"), await image("two.png")]);
  await expect(
    editor.getByRole("img", { name: "待上传：one.png", exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "保存草稿", exact: true })
    .dblclick();
  await expect(editor.getByText(/需求已保存/)).toBeVisible();
  await expect(editor.getByText(/1 张成功.*1 张失败/)).toBeVisible();
  expect(creations).toBe(1);
  await editor
    .getByRole("button", { name: "重试失败图片", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp("/requirement/" + savedId + "$"));
  expect(creations).toBe(1);
  expect(secondKeys).toHaveLength(2);
  expect(secondKeys[1]).toBe(secondKeys[0]);
  const attachments = await api(
    page,
    "GET",
    `/api/objects/requirement/${savedId}/attachments`,
  );
  expect(attachments.items).toHaveLength(2);
  const history = await api(
    page,
    "GET",
    `/api/objects/requirement/${savedId}/history?limit=100`,
  );
  expect(
    history.items.filter((entry: any) => entry.action === "created"),
  ).toHaveLength(1);
  expect(
    history.items.filter((entry: any) => entry.action === "attachmentAdded"),
  ).toHaveLength(2);
});

test("saved object receipt survives refresh without recreating a requirement or pretending to restore image bytes", async ({
  page,
}) => {
  const editor = await openNew(page);
  let creations = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname === "/api/requirements"
    )
      creations++;
  });
  await page.route("**/api/objects/requirement/*/attachments?*", (route) =>
    route.abort(),
  );
  await editor.getByLabel("标题", { exact: true }).fill("合成图片交付刷新回执");
  await editor
    .getByLabel("来源说明", { exact: true })
    .fill("文字已入库，文件仅在内存");
  await editor
    .getByLabel("选择需求截图", { exact: true })
    .setInputFiles(await image("pending.png"));
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "重试失败图片", exact: true }),
  ).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  // Reopen this same creation key after a full route reload.
  await page.getByRole("button", { name: "新建需求", exact: true }).click();
  const restored = page.getByRole("dialog", { name: "新建需求", exact: true });
  await expect(restored.getByText(/图片未在刷新后保留/)).toBeVisible();
  expect(creations).toBe(1);
  const storage = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.includes("workbench:"))
      .map(([, value]) => value)
      .join("\n"),
  );
  expect(storage).not.toContain("blob:");
  expect(storage).not.toContain("data:image");
  await restored
    .getByRole("button", { name: "查看已保存需求", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requirement\//);
  expect(creations).toBe(1);
});

test("clear confirmation and cancellation preserve ordinary text and pending previews on phones", async ({
  page,
}, info) => {
  const editor = await openNew(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.getByLabel("标题", { exact: true }).fill("合成清空保护");
  await editor
    .getByLabel("来源说明", { exact: true })
    .fill("文字和图片均未提交");
  await editor
    .getByLabel("选择需求截图", { exact: true })
    .setInputFiles(await image("keep.png"));
  let writes = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/api\/(requirements|objects)/.test(new URL(r.url()).pathname)
    )
      writes++;
  });
  await editor.getByRole("button", { name: "清空", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "清空未保存内容",
    exact: true,
  });
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor.getByLabel("标题", { exact: true })).toHaveValue(
    "合成清空保护",
  );
  await expect(
    editor.getByRole("img", { name: "待上传：keep.png", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("requirement-create-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await editor.getByRole("button", { name: "清空", exact: true }).click();
  await confirmation
    .getByRole("button", { name: "确认清空", exact: true })
    .click();
  await expect(editor.getByLabel("标题", { exact: true })).toHaveValue("");
  await expect(
    editor.getByRole("img", { name: "待上传：keep.png", exact: true }),
  ).toHaveCount(0);
  expect(writes).toBe(0);
});

test("an unknown successful create locks the original command and recovers one server object", async ({
  page,
}) => {
  const editor = await openNew(page);
  const keys: string[] = [];
  let lost = true;
  await page.route("**/api/requirements", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]!);
    if (!lost) return route.continue();
    lost = false;
    await route.fetch();
    await route.abort();
  });
  await editor.getByLabel("标题", { exact: true }).fill("合成创建结果未知重试");
  await editor.getByLabel("来源说明", { exact: true }).fill("只重试原创建命令");
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "重试确认保存", exact: true }),
  ).toBeVisible();
  await expect(editor.getByLabel("标题", { exact: true })).toBeDisabled();
  await editor
    .getByRole("button", { name: "重试确认保存", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requirement\//);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  const result = await api(
    page,
    "GET",
    "/api/requirements?projectId=p1&limit=100",
  );
  expect(
    result.items.filter((r: any) => r.title === "合成创建结果未知重试"),
  ).toHaveLength(1);
});

test("paste and drag preview remain local and cancelled leaving retains the same files", async ({
  page,
}) => {
  const editor = await openNew(page);
  const png = await image("drag.png");
  let writes = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/api\/(requirements|objects)/.test(new URL(r.url()).pathname)
    )
      writes++;
  });
  await editor
    .getByLabel("标题", { exact: true })
    .fill("合成粘贴拖拽与离开保护");
  const zone = editor.getByRole("button", {
    name: "粘贴拖入或选择需求截图",
    exact: true,
  });
  await zone.evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const drop = new DataTransfer();
    drop.items.add(new File([bytes], "drag.png", { type: "image/png" }));
    element.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: drop,
        bubbles: true,
        cancelable: true,
      }),
    );
    const paste = new DataTransfer();
    paste.items.add(new File([bytes], "paste.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: paste,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png.buffer.toString("base64"));
  await expect(
    editor.getByRole("img", { name: "待上传：drag.png", exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole("img", { name: "待上传：paste.png", exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "返回", exact: true })
    .click();
  const discard = page.getByRole("dialog", {
    name: "放弃待上传图片？",
    exact: true,
  });
  await discard.getByRole("button", { name: "继续填写", exact: true }).click();
  await expect(
    editor.getByRole("img", { name: "待上传：paste.png", exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "返回", exact: true })
    .click();
  await discard
    .getByRole("button", { name: "放弃待上传图片并离开", exact: true })
    .click();
  await page.getByRole("button", { name: "新建需求", exact: true }).click();
  await expect(editor.getByLabel("标题", { exact: true })).toHaveValue(
    "合成粘贴拖拽与离开保护",
  );
  await expect(editor.getByRole("img", { name: /待上传：/ })).toHaveCount(0);
  expect(writes).toBe(0);
});

test("an external object update requires explicit image version adoption and never resaves the text", async ({
  page,
}) => {
  const editor = await openNew(page);
  let changed = false;
  const uploads: { key: string; version: string | null }[] = [];
  await page.route(
    "**/api/objects/requirement/*/attachments?*",
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const url = new URL(route.request().url());
      uploads.push({
        key: route.request().headers()["idempotency-key"]!,
        version: url.searchParams.get("expectedVersion"),
      });
      if (!changed) {
        changed = true;
        const objectId = url.pathname.split("/")[4];
        await api(page, "POST", `/api/requirements/${objectId}/actions`, {
          action: "refine",
          expectedVersion: Number(url.searchParams.get("expectedVersion")),
          description: "Synthetic outside edit stays intact",
        });
      }
      await route.continue();
    },
  );
  await editor.getByLabel("标题", { exact: true }).fill("合成图片版本冲突");
  await editor.getByLabel("来源说明", { exact: true }).fill("保留外部修改");
  await editor
    .getByLabel("选择需求截图", { exact: true })
    .setInputFiles(await image("version.png"));
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await editor
    .getByRole("button", { name: "核对并采用需求最新版本", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "重试失败图片", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requirement\//);
  const objectId = new URL(page.url()).pathname.split("/").pop()!;
  const object = await api(page, "GET", `/api/requirements/${objectId}`);
  expect(object.description).toBe("Synthetic outside edit stays intact");
  expect(uploads).toHaveLength(2);
  expect(uploads[0].version).toBe("1");
  expect(uploads[1].version).toBe("2");
  expect(uploads[1].key).not.toBe(uploads[0].key);
  expect(
    (await api(page, "GET", `/api/objects/requirement/${objectId}/attachments`))
      .items,
  ).toHaveLength(1);
});

test("edit validation expands hidden required details and keeps the existing modal", async ({
  page,
}) => {
  await login(page, "product");
  const r = await api(page, "POST", "/api/requirements", {
    projectId: "p1",
    title: "合成编辑校验",
    source: { description: "Original background" },
    description: "",
    acceptorId: "product",
    criteria: [],
    priority: "medium",
  });
  await page.goto(`/requirement/${r.id}`);
  await page.getByRole("button", { name: "细化内容", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "细化内容", exact: true });
  await expect(
    editor.locator(
      "xpath=ancestor-or-self::div[contains(@class,'ant-modal')][1]",
    ),
  ).toBeVisible();
  await expect(editor.getByLabel("细化说明", { exact: true })).toBeHidden();
  let writes = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/api/requirements/${r.id}/actions`
    )
      writes++;
  });
  await editor.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(editor.getByLabel("细化说明", { exact: true })).toBeVisible();
  expect(writes).toBe(0);
  await expect(editor.getByText(/创建者：林产品/)).toBeVisible();
});

test("Ctrl+S sends the same validated draft once and clear cancellation does not submit", async ({
  page,
}) => {
  const editor = await openNew(page);
  let creates = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname === "/api/requirements"
    )
      creates++;
  });
  await editor.getByLabel("标题", { exact: true }).fill("合成快捷键真实保存");
  await editor
    .getByLabel("来源说明", { exact: true })
    .fill("键盘复用校验与保存");
  await editor.getByLabel("标题", { exact: true }).focus();
  await page.keyboard.press("Control+s");
  await expect(page).toHaveURL(/\/requirement\//);
  expect(creates).toBe(1);
});

test("failed browser draft persistence keeps the command unsent and can recover without duplication", async ({
  page,
}) => {
  const editor = await openNew(page);
  let creates = 0;
  await editor.getByLabel("标题", { exact: true }).fill("合成暂存失败");
  await editor
    .getByLabel("来源说明", { exact: true })
    .fill("浏览器暂存失败不应提交未绑定命令");
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname === "/api/requirements"
    )
      creates++;
  });
  await page.evaluate(() => {
    (window as any).syntheticOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException("Synthetic storage quota", "QuotaExceededError");
    };
  });
  await editor
    .getByLabel("标题", { exact: true })
    .fill("合成暂存失败后仍可编辑");
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(editor.getByLabel("标题", { exact: true })).toBeEnabled();
  await expect(editor.getByRole("alert")).toContainText("请求尚未发送");
  expect(creates).toBe(0);
  await page.evaluate(() => {
    Storage.prototype.setItem = (window as any).syntheticOriginalSetItem;
  });
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page).toHaveURL(/\/requirement\//);
  expect(creates).toBe(1);
});

test("a rejected retry cannot unlock an earlier ambiguous successful create", async ({
  page,
}) => {
  const editor = await openNew(page);
  const keys: string[] = [];
  let attempt = 0;
  await page.route("**/api/requirements", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]!);
    attempt++;
    if (attempt === 1) {
      await route.fetch();
      return route.abort();
    }
    if (attempt === 2)
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "合成临时权限拒绝" }),
      });
    return route.continue();
  });
  await editor
    .getByLabel("标题", { exact: true })
    .fill("合成已成功请求重试被拒");
  await editor
    .getByLabel("来源说明", { exact: true })
    .fill("拒绝本次重试不证明上次请求未执行");
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await editor
    .getByRole("button", { name: "重试确认保存", exact: true })
    .click();
  await expect(editor.getByRole("alert").filter({ hasText: "合成临时权限拒绝" })).toBeVisible();
  await expect(editor.getByLabel("标题", { exact: true })).toBeDisabled();
  await expect(
    editor.getByRole("button", { name: "保存草稿", exact: true }),
  ).toHaveCount(0);
  await editor
    .getByRole("button", { name: "重试确认保存", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requirement\//);
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(1);
  const result = await api(
    page,
    "GET",
    "/api/requirements?projectId=p1&limit=100",
  );
  expect(
    result.items.filter((r: any) => r.title === "合成已成功请求重试被拒"),
  ).toHaveLength(1);
});

test("a restored saved receipt can retry a transient object verification failure", async ({
  page,
}) => {
  const editor = await openNew(page);
  let savedId = "",
    creates = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname === "/api/requirements"
    )
      creates++;
  });
  page.on("response", async (r) => {
    if (
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/requirements" &&
      r.ok()
    )
      savedId = (await r.json()).id;
  });
  await page.route("**/api/objects/requirement/*/attachments?*", (route) =>
    route.abort(),
  );
  await editor.getByLabel("标题", { exact: true }).fill("合成回执核对恢复");
  await editor
    .getByLabel("来源说明", { exact: true })
    .fill("已入库对象核对可重试，不再创建");
  await editor
    .getByLabel("选择需求截图", { exact: true })
    .setInputFiles(await image("recovery.png"));
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "重试失败图片", exact: true }),
  ).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  const objectPath = "/api/requirements/" + savedId;
  await page.route("**" + objectPath, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "合成回执读取暂不可用" }),
    }),
  );
  await page.getByRole("button", { name: "新建需求", exact: true }).click();
  const restored = page.getByRole("dialog", { name: "新建需求", exact: true });
  await expect(restored.getByText(/合成回执读取暂不可用/)).toBeVisible();
  await page.unroute("**" + objectPath);
  await expect(
    restored.getByRole("button", { name: "重新核对保存回执", exact: true }),
  ).toBeVisible();
  await restored
    .getByRole("button", { name: "重新核对保存回执", exact: true })
    .click();
  await expect(
    restored.getByRole("button", { name: "查看已保存需求", exact: true }),
  ).toBeEnabled();
  await restored
    .getByRole("button", { name: "查看已保存需求", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp("/requirement/" + savedId + "$"));
  expect(creates).toBe(1);
});

test("repeated refreshes retain the lost-image warning while an original create remains ambiguous", async ({
  page,
}) => {
  let editor = await openNew(page);
  const keys: string[] = [];
  let attempts = 0;
  await page.route("**/api/requirements", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]!);
    attempts++;
    if (attempts <= 2) {
      await route.fetch();
      return route.abort();
    }
    return route.continue();
  });
  await editor
    .getByLabel("标题", { exact: true })
    .fill("合成多次刷新图片丢失保护");
  await editor
    .getByLabel("来源说明", { exact: true })
    .fill("文字请求保持同一绑定，丢失图片一直明确提示");
  await editor
    .getByLabel("选择需求截图", { exact: true })
    .setInputFiles(await image("lost-on-refresh.png"));
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  page.on("dialog", (dialog) => dialog.accept());
  for (let refresh = 0; refresh < 2; refresh++) {
    await page.reload();
    await page.getByRole("button", { name: "新建需求", exact: true }).click();
    editor = page.getByRole("dialog", { name: "新建需求", exact: true });
    await expect(
      editor.getByText(/上次待上传图片未在刷新后保留/),
    ).toBeVisible();
    await editor
      .getByRole("button", { name: "重试确认保存", exact: true })
      .click();
    if (refresh === 0)
      await expect(
        editor.getByRole("alert").filter({ hasText: "网络连接失败" }),
      ).toBeVisible();
  }
  await expect(
    editor.getByText(/图片未在刷新后保留，请查看已保存需求/),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "查看已保存需求", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requirement\//);
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(1);
});

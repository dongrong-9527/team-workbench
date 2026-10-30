import { test, expect } from "./fixtures.js";
import { login } from "./helpers.js";
import { api, requirement } from "./audit-helpers.js";
import sharp from "sharp";

test("browser reload warns when the latest editable text could not be persisted", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新建任务", exact: true });
  await editor.getByLabel("标题", { exact: true }).fill("旧的本地内容");
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("Synthetic quota", "QuotaExceededError");
    };
  });
  await editor.getByLabel("标题", { exact: true }).fill("最新文字尚未持久化");
  await expect(editor.getByRole("alert")).toContainText("暂存失败");
  let warnings = 0;
  page.once("dialog", async (dialog) => {
    warnings++;
    await dialog.dismiss();
  });
  await page.reload({ timeout: 3000 }).catch(() => undefined);
  expect(warnings).toBe(1);
  await expect(editor.getByLabel("标题", { exact: true })).toHaveValue(
    "最新文字尚未持久化",
  );
});

test("an unknown requirement create freezes custom acceptance-row controls as well as text fields", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "新建需求", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新建需求", exact: true });
  await page.route("**/api/requirements", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fetch();
    return route.abort();
  });
  await editor.getByLabel("标题", { exact: true }).fill("合成未知需求条目冻结");
  await editor
    .getByLabel("来源说明", { exact: true })
    .fill("原命令已发送，不能再改验收行");
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "重试确认保存", exact: true }),
  ).toBeVisible();
  await editor.getByText("补充细节", { exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "添加条目", exact: true }),
  ).toBeDisabled();
});

test("phone creation keeps a fixed visible footer and scrolls only long Modal content", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "product");
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "新建任务", exact: true });
  await expect(modal).toHaveAttribute("aria-modal", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const footer = modal.locator(".mutation-footer");
  const box = await footer.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(836);
  expect(
    await modal
      .locator(".mutation-scroll")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  await expect(
    modal.getByRole("button", { name: "返回", exact: true }),
  ).toBeInViewport();
  await expect(
    modal.getByRole("button", { name: "保存为草稿", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: info.outputPath("creation-modal-phone.png"),
    fullPage: false,
  });
  const first = modal.locator(".ant-modal-close"),
    last = modal.getByRole("button", { name: "确认新建任务", exact: true });
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
});

test("nested requirement clear and image-loss confirmations keep Escape and focus in the top Modal", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "新建需求", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新建需求", exact: true });
  const image = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#789abc" },
  })
    .png()
    .toBuffer();
  await editor.getByLabel("标题", { exact: true }).fill("合成嵌套弹框保护");
  await editor
    .getByLabel("选择需求截图", { exact: true })
    .setInputFiles({
      name: "synthetic.png",
      mimeType: "image/png",
      buffer: image,
    });
  await editor.getByRole("button", { name: "返回", exact: true }).click();
  const lost = page.getByRole("dialog", {
    name: "放弃待上传图片？",
    exact: true,
  });
  await expect(lost).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lost).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("img", { name: "待上传：synthetic.png", exact: true }),
  ).toBeVisible();
  const clear = editor.getByRole("button", { name: "清空", exact: true });
  await clear.click();
  const confirm = page.getByRole("dialog", {
    name: "清空未保存内容",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(clear).toBeFocused();
});

test("a pending real creation disables return and draft actions and ignores duplicate clicks and Escape", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "新建任务", exact: true });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let writes = 0;
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    const response = await route.fetch();
    await gate;
    return route.fulfill({ response });
  });
  try {
    await modal.getByLabel("标题", { exact: true }).fill("合成提交中真实弹框");
    await modal
      .getByRole("button", { name: "确认新建任务", exact: true })
      .dblclick();
    await expect.poll(() => writes).toBe(1);
    await expect(
      modal.getByRole("button", { name: "返回", exact: true }),
    ).toBeDisabled();
    await expect(
      modal.getByRole("button", { name: "保存为草稿", exact: true }),
    ).toBeDisabled();
    await expect(modal.locator(".ant-modal-close")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(modal).toBeVisible();
  } finally {
    release();
  }
  await expect(page).toHaveURL(/\/task\//);
  expect(writes).toBe(1);
});

test("an unfinished work update can save a local draft without writing progress", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("link", { name: "完善工作更新的字段校验", exact: true })
    .click();
  await page.getByRole("button", { name: "写工作更新", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "写工作更新", exact: true });
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/updates")
      writes++;
  });
  await editor
    .getByLabel("下一步计划", { exact: true })
    .fill("合成未提交的下一步说明");
  await editor.getByRole("button", { name: "保存为草稿", exact: true }).click();
  await expect(
    editor.getByText("草稿已保存在当前浏览器，尚未提交业务数据。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    editor.getByLabel("今天实际做了什么", { exact: true }),
  ).toHaveValue("");
  await editor.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "写工作更新", exact: true }).click();
  await expect(editor.getByLabel("下一步计划", { exact: true })).toHaveValue(
    "合成未提交的下一步说明",
  );
  expect(writes).toBe(0);
});

test("failed local draft storage reports failure and return cannot silently lose the form", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新建任务", exact: true });
  await editor
    .getByLabel("完成标准", { exact: true })
    .fill("仅在本页的未完成草稿");
  await page.evaluate(() => {
    (window as any).originalDraftSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException("Synthetic quota", "QuotaExceededError");
    };
  });
  await editor.getByRole("button", { name: "保存为草稿", exact: true }).click();
  await expect(
    editor.getByText("草稿保存失败，内容仍在当前页面，请勿直接离开。", {
      exact: true,
    }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "返回", exact: true }).click();
  const warning = page.getByRole("dialog", {
    name: "本地暂存失败",
    exact: true,
  });
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "继续填写", exact: true }).click();
  await expect(editor).toBeVisible();
  await page.evaluate(() => {
    Storage.prototype.setItem = (window as any).originalDraftSetItem;
  });
  await editor.getByRole("button", { name: "保存为草稿", exact: true }).click();
  await expect(
    editor.getByText("草稿已保存在当前浏览器，尚未提交业务数据。", {
      exact: true,
    }),
  ).toBeVisible();
});

for (const discard of [false, true]) {
  test(`quota failure during expired-session relogin ${discard ? "resumes only after explicit discard" : "retains input on Escape and continue"}`, async ({ page }) => {
    await login(page, "product");
    await page.goto("/projects/p1");
    await page.getByRole("button", { name: "新建任务", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "新建任务", exact: true });
    let writes = 0;
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/api/tasks" && request.method() === "POST") writes++;
    });
    await page.evaluate(() => {
      Storage.prototype.setItem = function () { throw new DOMException("Synthetic quota", "QuotaExceededError"); };
    });
    await editor.getByLabel("标题", { exact: true }).fill("合成尚未暂存的会话内容");
    await page.evaluate(() => window.dispatchEvent(new Event("workbench:expired")));
    await page.getByRole("dialog", { name: "登录会话已失效", exact: true })
      .getByRole("button", { name: "重新登录", exact: true }).click();
    const warning = page.getByRole("dialog", { name: "本地暂存失败", exact: true });
    await expect(warning).toBeVisible();
    if (discard) {
      await warning.getByRole("button", { name: "放弃本页内容并返回", exact: true }).click();
      await expect(page).toHaveURL(/\/login\?return=/);
    } else {
      await page.keyboard.press("Escape");
      await expect(warning).not.toBeVisible();
      await expect(editor.getByLabel("标题", { exact: true })).toHaveValue("合成尚未暂存的会话内容");
      await expect(page).toHaveURL(/\/projects\/p1/);
      await editor.getByRole("button", { name: "返回", exact: true }).click();
      await warning.getByRole("button", { name: "继续填写", exact: true }).click();
      await expect(editor).toBeVisible();
      await expect(editor.getByLabel("标题", { exact: true })).toHaveValue("合成尚未暂存的会话内容");
    }
    expect(writes).toBe(0);
  });
}

test("an ambiguous creation retains its valid command even if restored editable values are malformed", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新建任务", exact: true });
  let lost = true;
  const keys: string[] = [];
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]!);
    if (lost) {
      lost = false;
      await route.fetch();
      return route.abort();
    }
    return route.continue();
  });
  await editor
    .getByLabel("标题", { exact: true })
    .fill("合成原命令恢复不依赖坏的可编辑值");
  await editor
    .getByRole("button", { name: "确认新建任务", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "重试确认创建", exact: true }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "返回", exact: true }).click();
  await page.evaluate(() => {
    const key = "workbench:draft:product:create:task:p1",
      saved = JSON.parse(localStorage.getItem(key)!);
    saved.values = [];
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "重试确认创建", exact: true }),
  ).toBeVisible();
  await expect(editor.getByLabel("标题", { exact: true })).toBeDisabled();
  await editor
    .getByRole("button", { name: "重试确认创建", exact: true })
    .click();
  await expect(page).toHaveURL(/\/task\//);
  expect(keys).toHaveLength(2);
  expect(new Set(keys).size).toBe(1);
});

test("unfinished task draft saves locally without creating or validating a server object", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建任务", exact: true });
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/tasks")
      writes.push(r.url());
  });
  await dialog
    .getByLabel("完成标准", { exact: true })
    .fill("尚未填标题，先存本机");
  const save = dialog.getByRole("button", { name: "保存为草稿", exact: true });
  await expect(save).toBeVisible();
  await save.click();
  await expect(
    dialog.getByText("草稿已保存在当前浏览器，尚未提交业务数据。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByLabel("标题", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await expect(dialog.getByLabel("完成标准", { exact: true })).toHaveValue(
    "尚未填标题，先存本机",
  );
  expect(writes).toEqual([]);
});

test("project edit returns without a standalone draft action or server mutation", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/projects/p1");
  await page.getByRole("button", { name: "编辑项目", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑项目", exact: true });
  await expect(
    dialog.getByRole("button", { name: "保存为草稿", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "保存修改", exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("项目名称", { exact: true })
    .fill("本次没有提交的名称");
  await dialog.getByRole("button", { name: "返回", exact: true }).click();
  expect((await api(page, "GET", "/api/projects/p1")).name).toBe(
    "星河协作计划",
  );
});

for (const kind of ["task", "bug"] as const)
  test(`${kind} unknown create keeps one original command through return, reload, and a rejected retry`, async ({
    page,
  }) => {
    await login(page, "product");
    await page.goto("/projects/p1");
    const entry = kind === "task" ? "新建任务" : "新建 Bug",
      title = kind === "task" ? "新建任务" : "新建Bug";
    await page.getByRole("button", { name: entry, exact: true }).click();
    let dialog = page.getByRole("dialog", { name: title, exact: true });
    let attempt = 0;
    const keys: string[] = [];
    await page.route(
      `**/api/${kind === "task" ? "tasks" : "bugs"}`,
      async (route) => {
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
            body: JSON.stringify({ error: "合成重试临时拒绝" }),
          });
        return route.continue();
      },
    );
    const text = "合成未知新建保护 " + kind;
    await dialog.getByLabel("标题", { exact: true }).fill(text);
    await dialog
      .getByRole("button", {
        name: kind === "task" ? "确认新建任务" : "确认新建Bug",
        exact: true,
      })
      .click();
    await expect(
      dialog.getByRole("button", { name: "重试确认创建", exact: true }),
    ).toBeVisible();
    await expect(dialog.getByLabel("标题", { exact: true })).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "保存为草稿", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "返回", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: entry, exact: true }).click();
    dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog.getByLabel("标题", { exact: true })).toHaveValue(text);
    await dialog
      .getByRole("button", { name: "重试确认创建", exact: true })
      .click();
    await expect(dialog.getByText(/合成重试临时拒绝/)).toBeVisible();
    await expect(dialog.getByLabel("标题", { exact: true })).toBeDisabled();
    await dialog
      .getByRole("button", { name: "重试确认创建", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp("/" + kind + "/"));
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    const items = (
      await api(
        page,
        "GET",
        `/api/${kind === "task" ? "tasks" : "bugs"}?projectId=p1&limit=100`,
      )
    ).items;
    expect(items.filter((x: any) => x.title === text)).toHaveLength(1);
  });

test("a foreign draft context cannot be restored under the current user's storage key", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  await page.evaluate(() =>
    localStorage.setItem(
      "workbench:draft:product:create:task:p1",
      JSON.stringify({
        context: {
          actor: "dev",
          draftKey: "create:task:p1",
          path: "/api/tasks",
          method: "POST",
          projectId: "p1",
        },
        values: {
          title: "不属于当前上下文",
          kind: "backend",
          priority: "medium",
        },
      }),
    ),
  );
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("标题", { exact: true }),
  ).toHaveValue("");
});

test("all standalone creation entries are real masked Modals with background and safe focus return", async ({
  page,
}, info) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  for (const [entry, title] of [
    ["新建需求", "新建需求"],
    ["新建任务", "新建任务"],
    ["新建 Bug", "新建Bug"],
  ]) {
    const trigger = page.getByRole("button", { name: entry, exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(page.locator(".ant-modal-mask")).toBeVisible();
    await expect(dialog).toHaveClass(/ant-modal/);
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(page.locator("#main > .page-action-form")).toHaveCount(0);
    await expect(
      page
        .locator("#main")
        .getByRole("heading", { name: "星河协作计划", exact: true }),
    ).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("标题", { exact: true })
      .fill("合成真实弹框 " + entry);
    if (entry === "新建需求")
      await page.screenshot({
        path: info.outputPath("creation-modal-desktop.png"),
        fullPage: false,
      });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test("requirement split and a direct linked Bug URL use Modals and retain a safe background", async ({
  page,
}) => {
  await login(page, "product");
  const r = await requirement(page, "合成弹框拆分来源");
  await page.goto(`/requirement/${r.id}`);
  await page.getByRole("button", { name: "拆分任务", exact: true }).click();
  const split = page.getByRole("dialog", { name: "新建任务", exact: true });
  await expect(split).toHaveClass(/ant-modal/);
  await expect(split.getByLabel("关联需求编号", { exact: true })).toHaveValue(
    r.id,
  );
  await split.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/requirement/${r.id}$`));
  await page.goto(`/projects/p1?create=bug&requirementId=${r.id}`);
  await page.reload();
  const bug = page.getByRole("dialog", { name: "新建Bug", exact: true });
  await expect(bug).toHaveClass(/ant-modal/);
  await expect(bug.getByLabel("关联需求编号", { exact: true })).toHaveValue(
    r.id,
  );
  await bug.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/p1$/);
});

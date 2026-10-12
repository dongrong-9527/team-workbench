import { test, expect } from "./fixtures.js";
import { login } from "./helpers.js";
test("task_10 late history completion after navigation retains actual error diagnostics", async ({
  page,
}) => {
  await login(page);
  await page.evaluate(() => {
    const app = (document.querySelector("#app") as any).__vue_app__;
    const previous = app.config.errorHandler;
    app.config.errorHandler = (error: any, instance: any, info: string) => {
      void (window as any).__workbenchBrowserFailure({
        kind: "vue-error-handler",
        message: error?.message,
        stack: error?.stack,
        info,
        component: instance?.$options?.__name,
      });
      if (previous) previous(error, instance, info);
      else throw error;
    };
    app.mixin({
      mounted() {
        if (
          ["HistoryList", "ObjectDetail"].includes(
            (this as any).$options.__name,
          )
        )
          console.info(
            "[workbench:diagnostic]",
            "mounted",
            (this as any).$options.__name,
            location.pathname,
          );
      },
      unmounted() {
        if (
          ["HistoryList", "ObjectDetail"].includes(
            (this as any).$options.__name,
          )
        )
          console.info(
            "[workbench:diagnostic]",
            "unmounted",
            (this as any).$options.__name,
            location.pathname,
          );
      },
    });
  });
  let release!: () => void;
  let received!: () => void;
  const held = new Promise<void>((r) => (received = r));
  await page.route("**/api/objects/task/*/history?*", async (route) => {
    const response = await route.fetch();
    await new Promise<void>((r) => {
      release = r;
      received();
    });
    await route.fulfill({ response });
  });
  await page
    .getByRole("link", { name: "完善工作更新的字段校验", exact: true })
    .click();
  await held;
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: /我的工作/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "我的工作", exact: true }),
  ).toBeVisible();
  const completed = page.waitForResponse((r) => r.url().includes("/history?"));
  release();
  await completed;
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await expect(
    page.getByRole("heading", { name: "我的工作", exact: true }),
  ).toBeVisible();
});

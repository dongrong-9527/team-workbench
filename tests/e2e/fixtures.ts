import {
  test as base,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { writeFile } from "node:fs/promises";

// Context-level collection covers popup/secondary pages as well as the default
// page. Do not prevent browser errors or hide Vue warnings. Diagnostics exclude
// request headers/bodies so activation tickets and passwords never enter them.
export const test = base.extend<{
  observeContext: (context: BrowserContext) => Promise<void>;
}>({
  observeContext: [
    async ({ context }, use, testInfo) => {
      const errors: unknown[] = [];
      const timeline: unknown[] = [];
      const record = (event: unknown) => {
        timeline.push(event);
        if (timeline.length > 300) timeline.shift();
      };
      const observed = new WeakSet<BrowserContext>();
      async function observe(context: BrowserContext) {
        if (observed.has(context)) return;
        observed.add(context);
        await context.exposeBinding(
          "__workbenchBrowserFailure",
          ({ page }, value) => {
            const event = { page: page.url(), time: Date.now(), ...value };
            errors.push(event);
            record(event);
          },
        );
        await context.addInitScript(() => {
          const report = (value: unknown) =>
            (window as any).__workbenchBrowserFailure(value);
          window.addEventListener("error", (e) => {
            void report({
              kind: "window-error",
              message: e.message,
              stack: e.error?.stack,
            });
          });
          window.addEventListener("unhandledrejection", (e) => {
            void report({
              kind: "unhandled-rejection",
              message: String(e.reason),
              stack: e.reason?.stack,
            });
          });
        });
        const attached = new WeakSet<Page>();
        const attach = (page: Page) => {
          if (attached.has(page)) return;
          attached.add(page);
          page.on("pageerror", (error) => {
            errors.push({
              kind: "pageerror",
              page: page.url(),
              message: error.message,
              stack: error.stack,
            });
          });
          page.on("console", (message) => {
            if (message.text().startsWith("[workbench:diagnostic]"))
              record({
                kind: "lifecycle",
                message: message.text(),
                time: Date.now(),
              });
            if (message.text().includes("[Vue warn]: Unhandled error"))
              errors.push({
                kind: "vue-warning",
                page: page.url(),
                message: message.text(),
                location: message.location(),
              });
          });
          page.on("framenavigated", (frame) => {
            if (frame === page.mainFrame())
              record({
                kind: "navigation",
                url: frame.url(),
                time: Date.now(),
              });
          });
          page.on("close", () =>
            record({ kind: "page-close", time: Date.now() }),
          );
        };
        context.on("page", attach);
        for (const page of context.pages()) attach(page);
        context.on("request", (request) => {
          if (
            request.method() === "GET" &&
            new URL(request.url()).pathname.startsWith("/api/")
          )
            record({ kind: "request", url: request.url(), time: Date.now() });
        });
        context.on("response", (response) => {
          if (
            response.request().method() === "GET" &&
            new URL(response.url()).pathname.startsWith("/api/")
          )
            record({
              kind: "response",
              url: response.url(),
              status: response.status(),
              time: Date.now(),
            });
        });
        context.on("requestfailed", (request) => {
          const path = new URL(request.url()).pathname;
          if (path.startsWith("/api/") || path.startsWith("/src/")) record({
            kind: "request-failed", path, method: request.method(),
            failure: request.failure()?.errorText, time: Date.now(),
          });
        });
      }
      await observe(context);
      await use(observe);
      const path = testInfo.outputPath("browser-diagnostics.json");
      await writeFile(
        path,
        JSON.stringify({ test: testInfo.title, errors, timeline }, null, 2),
      );
      expect(
        errors,
        "No uncaught errors, rejections or unhandled Vue warnings in any page",
      ).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

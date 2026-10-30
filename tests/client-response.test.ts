import { afterEach, expect, test, vi } from "vitest";
import { ApiError, request } from "../apps/web/src/api/client.js";

afterEach(() => vi.unstubAllGlobals());

test("a successful response whose body is interrupted rejects instead of fabricating data", async () => {
  let interrupt!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      interrupt = controller;
      controller.enqueue(new TextEncoder().encode('{"items":'));
    },
  });
  vi.stubGlobal("fetch", async () => new Response(body, { status: 200 }));
  const result = request("/api/objects/task/example/history?limit=20");
  const rejected = expect(result).rejects.toBeInstanceOf(ApiError);
  interrupt.error(new TypeError("Failed to fetch"));
  await rejected;
});

test("invalid JSON in a successful response is a recoverable request error", async () => {
  vi.stubGlobal("fetch", async () => new Response("{", { status: 200 }));
  await expect(request("/api/example")).rejects.toBeInstanceOf(ApiError);
});

test("valid JSON responses retain their payload", async () => {
  const payload = { items: [], nextAfterSeq: null, cutoffSeq: 0 };
  vi.stubGlobal("fetch", async () => Response.json(payload));
  await expect(request("/api/example")).resolves.toEqual(payload);
});

test("non-JSON failure responses retain the HTTP status and recovery message", async () => {
  vi.stubGlobal(
    "fetch",
    async () => new Response("upstream unavailable", { status: 503 }),
  );
  await expect(request("/api/example")).rejects.toMatchObject({
    code: 503,
    message: "数据库繁忙，输入已保留，请稍后重试。",
  });
});

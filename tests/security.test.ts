import { afterEach, beforeEach, expect, test } from "vitest";
import { createTestKit, type TestKit } from "./helpers.js";
let f: TestKit;
beforeEach(async () => {
  f = await createTestKit();
});
afterEach(async () => {
  await f.close();
});
test("public health exposes status only and administrator information requires current admin", async () => {
  for (const route of ["live", "ready"]) {
    const r = await f.api("GET", `/api/health/${route}`, {}, "anonymous");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ok" });
  }
  expect(
    (await f.api("GET", "/api/admin/runtime", {}, "anonymous")).status,
  ).toBe(401);
  expect((await f.api("GET", "/api/admin/runtime", {}, "dev")).status).toBe(
    403,
  );
  const r = await f.api("GET", "/api/admin/runtime");
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({
    nodeVersion: process.versions.node,
    schemaVersion: 10,
  });
  f.db.prepare("UPDATE members SET is_admin=0 WHERE id='admin'").run();
  expect((await f.api("GET", "/api/admin/runtime")).status).toBe(403);
});
test("ready fails closed when migration ledger is incomplete while live stays healthy", async () => {
  f.db.prepare("DELETE FROM schema_migrations WHERE version=5").run();
  expect(
    await f.api("GET", "/api/health/ready", {}, "anonymous"),
  ).toMatchObject({ status: 503, body: { status: "unavailable" } });
  expect(
    (await f.api("GET", "/api/health/live", {}, "anonymous")).body,
  ).toEqual({ status: "ok" });
});
test("admin runtime includes aggregate transaction wait measurements without request content", async () => {
  await f.api("POST", "/test/mutation", { title: "private text" });
  const r = await f.api("GET", "/api/admin/runtime");
  expect(r.body).toHaveProperty("mutations.count");
  expect(JSON.stringify(r.body)).not.toContain("private text");
});

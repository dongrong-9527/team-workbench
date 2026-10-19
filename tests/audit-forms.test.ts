import { afterEach, beforeEach, expect, it } from "vitest";
import { actionForm, createForm } from "../apps/web/src/forms.js";
import { state } from "../apps/web/src/state.js";
import { createTestKit, type TestKit } from "./helpers.js";

let f: TestKit;
beforeEach(async () => {
  f = await createTestKit();
  state.projects = [{ id: "p1", name: "Project One", description: "", archived: 0,
    version: 1, myRoles: [{ role: "product", lead: 0 }] }];
  state.members = (await f.api<any>("GET", "/api/members")).body.items;
  state.projectMembers.p1 = (await f.api<any>("GET", "/api/members?projectId=p1")).body.items;
});
afterEach(async () => {
  state.projects = [];
  state.members = [];
  state.projectMembers = {};
  await f.close();
});

it.each(["frontend", "backend"])("other/%s creation offers actual test-role reviewers", (role) => {
  const form = createForm("task", "p1");
  const values = { ...form.initial, kind: "other", role };
  const candidates = form.fields.find((x) => x.key === "reviewerId")!.optionsFor!(values);
  expect(candidates.map((x) => x.value)).toEqual(["tester"]);
});

it("other/test retains product or matching test-lead reviewers", () => {
  const form = createForm("task", "p1");
  const candidates = form.fields.find((x) => x.key === "reviewerId")!.optionsFor!({ ...form.initial, kind: "other", role: "test" });
  expect(candidates.map((x) => x.value).sort()).toEqual(["admin", "product"]);
});

it("link-only unrefined requirement form saves a real incomplete draft", async () => {
  const form = createForm("requirement", "p1");
  const values = { ...form.initial, title: "Synthetic source to refine", sourceUrl: "https://docs.example.test/synthetic" };
  const result = await f.api<any>("POST", form.path, form.body(values), "product");
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ state: "draft", description: "", criteria: [], source: { url: values.sourceUrl } });
  expect(result.body.acceptorId).toBeFalsy();
  for (const key of ["sourceDescription", "description", "acceptorId", "criteria"])
    expect(form.fields.find((x) => x.key === key)?.required).toBeFalsy();
  const ready = await f.api("POST", `/api/requirements/${result.body.id}/actions`, { action: "makeReady", expectedVersion: result.body.version }, "product");
  expect(ready.status).not.toBe(200);
});

it("empty source is explained before sending rather than invented", () => {
  const form = createForm("requirement", "p1");
  expect(() => form.body({ ...form.initial, title: "Missing source" })).toThrow(/来源链接或来源说明/);
});

it("pending task form preserves the empty required standard key for later refinement", async () => {
  const form = createForm("task", "p1");
  const result = await f.api<any>("POST", form.path, form.body({ ...form.initial, title: "Synthetic pending standard" }), "product");
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ state: "pending", definitionOfDone: "" });
  expect(form.fields.find((x) => x.key === "definitionOfDone")?.required).toBeFalsy();
});

it("oral Bug form saves incomplete reproduction and retains confirmation gate", async () => {
  const form = createForm("bug", "p1");
  const result = await f.api<any>("POST", form.path, form.body({ ...form.initial, title: "Synthetic spoken issue" }), "product");
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ state: "unconfirmed", expected: "", actual: "", reproduction: "", environment: "" });
  for (const key of ["expected", "actual", "reproduction", "environment"])
    expect(form.fields.find((x) => x.key === key)?.required).toBeFalsy();
  expect((await f.api("POST", `/api/bugs/${result.body.id}/actions`, { action: "confirm", expectedVersion: result.body.version, reason: "Review draft" }, "product")).status).toBe(422);
});

it("correction locks the actual contribution type and ignores stale restored classification", async () => {
  const task = (await f.api<any>("POST", "/api/tasks", { projectId: "p1", title: "Synthetic classification", kind: "backend", definitionOfDone: "Review", priority: "medium" }, "product")).body;
  const original = await f.api<any>("POST", "/api/updates", { target: { kind: "task", id: task.id }, workDate: "2026-10-19", contributionType: "testing", done: "Reviewed boundary" }, "tester");
  expect(original.status).toBe(200);
  const form = actionForm("task", task, "update", [], undefined, original.body);
  expect(form.fields.find((x) => x.key === "contributionType")?.disabled).toBe(true);
  const body = form.body({ ...form.initial, contributionType: "development", done: "Corrected review text", reason: "Correct wording" });
  expect(body.contributionType).toBe("testing");
  const corrected = await f.api<any>("POST", form.path, { ...body, expectedVersion: original.body.version }, "tester");
  expect(corrected.status).toBe(200);
  expect(corrected.body).toMatchObject({ contributionType: "testing", version: 2 });
});

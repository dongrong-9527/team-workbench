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

it("return-only acceptance preserves the submitted build and rejects an adopted unrelated revision", () => {
  const r = { id: "synthetic-round", projectId: "p1", title: "Current submitted scope", version: 4, revision: 1, state: "active", role: "backend", acceptorId: "product", acceptanceTargetVersion: "build-1",
    acceptanceRound: { revision: 1, targetVersion: "build-1", submittedSeq: 5 }, criteria: [{ id: "a", text: "Behavior", required: true }] };
  const form = actionForm("requirement", r, "returnAcceptance");
  expect(form.path).toBe(`/api/requirements/${r.id}/acceptance`);
  expect(form.body({ ...form.initial, decision: "pass", targetVersion: "different" })).toMatchObject({ decision: "return", revision: 1, targetVersion: "build-1" });
  expect(form.fields.find((x) => x.key === "decision")?.disabled).toBe(true);
  const values = structuredClone(form.initial);
  form.adopt!({ ...r, version: 5, revision: 2, acceptanceRound: null }, values);
  expect(() => form.body(values)).toThrow(/验收轮次/);
});

it("test evidence selects same-project existing Bugs and carries explicit registration context", () => {
  const task = { id: "synthetic-task", projectId: "p1", requirementId: "synthetic-requirement", title: "Check this work", kind: "backend", definitionOfDone: "Check", state: "pending_check", version: 2 };
  const linked = [ { id: "bug-one", projectId: "p1", title: "Existing discrepancy", objectKind: "bug" }, { id: "foreign-bug", projectId: "p2", title: "Other project", objectKind: "bug" } ];
  const form = actionForm("task", task, "checkFail", linked);
  expect(form.fields.find((x) => x.key === "bugId")).toMatchObject({ type: "select", options: [{ value: "bug-one", label: "Existing discrepancy · bug-one" }] });
  expect(form.relatedBugContext).toMatchObject({ projectId: "p1", requirementId: "synthetic-requirement", taskId: "synthetic-task", role: "backend" });
});

it("requirement cancellation permits an empty disposition when there are no unfinished tasks", () => {
  const r = { id: "synthetic-no-tasks", projectId: "p1", title: "Empty work", version: 1, revision: 1, state: "draft", criteria: [], source: { description: "Source" } };
  const form = actionForm("requirement", r, "cancel");
  expect(form.fields.find((x) => x.key === "taskDisposition")?.required).toBe(false);
  expect(form.body({ ...form.initial, reason: "Stop draft" })).toMatchObject({ action: "cancel", taskDisposition: [] });
});

import { expect, it } from "vitest";
import { createForm, actionForm, field } from "../apps/web/src/forms.js";
const object = {
  id: "x",
  projectId: "p1",
  title: "title",
  kind: "backend",
  version: 1,
  criteria: [],
  definitionOfDone: "done",
};
function maxima(fields: any[]) {
  return Object.fromEntries(
    fields
      .filter((f) => ["text", "textarea", "url"].includes(f.type))
      .map((f) => [f.key, f.max ?? (f.type === "textarea" ? 6000 : 200)]),
  );
}
it("creation fields advertise their API character bounds", () => {
  expect(maxima(createForm("requirement", "p1").fields)).toMatchObject({
    title: 200,
    sourceDescription: 2000,
    sourceUrl: 2000,
    description: 6000,
  });
  expect(maxima(createForm("task", "p1").fields)).toMatchObject({
    title: 200,
    definitionOfDone: 6000,
    exclusionReason: 2000,
    requirementId: 2000,
  });
  expect(maxima(createForm("bug", "p1").fields)).toMatchObject({
    expected: 4000,
    actual: 4000,
    reproduction: 4000,
    environment: 4000,
    requirementId: 128,
    taskId: 128,
  });
  expect(field("login", "Login").max).toBe(64);
  expect(field("displayName", "Name").max).toBe(100);
});
it("action fields advertise endpoint-specific narrative and scalar bounds", () => {
  for (const kind of ["task", "bug"]) {
    expect(maxima(actionForm(kind, object, "submit").fields)).toMatchObject({
      selfCheck: 4000,
      environment: 4000,
      targetVersion: 200,
      ...(kind === "bug" ? { fix: 4000, impact: 4000 } : { done: 4000 }),
    });
    expect(maxima(actionForm(kind, object, "transfer").fields)).toMatchObject({
      reason: 2000,
      handoff: 4000,
    });
    expect(maxima(actionForm(kind, object, "block").fields)).toMatchObject({
      reason: 2000,
      assistance: 2000,
    });
    expect(maxima(actionForm(kind, object, "test").fields)).toMatchObject({
      targetVersion: 200,
      environment: 2000,
      reusedFromId: 128,
      reuseReason: 4000,
    });
    expect(actionForm(kind, object, "test").fields.find((f) => f.key === "bugId"))
      .toMatchObject({ type: "select", max: 128 });
  }
  expect(
    maxima(actionForm("requirement", object, "acceptance").fields),
  ).toMatchObject({ reason: 4000 });
  expect(
    maxima(actionForm("requirement", object, "waiver").fields),
  ).toMatchObject({ reason: 4000, plan: 4000 });
  expect(
    maxima(actionForm("requirement", object, "makeReady").fields),
  ).toMatchObject({
    sourceDescription: 2000,
    sourceUrl: 2000,
    sourceReason: 2000,
  });
  expect(maxima(actionForm("task", object, "update").fields)).toMatchObject({
    done: 6000,
    next: 6000,
    obstacle: 6000,
  });
});

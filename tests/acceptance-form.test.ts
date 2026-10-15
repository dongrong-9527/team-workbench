import { expect, it } from "vitest";
import { actionForm } from "../apps/web/src/forms.js";

const requirement = () => ({
  id: "synthetic-r",
  projectId: "synthetic-p",
  title: "Synthetic scope",
  version: 3,
  revision: 1,
  state: "pending_acceptance",
  acceptorId: "product",
  role: "backend",
  acceptanceTargetVersion: "build-1",
  criteria: [{ id: "first", text: "First behavior", required: true }],
});

it("adopting an acceptance version preserves the current revision's typed conclusions", () => {
  const r = requirement();
  const form = actionForm("requirement", r, "acceptance");
  const values = structuredClone(form.initial);
  values.criteria[0].passed = true;
  values.criteria[0].note = "Manual business conclusion";
  values.reason = "Product's own typed explanation";
  expect(form.adopt).toBeTypeOf("function");
  form.adopt!({ ...r, version: 4 }, values);
  expect(form.body(values)).toMatchObject({
    revision: 1,
    reason: values.reason,
    criteria: [
      { id: "first", passed: true, note: "Manual business conclusion" },
    ],
  });
});

it("adopting a new scope uses its actual revision and requires fresh checks without losing prior notes", () => {
  const r = requirement();
  const form = actionForm("requirement", r, "acceptance");
  const values = structuredClone(form.initial);
  values.criteria[0].passed = true;
  values.criteria[0].note = "Original checked note";
  values.reason = "My original explanation";
  expect(form.adopt).toBeTypeOf("function");
  form.adopt!(
    {
      ...r,
      revision: 2,
      version: 4,
      criteria: [
        { id: "first", text: "Changed first behavior", required: true },
        { id: "second", text: "New behavior", required: true },
      ],
    },
    values,
  );
  expect(form.body(values)).toMatchObject({
    revision: 2,
    reason: "My original explanation",
    criteria: [
      { id: "first", passed: false, note: "Original checked note" },
      { id: "second", passed: false },
    ],
  });
  expect(values.previousAcceptanceCriteria).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "first",
        passed: true,
        note: "Original checked note",
      }),
    ]),
  );
});

it("a restored old revision is compared with its own saved scope rather than the new form factory", () => {
  const old = actionForm("requirement", requirement(), "acceptance");
  const restored = structuredClone(old.initial);
  restored.criteria[0].passed = true;
  restored.criteria[0].note = "Note saved before leaving R1";
  const current = {
    ...requirement(),
    revision: 2,
    version: 7,
    criteria: [{ id: "first", text: "New definition at R2", required: true }],
  };
  const reopened = actionForm("requirement", current, "acceptance");
  reopened.adopt!(current, restored);
  expect(reopened.body(restored)).toMatchObject({
    revision: 2,
    criteria: [
      { id: "first", passed: false, note: "Note saved before leaving R1" },
    ],
  });
  expect(restored.previousAcceptanceCriteria).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: "First behavior", passed: true }),
    ]),
  );
});

it("a legacy draft without a saved revision conservatively requires fresh manual checks", () => {
  const r = requirement();
  const reopened = actionForm("requirement", r, "acceptance");
  const restored = structuredClone(reopened.initial);
  delete restored.acceptanceRevision;
  restored.criteria[0].passed = true;
  restored.criteria[0].note = "Legacy note remains readable";
  reopened.adopt!({ ...r, version: 4 }, restored);
  expect(reopened.body(restored).criteria[0]).toMatchObject({
    passed: false,
    note: "Legacy note remains readable",
  });
  expect(restored.previousAcceptanceCriteria).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        passed: true,
        note: "Legacy note remains readable",
      }),
    ]),
  );
});

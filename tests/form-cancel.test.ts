import { expect, it, afterEach } from "vitest";
import { actionForm, createForm, formCancelPresentation, type FormSpec } from "../apps/web/src/forms.js";
import { state } from "../apps/web/src/state.js";

afterEach(() => { state.projects = []; });
it.each([
  { name: "empty confirmation", fields: [], cancelLabel: undefined, sensitive: false, label: "取消", hints: false },
  { name: "empty confirmation cannot opt into an ordinary draft", fields: [], cancelLabel: "返回并保留草稿", sensitive: false, label: "取消", hints: false },
  { name: "locked-only context", fields: [{ key: "build", label: "构建", disabled: true }], cancelLabel: "返回并保留草稿", sensitive: false, label: "取消", hints: false },
  { name: "short editable input", fields: [{ key: "name", label: "名称" }], cancelLabel: undefined, sensitive: false, label: "取消", hints: true },
  { name: "recoverable long input", fields: [{ key: "done", label: "实际工作", type: "textarea" }], cancelLabel: "返回并保留草稿", sensitive: false, label: "返回并保留草稿", hints: true },
  { name: "sensitive input cannot promise draft recovery", fields: [{ key: "secret", label: "敏感值" }], cancelLabel: "返回并保留草稿", sensitive: true, label: "取消", hints: false },
])("cancel presentation respects $name", ({ fields, cancelLabel, sensitive, label, hints }) => {
  expect(formCancelPresentation({ fields, cancelLabel } as FormSpec, sensitive)).toEqual({ label, showDraftHints: hints });
});

const object = { id: "synthetic", projectId: "p1", kind: "backend", title: "Synthetic work", version: 1, revision: 1, role: "backend", description: "Actual definition", definitionOfDone: "Actually verify", source: { description: "Actual source" }, criteria: [{ id: "a", text: "Actual criterion", required: true }], acceptanceRound: { revision: 1, targetVersion: "build-1" } };
it.each([
  ["claim", "取消"], ["start", "取消"], ["reopen", "取消"], ["cancel", "取消"],
  ["unblock", "取消"], ["approveParallel", "取消"], ["designateReviewer", "取消"],
  ["setRequired", "取消"], ["setDependencies", "取消"], ["suggestChange", "取消"],
  ["restore", "取消"], ["confirm", "取消"], ["submitAcceptance", "取消"],
  ["assign", "返回并保留草稿"], ["transfer", "返回并保留草稿"], ["requestTransfer", "返回并保留草稿"],
  ["submit", "返回并保留草稿"], ["checkPass", "返回并保留草稿"], ["checkFail", "返回并保留草稿"],
  ["verifyPass", "返回并保留草稿"], ["verifyFail", "返回并保留草稿"], ["test", "返回并保留草稿"],
  ["block", "返回并保留草稿"], ["reject", "返回并保留草稿"], ["defineChecks", "返回并保留草稿"],
  ["refine", "返回并保留草稿"], ["revise", "返回并保留草稿"], ["makeReady", "返回并保留草稿"],
  ["acceptance", "返回并保留草稿"], ["returnAcceptance", "返回并保留草稿"],
  ["waiver", "返回并保留草稿"], ["update", "返回并保留草稿"],
])("%s chooses wording for its actual form intent", (action, label) => {
  const kind = ["suggestChange", "restore", "submitAcceptance", "revise", "makeReady", "acceptance", "returnAcceptance", "waiver"].includes(action) ? "requirement" : ["confirm", "reject", "verifyPass", "verifyFail"].includes(action) ? "bug" : "task";
  const form = actionForm(kind, object, action);
  expect(formCancelPresentation(form).label).toBe(label);
});

it("requirement cancellation only offers draft return when unfinished child dispositions need work", () => {
  const empty = actionForm("requirement", object, "cancel");
  const done = actionForm("requirement", object, "cancel", [{ id: "closed-child", objectKind: "task", state: "done" }]);
  const populated = actionForm("requirement", object, "cancel", [{ id: "live-child", objectKind: "task", state: "pending" }]);
  expect(formCancelPresentation(empty).label).toBe("取消");
  expect(formCancelPresentation(done).label).toBe("取消");
  expect(formCancelPresentation(populated).label).toBe("返回并保留草稿");
  expect(populated.body(populated.initial)).toMatchObject({ action: "cancel", taskDisposition: [{ taskId: "live-child", disposition: "cancel" }] });
});

it.each(["requirement", "task", "bug"])("%s creation retains recoverable draft return", kind => {
  state.projects = [{ id: "p1", name: "Synthetic", description: "", archived: 0, version: 1, myRoles: [{ role: "product", lead: 0 }] }];
  expect(formCancelPresentation(createForm(kind, "p1"))).toEqual({ label: "返回并保留草稿", showDraftHints: true });
});

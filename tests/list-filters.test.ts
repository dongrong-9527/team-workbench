import { describe, expect, it } from "vitest";
import { effectScope, ref } from "vue";
import {
  countFilters,
  decodeFilters,
  encodeFilters,
  useStagedFilters,
} from "../apps/web/src/composables/listFilters.js";

describe("staged list filters", () => {
  it("keeps edit/reset/collapse separate from applied values and clones on reopen", () => {
    const scope = effectScope();
    scope.run(() => {
      const applied = ref({ keyword: "saved", state: "active" });
      const defaults = { keyword: "", state: "" };
      const emitted: unknown[] = [];
      const panel = useStagedFilters(() => applied.value, () => defaults, () => "p1", (next) => emitted.push(next));
      expect(panel.open.value).toBe(false);
      panel.openPanel();
      panel.draft.value.keyword = "temporary";
      expect(applied.value.keyword).toBe("saved");
      panel.reset();
      expect(panel.draft.value).toEqual(defaults);
      expect(applied.value.state).toBe("active");
      panel.close();
      panel.openPanel();
      expect(panel.draft.value).toEqual({ keyword: "saved", state: "active" });
      expect(emitted).toEqual([]);
      panel.draft.value.keyword = "confirmed";
      panel.apply();
      panel.apply();
      expect(emitted).toEqual([{ keyword: "confirmed", state: "active" }]);
      expect(panel.open.value).toBe(false);
      panel.draft.value.keyword = "after close";
      expect(emitted).toEqual([{ keyword: "confirmed", state: "active" }]);
    });
    scope.stop();
  });

  it("discards drafts synchronously when scope or applied route changes", () => {
    const scope = effectScope();
    scope.run(() => {
      const identity = ref("member-a:project-1");
      const applied = ref({ keyword: "" });
      const panel = useStagedFilters(() => applied.value, () => ({ keyword: "" }), () => identity.value, () => { throw new Error("must not apply"); });
      panel.openPanel();
      panel.draft.value.keyword = "private draft";
      identity.value = "member-b:project-2";
      expect(panel.open.value).toBe(false);
      panel.openPanel();
      expect(panel.draft.value.keyword).toBe("");
      applied.value = { keyword: "back navigation" };
      expect(panel.open.value).toBe(false);
      panel.openPanel();
      expect(panel.draft.value.keyword).toBe("back navigation");
    });
    scope.stop();
  });

  it("counts only applied conditions differing from defaults", () => {
    expect(countFilters({ keyword: "", archive: "all" }, { keyword: "", archive: "all" })).toBe(0);
    expect(countFilters({ keyword: "title", archive: "archived" }, { keyword: "", archive: "all" })).toBe(2);
  });
});

describe("front-only route filters", () => {
  const schema = {
    kind: { key: "filterKind", default: "", values: ["", "task", "requirement", "bug"] },
    blocked: { key: "filterBlocked", default: "", values: ["", "true", "false"] },
    keyword: { key: "q", default: "", max: 200 },
  };
  it("validates scalar query fields without turning arrays into API strings", () => {
    expect(decodeFilters({ filterKind: "task", filterBlocked: ["true", "false"], q: "hello", unknown: "ignored" }, schema)).toEqual({ kind: "task", blocked: "", keyword: "hello" });
    expect(decodeFilters({ filterKind: "admin", filterBlocked: "1", q: "x".repeat(201) }, schema)).toEqual({ kind: "", blocked: "", keyword: "" });
  });
  it("encodes all changes atomically, clears defaults and preserves route context", () => {
    expect(encodeFilters({ workTab: "review", queue: "bugs", projectId: "p1", filterKind: "bug", q: "old", untouched: "yes" }, { kind: "task", blocked: "true", keyword: "" }, schema)).toEqual({ workTab: "review", queue: "bugs", projectId: "p1", untouched: "yes", filterKind: "task", filterBlocked: "true" });
  });
});

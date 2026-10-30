import { ref, watch, type Ref } from "vue";
import type { LocationQuery, LocationQueryRaw } from "vue-router";

export type FilterValues = Record<string, string>;
type FilterField = { key: string; default: string; values?: readonly string[]; max?: number };
export type FilterSchema = Record<string, FilterField>;

// Drafts never share a reactive proxy with applied values.
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
export function useStagedFilters<T extends FilterValues>(applied: () => T, defaults: () => T, scope: () => string, emit: (next: T) => void) {
  const open = ref(false);
  const draft = ref(clone(applied())) as Ref<T>;
  function close() { open.value = false; draft.value = clone(applied()); }
  watch([scope, () => JSON.stringify(applied())], close, { flush: "sync" });
  return {
    open, draft,
    openPanel() { draft.value = clone(applied()); open.value = true; },
    close,
    reset() { if (open.value) draft.value = clone(defaults()); },
    apply() {
      if (!open.value) return;
      const next = clone(draft.value);
      open.value = false;
      emit(next);
    },
  };
}
export function countFilters(applied: FilterValues, defaults: FilterValues) {
  return Object.keys(defaults).filter((key) => applied[key] !== defaults[key]).length;
}
function valid(value: unknown, field: FilterField): value is string {
  return typeof value === "string" && value.length <= (field.max ?? 128) && (!field.values || field.values.includes(value));
}
export function decodeFilters<S extends FilterSchema>(query: LocationQuery | Record<string, unknown>, schema: S): Record<keyof S, string> {
  return Object.fromEntries(Object.entries(schema).map(([name, field]) => [name, valid(query[field.key], field) ? query[field.key] : field.default])) as Record<keyof S, string>;
}
export function encodeFilters(query: LocationQueryRaw, values: FilterValues, schema: FilterSchema): LocationQueryRaw {
  const next = { ...query };
  for (const [name, field] of Object.entries(schema)) {
    delete next[field.key];
    const value = values[name];
    if (valid(value, field) && value !== field.default) next[field.key] = value;
  }
  return next;
}
export const workFilterSchema = {
  kind: { key: "filterKind", default: "", values: ["", "requirement", "task", "bug"] },
  status: { key: "filterState", default: "", values: ["", "draft", "refining", "pending", "ready", "active", "pending_check", "done", "unconfirmed", "fixing", "pending_verify", "closed", "pending_acceptance", "accepted", "cancelled", "rejected"] },
  owner: { key: "filterOwner", default: "" },
  blocked: { key: "filterBlocked", default: "", values: ["", "true", "false"] },
};

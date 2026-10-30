import { onBeforeUnmount } from "vue";

// A page belongs to one immutable query identity. New reads and unmounting
// invalidate old completions, including their error/loading/cursor updates.
export function useReadScope(identity: () => string) {
  let generation = 0;
  let alive = true;
  let pending = false;
  let loadedIdentity: string | undefined;
  onBeforeUnmount(() => {
    alive = false;
    generation++;
  });
  return {
    invalidate() {
      generation++;
      pending = false;
    },
    begin(more = false) {
      const query = identity();
      if (!alive || (more && (pending || loadedIdentity !== query))) return;
      const revision = ++generation;
      pending = true;
      const valid = () =>
        alive && generation === revision && identity() === query;
      return {
        valid,
        commit(update: () => void) {
          if (!valid()) return;
          update();
          loadedIdentity = query;
        },
        finish(update: () => void) {
          if (!valid()) return;
          pending = false;
          update();
        },
      };
    },
  };
}

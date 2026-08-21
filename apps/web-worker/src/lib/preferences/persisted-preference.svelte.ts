/*
 * The persisted-preference primitive — reactive half. `createPersistedPreference` wraps a codec
 * (persisted-preference.ts) in rune state seeded from storage, persists every set through the
 * swallowed writer, and offers `followAcrossTabs` so a change in one same-origin tab lands in the
 * others. This is the one mechanism the tools view, developer preferences, the sidebar store, and
 * the developer-console modules were each reimplementing.
 *
 * SSR/prerender/test safe: seeding reads through the guarded storage helpers (a default when no
 * browser), and `followAcrossTabs` no-ops without a `window`.
 */
import {
  readStoredString,
  writeStoredString,
  type PreferenceCodec,
} from "./persisted-preference.ts";

export interface PersistedPreference<Value> {
  /** The live value — read reactively in markup. */
  readonly current: Value;
  /** Replace the value and persist it. */
  set(value: Value): void;
  /**
   * Register the cross-tab follower and return its unsubscribe. Call once at module scope for a
   * process-lifetime store; call inside an `$effect` for a component-scoped one so the listener is
   * removed on destroy. A no-op (returning a no-op unsubscribe) when there is no `window`.
   */
  followAcrossTabs(): () => void;
}

export function createPersistedPreference<Value>(
  codec: PreferenceCodec<Value>,
): PersistedPreference<Value> {
  const state = $state<{ value: Value }>({
    value: codec.decode(readStoredString(codec.storageKey)),
  });

  return {
    get current(): Value {
      return state.value;
    },
    set(value: Value): void {
      state.value = value;
      writeStoredString(codec.storageKey, codec.encode(value));
    },
    followAcrossTabs(): () => void {
      if (typeof window === "undefined") return () => {};
      // "storage" fires only in OTHER same-origin tabs when a key changes; re-reading through the
      // codec re-normalizes the payload so the receiving tab honors the same invariants the writer
      // did. `event.key === null` is storage.clear() — this key may have changed too.
      const onStorage = (event: StorageEvent): void => {
        if (event.key !== null && event.key !== codec.storageKey) return;
        state.value = codec.decode(readStoredString(codec.storageKey));
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
  };
}

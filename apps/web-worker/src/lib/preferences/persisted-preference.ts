/*
 * The persisted-preference primitive — pure half. One home for the per-browser-preference
 * mechanics that were reimplemented across the app (the tools view, developer flags, the sidebar
 * customization, the developer-console modules): a `typeof localStorage` guard, swallowed reads
 * and writes, and normalize-on-read. The reactive store beside this file
 * (persisted-preference.svelte.ts) adds the rune state and the cross-tab `storage` follower.
 *
 * Everything here is browser-optional (each function guards `localStorage`) and, for the codecs,
 * pure — so the validation rules are unit-testable under the plugin-less web test config, without
 * a DOM.
 */

/**
 * A codec pins one preference to storage: its key, and how a raw stored string round-trips to a
 * value. `decode` is TOTAL — it is handed the raw string, or `null` when the key is absent, and
 * must always return a valid value (never throw), folding any stale, partial, or hand-edited
 * payload back to a sane default. `encode` serializes for storage.
 */
export interface PreferenceCodec<Value> {
  readonly storageKey: string;
  decode(raw: string | null): Value;
  encode(value: Value): string;
}

/**
 * A codec for a value drawn from a fixed set of strings (a view choice, a mode). Only a member of
 * `allowed` survives a read; `null`, the empty string, and any stale or hand-edited value fall
 * back to `fallback`.
 */
export function stringUnionPreference<Value extends string>(
  storageKey: string,
  allowed: readonly Value[],
  fallback: Value,
): PreferenceCodec<Value> {
  const permitted = new Set<string>(allowed);
  return {
    storageKey,
    decode(raw) {
      return raw !== null && permitted.has(raw) ? (raw as Value) : fallback;
    },
    encode(value) {
      return value;
    },
  };
}

/**
 * A codec for a JSON-shaped value. `normalize` is the read-time validator: it receives the parsed
 * JSON — or `undefined` when the key is absent, empty, or the payload does not parse — and returns
 * a valid value, freshly built each call so no two reads share a mutable object. This is where a
 * caller enforces its own invariants (drop unknown keys, apply a cascade, seed defaults).
 */
export function jsonPreference<Value>(
  storageKey: string,
  normalize: (parsed: unknown) => Value,
): PreferenceCodec<Value> {
  return {
    storageKey,
    decode(raw) {
      if (raw === null) return normalize(undefined);
      try {
        return normalize(JSON.parse(raw));
      } catch {
        return normalize(undefined);
      }
    },
    encode(value) {
      return JSON.stringify(value);
    },
  };
}

// ─── Swallowed localStorage access ──────────────────────────────────────────────────────────
// Every read and write is guarded (module init must never assume a browser: tests, prerender
// safety) and every storage hazard (private mode, quota, a corrupt payload) is swallowed here so
// no caller carries its own try/catch. A failed read yields the absent value; a failed write is a
// no-op and the live preference still works for the session.

/** Read a raw string, or `null` when absent or storage is unavailable. Never throws. */
export function readStoredString(key: string): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a raw string, swallowing any storage failure. */
export function writeStoredString(key: string, value: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable; the live preference still works for the session.
  }
}

/** Read and parse a JSON value, or `null` when absent, unparseable, or storage is unavailable. */
export function readStoredJson<Value>(key: string): Value | null {
  const raw = readStoredString(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as Value;
  } catch {
    return null;
  }
}

/** Serialize and write a JSON value, swallowing serialization or storage failure. */
export function writeStoredJson<Value>(key: string, value: Value): void {
  try {
    writeStoredString(key, JSON.stringify(value));
  } catch {
    // A value that will not serialize is dropped rather than thrown to the caller.
  }
}

/** Remove a key, swallowing any storage failure. */
export function removeStoredValue(key: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

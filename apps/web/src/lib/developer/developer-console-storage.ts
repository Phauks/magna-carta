/*
 * Per-module persistence for developer-console modules: one localStorage key per module id, JSON in
 * and out, on the shared persisted-preference primitive's swallowed storage helpers so every
 * storage hazard (private mode, quota, corrupt payloads) is handled in one place and modules never
 * try/catch. These overrides are non-reactive, load-on-demand tuning state — a module reads once
 * and owns its own reactivity — so this stays a plain load/save/clear seam, not a rune store.
 */
import {
  readStoredJson,
  removeStoredValue,
  writeStoredJson,
} from "$lib/preferences/persisted-preference.ts";

export interface DeveloperConsoleStorage<Value> {
  load(): Value | null;
  save(value: Value): void;
  clear(): void;
}

export function createDeveloperConsoleStorage<Value>(
  moduleId: string,
): DeveloperConsoleStorage<Value> {
  const key = `mc-developer-${moduleId}`;
  return {
    load(): Value | null {
      return readStoredJson<Value>(key);
    },
    save(value: Value): void {
      writeStoredJson(key, value);
    },
    clear(): void {
      removeStoredValue(key);
    },
  };
}

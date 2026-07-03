/*
 * Per-module persistence for developer-console modules: one localStorage key per module id, JSON
 * in and out, every storage hazard (private mode, quota, corrupt payloads) swallowed here so
 * modules never try/catch. Overrides are per-browser tuning state, not application data.
 */
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
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? null : (JSON.parse(raw) as Value);
      } catch {
        return null;
      }
    },
    save(value: Value): void {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Storage unavailable; the live overrides still work for the session.
      }
    },
    clear(): void {
      try {
        localStorage.removeItem(key);
      } catch {
        // Nothing to clear.
      }
    },
  };
}

/*
 * The Network Speed Test's two per-browser preferences — low internet usage mode and auto-start —
 * stored together under one key. This pure module holds the shape, the default, the storage key,
 * and the read-time validation; the rune store beside it (speed-test-preferences.svelte.ts) owns
 * the reactive state and localStorage. The split keeps this logic unit-testable under the
 * plugin-less web test config.
 *
 * Both default to false: a default of true on either would spend a firm's bandwidth without being
 * asked — low-data mode by narrowing the ladder, auto-start by transferring anything at all before
 * a press.
 */
export interface SpeedTestPreferences {
  lowData: boolean;
  autoStart: boolean;
}

export const DEFAULT_PREFERENCES: SpeedTestPreferences = {
  lowData: false,
  autoStart: false,
};

export const SPEED_TEST_PREFERENCES_KEY = "mc-speed-test-preferences";

/**
 * Normalize a stored value: a missing key, malformed JSON, a non-object, or a non-boolean flag all
 * fall back to that flag's default. A stored object naming only one flag keeps the other's default
 * rather than losing it, and unknown keys are ignored.
 */
export function parsePreferences(raw: string | null): SpeedTestPreferences {
  if (raw === null) return DEFAULT_PREFERENCES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_PREFERENCES;
  const candidate = parsed as Record<string, unknown>;
  return {
    lowData: typeof candidate.lowData === "boolean" ? candidate.lowData : DEFAULT_PREFERENCES.lowData,
    autoStart:
      typeof candidate.autoStart === "boolean" ? candidate.autoStart : DEFAULT_PREFERENCES.autoStart,
  };
}

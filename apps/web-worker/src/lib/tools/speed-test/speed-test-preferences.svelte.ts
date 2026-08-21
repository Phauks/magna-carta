/*
 * The reactive Network Speed Test preferences — a per-browser choice (low-data mode, auto-start),
 * on the shared persisted-preference primitive. The primitive owns the localStorage read/write, the
 * SSR guard, normalize-on-read (through parsePreferences), and the cross-tab follower registered
 * here once at module scope.
 */
import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
import {
  parsePreferences,
  SPEED_TEST_PREFERENCES_KEY,
  type SpeedTestPreferences,
} from "./speed-test-preferences.ts";

const preference = createPersistedPreference<SpeedTestPreferences>({
  storageKey: SPEED_TEST_PREFERENCES_KEY,
  decode: parsePreferences,
  encode: (value) => JSON.stringify(value),
});
preference.followAcrossTabs();

/** Read reactively in markup. */
export function preferences(): SpeedTestPreferences {
  return preference.current;
}

export function setLowData(value: boolean): void {
  if (preference.current.lowData === value) return;
  preference.set({ ...preference.current, lowData: value });
}

export function setAutoStart(value: boolean): void {
  if (preference.current.autoStart === value) return;
  preference.set({ ...preference.current, autoStart: value });
}

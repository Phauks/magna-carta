/*
 * The reactive Network Speed Test preferences — a per-browser choice, stored in localStorage and
 * synced across tabs by the storage event (the tools-view-preference pattern). SSR/prerender-safe:
 * module init never assumes a browser. Reads and writes go through parsePreferences so a stale or
 * hand-edited value normalizes on read.
 */
import {
  DEFAULT_PREFERENCES,
  parsePreferences,
  SPEED_TEST_PREFERENCES_KEY,
  type SpeedTestPreferences,
} from "./speed-test-preferences.ts";

function readStored(): SpeedTestPreferences {
  if (typeof localStorage === "undefined") return DEFAULT_PREFERENCES;
  try {
    return parsePreferences(localStorage.getItem(SPEED_TEST_PREFERENCES_KEY));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function persist(value: SpeedTestPreferences): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SPEED_TEST_PREFERENCES_KEY, JSON.stringify(value));
  } catch {
    // Storage unavailable; the live preference still works for the session.
  }
}

const state = $state<{ preferences: SpeedTestPreferences }>({ preferences: readStored() });

// Follow the choice across same-origin tabs. `event.key === null` is storage.clear().
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== SPEED_TEST_PREFERENCES_KEY) return;
    state.preferences = readStored();
  });
}

/** Read reactively in markup. */
export function preferences(): SpeedTestPreferences {
  return state.preferences;
}

export function setLowData(value: boolean): void {
  if (state.preferences.lowData === value) return;
  state.preferences = { ...state.preferences, lowData: value };
  persist(state.preferences);
}

export function setAutoStart(value: boolean): void {
  if (state.preferences.autoStart === value) return;
  state.preferences = { ...state.preferences, autoStart: value };
  persist(state.preferences);
}

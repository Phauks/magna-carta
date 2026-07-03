/*
 * Developer preferences — the reactive store behind Settings · Developer and the app shell's
 * developer-toolkit gate. Both defaults are true so a development build behaves exactly as it
 * always has until someone opts out; the values are per-browser tuning state (localStorage),
 * not application data, so every storage hazard (private mode, quota, corrupt payloads) is
 * swallowed here and the in-memory defaults win.
 *
 * `developerSettingsEnabled` is the master: turning it OFF turns every subordinate flag off
 * too, persisted — the master is a real kill switch, not a mute. Re-enabling reveals the
 * subordinates in their all-off state, each an explicit opt-in again. The cascade lives in
 * this setter (not in the settings page) so the invariant "master off means every developer
 * flag is off" holds no matter which caller flips the master.
 */

const STORAGE_KEY = "mc-developer-preferences";

interface DeveloperPreferencesValue {
  developerSettingsEnabled: boolean;
  developerToolkitInHeader: boolean;
}

const DEFAULTS: DeveloperPreferencesValue = {
  developerSettingsEnabled: true,
  developerToolkitInHeader: true,
};

function readStoredPreferences(): DeveloperPreferencesValue {
  // The app is an SPA, but module init must not assume a browser (tests, prerender safety).
  if (typeof localStorage === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<DeveloperPreferencesValue> | null;
    const developerSettingsEnabled =
      typeof parsed?.developerSettingsEnabled === "boolean"
        ? parsed.developerSettingsEnabled
        : DEFAULTS.developerSettingsEnabled;
    return {
      developerSettingsEnabled,
      // Normalized on read too: a payload persisted before the master-off cascade existed
      // (or edited by hand) may carry master-off with a live subordinate — the invariant wins.
      developerToolkitInHeader:
        developerSettingsEnabled &&
        (typeof parsed?.developerToolkitInHeader === "boolean"
          ? parsed.developerToolkitInHeader
          : DEFAULTS.developerToolkitInHeader),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function persist(value: DeveloperPreferencesValue): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage unavailable; the live preference still works for the session.
  }
}

const preferences = $state<DeveloperPreferencesValue>(readStoredPreferences());

/*
 * CROSS-TAB FOLLOW. "storage" fires in every OTHER same-origin tab when the key changes, so
 * re-reading here makes a developer-preference flip in one tab land in all of them. The
 * contract: last write wins; the re-read goes through readStoredPreferences so the receiving
 * tab re-normalizes the payload — the master-off cascade ("master off means every developer
 * flag is off") holds no matter which tab wrote. Registered once at module scope (one module
 * instance per app), guarded so the module stays importable during SSR/tests where `window`
 * does not exist. `event.key === null` means `storage.clear()` — this key may have changed
 * too, so re-read then as well.
 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    const next = readStoredPreferences();
    preferences.developerSettingsEnabled = next.developerSettingsEnabled;
    preferences.developerToolkitInHeader = next.developerToolkitInHeader;
  });
}

export const developerPreferences = {
  get developerSettingsEnabled(): boolean {
    return preferences.developerSettingsEnabled;
  },
  set developerSettingsEnabled(next: boolean) {
    preferences.developerSettingsEnabled = next;
    if (!next) {
      // Master off = everything off, persisted: no subordinate silently survives to spring
      // back on re-enable. Each control is re-opted-into deliberately.
      preferences.developerToolkitInHeader = false;
    }
    persist({ ...preferences });
  },
  get developerToolkitInHeader(): boolean {
    return preferences.developerToolkitInHeader;
  },
  set developerToolkitInHeader(next: boolean) {
    preferences.developerToolkitInHeader = next;
    persist({ ...preferences });
  },
};

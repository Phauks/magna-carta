/*
 * Developer preferences — the reactive store behind Settings · Developer and the app shell's
 * developer-toolkit gate, on the shared persisted-preference primitive. Both defaults are true so a
 * development build behaves exactly as it always has until someone opts out; the values are
 * per-browser tuning state, so the primitive swallows every storage hazard and the in-memory
 * defaults win.
 *
 * `developerSettingsEnabled` is the master: turning it OFF turns every subordinate flag off too,
 * persisted — the master is a real kill switch, not a mute. Re-enabling reveals the subordinates in
 * their all-off state, each an explicit opt-in again. The cascade lives in this setter (not in the
 * settings page) so the invariant "master off means every developer flag is off" holds no matter
 * which caller flips the master, and normalize-on-read below re-asserts it for a payload persisted
 * before the cascade existed or edited by hand — including one arriving from another tab.
 */
import { jsonPreference } from "$lib/preferences/persisted-preference.ts";
import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";

const STORAGE_KEY = "mc-developer-preferences";

interface DeveloperPreferencesValue {
  developerSettingsEnabled: boolean;
  developerToolkitInHeader: boolean;
}

const DEFAULTS: DeveloperPreferencesValue = {
  developerSettingsEnabled: true,
  developerToolkitInHeader: true,
};

/** Read-time validator: an unreadable payload is the defaults; master-off forces every flag off. */
function normalize(parsed: unknown): DeveloperPreferencesValue {
  if (parsed === null || typeof parsed !== "object") return { ...DEFAULTS };
  const record = parsed as Partial<DeveloperPreferencesValue>;
  const developerSettingsEnabled =
    typeof record.developerSettingsEnabled === "boolean"
      ? record.developerSettingsEnabled
      : DEFAULTS.developerSettingsEnabled;
  return {
    developerSettingsEnabled,
    developerToolkitInHeader:
      developerSettingsEnabled &&
      (typeof record.developerToolkitInHeader === "boolean"
        ? record.developerToolkitInHeader
        : DEFAULTS.developerToolkitInHeader),
  };
}

const preference = createPersistedPreference(
  jsonPreference<DeveloperPreferencesValue>(STORAGE_KEY, normalize),
);
preference.followAcrossTabs();

export const developerPreferences = {
  get developerSettingsEnabled(): boolean {
    return preference.current.developerSettingsEnabled;
  },
  set developerSettingsEnabled(next: boolean) {
    // Master off = everything off, persisted: no subordinate silently survives to spring back on
    // re-enable. Each control is re-opted-into deliberately.
    preference.set({
      developerSettingsEnabled: next,
      developerToolkitInHeader: next ? preference.current.developerToolkitInHeader : false,
    });
  },
  get developerToolkitInHeader(): boolean {
    return preference.current.developerToolkitInHeader;
  },
  set developerToolkitInHeader(next: boolean) {
    preference.set({ ...preference.current, developerToolkitInHeader: next });
  },
};

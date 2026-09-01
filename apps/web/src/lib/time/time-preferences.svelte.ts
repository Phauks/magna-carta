/*
 * The reader's own time-entry preferences.
 *
 * Held in localStorage for this browser, the same seam the theme preference sits behind: the
 * per-member preference store is what will hold these across devices, and this module is the only
 * touch point to swap when it lands. Reads and writes are guarded, because storage can be absent
 * or refused and a preference must degrade to its default rather than to a crash.
 */

const DEFAULT_STAFF_TO_SELF_KEY = "magna-carta.time.default-staff-to-self";

class TimePreferences {
  /** Whether a new entry's staff member starts as the person creating it. Defaults to on. */
  defaultStaffToSelf = $state(readBoolean(DEFAULT_STAFF_TO_SELF_KEY, true));

  setDefaultStaffToSelf(next: boolean): void {
    this.defaultStaffToSelf = next;
    writeBoolean(DEFAULT_STAFF_TO_SELF_KEY, next);
  }
}

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const held = localStorage.getItem(key);
    if (held === null) return fallback;
    return held === "true";
  } catch {
    return fallback;
  }
}

function writeBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Storage refused; the choice still applies for this visit.
  }
}

export const timePreferences = new TimePreferences();

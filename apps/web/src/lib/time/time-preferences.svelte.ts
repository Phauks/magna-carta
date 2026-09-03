/*
 * The reader's own time-entry preferences.
 *
 * Held in localStorage for this browser, the same seam the theme preference sits behind: the
 * per-member preference store is what will hold these across devices, and this module is the only
 * touch point to swap when it lands. Reads and writes are guarded, because storage can be absent
 * or refused and a preference must degrade to its default rather than to a crash.
 */

const DEFAULT_STAFF_TO_SELF_KEY = "magna-carta.time.default-staff-to-self";
const ENTRY_MODES_KEY = "magna-carta.time.entry-modes";

/*
 * THE THREE WAYS A PERSON STATES HOW LONG THEY WORKED, and they are three because firms are three.
 *
 *   hours — "1:30", "1.5", "90m". What everybody understands, and the one that is always available.
 *   units — the firm's own billing increment, counted. A practice that bills in tenths thinks in
 *           tenths, and asking that person to convert six units into 0.6 hours is asking them to do
 *           arithmetic the product already knows how to do.
 *   span  — the two clock times the work happened between. The way a person who was in a meeting
 *           from nine to half past ten actually remembers it.
 *
 * All three describe the same minutes and all three are live at once: whichever a person types in,
 * the others follow. The choice below is about how many of them are on SCREEN, because a member
 * who only ever thinks in one of them should not have to look at the other two for ever.
 */
export const TIME_ENTRY_MODES = ["hours", "units", "span"] as const;
export type TimeEntryMode = (typeof TIME_ENTRY_MODES)[number];

/** What each is called where the reader chooses it, and on the field itself. */
export const TIME_ENTRY_MODE_LABELS: Readonly<Record<TimeEntryMode, string>> = {
  hours: "Hours",
  units: "Units",
  span: "Start and end time",
};

class TimePreferences {
  /** Whether a new entry's staff member starts as the person creating it. Defaults to on. */
  defaultStaffToSelf = $state(readBoolean(DEFAULT_STAFF_TO_SELF_KEY, true));

  /*
   * Which ways of stating a duration are on screen. All three by default: a capability nobody can
   * see is a capability nobody has, so the product shows its hand once and lets the reader put
   * away what they do not use.
   */
  entryModes = $state<readonly TimeEntryMode[]>(readModes());

  setDefaultStaffToSelf(next: boolean): void {
    this.defaultStaffToSelf = next;
    writeBoolean(DEFAULT_STAFF_TO_SELF_KEY, next);
  }

  /**
   * Turn one way of entering time on or off.
   *
   * THE LAST ONE CANNOT BE TURNED OFF. A record window with no way to say how long the work took
   * is a window that cannot record time, and a preference must not be able to produce one — so
   * clearing the last remaining mode is refused rather than obeyed, and the control that offered
   * it reads as already-decided rather than as broken.
   */
  setEntryMode(mode: TimeEntryMode, enabled: boolean): void {
    if (!enabled && this.entryModes.length <= 1) return;
    const next = enabled
      ? TIME_ENTRY_MODES.filter(
          (candidate) => candidate === mode || this.entryModes.includes(candidate),
        )
      : this.entryModes.filter((candidate) => candidate !== mode);
    this.entryModes = next;
    writeText(ENTRY_MODES_KEY, next.join(","));
  }

  /** Whether one mode is on screen. */
  showsEntryMode(mode: TimeEntryMode): boolean {
    return this.entryModes.includes(mode);
  }
}

function readModes(): readonly TimeEntryMode[] {
  const held = readText(ENTRY_MODES_KEY);
  if (held === null) return TIME_ENTRY_MODES;
  // Stored order is not trusted: the modes read in the one order the screen lays them out, so a
  // hand-edited or half-written value cannot rearrange the fields.
  const wanted = new Set(held.split(","));
  const kept = TIME_ENTRY_MODES.filter((mode) => wanted.has(mode));
  return kept.length === 0 ? TIME_ENTRY_MODES : kept;
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

function readText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeText(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage refused; the choice still applies for this visit.
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

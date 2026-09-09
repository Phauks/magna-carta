/*
 * The firm's calendar settings as a draft the settings page stages and saves — the words and the
 * field mapping; the staging, counting and saving are the shared server-backed draft's
 * ($lib/settings/server-backed-draft.svelte.ts).
 *
 * This was the platform's first server-backed setting and carried its own copy of that machinery,
 * hardcoded to its one definition. The scan policy is the second, and four settings rather than
 * one, so the machinery moved to where both read it from and this module kept what is actually the
 * calendar's: what the setting is called, what it means, and what its two values stand for on the
 * wire.
 */
import type { SettingDefinition, SettingValue } from "$lib/settings/settings-definitions.ts";
import {
  ServerBackedSettingsDraft,
  type ServerBackedField,
} from "$lib/settings/server-backed-draft.svelte.ts";
import {
  readCalendarSettings,
  updateCalendarSettings,
  type CalendarSettings,
  type WeekStartsOn,
} from "./calendar-api.ts";
import { calendarContext } from "./calendar-context.svelte.ts";

/** The settings section this draft belongs to (settings-sections.ts). */
export const CALENDAR_SETTINGS_SECTION_ID = "calendar";

/**
 * The one definition today. A select over the two starts practice uses, carried as the strings a
 * select control binds to; the wire value is the number behind them.
 */
export const WEEK_STARTS_ON_DEFINITION: SettingDefinition = {
  id: "calendar.week-starts-on",
  sectionId: CALENDAR_SETTINGS_SECTION_ID,
  plateLabel: "The Week",
  label: "First Day of the Week",
  description: "The day every calendar in the firm begins its week on.",
  kind: "select",
  options: [
    { value: "0", label: "Sunday" },
    { value: "1", label: "Monday" },
  ],
  defaultValue: "0",
  sensitivity: "open",
  audited: true,
};

/** The wire value a select choice stands for; null for a string the vocabulary does not carry. */
export function weekStartsOnFromValue(value: SettingValue): WeekStartsOn | null {
  if (value === "0") return 0;
  if (value === "1") return 1;
  return null;
}

const FIELDS: readonly ServerBackedField<CalendarSettings, { weekStartsOn: WeekStartsOn }>[] = [
  {
    definition: WEEK_STARTS_ON_DEFINITION,
    valueOf: (settings) => String(settings.weekStartsOn),
    applyTo: (patch, value) => {
      const weekStartsOn = weekStartsOnFromValue(value);
      return weekStartsOn === null ? null : { ...patch, weekStartsOn };
    },
  },
];

export function createCalendarSettingsDraft(
  fetchImpl: typeof fetch,
): ServerBackedSettingsDraft<CalendarSettings, { weekStartsOn: WeekStartsOn }> {
  return new ServerBackedSettingsDraft({
    sectionId: CALENDAR_SETTINGS_SECTION_ID,
    fields: FIELDS,
    read: () => readCalendarSettings(fetchImpl),
    write: (patch, idempotencyKey) => updateCalendarSettings(fetchImpl, patch, idempotencyKey),
    // Every grid on the screen reads the week start from the context, so the one that is already
    // rendered has to be told rather than left showing the week the firm no longer keeps.
    onSaved: (settings) => calendarContext.noteWeekStartsOn(settings.weekStartsOn),
  });
}

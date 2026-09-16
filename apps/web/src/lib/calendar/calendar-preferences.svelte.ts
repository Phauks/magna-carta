/*
 * Which calendars this reader has turned on, what colour they gave each, and how they want things
 * that run at the same time drawn — held per browser on the shared persisted-preference primitive.
 *
 * THIS IS THE PERSONAL HALF, AND IT IS THE ONLY PERSONAL THING ON THIS SURFACE. The day the firm's
 * week begins on is the FIRM's (owner ruling, 2026-09-02): two members looking at the same week
 * must see the same seven columns, so it lives on the server behind the calendar's manage right
 * and no member overrides it. Which of the firm's twenty calendars a particular person has open,
 * and whether the receptionist's is green, is the opposite kind of fact: it changes nothing anyone
 * else sees, it changes several times a day, and a server round trip to record that somebody
 * unticked a room would be a write per glance.
 *
 * WHAT IS STORED IS THE DEPARTURE, NOT THE STATE. A reader who has never touched the rail gets the
 * catalog's own defaults (the firm's records and the firm's own events), and a calendar added to
 * the product later arrives at its default for them rather than absent because their stored list
 * predates it. The same reasoning as the sidebar's stars, and for the same reason: a stored
 * snapshot of "what exists" goes stale the moment anything is added.
 *
 * A KEY THE CATALOG NO LONGER HOLDS IS DROPPED ON READ. A member who left, a room that was retired,
 * a hand-edited payload: none of them should be able to put a read in flight for something that is
 * not there. The catalog is the truth about what exists; this file holds only what was decided
 * about it.
 */
import {
  DEFAULT_CONCURRENCY,
  isCalendarColor,
  type CalendarGridColor,
  type CalendarGridConcurrency,
} from "@magna-carta/design-system/calendar-grid";
import { jsonPreference } from "$lib/preferences/persisted-preference.ts";
import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
import { DEFAULT_ON_SOURCE_KEYS } from "./calendar-sources.ts";

const STORAGE_KEY = "mc-calendar-preferences";

/** What is remembered between visits. */
export interface CalendarPreferencesValue {
  /**
   * Only the calendars whose state DIFFERS from the catalog's default: a `false` here for one of
   * the two calendars that are on by default, a `true` for anything else. So a calendar shipped
   * later arrives at its default rather than off.
   */
  onOverrides: Record<string, boolean>;
  /** The colour the reader chose for a calendar. Absent means the catalog's own dealt colour. */
  colors: Record<string, CalendarGridColor>;
  /**
   * How things that run at the same time are drawn on a time grid: divided between them, or lying
   * over one another. Personal for the same reason the colours are — it changes nothing anybody
   * else sees, and a reader flips it while reading a crowded Tuesday.
   */
  concurrency: CalendarGridConcurrency;
}

function emptyValue(): CalendarPreferencesValue {
  return { onOverrides: {}, colors: {}, concurrency: DEFAULT_CONCURRENCY };
}

/** The two presentations, as the control offers them. A closed set the grid also declares. */
const CONCURRENCIES: ReadonlySet<CalendarGridConcurrency> = new Set<CalendarGridConcurrency>([
  "side-by-side",
  "overlap",
]);

function isConcurrency(value: unknown): value is CalendarGridConcurrency {
  return typeof value === "string" && CONCURRENCIES.has(value as CalendarGridConcurrency);
}

/**
 * The read-time validator. A payload that is not an object, an override that is not a boolean, a
 * colour name this palette does not offer: each is dropped rather than carried, and the shape is
 * rebuilt fresh so no two reads share one mutable object.
 */
export function normalizeCalendarPreferences(parsed: unknown): CalendarPreferencesValue {
  const value = emptyValue();
  if (parsed === null || typeof parsed !== "object") return value;
  const record = parsed as Partial<CalendarPreferencesValue>;
  if (record.onOverrides !== null && typeof record.onOverrides === "object") {
    for (const [key, on] of Object.entries(record.onOverrides)) {
      if (typeof on === "boolean") value.onOverrides[key] = on;
    }
  }
  if (record.colors !== null && typeof record.colors === "object") {
    for (const [key, color] of Object.entries(record.colors)) {
      if (typeof color === "string" && isCalendarColor(color)) value.colors[key] = color;
    }
  }
  if (isConcurrency(record.concurrency)) value.concurrency = record.concurrency;
  return value;
}

/** Whether a calendar is on, given what was stored and what the catalog says by default. */
export function isSourceOn(
  value: CalendarPreferencesValue,
  key: string,
  defaultOn: ReadonlySet<string> = new Set(DEFAULT_ON_SOURCE_KEYS),
): boolean {
  return value.onOverrides[key] ?? defaultOn.has(key);
}

/**
 * The stored overrides after a whole selection is written back: every key that differs from its
 * default, and nothing that agrees with it. `known` is the catalog's keys, so a calendar that has
 * gone is forgotten rather than kept as an override nothing can ever clear.
 */
export function overridesFor(
  on: ReadonlySet<string>,
  known: readonly string[],
  defaultOn: ReadonlySet<string> = new Set(DEFAULT_ON_SOURCE_KEYS),
): Record<string, boolean> {
  const overrides: Record<string, boolean> = {};
  for (const key of known) {
    const wanted = on.has(key);
    if (wanted !== defaultOn.has(key)) overrides[key] = wanted;
  }
  return overrides;
}

const preference = createPersistedPreference(
  jsonPreference<CalendarPreferencesValue>(STORAGE_KEY, normalizeCalendarPreferences),
);
preference.followAcrossTabs();

/** The calendars this reader has on, of those the catalog holds. */
export function calendarsOn(known: readonly string[]): ReadonlySet<string> {
  const defaultOn = new Set(DEFAULT_ON_SOURCE_KEYS);
  const on = new Set<string>();
  for (const key of known) {
    if (isSourceOn(preference.current, key, defaultOn)) on.add(key);
  }
  return on;
}

/** Write a whole selection back, keeping only what departs from the catalog's defaults. */
export function setCalendarsOn(on: ReadonlySet<string>, known: readonly string[]): void {
  preference.set({ ...preference.current, onOverrides: overridesFor(on, known) });
}

/** The colours this reader chose, by calendar key. Unchosen calendars are absent. */
export function chosenColors(): Readonly<Record<string, CalendarGridColor>> {
  return preference.current.colors;
}

/** Give a calendar a colour. */
export function setCalendarColor(key: string, color: CalendarGridColor): void {
  preference.set({
    ...preference.current,
    colors: { ...preference.current.colors, [key]: color },
  });
}

/** How this reader wants concurrent entries drawn on a time grid. */
export function chosenConcurrency(): CalendarGridConcurrency {
  return preference.current.concurrency;
}

/** Choose how concurrent entries are drawn. */
export function setConcurrency(concurrency: CalendarGridConcurrency): void {
  preference.set({ ...preference.current, concurrency });
}

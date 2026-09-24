/*
 * The settings column's FOLDS — which bands and which groups this member has folded away, per
 * browser, on the shared persisted-preference primitive ($lib/preferences/).
 *
 * DEPARTURES, NEVER STATE. Everything is open until somebody folds it, so what is stored is only
 * what was folded. That is what lets a band or a group shipped later arrive OPEN rather than
 * inheriting a preference nobody expressed — the same rule the sidebar's folds keep
 * ($lib/navigation/sidebar-preferences.svelte.ts), and the reason both stores record an absence
 * rather than a value per entry.
 *
 * FOLDING HIDES ROWS, AND HIDING MUST NEVER REMOVE CAPABILITY. Every settings section stays
 * reachable from the command palette, which renders the section registry directly and is never
 * filtered by a fold. A folded group is a reading convenience, not an access decision.
 *
 * The band and the group holding the page being read are never folded away from the reader — that
 * rule lives in the settings layout, because it is about where the reader is standing rather than
 * about what they have chosen to keep folded. The reveal it performs is deliberately NOT written
 * here: a member who never asked for a group to open should not find it open tomorrow.
 */

import { jsonPreference } from "$lib/preferences/persisted-preference.ts";
import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
import {
  SETTINGS_BANDS,
  SETTINGS_SECTION_GROUPS,
  type SettingsBand,
  type SettingsSectionGroup,
} from "./settings-sections.ts";

const STORAGE_KEY = "mc-settings-navigation-folds";

export interface SettingsNavigationFolds {
  /** Bands this member has folded away. Absence means open. */
  collapsedBands: SettingsBand[];
  /** Groups this member has folded away. Absence means open. */
  collapsedGroups: SettingsSectionGroup[];
}

const BAND_IDENTIFIERS = new Set<string>(SETTINGS_BANDS.map((band) => band.id));
const GROUP_IDENTIFIERS = new Set<string>(SETTINGS_SECTION_GROUPS.map((group) => group.id));

/**
 * The read-time validator: anything that is not a band or a group this build ships drops, and the
 * shape is rebuilt fresh on every read. A retired group left in storage would otherwise fold a
 * group that has since taken its name.
 */
export function normalizeSettingsNavigationFolds(parsed: unknown): SettingsNavigationFolds {
  const value: SettingsNavigationFolds = { collapsedBands: [], collapsedGroups: [] };
  if (parsed === null || typeof parsed !== "object") return value;
  const record = parsed as Partial<SettingsNavigationFolds>;
  if (Array.isArray(record.collapsedBands)) {
    value.collapsedBands = record.collapsedBands.filter(
      (id): id is SettingsBand => typeof id === "string" && BAND_IDENTIFIERS.has(id),
    );
  }
  if (Array.isArray(record.collapsedGroups)) {
    value.collapsedGroups = record.collapsedGroups.filter(
      (id): id is SettingsSectionGroup => typeof id === "string" && GROUP_IDENTIFIERS.has(id),
    );
  }
  return value;
}

const preference = createPersistedPreference(
  jsonPreference<SettingsNavigationFolds>(STORAGE_KEY, normalizeSettingsNavigationFolds),
);
preference.followAcrossTabs();

/** Whether a band is folded away in this member's settings column. Read reactively. */
export function isSettingsBandCollapsed(band: SettingsBand): boolean {
  return preference.current.collapsedBands.includes(band);
}

export function setSettingsBandCollapsed(band: SettingsBand, next: boolean): void {
  if (isSettingsBandCollapsed(band) === next) return;
  const collapsedBands = next
    ? [...preference.current.collapsedBands, band]
    : preference.current.collapsedBands.filter((id) => id !== band);
  preference.set({ ...preference.current, collapsedBands });
}

/** Whether a group is folded away. Same departures-not-state rule as a band's fold. */
export function isSettingsGroupCollapsed(group: SettingsSectionGroup): boolean {
  return preference.current.collapsedGroups.includes(group);
}

export function setSettingsGroupCollapsed(group: SettingsSectionGroup, next: boolean): void {
  if (isSettingsGroupCollapsed(group) === next) return;
  const collapsedGroups = next
    ? [...preference.current.collapsedGroups, group]
    : preference.current.collapsedGroups.filter((id) => id !== group);
  preference.set({ ...preference.current, collapsedGroups });
}

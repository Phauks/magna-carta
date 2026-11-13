/*
 * The firm's file-retention setting as a draft the settings page stages and saves — the words and
 * the field mapping; the staging, counting and saving are the shared server-backed draft's
 * ($lib/settings/server-backed-draft.svelte.ts).
 *
 * One setting: the minimum number of whole years a closed matter's paper file is kept after the
 * close. Closing a matter asks for the date the file may be destroyed after, and that date may be
 * no earlier than this; a later date, or none, is always allowed. 0 is "no minimum" — the value a
 * firm that has never opened the page holds, because the platform never picks a retention period.
 */
import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
import {
  ServerBackedSettingsDraft,
  type ServerBackedField,
} from "$lib/settings/server-backed-draft.svelte.ts";
import { readMatterSettings, updateMatterSettings, type MatterSettings } from "./matters-api.ts";

/** The settings section this draft belongs to (settings-sections.ts). */
export const FILE_RETENTION_SETTINGS_SECTION_ID = "file-retention";

/** The same ceiling the server's setting schema enforces. */
export const FILE_RETENTION_MINIMUM_YEARS_MAXIMUM = 100;

export const FILE_RETENTION_MINIMUM_YEARS_DEFINITION: SettingDefinition = {
  id: "file-retention.minimum-years",
  sectionId: FILE_RETENTION_SETTINGS_SECTION_ID,
  plateLabel: "Closed Matters",
  label: "Minimum Retention",
  description:
    "The minimum number of years a closed matter's paper file is kept. Closing a matter asks for a destruction date no earlier than this. 0 means no minimum. Nothing is destroyed automatically.",
  kind: "number",
  minimum: 0,
  maximum: FILE_RETENTION_MINIMUM_YEARS_MAXIMUM,
  unit: "year",
  defaultValue: 0,
  sensitivity: "open",
  audited: true,
};

const FIELDS: readonly ServerBackedField<MatterSettings, Partial<MatterSettings>>[] = [
  {
    definition: FILE_RETENTION_MINIMUM_YEARS_DEFINITION,
    valueOf: (settings) => settings.fileRetentionMinimumYears,
    applyTo: (patch, value) =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= FILE_RETENTION_MINIMUM_YEARS_MAXIMUM
        ? { ...patch, fileRetentionMinimumYears: value }
        : null,
    refusalFor: (value) =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= FILE_RETENTION_MINIMUM_YEARS_MAXIMUM
        ? undefined
        : `A whole number of years from 0 to ${String(FILE_RETENTION_MINIMUM_YEARS_MAXIMUM)}.`,
  },
];

export function createFileRetentionSettingsDraft(
  fetchImpl: typeof fetch,
): ServerBackedSettingsDraft<MatterSettings, Partial<MatterSettings>> {
  return new ServerBackedSettingsDraft({
    sectionId: FILE_RETENTION_SETTINGS_SECTION_ID,
    fields: FIELDS,
    read: () => readMatterSettings(fetchImpl),
    write: (patch, idempotencyKey) => updateMatterSettings(fetchImpl, patch, idempotencyKey),
  });
}

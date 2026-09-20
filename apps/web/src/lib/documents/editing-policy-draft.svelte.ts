/*
 * The firm's editing policy as a settings draft — the one setting the Editing page renders, and
 * what its staged value means as a change to send. The staging, counting, confirming and saving
 * are the shared server-backed draft's ($lib/settings/server-backed-draft.svelte.ts); this module
 * is the field mapping and the words.
 */
import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
import {
  ServerBackedSettingsDraft,
  type ServerBackedField,
} from "$lib/settings/server-backed-draft.svelte.ts";
import {
  readEditingPolicy,
  updateEditingPolicy,
  type EditingPolicyPatch,
  type EditingPolicySettings,
} from "./editing-policy-api.ts";

/** The settings section this draft belongs to (settings-sections.ts). */
export const EDITING_SECTION_ID = "editing";

export const RECORD_CHANGES_DEFINITION: SettingDefinition = {
  id: "editing.record-changes",
  sectionId: EDITING_SECTION_ID,
  plateLabel: "Recording Changes",
  label: "Record Changes in Every Document",
  description:
    "Every document opened in the browser editor keeps a record of who changed what. Members cannot turn recording off; the marks are hidden until somebody chooses to see them, and a copy that leaves the firm carries none of them.",
  kind: "switch",
  defaultValue: true,
  sensitivity: "open",
  // Consequential: switching this off is the firm deciding its documents stop carrying a record
  // of who changed what, and what was not recorded cannot be recovered later. Asked once before it
  // lands.
  confirm: true,
  audited: true,
};

/** Every definition the page renders, in reading order. */
export const EDITING_DEFINITIONS: readonly SettingDefinition[] = [RECORD_CHANGES_DEFINITION];

const FIELDS: readonly ServerBackedField<EditingPolicySettings, EditingPolicyPatch>[] = [
  {
    definition: RECORD_CHANGES_DEFINITION,
    valueOf: (settings) => settings.recordChanges,
    applyTo: (patch, value) =>
      typeof value === "boolean" ? { ...patch, recordChanges: value } : null,
  },
];

export function createEditingPolicyDraft(
  fetchImpl: typeof fetch,
): ServerBackedSettingsDraft<EditingPolicySettings, EditingPolicyPatch> {
  return new ServerBackedSettingsDraft({
    sectionId: EDITING_SECTION_ID,
    fields: FIELDS,
    read: () => readEditingPolicy(fetchImpl),
    write: (patch, idempotencyKey) => updateEditingPolicy(fetchImpl, patch, idempotencyKey),
  });
}

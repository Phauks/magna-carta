/*
 * The firm's deleted-file policy as a draft the settings page stages and saves: the words and the
 * field mapping. The staging, counting and saving are the shared server-backed draft's
 * ($lib/settings/server-backed-draft.svelte.ts).
 *
 * Two settings. How long a deleted file waits in its matter's Trash, where anyone with access can
 * put it back; and what happens after that: move it to archive storage, which is cheaper to keep,
 * or leave it where it is. Neither one destroys a file. The server holds the same closed lists
 * (@magna-carta/file-manager/deleted-file-settings), so a value outside them cannot be saved.
 */
import {
  deletedFilePolicyGet,
  deletedFilePolicyUpdate,
  type DeletedFilePolicyResponse,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";
import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
import {
  ServerBackedSettingsDraft,
  type ServerBackedField,
} from "$lib/settings/server-backed-draft.svelte.ts";

export type DeletedFilePolicy = DeletedFilePolicyResponse;

/** The settings section this draft belongs to (settings-sections.ts). */
export const DELETED_FILES_SETTINGS_SECTION_ID = "deleted-files";

const TRASH_DAYS = [30, 60, 90, 180, 365] as const;
type TrashDays = (typeof TRASH_DAYS)[number];

export const TRASH_DAYS_DEFINITION: SettingDefinition = {
  id: "deleted-files.trash-days",
  sectionId: DELETED_FILES_SETTINGS_SECTION_ID,
  plateLabel: "Trash",
  label: "Keep in Trash For",
  description:
    "How long a deleted file waits in its matter's Trash. Until then anyone who can see the matter can restore it.",
  kind: "select",
  options: TRASH_DAYS.map((days) => ({
    value: String(days),
    label: days === 365 ? "1 year" : `${String(days)} days`,
  })),
  defaultValue: "30",
  sensitivity: "open",
  audited: true,
};

export const AFTER_TRASH_DEFINITION: SettingDefinition = {
  id: "deleted-files.after-trash",
  sectionId: DELETED_FILES_SETTINGS_SECTION_ID,
  plateLabel: "Trash",
  label: "Then",
  description:
    "Archive storage costs about a third less to keep and a little to read back. An archived file can still be restored. Nothing is ever destroyed.",
  kind: "select",
  options: [
    { value: "archive", label: "Move to archive storage" },
    { value: "keep-standard", label: "Keep in standard storage" },
  ],
  defaultValue: "archive",
  sensitivity: "open",
  audited: true,
};

const isTrashDays = (value: number): value is TrashDays =>
  (TRASH_DAYS as readonly number[]).includes(value);

const FIELDS: readonly ServerBackedField<DeletedFilePolicy, Partial<DeletedFilePolicy>>[] = [
  {
    definition: TRASH_DAYS_DEFINITION,
    valueOf: (policy) => String(policy.trashDays),
    applyTo: (patch, value) => {
      const days = Number(value);
      return isTrashDays(days) ? { ...patch, trashDays: days } : null;
    },
    refusalFor: (value) =>
      isTrashDays(Number(value)) ? undefined : "Choose one of the listed periods.",
  },
  {
    definition: AFTER_TRASH_DEFINITION,
    valueOf: (policy) => policy.afterTrash,
    applyTo: (patch, value) =>
      value === "archive" || value === "keep-standard" ? { ...patch, afterTrash: value } : null,
    refusalFor: (value) =>
      value === "archive" || value === "keep-standard" ? undefined : "Choose one of the two.",
  },
];

export async function readDeletedFilePolicy(): Promise<ApiOutcome<DeletedFilePolicy>> {
  try {
    const { data } = await deletedFilePolicyGet({ throwOnError: true });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

async function writeDeletedFilePolicy(
  patch: Partial<DeletedFilePolicy>,
  idempotencyKey: string,
): Promise<ApiOutcome<DeletedFilePolicy>> {
  try {
    const { data } = await deletedFilePolicyUpdate({
      body: patch,
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

export function createDeletedFilePolicyDraft(): ServerBackedSettingsDraft<
  DeletedFilePolicy,
  Partial<DeletedFilePolicy>
> {
  return new ServerBackedSettingsDraft({
    sectionId: DELETED_FILES_SETTINGS_SECTION_ID,
    fields: FIELDS,
    read: readDeletedFilePolicy,
    write: writeDeletedFilePolicy,
  });
}

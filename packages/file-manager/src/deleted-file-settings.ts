import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { z } from "zod";

// What happens to a deleted file, as the firm decides it. Deleting is a soft delete: the file leaves
// the list and waits in its matter's Trash, on Standard storage, where anyone with access can put it
// back at no cost. After the trash window the firm's choice applies: move the bytes to Infrequent
// Access in place ("archive"), which is cheaper to keep and slower and dearer to read, or leave them
// where they are ("keep-standard"). Either way nothing is destroyed: no setting here deletes a byte.
//
// Thirty days is the default because R2 bills Infrequent Access for at least thirty days, so a file
// deleted and put back inside the window never pays that floor. The choices are a closed list rather
// than a free number for the same reason: a window shorter than thirty days would pay it.
export const TRASH_DAY_CHOICES = [30, 60, 90, 180, 365] as const;
export type TrashDays = (typeof TRASH_DAY_CHOICES)[number];

export type AfterTrash = "archive" | "keep-standard";

export interface DeletedFilePolicy {
  readonly trashDays: TrashDays;
  readonly afterTrash: AfterTrash;
}

export const DEFAULT_DELETED_FILE_POLICY: DeletedFilePolicy = {
  trashDays: 30,
  afterTrash: "archive",
};

const trashDaysSchema = z.union([
  z.literal(30),
  z.literal(60),
  z.literal(90),
  z.literal(180),
  z.literal(365),
]);

export const deletedFilePolicyDefinition: FirmSettingDefinition<DeletedFilePolicy> = {
  key: "documents.deleted_file_policy",
  schema: z.object({
    trashDays: trashDaysSchema,
    afterTrash: z.enum(["archive", "keep-standard"]),
  }),
  defaultValue: DEFAULT_DELETED_FILE_POLICY,
};

export function readDeletedFilePolicy(database: SqlDatabase): Promise<DeletedFilePolicy> {
  return readFirmSetting(database, deletedFilePolicyDefinition);
}

/** The instant a file deleted at `deletedAtIso` leaves Trash under the policy, as an ISO string. */
export function leavesTrashAt(
  deletedAtIso: string,
  policy: Pick<DeletedFilePolicy, "trashDays">,
): string {
  return new Date(Date.parse(deletedAtIso) + policy.trashDays * 24 * 60 * 60 * 1000).toISOString();
}

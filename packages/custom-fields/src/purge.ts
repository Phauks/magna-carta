import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { CustomFieldId } from "@magna-carta/identifiers/types";
import type { CustomFieldWriteOptions } from "./run-custom-field-effect.ts";
import { CustomFieldError } from "./types.ts";

// Compliance erasure: an irreversible, audited removal of a custom field AND all of its values
// (current and historical) — the one case Archive cannot serve. Gated by the `customFields:purge`
// permission. The executing pass is built when a real erasure obligation appears; until then this
// seam refuses, so no destructive bulk operation ships speculatively. When built, it will: delete
// every custom_field_value for the field, delete its picklist_option rows, delete the custom_field
// row, and emit `custom_field.purged`.
export async function purgeCustomField(
  _database: BatchDatabase,
  _input: { fieldId: CustomFieldId | string; reason: string },
  _options: CustomFieldWriteOptions,
): Promise<never> {
  throw new CustomFieldError("purge-not-yet-enabled", "Custom-field purge is not yet enabled.");
}

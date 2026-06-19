import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { PicklistOptionId, CustomFieldId } from "@magna-carta/identifiers/types";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { customFieldAuditStatement } from "./audit.ts";
import { runCustomFieldEffect, type CustomFieldWriteOptions } from "./run-custom-field-effect.ts";
import {
  insertPicklistOptionStatement,
  updatePicklistOptionNameStatement,
  setPicklistOptionArchivedStatement,
  setPicklistOptionPositionStatement,
  deletePicklistOptionStatement,
} from "./picklist-option-statements.ts";
import { CustomFieldError } from "./types.ts";

export async function createPicklistOption(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId; name: string },
  options: CustomFieldWriteOptions,
) {
  const optionId = newIdentifier("picklistOption", options.randomSource) as PicklistOptionId;
  return runCustomFieldEffect<{ optionId: PicklistOptionId }>(database, options, 201, () => ({
    statements: [
      insertPicklistOptionStatement(database, {
        id: optionId,
        fieldId: input.fieldId,
        name: input.name,
        position: 0,
      }),
      customFieldAuditStatement(database, options, "custom_field.option_created", optionId),
    ],
    outboxMessages: [],
    value: { optionId },
  }));
}

export async function renamePicklistOption(
  database: BatchDatabase,
  input: { optionId: PicklistOptionId; name: string },
  options: CustomFieldWriteOptions,
) {
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      updatePicklistOptionNameStatement(database, input.optionId, input.name),
      customFieldAuditStatement(database, options, "custom_field.option_renamed", input.optionId),
    ],
    outboxMessages: [],
    value: { ok: true as const },
  }));
}

export async function reorderPicklistOption(
  database: BatchDatabase,
  input: { optionId: PicklistOptionId; position: number },
  options: CustomFieldWriteOptions,
) {
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      setPicklistOptionPositionStatement(database, input.optionId, input.position),
      customFieldAuditStatement(database, options, "custom_field.option_reordered", input.optionId),
    ],
    outboxMessages: [],
    value: { ok: true as const },
  }));
}

export async function archivePicklistOption(
  database: BatchDatabase,
  input: { optionId: PicklistOptionId },
  options: CustomFieldWriteOptions,
) {
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      setPicklistOptionArchivedStatement(database, input.optionId, 1),
      customFieldAuditStatement(database, options, "custom_field.option_archived", input.optionId),
    ],
    outboxMessages: [],
    value: { ok: true as const },
  }));
}

export async function hardDeletePicklistOption(
  database: BatchDatabase,
  input: { optionId: PicklistOptionId },
  options: CustomFieldWriteOptions,
) {
  const { results: inUseRows } = await database
    .prepare(`SELECT 1 FROM custom_field_value WHERE value_option_id = ?1 LIMIT 1`)
    .bind(input.optionId)
    .all<{ 1: number }>();
  if (inUseRows.length > 0) {
    throw new CustomFieldError(
      "option-in-use",
      "Cannot delete a picklist option that has stored values; archive it instead.",
    );
  }
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      deletePicklistOptionStatement(database, input.optionId),
      customFieldAuditStatement(database, options, "custom_field.option_deleted", input.optionId),
    ],
    outboxMessages: [],
    value: { ok: true as const },
  }));
}

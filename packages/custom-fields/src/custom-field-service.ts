import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CustomFieldId } from "@magna-carta/identifiers/types";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { customFieldAuditStatement } from "./audit.ts";
import {
  insertCustomFieldStatement,
  updateCustomFieldNameStatement,
  updateCustomFieldFlagsStatement,
} from "./custom-field-statements.ts";
import { runCustomFieldEffect, type CustomFieldWriteOptions } from "./run-custom-field-effect.ts";
import { CustomFieldError, type CustomFieldKind, type CustomFieldTarget } from "./types.ts";
import { MAX_FIELDS_PER_SCOPE, MAX_FIELDS_PER_FIRM } from "./limits.ts";

export interface DefineCustomFieldInput {
  readonly name: string;
  readonly kind: CustomFieldKind;
  readonly target: CustomFieldTarget;
  readonly attachmentId: string | null;
  readonly numberScale?: number | null;
  readonly required?: boolean;
}

async function assertWithinFieldCaps(
  database: BatchDatabase,
  input: DefineCustomFieldInput,
): Promise<void> {
  const { results: scopeRows } = await database
    .prepare(
      `SELECT COUNT(*) AS n FROM custom_field WHERE target = ?1 AND ((attachment_id IS NULL AND ?2 IS NULL) OR attachment_id = ?2) AND archived = 0`,
    )
    .bind(input.target, input.attachmentId)
    .all<{ n: number }>();
  if ((scopeRows[0]?.n ?? 0) >= MAX_FIELDS_PER_SCOPE)
    throw new CustomFieldError(
      "too-many-fields-for-scope",
      `A scope may hold at most ${MAX_FIELDS_PER_SCOPE} active fields.`,
    );
  const { results: firmRows } = await database
    .prepare(`SELECT COUNT(*) AS n FROM custom_field WHERE archived = 0`)
    .all<{ n: number }>();
  if ((firmRows[0]?.n ?? 0) >= MAX_FIELDS_PER_FIRM)
    throw new CustomFieldError(
      "too-many-fields-for-firm",
      `A firm may hold at most ${MAX_FIELDS_PER_FIRM} active fields.`,
    );
}

export async function defineCustomField(
  database: BatchDatabase,
  input: DefineCustomFieldInput,
  options: CustomFieldWriteOptions,
) {
  await assertWithinFieldCaps(database, input);
  const fieldId = newIdentifier("customField", options.randomSource) as CustomFieldId;
  return runCustomFieldEffect<{ customFieldId: CustomFieldId }>(database, options, 201, () => {
    const now = options.clock.now();
    return {
      statements: [
        insertCustomFieldStatement(database, {
          id: fieldId,
          name: input.name,
          kind: input.kind,
          target: input.target,
          attachmentId: input.attachmentId,
          numberScale: input.numberScale ?? null,
          required: input.required ? 1 : 0,
          position: 0,
          templateFieldKey: null,
          createdAt: now,
          createdBy: options.actorUserId,
        }),
        customFieldAuditStatement(database, options, "custom_field.defined", fieldId),
      ],
      outboxMessages: [],
      value: { customFieldId: fieldId },
    };
  });
}

export async function renameCustomField(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId; name: string },
  options: CustomFieldWriteOptions,
) {
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      updateCustomFieldNameStatement(database, input.fieldId, input.name),
      customFieldAuditStatement(database, options, "custom_field.renamed", input.fieldId),
    ],
    outboxMessages: [],
    value: { ok: true as const },
  }));
}

export async function archiveCustomField(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId },
  options: CustomFieldWriteOptions,
) {
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      updateCustomFieldFlagsStatement(database, input.fieldId, { archived: 1 }),
      customFieldAuditStatement(database, options, "custom_field.archived", input.fieldId),
    ],
    outboxMessages: [],
    value: { ok: true as const },
  }));
}

export async function unarchiveCustomField(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId },
  options: CustomFieldWriteOptions,
) {
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      updateCustomFieldFlagsStatement(database, input.fieldId, { archived: 0 }),
      customFieldAuditStatement(database, options, "custom_field.unarchived", input.fieldId),
    ],
    outboxMessages: [],
    value: { ok: true as const },
  }));
}

export async function setCustomFieldRequired(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId; required: boolean },
  options: CustomFieldWriteOptions,
) {
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      updateCustomFieldFlagsStatement(database, input.fieldId, {
        required: input.required ? 1 : 0,
      }),
      customFieldAuditStatement(database, options, "custom_field.required_changed", input.fieldId),
    ],
    outboxMessages: [],
    value: { ok: true as const },
  }));
}

export async function reorderCustomField(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId; position: number },
  options: CustomFieldWriteOptions,
) {
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      updateCustomFieldFlagsStatement(database, input.fieldId, { position: input.position }),
      customFieldAuditStatement(database, options, "custom_field.reordered", input.fieldId),
    ],
    outboxMessages: [],
    value: { ok: true as const },
  }));
}

export async function hardDeleteCustomField(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId },
  options: CustomFieldWriteOptions,
) {
  const { results: inUseRows } = await database
    .prepare(`SELECT 1 FROM custom_field_value WHERE field_id = ?1 LIMIT 1`)
    .bind(input.fieldId)
    .all<{ 1: number }>();
  if (inUseRows.length > 0) {
    throw new CustomFieldError(
      "field-in-use",
      "Cannot hard-delete a field that has values; archive it instead.",
    );
  }
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      database.prepare(`DELETE FROM picklist_option WHERE field_id = ?1`).bind(input.fieldId),
      database.prepare(`DELETE FROM custom_field WHERE id = ?1`).bind(input.fieldId),
      customFieldAuditStatement(database, options, "custom_field.hard_deleted", input.fieldId),
    ],
    outboxMessages: [],
    value: { ok: true as const },
  }));
}

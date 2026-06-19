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
import type { CustomFieldKind, CustomFieldTarget } from "./types.ts";

export interface DefineCustomFieldInput {
  readonly name: string;
  readonly kind: CustomFieldKind;
  readonly target: CustomFieldTarget;
  readonly attachmentId: string | null;
  readonly numberScale?: number | null;
  readonly required?: boolean;
}

export async function defineCustomField(
  database: BatchDatabase,
  input: DefineCustomFieldInput,
  options: CustomFieldWriteOptions,
) {
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

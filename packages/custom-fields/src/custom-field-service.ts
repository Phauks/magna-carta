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
import { MAX_FIELDS_PER_SCOPE, MAX_FIELDS_PER_FIRM, MAX_NUMBER_SCALE } from "./limits.ts";

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

// A field's number_scale is the exponent every write and every conversion scales by, so it has to stay
// inside the range where 10^scale is still an exact integer — a wild scale turns each stored value into
// a rounded or infinite number long before anything else notices.
function assertNumberScaleInRange(numberScale: number | null | undefined): void {
  if (numberScale === null || numberScale === undefined) return;
  if (!Number.isInteger(numberScale) || numberScale < 0 || numberScale > MAX_NUMBER_SCALE) {
    throw new CustomFieldError(
      "number-scale-out-of-range",
      `A field's number scale must be a whole number from 0 to ${MAX_NUMBER_SCALE}.`,
    );
  }
}

export async function defineCustomField(
  database: BatchDatabase,
  input: DefineCustomFieldInput,
  options: CustomFieldWriteOptions,
) {
  assertNumberScaleInRange(input.numberScale);
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

// Whether any registered document template binds this field as a merge field.
//
// A template version stores the field manifest it was normalized against, and a binding to a firm's own
// field is the key `custom.<handle>` inside it — so the search is for that literal string in the stored
// manifests. It is a scan rather than an index lookup, and deliberately so: this runs on a rare
// administrative action where a human is deciding whether to destroy a definition, never on a read or
// write path, and the alternative (a bindings table maintained alongside every registration) is a second
// copy of a fact the manifest already states, with its own way of going stale.
//
// The table is named by string. `@magna-carta/custom-fields` does not import
// `@magna-carta/document-assembly` and must not — the two are siblings, and the table lives in the
// shared schema package, exactly as `@magna-carta/directory` reaches `custom_field_value`.
async function isBoundByATemplate(
  database: BatchDatabase,
  fieldId: CustomFieldId,
): Promise<boolean> {
  const { results } = await database
    .prepare(
      `SELECT 1 FROM document_template_version WHERE instr(field_manifest_json, ?1) > 0 LIMIT 1`,
    )
    .bind(`custom.${fieldId}`)
    .all<{ 1: number }>();
  return results.length > 0;
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
      "field-in-use: Cannot hard-delete a field that has values; archive it instead.",
    );
  }
  // A field a document template binds is in use even with no values behind it. Destroying the
  // definition would leave every template that names it unable to assemble, with a handle nobody can
  // look up — so the same refusal that guards stored values guards a template binding, and routes the
  // administrator to Archive, where a bound field resolves as a reported absence instead.
  if (await isBoundByATemplate(database, input.fieldId)) {
    throw new CustomFieldError(
      "field-in-use",
      "field-in-use: Cannot hard-delete a field a document template uses as a merge field; archive it instead.",
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

import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { CustomFieldId } from "@magna-carta/identifiers/types";
import type { CustomFieldTarget } from "./types.ts";

export interface CustomFieldRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly target: string;
  readonly attachmentId: string | null;
  readonly archived: number;
}

export interface CustomFieldValueRow {
  readonly id: string;
  readonly fieldId: string;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly valueDate: string | null;
  readonly valueOptionId: string | null;
  readonly valueReferenceId: string | null;
  readonly validFrom: string;
  readonly validTo: string | null;
}

export type ResolvedCustomField =
  | { status: "active"; field: CustomFieldRow }
  | { status: "archived"; field: CustomFieldRow }
  | { status: "absent" };

export async function resolveCustomField(
  database: SqlDatabase,
  fieldId: CustomFieldId | string,
): Promise<ResolvedCustomField> {
  const { results } = await database
    .prepare(
      `SELECT id, name, kind, target, attachment_id AS attachmentId, archived FROM custom_field WHERE id = ?1`,
    )
    .bind(fieldId)
    .all<CustomFieldRow>();
  const row = results[0];
  if (!row) return { status: "absent" };
  return { status: row.archived === 1 ? "archived" : "active", field: row };
}

export async function readCurrentValues(
  database: SqlDatabase,
  targetRowId: string,
): Promise<CustomFieldValueRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, field_id AS fieldId, value_text AS valueText, value_number AS valueNumber, value_date AS valueDate, value_option_id AS valueOptionId, value_reference_id AS valueReferenceId, valid_from AS validFrom, valid_to AS validTo FROM custom_field_value WHERE target_row_id = ?1 AND is_current = 1`,
    )
    .bind(targetRowId)
    .all<CustomFieldValueRow>();
  return results;
}

// One active field the scope offers, with this record's current value on it — or nulls where the
// record has none.
export interface ScopedCustomFieldValueRow {
  readonly fieldId: string;
  readonly name: string;
  readonly kind: string;
  readonly numberScale: number | null;
  readonly required: number;
  readonly position: number;
  // Null on every value column when nobody has set this field on this record. A field the scope
  // offers and the record has not answered is a real, reportable state — not the same thing as a
  // field the scope does not offer at all, and collapsing the two would leave a caller unable to
  // tell "not filled in" from "not applicable here".
  readonly valueId: string | null;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly valueDate: string | null;
  readonly valueOptionId: string | null;
  readonly valueReferenceId: string | null;
  readonly validFrom: string | null;
}

// Every ACTIVE field a scope offers, left-joined to one record's current value for it.
//
// ONE READ, whatever the field count — the same batching discipline the merge resolver holds to. The
// natural implementation is "list the fields, then fetch each one's value", which is an N+1 aimed at
// a record with thirty of a firm's own fields on it.
//
// The scope is `target` plus `attachmentId`, and the attachment arm is what makes per-class fields
// work: a field with a null attachment applies to every record on the axis, one naming a class (or a
// matter type, or a contact category — the column means the axis's own narrowing on each target)
// applies only there. An archived field is excluded, matching the engine's archive-as-absence rule
// everywhere else — its stored values endure and stay reachable through the history read.
export async function readCustomFieldValuesForScope(
  database: SqlDatabase,
  scope: {
    readonly target: CustomFieldTarget;
    readonly attachmentId: string | null;
    readonly targetRowId: string;
  },
): Promise<ScopedCustomFieldValueRow[]> {
  const { results } = await database
    .prepare(
      `SELECT custom_field.id AS fieldId,
              custom_field.name AS name,
              custom_field.kind AS kind,
              custom_field.number_scale AS numberScale,
              custom_field.required AS required,
              custom_field.position AS position,
              custom_field_value.id AS valueId,
              custom_field_value.value_text AS valueText,
              custom_field_value.value_number AS valueNumber,
              custom_field_value.value_date AS valueDate,
              custom_field_value.value_option_id AS valueOptionId,
              custom_field_value.value_reference_id AS valueReferenceId,
              custom_field_value.valid_from AS validFrom
         FROM custom_field
         LEFT JOIN custom_field_value
                ON custom_field_value.field_id = custom_field.id
               AND custom_field_value.target_row_id = ?3
               AND custom_field_value.is_current = 1
        WHERE custom_field.target = ?1
          AND custom_field.archived = 0
          AND (custom_field.attachment_id IS NULL OR custom_field.attachment_id = ?2)
        ORDER BY custom_field.position, custom_field.name, custom_field.id`,
    )
    .bind(scope.target, scope.attachmentId, scope.targetRowId)
    .all<ScopedCustomFieldValueRow>();
  return results;
}

export async function readValueHistory(
  database: SqlDatabase,
  fieldId: CustomFieldId | string,
  targetRowId: string,
): Promise<CustomFieldValueRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, field_id AS fieldId, value_text AS valueText, value_number AS valueNumber, value_date AS valueDate, value_option_id AS valueOptionId, value_reference_id AS valueReferenceId, valid_from AS validFrom, valid_to AS validTo FROM custom_field_value WHERE field_id = ?1 AND target_row_id = ?2 ORDER BY valid_from`,
    )
    .bind(fieldId, targetRowId)
    .all<CustomFieldValueRow>();
  return results;
}

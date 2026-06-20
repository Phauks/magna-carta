import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { CustomFieldId } from "@magna-carta/identifiers/types";

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

import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { CustomFieldId, CustomFieldValueId } from "@magna-carta/identifiers/types";

const TABLE = "custom_field_value";

// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function flipCurrentValueStatement(
  database: SqlDatabase,
  fieldId: CustomFieldId,
  targetRowId: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TABLE} SET is_current = 0, valid_to = ?3 WHERE field_id = ?1 AND target_row_id = ?2 AND is_current = 1`,
    )
    .bind(fieldId, targetRowId, now);
}

export interface InsertValueRow {
  readonly id: CustomFieldValueId;
  readonly fieldId: CustomFieldId;
  readonly targetRowId: string;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly valueDate: string | null;
  readonly valueOptionId: string | null;
  readonly valueReferenceId: string | null;
  readonly now: string;
  readonly createdBy: string | null;
}

export function insertCurrentValueStatement(
  database: SqlDatabase,
  row: InsertValueRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TABLE} (id, field_id, target_row_id, value_text, value_number, value_date, value_option_id, value_reference_id, is_current, valid_from, valid_to, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, NULL, ?9, ?10)`,
    )
    .bind(
      row.id,
      row.fieldId,
      row.targetRowId,
      row.valueText,
      row.valueNumber,
      row.valueDate,
      row.valueOptionId,
      row.valueReferenceId,
      row.now,
      row.createdBy,
    );
}

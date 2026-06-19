import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { CustomFieldId } from "@magna-carta/identifiers/types";

const CUSTOM_FIELD_TABLE = "custom_field";

export interface InsertCustomFieldRow {
  readonly id: CustomFieldId;
  readonly name: string;
  readonly kind: string;
  readonly target: string;
  readonly attachmentId: string | null;
  readonly numberScale: number | null;
  readonly required: number;
  readonly position: number;
  readonly templateFieldKey: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export function insertCustomFieldStatement(
  database: SqlDatabase,
  row: InsertCustomFieldRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTOM_FIELD_TABLE} (id, name, kind, target, attachment_id, number_scale, required, archived, converting, position, template_field_key, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      row.id,
      row.name,
      row.kind,
      row.target,
      row.attachmentId,
      row.numberScale,
      row.required,
      row.position,
      row.templateFieldKey,
      row.createdAt,
      row.createdBy,
    );
}

export function updateCustomFieldNameStatement(
  database: SqlDatabase,
  id: CustomFieldId,
  name: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${CUSTOM_FIELD_TABLE} SET name = ?2 WHERE id = ?1`)
    .bind(id, name);
}

export function updateCustomFieldFlagsStatement(
  database: SqlDatabase,
  id: CustomFieldId,
  fields: {
    required?: number;
    archived?: number;
    position?: number;
    converting?: number;
    kind?: string;
    numberScale?: number | null;
  },
): SqlStatement {
  const sets: string[] = [];
  const bindings: (string | number | null)[] = [id];
  let index = 2;
  for (const [column, value] of Object.entries({
    required: fields.required,
    archived: fields.archived,
    position: fields.position,
    converting: fields.converting,
    kind: fields.kind,
    number_scale: fields.numberScale,
  })) {
    if (value === undefined) continue;
    sets.push(`${column} = ?${index}`);
    bindings.push(value as string | number | null);
    index += 1;
  }
  if (sets.length === 0) {
    throw new Error("updateCustomFieldFlagsStatement: at least one field must be provided");
  }
  return database
    .prepare(`UPDATE ${CUSTOM_FIELD_TABLE} SET ${sets.join(", ")} WHERE id = ?1`)
    .bind(...bindings);
}

export function deleteCustomFieldStatement(database: SqlDatabase, id: CustomFieldId): SqlStatement {
  return database.prepare(`DELETE FROM ${CUSTOM_FIELD_TABLE} WHERE id = ?1`).bind(id);
}

export function selectCustomFieldStatement(database: SqlDatabase, id: CustomFieldId): SqlStatement {
  return database
    .prepare(
      `SELECT id, name, kind, target, attachment_id, number_scale, required, archived, converting, position FROM ${CUSTOM_FIELD_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

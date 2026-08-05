import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { CustomFieldKind } from "@magna-carta/custom-fields/types";
import type { CustomFieldDefinitionRow, CustomFieldValueRow } from "./custom-field-bindings.ts";

// The custom-field arm of the resolution reads. Table names are tracked against
// @magna-carta/database's per-firm schema by the schema-name-sync fitness test.
//
// TWO STATEMENTS, EACH COVERING EVERY HANDLE — never one per field. A template naming forty of a firm's
// own fields costs the same reads as one naming two, which is the batching rule the whole resolver is
// built on. The two are the catalogue read (what fields the firm has, which is what a template is
// AUTHORED and re-CHECKED against, and which touches no matter's data) and the value read (what this
// one matter holds for them).

export const CUSTOM_FIELD_TABLE = "custom_field";
export const CUSTOM_FIELD_VALUE_TABLE = "custom_field_value";
export const PICKLIST_OPTION_TABLE = "picklist_option";
export const MATTER_TABLE = "matter";
export const DIRECTORY_PERSON_TABLE = "directory_person";
export const DIRECTORY_ORGANIZATION_TABLE = "directory_organization";

// A bound-parameter list of the right length: `?1, ?2, …`. Handles NEVER reach the SQL text — the
// statement's shape depends only on how many there are, so a firm-supplied handle cannot become a
// fragment of a query however it is spelled.
function placeholders(count: number, from = 1): string {
  return Array.from({ length: count }, (_unused, index) => `?${index + from}`).join(", ");
}

export interface CustomFieldDefinitionColumns {
  id: string;
  name: string;
  kind: string;
  number_scale: number | null;
  archived: number;
}

// The firm's ACTIVE matter-axis fields, as the dictionary sees them. Scoped to `target = 'matter'`
// because an assembly resolves against a matter: an entity-axis field's values hang off a directory
// record, and offering one as a merge field would produce a key that can never resolve.
export function selectCustomFieldCatalogStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT id, name, kind, number_scale, archived
       FROM ${CUSTOM_FIELD_TABLE}
      WHERE target = 'matter' AND archived = 0
      ORDER BY position, name, id`,
  );
}

export function toCustomFieldDefinitionRow(
  row: CustomFieldDefinitionColumns,
): CustomFieldDefinitionRow {
  return {
    handle: row.id,
    name: row.name,
    kind: row.kind as CustomFieldKind,
    numberScale: row.number_scale,
    archived: row.archived === 1,
  };
}

export interface CustomFieldValueColumns {
  handle: string;
  kind: string;
  number_scale: number | null;
  archived: number;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  resolved_label: string | null;
}

// Every handle the manifest mentions, resolved against ONE matter, in one statement.
//
// The joins are what keep it one statement. A picklist value stores an option handle and a reference
// value stores a record handle, and neither is a fact a document can print — so the option's label and
// the referenced record's display name are joined here rather than fetched per value, which is exactly
// the N+1 the batching rule exists to forbid. A soft-deleted directory record still joins to nothing and
// resolves as an absence, which is the honest outcome: a document that quietly omitted the name would be
// worse than one that shows the gap.
//
// The definition columns ride along because assembly needs the field's kind and scale to read its stored
// integer at all, and reading them here rather than in a second statement is one fewer round trip on the
// path a user is waiting on.
export function selectCustomFieldValuesStatement(
  database: SqlDatabase,
  matterId: string,
  handles: readonly string[],
): SqlStatement {
  const handleList = placeholders(handles.length, 2);
  return database
    .prepare(
      `SELECT custom_field.id AS handle,
              custom_field.kind AS kind,
              custom_field.number_scale AS number_scale,
              custom_field.archived AS archived,
              custom_field_value.value_text AS value_text,
              custom_field_value.value_number AS value_number,
              custom_field_value.value_date AS value_date,
              COALESCE(picklist_option.name,
                       directory_person.display_name,
                       directory_organization.display_name,
                       directory_organization.legal_name,
                       referenced_matter.title) AS resolved_label
         FROM ${CUSTOM_FIELD_TABLE} AS custom_field
         LEFT JOIN ${CUSTOM_FIELD_VALUE_TABLE} AS custom_field_value
                ON custom_field_value.field_id = custom_field.id
               AND custom_field_value.target_row_id = ?1
               AND custom_field_value.is_current = 1
         LEFT JOIN ${PICKLIST_OPTION_TABLE} AS picklist_option
                ON picklist_option.id = custom_field_value.value_option_id
         LEFT JOIN ${DIRECTORY_PERSON_TABLE} AS directory_person
                ON directory_person.id = custom_field_value.value_reference_id
               AND directory_person.deleted_at IS NULL
         LEFT JOIN ${DIRECTORY_ORGANIZATION_TABLE} AS directory_organization
                ON directory_organization.id = custom_field_value.value_reference_id
               AND directory_organization.deleted_at IS NULL
         LEFT JOIN ${MATTER_TABLE} AS referenced_matter
                ON referenced_matter.id = custom_field_value.value_reference_id
        WHERE custom_field.id IN (${handleList})`,
    )
    .bind(matterId, ...handles);
}

export function toCustomFieldValueRow(row: CustomFieldValueColumns): CustomFieldValueRow {
  return {
    handle: row.handle,
    kind: row.kind as CustomFieldKind,
    numberScale: row.number_scale,
    valueText: row.value_text,
    valueNumber: row.value_number,
    valueDate: row.value_date,
    resolvedLabel: row.resolved_label,
  };
}

// Whether a row the value read returned belongs to a field the firm has since archived. An archived
// field resolves as an ABSENCE rather than as its last stored value: the firm withdrew the field, and a
// document that kept printing what it used to hold would be asserting something the firm stopped
// standing behind.
export function isArchivedCustomFieldRow(row: CustomFieldValueColumns): boolean {
  return row.archived === 1;
}

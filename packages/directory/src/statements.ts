import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { DirectoryNameId, DirectoryOrganizationId, DirectoryPersonId } from "@magna-carta/identifiers/types";
import type { EntityKind, NameRole, PhoneticScheme } from "./types.js";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test.
export const DIRECTORY_PERSON_TABLE = "directory_person";
export const DIRECTORY_ORGANIZATION_TABLE = "directory_organization";
export const DIRECTORY_NAME_TABLE = "directory_name";
export const DIRECTORY_NAME_PHONETIC_CODE_TABLE = "directory_name_phonetic_code";

// The caller-supplied person status values; the table CHECK constrains the column to exactly these.
export type PersonStatus = "active" | "merged_into";

// The person row written by createPerson. The structured name parts live alongside the rendered
// display_name so a list view never has to recompose them. status starts 'active'; merged_into_id is
// set only by a merge.
export interface InsertPersonRow {
  readonly id: DirectoryPersonId;
  readonly prefix: string | null;
  readonly given: string | null;
  readonly middle: string | null;
  readonly family: string | null;
  readonly suffix: string | null;
  readonly displayName: string;
  readonly status: PersonStatus;
  readonly createdAt: string;
}

export function insertPersonStatement(database: SqlDatabase, row: InsertPersonRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DIRECTORY_PERSON_TABLE} (id, name_prefix, name_given, name_middle, name_family, name_suffix, display_name, status, merged_into_id, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?9, NULL)`,
    )
    .bind(
      row.id,
      row.prefix,
      row.given,
      row.middle,
      row.family,
      row.suffix,
      row.displayName,
      row.status,
      row.createdAt,
    );
}

// A name row attached to an entity. entity_kind is a parameter so the organization service reuses
// this builder unchanged. normalized_display is the frozen-contract key that drives search, phonetic
// encoding, and duplicate detection; the INSERT trigger mirrors it into the FTS index automatically.
export interface InsertNameRow {
  readonly id: DirectoryNameId;
  readonly entityId: string;
  readonly entityKind: EntityKind;
  readonly nameRole: NameRole;
  readonly prefix: string | null;
  readonly given: string | null;
  readonly middle: string | null;
  readonly family: string | null;
  readonly suffix: string | null;
  readonly normalizedDisplay: string;
  readonly isCurrent: boolean;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly createdAt: string;
}

export function insertNameStatement(database: SqlDatabase, row: InsertNameRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DIRECTORY_NAME_TABLE} (id, entity_id, entity_kind, name_role, name_prefix, name_given, name_middle, name_family, name_suffix, normalized_display, is_current, valid_from, valid_to, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, NULL)`,
    )
    .bind(
      row.id,
      row.entityId,
      row.entityKind,
      row.nameRole,
      row.prefix,
      row.given,
      row.middle,
      row.family,
      row.suffix,
      row.normalizedDisplay,
      row.isCurrent ? 1 : 0,
      row.validFrom,
      row.validTo,
      row.createdAt,
    );
}

// One phonetic-code row per code on a name (Double Metaphone primary + secondary). Returns a
// statement per code so the caller pushes them all into the same atomic batch as the name they
// belong to. The (name_id, scheme) primary key keeps each scheme's code a single row.
export function insertPhoneticCodeStatements(
  database: SqlDatabase,
  nameId: DirectoryNameId,
  codes: ReadonlyArray<{ scheme: PhoneticScheme; code: string }>,
): SqlStatement[] {
  return codes.map((code) =>
    database
      .prepare(
        `INSERT INTO ${DIRECTORY_NAME_PHONETIC_CODE_TABLE} (name_id, scheme, code) VALUES (?1, ?2, ?3)`,
      )
      .bind(nameId, code.scheme, code.code),
  );
}

// The full mutable, caller-supplied person row read back by readPerson and projected to the typed
// Person. The structured name parts plus the rendered display_name and the lifecycle status.
export interface PersonRow {
  readonly id: DirectoryPersonId;
  readonly prefix: string | null;
  readonly given: string | null;
  readonly middle: string | null;
  readonly family: string | null;
  readonly suffix: string | null;
  readonly displayName: string | null;
  readonly status: PersonStatus;
  readonly mergedIntoId: string | null;
}

export function selectPersonStatement(database: SqlDatabase, id: DirectoryPersonId): SqlStatement {
  return database
    .prepare(
      `SELECT id, name_prefix, name_given, name_middle, name_family, name_suffix, display_name, status, merged_into_id FROM ${DIRECTORY_PERSON_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

// The non-name standard fields a caller may change after creation: lifecycle status and the
// merge pointer. Name changes flow through the name-history path (a new directory_name row), never
// this update — so this statement deliberately leaves the name_* columns alone.
export interface UpdatePersonFields {
  readonly status: PersonStatus;
  readonly mergedIntoId: string | null;
}

export function updatePersonFieldsStatement(
  database: SqlDatabase,
  id: DirectoryPersonId,
  fields: UpdatePersonFields,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DIRECTORY_PERSON_TABLE} SET status = ?2, merged_into_id = ?3, updated_at = ?4 WHERE id = ?1`,
    )
    .bind(id, fields.status, fields.mergedIntoId, updatedAt);
}

// The caller-supplied organization status values; the table CHECK constrains the column to exactly these.
export type OrganizationStatus = "active" | "merged_into";

// The organization row written by createOrganization. legal_name is the primary name column;
// display_name defaults to legal_name at creation and may diverge if the organization trades
// under a different name. status starts 'active'; merged_into_id is set only by a merge.
export interface InsertOrganizationRow {
  readonly id: DirectoryOrganizationId;
  readonly legalName: string;
  readonly displayName: string;
  readonly status: OrganizationStatus;
  readonly createdAt: string;
}

export function insertOrganizationStatement(
  database: SqlDatabase,
  row: InsertOrganizationRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DIRECTORY_ORGANIZATION_TABLE} (id, legal_name, display_name, ein_ciphertext, ein_blind_index, status, merged_into_id, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL, ?4, NULL, ?5, ?5, NULL)`,
    )
    .bind(row.id, row.legalName, row.displayName, row.status, row.createdAt);
}

export function selectOrganizationStatement(
  database: SqlDatabase,
  id: DirectoryOrganizationId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, legal_name, display_name, status, merged_into_id FROM ${DIRECTORY_ORGANIZATION_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

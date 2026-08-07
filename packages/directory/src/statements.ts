import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DirectoryEmailId,
  DirectoryNameId,
  DirectoryOrganizationId,
  DirectoryPersonId,
  MatterPartyId,
} from "@magna-carta/identifiers/types";
import type { EntityKind, NameRole, PhoneticScheme } from "./types.ts";

export const MATTER_PARTY_TABLE = "matter_party";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test.
export const DIRECTORY_PERSON_TABLE = "directory_person";
export const DIRECTORY_ORGANIZATION_TABLE = "directory_organization";
export const DIRECTORY_NAME_TABLE = "directory_name";
export const DIRECTORY_NAME_PHONETIC_CODE_TABLE = "directory_name_phonetic_code";
export const DIRECTORY_IDENTIFIER_TABLE = "directory_identifier";
export const DIRECTORY_EMAIL_TABLE = "directory_email";

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
  // 0/1; an ordinary create binds 0, a provisional import (a bare client display name with no
  // structured parts to trust) binds 1 so a clerk reviews it before it joins the conflicts corpus.
  readonly needsReview: 0 | 1;
  readonly createdAt: string;
}

export function insertPersonStatement(database: SqlDatabase, row: InsertPersonRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DIRECTORY_PERSON_TABLE} (id, name_prefix, name_given, name_middle, name_family, name_suffix, display_name, status, merged_into_id, needs_review, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?10, NULL)`,
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
      row.needsReview,
      row.createdAt,
    );
}

// A matter↔entity party link. role is free text (the directory_party_role catalog is what a UI lists
// from, not a constraint). valid_from/valid_to are NULL at creation; the link is undated until a caller
// sets a window. The one home for the matter_party INSERT — linkMatterParty and the 1·1 client-field
// migration both compose through it so the column list never drifts between two hand-written copies.
export interface InsertMatterPartyRow {
  readonly id: MatterPartyId;
  readonly matterId: string;
  readonly entityId: string;
  readonly role: string;
  // The capacity the party acts in on this matter — "Administrator", "Trustee" — recorded by the
  // firm, never inferred. Null when the link carries none.
  readonly capacity: string | null;
  readonly createdAt: string;
}

export function insertMatterPartyStatement(
  database: SqlDatabase,
  row: InsertMatterPartyRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_PARTY_TABLE} (id, matter_id, entity_id, role, capacity, valid_from, valid_to, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?6, NULL)`,
    )
    .bind(row.id, row.matterId, row.entityId, row.role, row.capacity, row.createdAt);
}

// An email address attached to an entity. `address` is stored as entered (trimmed); `normalized`
// is the lowercased match key the reverse address -> entity lookup queries. valid_from/valid_to are
// NULL at creation. The one home for the directory_email INSERT so the column list never drifts.
export interface InsertEmailRow {
  readonly id: DirectoryEmailId;
  readonly entityId: string;
  readonly label: string | null;
  readonly address: string;
  readonly normalizedAddress: string;
  readonly isPrimary: 0 | 1;
  readonly createdAt: string;
}

export function insertEmailStatement(database: SqlDatabase, row: InsertEmailRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DIRECTORY_EMAIL_TABLE} (id, entity_id, label, address, normalized_address, is_primary, valid_from, valid_to, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7, ?7, NULL)`,
    )
    .bind(
      row.id,
      row.entityId,
      row.label,
      row.address,
      row.normalizedAddress,
      row.isPrimary,
      row.createdAt,
    );
}

// Demote every live primary email on an entity to non-primary. Composed ahead of an insert/update that
// sets a new primary so the "at most one primary per entity" invariant holds in the same atomic batch.
export function demoteEntityPrimaryEmailsStatement(
  database: SqlDatabase,
  entityId: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DIRECTORY_EMAIL_TABLE} SET is_primary = 0, updated_at = ?2 WHERE entity_id = ?1 AND is_primary = 1 AND deleted_at IS NULL`,
    )
    .bind(entityId, updatedAt);
}

// The mutable fields an updateEmail rewrites in full (no dynamic column list): label, the as-entered
// address, its normalized key, and the primary flag. Name/lifecycle columns are never touched here.
export interface UpdateEmailFields {
  readonly label: string | null;
  readonly address: string;
  readonly normalizedAddress: string;
  readonly isPrimary: 0 | 1;
}

export function updateEmailStatement(
  database: SqlDatabase,
  id: DirectoryEmailId,
  fields: UpdateEmailFields,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DIRECTORY_EMAIL_TABLE} SET label = ?2, address = ?3, normalized_address = ?4, is_primary = ?5, updated_at = ?6 WHERE id = ?1`,
    )
    .bind(id, fields.label, fields.address, fields.normalizedAddress, fields.isPrimary, updatedAt);
}

// Soft-delete an email row (this system never hard-deletes). Sets deleted_at and touches updated_at.
export function softDeleteEmailStatement(
  database: SqlDatabase,
  id: DirectoryEmailId,
  deletedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${DIRECTORY_EMAIL_TABLE} SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1`)
    .bind(id, deletedAt);
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
  // 0/1; an ordinary create binds 0, a provisional import binds 1 so a clerk reviews it.
  readonly needsReview: 0 | 1;
  readonly createdAt: string;
}

export function insertOrganizationStatement(
  database: SqlDatabase,
  row: InsertOrganizationRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DIRECTORY_ORGANIZATION_TABLE} (id, legal_name, display_name, status, merged_into_id, needs_review, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?6, NULL)`,
    )
    .bind(row.id, row.legalName, row.displayName, row.status, row.needsReview, row.createdAt);
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

// Flip the entity's current name row to a former row: set name_role='former', is_current=0,
// valid_to=now, and touch updated_at. The row is preserved in place — never deleted — so phonetic
// codes and normalized_display remain queryable for the conflicts corpus.
export function flipCurrentNameToFormerStatement(
  database: SqlDatabase,
  entityId: string,
  validTo: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DIRECTORY_NAME_TABLE} SET name_role = 'former', is_current = 0, valid_to = ?2, updated_at = ?2 WHERE entity_id = ?1 AND is_current = 1`,
    )
    .bind(entityId, validTo);
}

// The new name columns to write onto the person entity row when a person's name changes. This is
// the denormalized projection kept on the entity row for fast list/display reads; the authoritative
// record is in directory_name.
export interface UpdatePersonNameFields {
  readonly prefix: string | null;
  readonly given: string | null;
  readonly middle: string | null;
  readonly family: string | null;
  readonly suffix: string | null;
  readonly displayName: string;
}

export function updatePersonNameStatement(
  database: SqlDatabase,
  id: DirectoryPersonId,
  fields: UpdatePersonNameFields,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DIRECTORY_PERSON_TABLE} SET name_prefix = ?2, name_given = ?3, name_middle = ?4, name_family = ?5, name_suffix = ?6, display_name = ?7, updated_at = ?8 WHERE id = ?1`,
    )
    .bind(
      id,
      fields.prefix,
      fields.given,
      fields.middle,
      fields.family,
      fields.suffix,
      fields.displayName,
      updatedAt,
    );
}

// The new name columns to write onto the organization entity row when an organization's name
// changes. legal_name is the primary field; display_name defaults to legal_name if not supplied.
export interface UpdateOrganizationNameFields {
  readonly legalName: string;
  readonly displayName: string;
}

export function updateOrganizationNameStatement(
  database: SqlDatabase,
  id: DirectoryOrganizationId,
  fields: UpdateOrganizationNameFields,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DIRECTORY_ORGANIZATION_TABLE} SET legal_name = ?2, display_name = ?3, updated_at = ?4 WHERE id = ?1`,
    )
    .bind(id, fields.legalName, fields.displayName, updatedAt);
}

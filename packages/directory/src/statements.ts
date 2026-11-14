import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DirectoryAddressId,
  DirectoryEmailId,
  DirectoryNameId,
  DirectoryOrganizationId,
  DirectoryPersonId,
  DirectoryPhoneId,
  MatterPartyId,
  UserId,
} from "@magna-carta/identifiers/types";
import { normalizedMatchKey, normalizedMatchKeyBare } from "./match-key.ts";
import type { PronounSet } from "./pronouns.ts";
import type { EntityKind, NameRole, PhoneticScheme } from "./types.ts";

export const MATTER_PARTY_TABLE = "matter_party";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test.
export const DIRECTORY_PERSON_TABLE = "directory_person";
export const DIRECTORY_ORGANIZATION_TABLE = "directory_organization";
export const DIRECTORY_NAME_TABLE = "directory_name";
export const DIRECTORY_NAME_PHONETIC_CODE_TABLE = "directory_name_phonetic_code";
export const NICKNAME_EQUIVALENCE_TABLE = "nickname_equivalence";
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

// Soft-deletes one party link. The twin of the INSERT above, and the only writer of
// matter_party.deleted_at — five readers filter on that column (the conflicts check and its
// re-check cause, the assembly merge read, the client-role predicate in packages/matters, and the
// load profile) and until this statement existed none of them could ever observe a non-null value.
//
// Guarded on deleted_at IS NULL so a repeated unlink reports zero rows changed rather than moving
// the timestamp: the instant a link was severed is a fact about the first severing, and a caller
// retrying must not be able to rewrite it.
// fitness:unguarded-write — soft-deleting a link already soft-deleted is the state the caller asked for
export function softDeleteMatterPartyStatement(
  database: SqlDatabase,
  row: { readonly id: MatterPartyId; readonly deletedAt: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_PARTY_TABLE} SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL`,
    )
    .bind(row.id, row.deletedAt);
}

// ── Contact points: email, phone, address ────────────────────────────────────────────────────────
//
// The three tables stay three. A postal address has nine components and a telecommunication endpoint
// has one, so a polymorphic contact-point table would put eight permanently null columns on every
// phone row — and it would break directory_email_normalized_address_index, which the inbound-capture
// reverse lookup depends on to resolve a correspondent to a matter in one statement.
//
// What they DO share is the preference and verification block, so its columns are named once here
// and every builder below binds the same seven in the same order.

export const DIRECTORY_PHONE_TABLE = "directory_phone";
export const DIRECTORY_ADDRESS_TABLE = "directory_address";

// The tables a contact preference can live in. The "at most one preferred contact point per entity"
// rule spans all three, because "reach me by post" is one answer about every channel at once.
export const CONTACT_POINT_TABLES = [
  DIRECTORY_EMAIL_TABLE,
  DIRECTORY_PHONE_TABLE,
  DIRECTORY_ADDRESS_TABLE,
] as const;

// Whether the firm may use this contact point, whether it is the one the person asked to be reached
// by, and whether the firm has confirmed it is still true. Common to all three tables.
export interface ContactRowFields {
  readonly contactPermitted: 0 | 1;
  readonly contactPreferred: 0 | 1;
  readonly contactNote: string | null;
  readonly verificationStatus: string;
  readonly verifiedAt: string | null;
  readonly verifiedBy: UserId | null;
  readonly verificationDetail: string | null;
}

// The seven shared columns, in the order every builder below binds them.
const CONTACT_COLUMNS =
  "contact_permitted, contact_preferred, contact_note, verification_status, verified_at, verified_by, verification_detail";

function contactValues(fields: ContactRowFields): readonly (string | number | null)[] {
  return [
    fields.contactPermitted,
    fields.contactPreferred,
    fields.contactNote,
    fields.verificationStatus,
    fields.verifiedAt,
    fields.verifiedBy,
    fields.verificationDetail,
  ];
}

// Demote every live PREFERRED contact point on an entity, across all three tables. Composed ahead of
// an insert or update that sets a new preferred one, so the invariant holds inside the same atomic
// batch. Three statements rather than one because the fact spans three tables and D1 has no
// interactive transaction to hold them open between.
// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function demoteEntityPreferredContactStatements(
  database: SqlDatabase,
  entityId: string,
  updatedAt: string,
): SqlStatement[] {
  return CONTACT_POINT_TABLES.map((table) =>
    database
      .prepare(
        `UPDATE ${table} SET contact_preferred = 0, updated_at = ?2 WHERE entity_id = ?1 AND contact_preferred = 1 AND deleted_at IS NULL`,
      )
      .bind(entityId, updatedAt),
  );
}

// An email address attached to an entity. `address` is stored as entered (trimmed); `normalized`
// is the lowercased match key the reverse address -> entity lookup queries. valid_from/valid_to are
// NULL at creation. The one home for the directory_email INSERT so the column list never drifts.
export interface InsertEmailRow extends ContactRowFields {
  readonly id: DirectoryEmailId;
  readonly entityId: string;
  readonly label: string | null;
  readonly contactUse: string | null;
  readonly address: string;
  readonly normalizedAddress: string;
  readonly isPrimary: 0 | 1;
  readonly createdAt: string;
}

export function insertEmailStatement(database: SqlDatabase, row: InsertEmailRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DIRECTORY_EMAIL_TABLE} (id, entity_id, label, contact_use, address, normalized_address, is_primary, ${CONTACT_COLUMNS}, valid_from, valid_to, created_at, updated_at, deleted_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, NULL, NULL, ?15, ?15, NULL)`,
    )
    .bind(
      row.id,
      row.entityId,
      row.label,
      row.contactUse,
      row.address,
      row.normalizedAddress,
      row.isPrimary,
      ...contactValues(row),
      row.createdAt,
    );
}

// Demote every live primary email on an entity to non-primary. Composed ahead of an insert/update that
// sets a new primary so the "at most one primary per entity" invariant holds in the same atomic batch.
// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
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
export interface UpdateEmailFields extends ContactRowFields {
  readonly label: string | null;
  readonly contactUse: string | null;
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
      `UPDATE ${DIRECTORY_EMAIL_TABLE} SET label = ?2, contact_use = ?3, address = ?4, normalized_address = ?5, is_primary = ?6, ` +
        `contact_permitted = ?7, contact_preferred = ?8, contact_note = ?9, verification_status = ?10, verified_at = ?11, verified_by = ?12, verification_detail = ?13, updated_at = ?14 WHERE id = ?1`,
    )
    .bind(
      id,
      fields.label,
      fields.contactUse,
      fields.address,
      fields.normalizedAddress,
      fields.isPrimary,
      ...contactValues(fields),
      updatedAt,
    );
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
  // The two match keys are DERIVED HERE from the row's own normalized_display rather than taken from
  // the caller, and that is the point: eight write paths insert a name row, and a key a caller has to
  // remember to compute is a key some caller eventually does not compute — which is a name silently
  // missing from a conflicts blocking channel, the failure the channel exists to prevent. Deriving
  // them at the one statement builder makes them impossible to omit and impossible to disagree with
  // the normalized_display they are layered on.
  return database
    .prepare(
      `INSERT INTO ${DIRECTORY_NAME_TABLE} (id, entity_id, entity_kind, name_role, name_prefix, name_given, name_middle, name_family, name_suffix, normalized_display, normalized_match_key, normalized_match_key_bare, is_current, valid_from, valid_to, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16, NULL)`,
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
      normalizedMatchKey(row.normalizedDisplay),
      normalizedMatchKeyBare(row.normalizedDisplay),
      row.isCurrent ? 1 : 0,
      row.validFrom,
      row.validTo,
      row.createdAt,
    );
}

// Fill the two match keys on an already-stored name row. Only for the backfill sweep over rows that
// predate the columns — a live write derives them in insertNameStatement above and never needs this.
// Guarded on the columns still being null so a re-run, or an overlap with another pass, is a no-op
// rather than a rewrite.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function backfillNameMatchKeysStatement(
  database: SqlDatabase,
  nameId: DirectoryNameId,
  normalizedDisplay: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DIRECTORY_NAME_TABLE} SET normalized_match_key = ?2, normalized_match_key_bare = ?3 WHERE id = ?1 AND normalized_match_key IS NULL`,
    )
    .bind(nameId, normalizedMatchKey(normalizedDisplay), normalizedMatchKeyBare(normalizedDisplay));
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
  readonly pronouns: PronounSet | null;
}

export function selectPersonStatement(database: SqlDatabase, id: DirectoryPersonId): SqlStatement {
  return database
    .prepare(
      `SELECT id, name_prefix, name_given, name_middle, name_family, name_suffix, display_name, status, merged_into_id, ` +
        `pronoun_subject, pronoun_object, pronoun_possessive_determiner, pronoun_possessive_pronoun, pronoun_reflexive, pronoun_verb_number, ` +
        `date_of_birth, date_of_death, deceased ` +
        `FROM ${DIRECTORY_PERSON_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

// The person's pronouns, written whole or cleared whole. There is deliberately no statement that
// writes ONE form: a set is one value, and a per-form update is the write that leaves a row saying
// "she … them", which is the defect the field exists to prevent. Clearing binds six NULLs, which is
// the only other state the table's completeness CHECK admits.
export function updatePersonPronounsStatement(
  database: SqlDatabase,
  id: DirectoryPersonId,
  pronouns: PronounSet | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DIRECTORY_PERSON_TABLE} SET pronoun_subject = ?2, pronoun_object = ?3, ` +
        `pronoun_possessive_determiner = ?4, pronoun_possessive_pronoun = ?5, pronoun_reflexive = ?6, ` +
        `pronoun_verb_number = ?7, updated_at = ?8 WHERE id = ?1`,
    )
    .bind(
      id,
      pronouns?.subject ?? null,
      pronouns?.object ?? null,
      pronouns?.possessiveDeterminer ?? null,
      pronouns?.possessivePronoun ?? null,
      pronouns?.reflexive ?? null,
      pronouns?.verbNumber ?? null,
      updatedAt,
    );
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

// The dates of a person's life, written together and cleared together.
//
// A SEPARATE STATEMENT FROM the general field update, for the reason the pronoun write is separate:
// the cleared state of each of these is legitimate — a firm records that it does not know a date of
// birth by leaving it null — so "omit the field to keep it" cannot be the rule for a caller that also
// needs to be able to send null.
//
// `deceased` and `date_of_death` are two columns because "known dead, date unknown" is a state
// probate work meets constantly. The implication that a recorded date means deceased is held here,
// in the one write path, rather than in a CHECK: a cross-column CHECK cannot be added to a table
// that already holds rows without rebuilding it, and this schema is expand-contract only.
export interface PersonLifeDates {
  readonly dateOfBirth: string | null;
  readonly dateOfDeath: string | null;
  readonly deceased: 0 | 1;
}

export function updatePersonLifeDatesStatement(
  database: SqlDatabase,
  id: DirectoryPersonId,
  dates: PersonLifeDates,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DIRECTORY_PERSON_TABLE} SET date_of_birth = ?2, date_of_death = ?3, deceased = ?4, updated_at = ?5 WHERE id = ?1`,
    )
    .bind(id, dates.dateOfBirth, dates.dateOfDeath, dates.deceased, updatedAt);
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
// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
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

// A name that was a typing mistake leaves the record rather than becoming a former name: it stops
// being current and is soft-deleted, which takes it out of every search and conflicts channel (each
// reads `deleted_at IS NULL`) while the row and the audit log still show what it said.
// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function retireMistypedCurrentNameStatement(
  database: SqlDatabase,
  entityId: string,
  retiredAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DIRECTORY_NAME_TABLE} SET is_current = 0, valid_to = ?2, deleted_at = ?2, updated_at = ?2 WHERE entity_id = ?1 AND is_current = 1`,
    )
    .bind(entityId, retiredAt);
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

// ── directory_phone ──────────────────────────────────────────────────────────────────────────────

// A telephone number attached to an entity. `number` is the number AS ENTERED and is never
// rewritten; the structured columns beside it carry the split form and go null when the input could
// not be split, so an unparseable number is still recorded and still displayed. `label` is not
// written: it is the legacy free-text column the typed system/use columns replace.
export interface InsertPhoneRow extends ContactRowFields {
  readonly id: DirectoryPhoneId;
  readonly entityId: string;
  readonly number: string;
  readonly contactSystem: string;
  readonly contactUse: string | null;
  readonly countryCallingCode: string | null;
  readonly nationalNumber: string | null;
  readonly extension: string | null;
  readonly countryRegionCode: string | null;
  readonly isPrimary: 0 | 1;
  readonly createdAt: string;
}

export function insertPhoneStatement(database: SqlDatabase, row: InsertPhoneRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DIRECTORY_PHONE_TABLE} (id, entity_id, label, number, contact_system, contact_use, country_calling_code, national_number, extension, country_region_code, is_primary, ${CONTACT_COLUMNS}, valid_from, valid_to, created_at, updated_at, deleted_at) ` +
        `VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, NULL, NULL, ?18, ?18, NULL)`,
    )
    .bind(
      row.id,
      row.entityId,
      row.number,
      row.contactSystem,
      row.contactUse,
      row.countryCallingCode,
      row.nationalNumber,
      row.extension,
      row.countryRegionCode,
      row.isPrimary,
      ...contactValues(row),
      row.createdAt,
    );
}

// The mutable fields an updatePhone rewrites in full (no dynamic column list). `label` is untouched:
// it is read-only from the day the typed columns exist.
export interface UpdatePhoneFields extends ContactRowFields {
  readonly number: string;
  readonly contactSystem: string;
  readonly contactUse: string | null;
  readonly countryCallingCode: string | null;
  readonly nationalNumber: string | null;
  readonly extension: string | null;
  readonly countryRegionCode: string | null;
  readonly isPrimary: 0 | 1;
}

export function updatePhoneStatement(
  database: SqlDatabase,
  id: DirectoryPhoneId,
  fields: UpdatePhoneFields,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DIRECTORY_PHONE_TABLE} SET number = ?2, contact_system = ?3, contact_use = ?4, country_calling_code = ?5, national_number = ?6, extension = ?7, country_region_code = ?8, is_primary = ?9, ` +
        `contact_permitted = ?10, contact_preferred = ?11, contact_note = ?12, verification_status = ?13, verified_at = ?14, verified_by = ?15, verification_detail = ?16, updated_at = ?17 WHERE id = ?1`,
    )
    .bind(
      id,
      fields.number,
      fields.contactSystem,
      fields.contactUse,
      fields.countryCallingCode,
      fields.nationalNumber,
      fields.extension,
      fields.countryRegionCode,
      fields.isPrimary,
      ...contactValues(fields),
      updatedAt,
    );
}

// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function demoteEntityPrimaryPhonesStatement(
  database: SqlDatabase,
  entityId: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DIRECTORY_PHONE_TABLE} SET is_primary = 0, updated_at = ?2 WHERE entity_id = ?1 AND is_primary = 1 AND deleted_at IS NULL`,
    )
    .bind(entityId, updatedAt);
}

export function softDeletePhoneStatement(
  database: SqlDatabase,
  id: DirectoryPhoneId,
  deletedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${DIRECTORY_PHONE_TABLE} SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1`)
    .bind(id, deletedAt);
}

// ── directory_address ────────────────────────────────────────────────────────────────────────────

// A postal address attached to an entity, in the international field set: recipient, organization,
// two address lines, dependent locality, locality, administrative area, postal code, sorting code
// and country. Nothing here assumes a state and a five-digit postal code — which fields a country
// uses, what they are called and what order they read in are all properties of the country.
export interface InsertAddressRow extends ContactRowFields {
  readonly id: DirectoryAddressId;
  readonly entityId: string;
  readonly recipient: string | null;
  readonly organizationName: string | null;
  readonly street: string | null;
  readonly streetTwo: string | null;
  readonly dependentLocality: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postal: string | null;
  readonly sortingCode: string | null;
  readonly country: string | null;
  readonly addressUse: string | null;
  readonly addressType: string;
  readonly normalizedKey: string;
  readonly isPrimary: 0 | 1;
  readonly createdAt: string;
}

export function insertAddressStatement(database: SqlDatabase, row: InsertAddressRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DIRECTORY_ADDRESS_TABLE} (id, entity_id, label, recipient, organization_name, street, street_two, dependent_locality, city, region, postal, sorting_code, country, address_use, address_type, normalized_key, is_primary, ${CONTACT_COLUMNS}, valid_from, valid_to, created_at, updated_at, deleted_at) ` +
        `VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, NULL, NULL, ?24, ?24, NULL)`,
    )
    .bind(
      row.id,
      row.entityId,
      row.recipient,
      row.organizationName,
      row.street,
      row.streetTwo,
      row.dependentLocality,
      row.city,
      row.region,
      row.postal,
      row.sortingCode,
      row.country,
      row.addressUse,
      row.addressType,
      row.normalizedKey,
      row.isPrimary,
      ...contactValues(row),
      row.createdAt,
    );
}

export interface UpdateAddressFields extends ContactRowFields {
  readonly recipient: string | null;
  readonly organizationName: string | null;
  readonly street: string | null;
  readonly streetTwo: string | null;
  readonly dependentLocality: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postal: string | null;
  readonly sortingCode: string | null;
  readonly country: string | null;
  readonly addressUse: string | null;
  readonly addressType: string;
  readonly normalizedKey: string;
  readonly isPrimary: 0 | 1;
}

export function updateAddressStatement(
  database: SqlDatabase,
  id: DirectoryAddressId,
  fields: UpdateAddressFields,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DIRECTORY_ADDRESS_TABLE} SET recipient = ?2, organization_name = ?3, street = ?4, street_two = ?5, dependent_locality = ?6, city = ?7, region = ?8, postal = ?9, sorting_code = ?10, country = ?11, address_use = ?12, address_type = ?13, normalized_key = ?14, is_primary = ?15, ` +
        `contact_permitted = ?16, contact_preferred = ?17, contact_note = ?18, verification_status = ?19, verified_at = ?20, verified_by = ?21, verification_detail = ?22, updated_at = ?23 WHERE id = ?1`,
    )
    .bind(
      id,
      fields.recipient,
      fields.organizationName,
      fields.street,
      fields.streetTwo,
      fields.dependentLocality,
      fields.city,
      fields.region,
      fields.postal,
      fields.sortingCode,
      fields.country,
      fields.addressUse,
      fields.addressType,
      fields.normalizedKey,
      fields.isPrimary,
      ...contactValues(fields),
      updatedAt,
    );
}

// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function demoteEntityPrimaryAddressesStatement(
  database: SqlDatabase,
  entityId: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DIRECTORY_ADDRESS_TABLE} SET is_primary = 0, updated_at = ?2 WHERE entity_id = ?1 AND is_primary = 1 AND deleted_at IS NULL`,
    )
    .bind(entityId, updatedAt);
}

export function softDeleteAddressStatement(
  database: SqlDatabase,
  id: DirectoryAddressId,
  deletedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${DIRECTORY_ADDRESS_TABLE} SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1`)
    .bind(id, deletedAt);
}

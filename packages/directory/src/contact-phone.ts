/*
 * Telephone and fax numbers for a directory entity — the write and read paths the table never had.
 *
 * `directory_phone` has been in the schema since the baseline migration with nothing able to write
 * to it: no domain module, no route, not one statement anywhere that inserts a telephone number. A
 * firm could not record a client's phone number. This module is that capability.
 *
 * THE TECHNOLOGY AND THE CONTEXT ARE TWO COLUMNS. `contactSystem` says what answers the number —
 * voice, fax, sms, pager — and `contactUse` says in what context — work, home, mobile. One flat list
 * holding both `fax` and `work` cannot express a work fax, which is exactly the ambiguity the old
 * free-text `label` column had. A number that answers both voice and fax is two rows, because they
 * are separately verifiable facts and one row cannot carry two verification dates.
 *
 * THE NUMBER AS ENTERED IS NEVER REWRITTEN. The structured columns sit beside it and go null when
 * the input could not be split. A firm's file is full of numbers written in ways no parser expects,
 * and refusing them would push the number into a free-text note where nothing can reach it.
 */
import type { ComposedContactWrite } from "./contact-email.ts";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DirectoryPhoneId } from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.ts";
import {
  CONTACT_FIELD_SELECT,
  contactPointStateFromRow,
  resolveContactFields,
  type ContactPointState,
  type ContactPreferenceInput,
  type ContactVerificationInput,
  type StoredContactFields,
} from "./contact-preference.ts";
import { assertEntityExists } from "./entity-kind.ts";
import { structurePhoneNumber } from "./phone-number.ts";
import { runDirectoryEffect } from "./run-directory-effect.ts";
import {
  demoteEntityPreferredContactStatements,
  demoteEntityPrimaryPhonesStatement,
  insertPhoneStatement,
  softDeletePhoneStatement,
  updatePhoneStatement,
} from "./statements.ts";
import { CONTACT_SYSTEMS, CONTACT_USES, type ContactSystem, type ContactUse } from "./types.ts";

// Thrown when a number carries no digit at all. The check is deliberately this permissive: anything
// with a digit in it is a number somebody wrote down, and the structured columns record honestly
// whether it could be split. `length > 0` also satisfies the table CHECK.
export class InvalidPhoneNumberError extends Error {
  readonly code = "invalid-phone-number";
  constructor(number: string) {
    super(
      `directory: not a usable telephone number: ${JSON.stringify(number)} (invalid-phone-number)`,
    );
    this.name = "InvalidPhoneNumberError";
  }
}

// Thrown when a system or use outside the catalog is supplied. The column CHECK is open at rest — a
// committed migration is immutable, so a closed IN (...) would turn a catalog addition into a
// migration against every firm — so this is where the catalog is actually enforced.
export class InvalidPhoneClassificationError extends Error {
  readonly code = "invalid-phone-classification";
  constructor(field: string, value: string) {
    super(
      `directory: not a known telephone ${field}: ${JSON.stringify(value)} (invalid-phone-classification)`,
    );
    this.name = "InvalidPhoneClassificationError";
  }
}

// Thrown when a phone id names no live row (missing or already soft-deleted).
export class DirectoryPhoneNotFoundError extends Error {
  readonly code = "directory-phone-not-found";
  constructor(phoneId: string) {
    super(
      `directory: telephone number not found or soft-deleted: ${phoneId} (directory-phone-not-found)`,
    );
    this.name = "DirectoryPhoneNotFoundError";
  }
}

function assertClassification(contactSystem: ContactSystem, contactUse: ContactUse | null): void {
  if (!CONTACT_SYSTEMS.includes(contactSystem)) {
    throw new InvalidPhoneClassificationError("system", contactSystem);
  }
  if (contactUse !== null && !CONTACT_USES.includes(contactUse)) {
    throw new InvalidPhoneClassificationError("use", contactUse);
  }
}

export interface AddPhoneInput {
  readonly entityId: string;
  /** The number as the person wrote it. Stored verbatim and never rewritten. */
  readonly number: string;
  /** What technology answers it. Defaults to voice, which is what an unqualified number means. */
  readonly contactSystem?: ContactSystem;
  readonly contactUse?: ContactUse | null;
  /**
   * The extension, where the caller has it separately. Overrides one read out of the number itself.
   * Its own column because E.164 has no extension concept and one embedded in the canonical string
   * breaks every downstream dialler.
   */
  readonly extension?: string | null;
  /** ISO 3166-1 alpha-2 for the region the number was read against, so a re-parse is reproducible. */
  readonly countryRegionCode?: string | null;
  /** Make this the entity's primary number; any existing primary is demoted in the same batch. */
  readonly isPrimary?: boolean;
  readonly preference?: ContactPreferenceInput;
  readonly verification?: ContactVerificationInput;
}

/**
 * Attach a telephone or fax number to a directory entity, in one atomic batch with its audit row.
 *
 * Rejects a missing, soft-deleted or merged-away entity and a number with no digits before any
 * write. Setting `isPrimary` demotes the entity's other live primary NUMBERS; setting the preference
 * `preferred` demotes the entity's preferred contact point across email, phone and address alike,
 * because that preference is one answer about every channel.
 */
// Composes the rows one number writes without committing and without checking the entity: the
// caller either checked it or is creating it in the same batch (person-record.ts).
export function composeAddPhone(
  database: BatchDatabase,
  input: AddPhoneInput,
  options: DirectoryWriteOptions,
): ComposedContactWrite<DirectoryPhoneId> {
  const numberAsEntered = input.number.trim();
  if (numberAsEntered === "" || !/[0-9]/.test(numberAsEntered)) {
    throw new InvalidPhoneNumberError(input.number);
  }
  const contactSystem = input.contactSystem ?? "voice";
  const contactUse = input.contactUse ?? null;
  assertClassification(contactSystem, contactUse);

  const structured = structurePhoneNumber(numberAsEntered);
  const extension =
    input.extension === undefined ? structured.extension : (input.extension?.trim() ?? null);

  const phoneId = newIdentifier("directoryPhone", options.randomSource);
  const now = options.clock.now();
  const isPrimary: 0 | 1 = input.isPrimary ? 1 : 0;
  const contactFields = resolveContactFields(input, null, options, now);

  const statements: SqlStatement[] = [];
  if (isPrimary === 1) {
    statements.push(demoteEntityPrimaryPhonesStatement(database, input.entityId, now));
  }
  if (contactFields.contactPreferred === 1) {
    statements.push(...demoteEntityPreferredContactStatements(database, input.entityId, now));
  }
  statements.push(
    insertPhoneStatement(database, {
      id: phoneId,
      entityId: input.entityId,
      number: numberAsEntered,
      contactSystem,
      contactUse,
      countryCallingCode: structured.countryCallingCode,
      nationalNumber: structured.nationalNumber,
      extension: extension === "" ? null : extension,
      countryRegionCode: input.countryRegionCode ?? null,
      isPrimary,
      createdAt: now,
      ...contactFields,
    }),
    directoryAuditStatement(database, options, "directory.phone.added", phoneId),
  );
  return { id: phoneId, statements };
}

export async function addPhone(
  database: BatchDatabase,
  input: AddPhoneInput,
  options: DirectoryWriteOptions,
): Promise<DirectoryPhoneId> {
  await assertEntityExists(database, input.entityId);
  const { id: phoneId, statements } = composeAddPhone(database, input, options);

  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements,
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: phoneId },
    value: phoneId,
    fromBody: (body) => (body as { id: DirectoryPhoneId }).id,
  }));
}

interface PhoneRow extends StoredContactFields {
  readonly id: DirectoryPhoneId;
  readonly entity_id: string;
  readonly label: string | null;
  readonly number: string;
  readonly contact_system: string | null;
  readonly contact_use: string | null;
  readonly country_calling_code: string | null;
  readonly national_number: string | null;
  readonly extension: string | null;
  readonly country_region_code: string | null;
  readonly is_primary: number;
  readonly deleted_at: string | null;
}

const PHONE_SELECT = `id, entity_id, label, number, contact_system, contact_use, country_calling_code, national_number, extension, country_region_code, is_primary, ${CONTACT_FIELD_SELECT}`;

async function readLivePhoneRow(
  database: BatchDatabase,
  phoneId: string,
): Promise<PhoneRow | null> {
  const { results } = await database
    .prepare(`SELECT ${PHONE_SELECT}, deleted_at FROM directory_phone WHERE id = ?1`)
    .bind(phoneId)
    .all<PhoneRow>();
  const row = results[0];
  if (row === undefined || row.deleted_at !== null) return null;
  return row;
}

export interface UpdatePhoneInput {
  readonly phoneId: string;
  // Each field is optional: an omitted field keeps its current value (a full-row UPDATE with the
  // current values re-bound, so the SQL column list never varies).
  readonly number?: string;
  readonly contactSystem?: ContactSystem;
  readonly contactUse?: ContactUse | null;
  readonly extension?: string | null;
  readonly countryRegionCode?: string | null;
  readonly isPrimary?: boolean;
  readonly preference?: ContactPreferenceInput;
  readonly verification?: ContactVerificationInput;
}

/**
 * Update a live number's fields in one atomic batch. Reads the current row first — D1 has no
 * interactive transaction — so an omitted field is preserved rather than nulled.
 *
 * A changed number is re-split; an unchanged one is not, so a row whose structure was corrected by
 * hand is not silently undone by an edit to its use.
 */
export async function updatePhone(
  database: BatchDatabase,
  input: UpdatePhoneInput,
  options: DirectoryWriteOptions,
): Promise<DirectoryPhoneId> {
  const current = await readLivePhoneRow(database, input.phoneId);
  if (current === null) throw new DirectoryPhoneNotFoundError(input.phoneId);

  const numberAsEntered = input.number === undefined ? current.number : input.number.trim();
  if (numberAsEntered === "" || !/[0-9]/.test(numberAsEntered)) {
    throw new InvalidPhoneNumberError(input.number ?? current.number);
  }
  const contactSystem =
    input.contactSystem ?? ((current.contact_system ?? "voice") as ContactSystem);
  const contactUse =
    input.contactUse === undefined ? (current.contact_use as ContactUse | null) : input.contactUse;
  assertClassification(contactSystem, contactUse);

  const structured =
    input.number === undefined
      ? {
          countryCallingCode: current.country_calling_code,
          nationalNumber: current.national_number,
          extension: current.extension,
        }
      : structurePhoneNumber(numberAsEntered);
  const extension =
    input.extension === undefined ? structured.extension : (input.extension?.trim() ?? null);

  const now = options.clock.now();
  const phoneId = current.id;
  const isPrimary: 0 | 1 =
    input.isPrimary === undefined ? (current.is_primary === 1 ? 1 : 0) : input.isPrimary ? 1 : 0;
  const contactFields = resolveContactFields(input, current, options, now);

  const statements: SqlStatement[] = [];
  // Demote siblings only when this row is BECOMING the primary or the preferred one; re-saving a row
  // that already is would otherwise demote itself in the same batch that promotes it.
  if (isPrimary === 1 && current.is_primary !== 1) {
    statements.push(demoteEntityPrimaryPhonesStatement(database, current.entity_id, now));
  }
  if (contactFields.contactPreferred === 1 && current.contact_preferred !== 1) {
    statements.push(...demoteEntityPreferredContactStatements(database, current.entity_id, now));
  }
  statements.push(
    updatePhoneStatement(
      database,
      phoneId,
      {
        number: numberAsEntered,
        contactSystem,
        contactUse,
        countryCallingCode: structured.countryCallingCode,
        nationalNumber: structured.nationalNumber,
        extension: extension === "" ? null : extension,
        countryRegionCode:
          input.countryRegionCode === undefined
            ? current.country_region_code
            : input.countryRegionCode,
        isPrimary,
        ...contactFields,
      },
      now,
    ),
    directoryAuditStatement(database, options, "directory.phone.updated", phoneId),
  );

  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements,
    outboxMessages: [],
    responseCode: 200,
    responseBody: { id: phoneId },
    value: phoneId,
    fromBody: (body) => (body as { id: DirectoryPhoneId }).id,
  }));
}

/** Soft-delete a number (never a hard delete). A missing or already-deleted id fails loudly. */
export async function removePhone(
  database: BatchDatabase,
  phoneId: string,
  options: DirectoryWriteOptions,
): Promise<DirectoryPhoneId> {
  const current = await readLivePhoneRow(database, phoneId);
  if (current === null) throw new DirectoryPhoneNotFoundError(phoneId);

  const now = options.clock.now();
  const id = current.id;
  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      softDeletePhoneStatement(database, id, now),
      directoryAuditStatement(database, options, "directory.phone.removed", id),
    ],
    outboxMessages: [],
    responseCode: 200,
    responseBody: { id },
    value: id,
    fromBody: (body) => (body as { id: DirectoryPhoneId }).id,
  }));
}

/** One telephone or fax number as the directory holds it. */
export interface DirectoryPhoneRow {
  readonly id: DirectoryPhoneId;
  readonly entityId: string;
  /** The number exactly as it was entered. What a screen shows. */
  readonly number: string;
  readonly contactSystem: ContactSystem;
  readonly contactUse: ContactUse | null;
  /** Null where the number could not be split — recorded honestly rather than guessed. */
  readonly countryCallingCode: string | null;
  readonly nationalNumber: string | null;
  readonly extension: string | null;
  readonly countryRegionCode: string | null;
  readonly isPrimary: boolean;
  readonly state: ContactPointState;
  /** The legacy free-text label, retained read-only until it is dropped. */
  readonly label: string | null;
}

function toPhoneRow(row: PhoneRow): DirectoryPhoneRow {
  return {
    id: row.id,
    entityId: row.entity_id,
    number: row.number,
    contactSystem: (row.contact_system ?? "voice") as ContactSystem,
    contactUse: row.contact_use as ContactUse | null,
    countryCallingCode: row.country_calling_code,
    nationalNumber: row.national_number,
    extension: row.extension,
    countryRegionCode: row.country_region_code,
    isPrimary: row.is_primary === 1,
    state: contactPointStateFromRow(row),
    label: row.label,
  };
}

/** The live numbers on an entity, primary first, then oldest first for a stable read. */
export async function readPhones(
  database: BatchDatabase,
  entityId: string,
): Promise<DirectoryPhoneRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${PHONE_SELECT} FROM directory_phone WHERE entity_id = ?1 AND deleted_at IS NULL ORDER BY is_primary DESC, created_at ASC, id ASC`,
    )
    .bind(entityId)
    .all<PhoneRow>();
  return results.map(toPhoneRow);
}

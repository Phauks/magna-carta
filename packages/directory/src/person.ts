import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DirectoryNameId, DirectoryPersonId } from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.ts";
import { assertEntityExists, entityKindFromId, UnknownEntityError } from "./entity-kind.ts";
import { runDirectoryEffect } from "./run-directory-effect.ts";
import { DIRECTORY_ENTITY_CREATED_TOPIC } from "./topics.ts";
import { normalizeName } from "./normalize-name.ts";
import { phoneticCodes } from "./phonetics.ts";
import {
  insertNameStatement,
  insertPersonStatement,
  insertPhoneticCodeStatements,
  selectPersonStatement,
  updatePersonFieldsStatement,
  updatePersonLifeDatesStatement,
  updatePersonPronounsStatement,
  type PersonRow,
  type PersonStatus,
} from "./statements.ts";
import {
  pronounSetFromColumns,
  validatePronounSet,
  type PronounColumns,
  type PronounSet,
} from "./pronouns.ts";

// The caller-supplied fields for a new person. given/family are the required structured name parts;
// the rest are optional. There is no idempotency context at this layer — that is threaded at the
// route boundary — so the batch carries no idempotency record.
export interface CreatePersonInput {
  readonly given: string;
  readonly family: string;
  readonly prefix?: string | null;
  readonly middle?: string | null;
  readonly suffix?: string | null;
  /**
   * Recorded by something other than a person at the Directory — a meeting guest typed by name and
   * address — and so waiting for somebody to keep, merge or discard it. Absent means a person
   * recorded it deliberately.
   */
  readonly needsReview?: boolean;
}

// The typed person projection returned by readPerson — the structured name parts, the rendered
// display name, the lifecycle status/merge pointer, and the pronouns the person stated.
export interface Person {
  readonly id: DirectoryPersonId;
  readonly prefix: string | null;
  readonly given: string | null;
  readonly middle: string | null;
  readonly family: string | null;
  readonly suffix: string | null;
  readonly displayName: string | null;
  readonly status: PersonStatus;
  readonly mergedIntoId: string | null;
  // Null when the person has stated none, which is the ordinary case and not a gap to fill in. It
  // is never populated from the name parts, the prefix, or anything else — see pronouns.ts.
  readonly pronouns: PronounSet | null;
  // ISO 8601 dates, held in the clear so the questions a firm actually asks of them — is this client
  // a minor, has a limitation period tolled, whose birthday falls this month — are askable at all. A
  // range query over ciphertext is not a query, which is why filing a date of birth as a sealed
  // identifier made it unusable. Both are registered for subject erasure.
  readonly dateOfBirth: string | null;
  readonly dateOfDeath: string | null;
  // Separate from the date: "known dead, date unknown" is a state probate work meets constantly.
  readonly deceased: boolean;
}

// Thrown when a date is not a plain ISO 8601 calendar date, or when the dates cannot both be true.
export class InvalidPersonLifeDatesError extends Error {
  readonly code = "invalid-person-life-dates";
  constructor(detail: string) {
    super(`directory: ${detail} (invalid-person-life-dates)`);
    this.name = "InvalidPersonLifeDatesError";
  }
}

// A plain calendar date and nothing else. No time, no zone: a date of birth has no instant, and
// storing one would make two records of the same birthday compare unequal across a zone boundary.
const CALENDAR_DATE = CIVIL_DATE_PATTERN;

function validCalendarDate(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!CALENDAR_DATE.test(trimmed)) {
    throw new InvalidPersonLifeDatesError(`${field} must be a calendar date as YYYY-MM-DD`);
  }
  // Reject a well-shaped date that names no day — 2026-02-30 matches the pattern and is not a date.
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(trimmed)) {
    throw new InvalidPersonLifeDatesError(`${field} names no day in the calendar`);
  }
  return trimmed;
}

// Render the display name from the structured parts in reading order, collapsing the blanks so a
// mononym ("Cher") or a missing middle name produces a clean single-spaced string.
function renderDisplayName(input: CreatePersonInput): string {
  return [input.prefix, input.given, input.middle, input.family, input.suffix]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(" ");
}

/** What creating a person contributes to a batch: the id it will have, its rows, its announcement. */
export interface ComposedPersonCreate {
  readonly personId: DirectoryPersonId;
  readonly statements: SqlStatement[];
  readonly outboxMessages: EffectWrite["outboxMessages"];
}

// Composes the person's own rows without committing: the node row, the current-name history row
// with its phonetic codes, and the audit row. createPerson commits exactly this; the create that
// records a whole person in one batch (person-record.ts) composes this first and everything else
// beside it, so a person is never half-recorded.
export function composeCreatePerson(
  database: BatchDatabase,
  input: CreatePersonInput,
  options: DirectoryWriteOptions,
): ComposedPersonCreate {
  const personId = newIdentifier("directoryPerson", options.randomSource);
  const nameId: DirectoryNameId = newIdentifier("directoryName", options.randomSource);
  const now = options.clock.now();

  const given = input.given.trim();
  const family = input.family.trim();
  const displayName = renderDisplayName(input);
  const normalizedDisplay = normalizeName(displayName);

  // Phonetic codes are computed on the family name because the surname is the primary
  // conflicts-blocking token for persons — it is what clerks search by and what the
  // duplicate-detection pass compares. If the family name is absent (a mononym), fall
  // back to the given name so the entity is never left without phonetic coverage.
  const phoneticSource = family.length > 0 ? family : given;
  const codes = phoneticCodes(normalizeName(phoneticSource));

  return {
    personId,
    statements: [
      insertPersonStatement(database, {
        id: personId,
        prefix: input.prefix ?? null,
        given: given.length > 0 ? given : null,
        middle: input.middle ?? null,
        family: family.length > 0 ? family : null,
        suffix: input.suffix ?? null,
        displayName,
        status: "active",
        needsReview: input.needsReview === true ? 1 : 0,
        createdAt: now,
      }),
      insertNameStatement(database, {
        id: nameId,
        entityId: personId,
        entityKind: "person",
        nameRole: "current",
        prefix: input.prefix ?? null,
        given: given.length > 0 ? given : null,
        middle: input.middle ?? null,
        family: family.length > 0 ? family : null,
        suffix: input.suffix ?? null,
        normalizedDisplay,
        isCurrent: true,
        validFrom: now,
        validTo: null,
        createdAt: now,
      }),
      ...insertPhoneticCodeStatements(database, nameId, codes),
      directoryAuditStatement(database, options, "directory.person.created", personId),
    ],
    outboxMessages: [{ topic: DIRECTORY_ENTITY_CREATED_TOPIC, payload: { personId } }],
  };
}

export async function createPerson(
  database: BatchDatabase,
  input: CreatePersonInput,
  options: DirectoryWriteOptions,
): Promise<DirectoryPersonId> {
  const composed = composeCreatePerson(database, input, options);
  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: composed.statements,
    outboxMessages: composed.outboxMessages,
    responseCode: 201,
    responseBody: { id: composed.personId },
    value: composed.personId,
    fromBody: (body) => (body as { id: DirectoryPersonId }).id,
  }));
}

/** The life dates a person may be recorded with, checked as setPersonLifeDates checks them. */
export interface CheckedLifeDates {
  readonly dateOfBirth: string | null;
  readonly dateOfDeath: string | null;
  readonly deceased: boolean;
}

export function checkLifeDates(input: {
  readonly dateOfBirth?: string | null;
  readonly dateOfDeath?: string | null;
  readonly deceased?: boolean;
}): CheckedLifeDates {
  const dateOfBirth = validCalendarDate(input.dateOfBirth, "date of birth");
  const dateOfDeath = validCalendarDate(input.dateOfDeath, "date of death");
  if (dateOfBirth !== null && dateOfDeath !== null && dateOfDeath < dateOfBirth) {
    throw new InvalidPersonLifeDatesError("a date of death cannot precede a date of birth");
  }
  const deceased = input.deceased ?? dateOfDeath !== null;
  if (dateOfDeath !== null && !deceased) {
    throw new InvalidPersonLifeDatesError(
      "a person with a recorded date of death cannot be marked not deceased",
    );
  }
  return { dateOfBirth, dateOfDeath, deceased };
}

export async function readPerson(
  database: BatchDatabase,
  personId: DirectoryPersonId,
): Promise<Person> {
  const { results } = await selectPersonStatement(database, personId).all<
    {
      id: string;
      name_prefix: string | null;
      name_given: string | null;
      name_middle: string | null;
      name_family: string | null;
      name_suffix: string | null;
      display_name: string | null;
      status: PersonStatus;
      merged_into_id: string | null;
      date_of_birth: string | null;
      date_of_death: string | null;
      deceased: number;
    } & PronounColumns
  >();
  const row = results[0];
  if (!row) throw new Error(`directory person not found: ${personId}`);
  return {
    id: row.id as DirectoryPersonId,
    prefix: row.name_prefix,
    given: row.name_given,
    middle: row.name_middle,
    family: row.name_family,
    suffix: row.name_suffix,
    displayName: row.display_name,
    status: row.status,
    mergedIntoId: row.merged_into_id,
    pronouns: pronounSetFromColumns(row),
    dateOfBirth: row.date_of_birth,
    dateOfDeath: row.date_of_death,
    deceased: row.deceased === 1,
  };
}

/** What a caller may record about a person's life dates. Each field may be sent as null to clear it. */
export interface PersonLifeDatesInput {
  readonly dateOfBirth?: string | null;
  readonly dateOfDeath?: string | null;
  /** Omitted, the flag follows the date: a recorded date of death means deceased. */
  readonly deceased?: boolean;
}

/**
 * Record a person's date of birth, date of death, and whether they are known to have died.
 *
 * A SEPARATE WRITE from updatePerson, for the reason the pronoun write is separate: each of these
 * has a legitimate CLEARED state, so "omit the field to keep it" cannot also mean "send null to
 * clear it". Here an omitted field keeps its stored value and an explicit null clears it.
 *
 * A recorded date of death implies the deceased flag and the write path holds that implication —
 * a cross-column CHECK cannot be added to a populated table under expand-contract. Clearing the
 * flag while a date of death stands is refused rather than silently corrected, because the caller
 * has asked for two things that cannot both be true and guessing which one they meant is worse.
 */
export async function setPersonLifeDates(
  database: BatchDatabase,
  personId: DirectoryPersonId,
  input: PersonLifeDatesInput,
  options: DirectoryWriteOptions,
): Promise<void> {
  if (entityKindFromId(personId) !== "person") throw new UnknownEntityError(personId);
  await assertEntityExists(database, personId);
  const current = await readPerson(database, personId);

  const dateOfBirth =
    input.dateOfBirth === undefined
      ? current.dateOfBirth
      : validCalendarDate(input.dateOfBirth, "date of birth");
  const dateOfDeath =
    input.dateOfDeath === undefined
      ? current.dateOfDeath
      : validCalendarDate(input.dateOfDeath, "date of death");

  if (dateOfBirth !== null && dateOfDeath !== null && dateOfDeath < dateOfBirth) {
    throw new InvalidPersonLifeDatesError("a date of death cannot precede a date of birth");
  }
  const deceased = input.deceased ?? (dateOfDeath !== null ? true : current.deceased);
  if (dateOfDeath !== null && !deceased) {
    throw new InvalidPersonLifeDatesError(
      "a person with a recorded date of death cannot be marked not deceased",
    );
  }

  const now = options.clock.now();
  await runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      updatePersonLifeDatesStatement(
        database,
        personId,
        { dateOfBirth, dateOfDeath, deceased: deceased ? 1 : 0 },
        now,
      ),
      directoryAuditStatement(database, options, "directory.person.updated", personId),
    ],
    outboxMessages: [],
    responseCode: 200,
    responseBody: { ok: true },
    value: undefined,
    fromBody: () => undefined,
  }));
}

// The non-name standard fields a caller may patch: lifecycle status and the merge pointer. Name
// changes are history — a new directory_name row — and flow through a separate path, never here.
export interface UpdatePersonPatch {
  readonly status?: PersonStatus;
  readonly mergedIntoId?: string | null;
}

export async function updatePerson(
  database: BatchDatabase,
  personId: DirectoryPersonId,
  patch: UpdatePersonPatch,
  options: DirectoryWriteOptions,
): Promise<void> {
  // Read-then-write so an omitted field keeps its stored value — a partial patch never blanks the
  // columns it does not name.
  const current = await readPerson(database, personId);
  const now = options.clock.now();

  const fields: { status: PersonStatus; mergedIntoId: string | null } = {
    status: patch.status ?? current.status,
    mergedIntoId: patch.mergedIntoId !== undefined ? patch.mergedIntoId : current.mergedIntoId,
  };

  await runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      updatePersonFieldsStatement(database, personId, fields, now),
      directoryAuditStatement(database, options, "directory.person.updated", personId),
    ],
    outboxMessages: [],
    responseCode: 200,
    responseBody: { ok: true },
    value: undefined,
    fromBody: () => undefined,
  }));
}

// Record or clear the person's pronouns.
//
// A SEPARATE WRITE FROM updatePerson, on purpose. A pronoun set is one value with its own reason to
// change — a person told the firm — and folding it into the general patch would make "omit the field
// to keep it" the rule for a value whose CLEARED state (null) is also a legitimate thing to send. A
// dedicated call has no such ambiguity: pass a set to record it, pass null to remove it. Setting it
// never touches the name columns, and no path anywhere derives it from them.
export async function setPersonPronouns(
  database: BatchDatabase,
  personId: DirectoryPersonId,
  pronouns: PronounSet | null,
  options: DirectoryWriteOptions,
): Promise<void> {
  // An ORGANISATION handle must not reach the UPDATE. The existence check below resolves its table
  // from the handle prefix, so an organisation id would pass it and then update no rows at all — a
  // write that reports success and records nothing. An organisation has no pronouns to state, so the
  // handle is simply wrong.
  if (entityKindFromId(personId) !== "person") throw new UnknownEntityError(personId);
  // Existence is part of the write's meaning, through the same assertion every referencing write
  // uses: a missing or soft-deleted person is a typed 404 and a merged-away one a typed 409 naming
  // the master, rather than a set recorded on a record no document reads.
  await assertEntityExists(database, personId);
  const validated = pronouns === null ? null : validatePronounSet(pronouns);
  const now = options.clock.now();

  await runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      updatePersonPronounsStatement(database, personId, validated, now),
      directoryAuditStatement(database, options, "directory.person.updated", personId),
    ],
    outboxMessages: [],
    responseCode: 200,
    responseBody: { ok: true },
    value: undefined,
    fromBody: () => undefined,
  }));
}

// Re-export PersonRow for consumers wiring read projections elsewhere.
export type { PersonRow };

import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
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
}

// Render the display name from the structured parts in reading order, collapsing the blanks so a
// mononym ("Cher") or a missing middle name produces a clean single-spaced string.
function renderDisplayName(input: CreatePersonInput): string {
  return [input.prefix, input.given, input.middle, input.family, input.suffix]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(" ");
}

export async function createPerson(
  database: BatchDatabase,
  input: CreatePersonInput,
  options: DirectoryWriteOptions,
): Promise<DirectoryPersonId> {
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

  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
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
        needsReview: 0,
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
    responseCode: 201,
    responseBody: { id: personId },
    value: personId,
    fromBody: (body) => (body as { id: DirectoryPersonId }).id,
  }));
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
  };
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

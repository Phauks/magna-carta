import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DirectoryNameId, DirectoryPersonId, UserId } from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.js";
import { normalizeName } from "./normalize-name.js";
import { phoneticCodes } from "./phonetics.js";
import {
  insertNameStatement,
  insertPersonStatement,
  insertPhoneticCodeStatements,
  selectPersonStatement,
  updatePersonFieldsStatement,
  type PersonRow,
  type PersonStatus,
} from "./statements.js";

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
// display name, and the lifecycle status/merge pointer.
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

  const statements: SqlStatement[] = [
    insertPersonStatement(database, {
      id: personId,
      prefix: input.prefix ?? null,
      given: given.length > 0 ? given : null,
      middle: input.middle ?? null,
      family: family.length > 0 ? family : null,
      suffix: input.suffix ?? null,
      displayName,
      status: "active",
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
  ];

  await commitEffectBatch(
    database,
    {
      statements,
      outboxMessages: [{ topic: "directory.entity.created", payload: { personId } }],
    },
    { now: () => now },
  );

  return personId;
}

export async function readPerson(
  database: BatchDatabase,
  personId: DirectoryPersonId,
): Promise<Person> {
  const { results } = await selectPersonStatement(database, personId).all<{
    id: string;
    name_prefix: string | null;
    name_given: string | null;
    name_middle: string | null;
    name_family: string | null;
    name_suffix: string | null;
    display_name: string | null;
    status: PersonStatus;
    merged_into_id: string | null;
  }>();
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

  const statements: SqlStatement[] = [
    updatePersonFieldsStatement(database, personId, fields, now),
    directoryAuditStatement(database, options, "directory.person.updated", personId),
  ];

  await commitEffectBatch(database, { statements, outboxMessages: [] }, { now: () => now });
}

// Re-export PersonRow for consumers wiring read projections elsewhere.
export type { PersonRow };

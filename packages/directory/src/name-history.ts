import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DirectoryNameId,
  DirectoryOrganizationId,
  DirectoryPersonId,
} from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.ts";
import { runDirectoryEffect } from "./run-directory-effect.ts";
import { entityKindFromId } from "./entity-kind.ts";
import { normalizeName } from "./normalize-name.ts";
import { phoneticCodes } from "./phonetics.ts";
import {
  flipCurrentNameToFormerStatement,
  insertNameStatement,
  insertPhoneticCodeStatements,
  updateOrganizationNameStatement,
  updatePersonNameStatement,
} from "./statements.ts";
import type { NameRole } from "./types.ts";

// Render the display name for a person from its structured parts, collapsing blanks so a mononym
// or a missing middle name produces a clean single-spaced string.
function renderPersonDisplayName(input: ChangePersonNameInput): string {
  return [input.prefix, input.given, input.middle, input.family, input.suffix]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(" ");
}

// ── changeName ───────────────────────────────────────────────────────────────

// The caller-supplied name fields for a person name change. The same structure as CreatePersonInput
// but kept separate so the two surfaces can evolve independently.
export interface ChangePersonNameInput {
  readonly given: string;
  readonly family: string;
  readonly prefix?: string | null;
  readonly middle?: string | null;
  readonly suffix?: string | null;
}

// The caller-supplied name fields for an organization name change.
export interface ChangeOrganizationNameInput {
  readonly legalName: string;
  readonly displayName?: string | null;
}

// The discriminated union of entity-specific name inputs accepted by changeName. The caller
// supplies exactly the fields that apply to the entity kind they are renaming.
export type ChangeNameInput = ChangePersonNameInput | ChangeOrganizationNameInput;

// True when the input carries person name fields (given/family) rather than an org legalName.
// Both given and family are required on ChangePersonNameInput; checking for both prevents a
// partial object that only supplies one field from incorrectly matching and then crashing when
// the other is accessed. ChangeOrganizationNameInput carries legalName and no given/family.
function isPersonNameInput(input: ChangeNameInput): input is ChangePersonNameInput {
  return "given" in input && "family" in input;
}

// changeName performs the append-and-flip in one atomic batch:
//   1. Flip the entity's existing is_current=1 name row to name_role='former', is_current=0,
//      valid_to=now — preserving it in place so its phonetic codes remain in the conflicts corpus.
//   2. INSERT a new name row (is_current=1, name_role='current') with phonetic codes.
//   3. UPDATE the entity row's denormalized name columns to reflect the new current name.
//   4. Emit a directory.entity.renamed outbox message and a domain audit row.
//
// The entity kind is resolved from the id handle prefix; the caller does not need to pass it.
export async function changeName(
  database: BatchDatabase,
  entityId: DirectoryPersonId | DirectoryOrganizationId,
  input: ChangeNameInput,
  options: DirectoryWriteOptions,
): Promise<void> {
  const nameId: DirectoryNameId = newIdentifier("directoryName", options.randomSource);
  const now = options.clock.now();
  const entityKind = entityKindFromId(entityId);

  const statements: SqlStatement[] = [];

  // Step 1: flip the prior current name to former.
  statements.push(flipCurrentNameToFormerStatement(database, entityId, now));

  if (entityKind === "person") {
    const personInput = isPersonNameInput(input)
      ? input
      : (() => {
          throw new Error("name-history: person entity requires ChangePersonNameInput");
        })();

    const given = personInput.given.trim();
    const family = personInput.family.trim();
    const displayName = renderPersonDisplayName(personInput);
    const normalizedDisplay = normalizeName(displayName);

    // Phonetic codes for persons are computed on the family name (the surname is the
    // primary conflicts-blocking token); fall back to given when family is absent.
    const phoneticSource = family.length > 0 ? family : given;
    const codes = phoneticCodes(normalizeName(phoneticSource));

    // Step 2: insert the new current name row.
    statements.push(
      insertNameStatement(database, {
        id: nameId,
        entityId,
        entityKind: "person",
        nameRole: "current",
        prefix: personInput.prefix ?? null,
        given: given.length > 0 ? given : null,
        middle: personInput.middle ?? null,
        family: family.length > 0 ? family : null,
        suffix: personInput.suffix ?? null,
        normalizedDisplay,
        isCurrent: true,
        validFrom: now,
        validTo: null,
        createdAt: now,
      }),
    );
    statements.push(...insertPhoneticCodeStatements(database, nameId, codes));

    // Step 3: update the person entity row's denormalized name columns.
    statements.push(
      updatePersonNameStatement(
        database,
        entityId as DirectoryPersonId,
        {
          prefix: personInput.prefix ?? null,
          given: given.length > 0 ? given : null,
          middle: personInput.middle ?? null,
          family: family.length > 0 ? family : null,
          suffix: personInput.suffix ?? null,
          displayName,
        },
        now,
      ),
    );
  } else {
    const organizationInput = !isPersonNameInput(input)
      ? input
      : (() => {
          throw new Error("name-history: organization entity requires ChangeOrganizationNameInput");
        })();

    const legalName = organizationInput.legalName.trim();
    const displayName = (organizationInput.displayName ?? legalName).trim();
    const normalizedDisplay = normalizeName(legalName);

    // Phonetic codes for organizations are computed on the full normalized legal name.
    const codes = phoneticCodes(normalizedDisplay);

    // Step 2: insert the new current name row.
    statements.push(
      insertNameStatement(database, {
        id: nameId,
        entityId,
        entityKind: "organization",
        nameRole: "current",
        prefix: null,
        given: null,
        middle: null,
        family: null,
        suffix: null,
        normalizedDisplay,
        isCurrent: true,
        validFrom: now,
        validTo: null,
        createdAt: now,
      }),
    );
    statements.push(...insertPhoneticCodeStatements(database, nameId, codes));

    // Step 3: update the organization entity row's denormalized name columns.
    statements.push(
      updateOrganizationNameStatement(
        database,
        entityId as DirectoryOrganizationId,
        { legalName, displayName },
        now,
      ),
    );
  }

  // Step 4: audit row.
  statements.push(directoryAuditStatement(database, options, "directory.entity.renamed", entityId));

  await runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements,
    outboxMessages: [{ topic: "directory.entity.renamed", payload: { entityId } }],
    responseCode: 200,
    responseBody: { ok: true },
    value: undefined,
    fromBody: () => undefined,
  }));
}

// ── addName ──────────────────────────────────────────────────────────────────

// The caller-supplied name fields for appending a person alias (maiden, aka, alias, …).
export interface AddPersonNameInput {
  readonly given: string;
  readonly family: string;
  readonly nameRole: NameRole;
  readonly prefix?: string | null;
  readonly middle?: string | null;
  readonly suffix?: string | null;
}

// The caller-supplied name fields for appending an organization alias (dba, aka, alias, …).
export interface AddOrganizationNameInput {
  readonly legalName: string;
  readonly nameRole: NameRole;
  readonly displayName?: string | null;
}

// The discriminated union of entity-specific inputs accepted by addName.
export type AddNameInput = AddPersonNameInput | AddOrganizationNameInput;

// True when the input carries person name fields rather than an org legalName.
function isAddPersonNameInput(input: AddNameInput): input is AddPersonNameInput {
  return "given" in input || "family" in input;
}

// addName appends a non-current alias row for the entity WITHOUT touching the current name:
//   - is_current=0, the supplied name_role (alias/aka/maiden/dba/…), phonetic codes included.
//   - The entity row's denormalized name columns are NOT updated — the current name is unchanged.
//
// The entity kind is resolved from the id handle prefix; the caller does not need to pass it.
export async function addName(
  database: BatchDatabase,
  entityId: DirectoryPersonId | DirectoryOrganizationId,
  input: AddNameInput,
  options: DirectoryWriteOptions,
): Promise<void> {
  const nameId: DirectoryNameId = newIdentifier("directoryName", options.randomSource);
  const now = options.clock.now();
  const entityKind = entityKindFromId(entityId);

  const statements: SqlStatement[] = [];

  if (entityKind === "person") {
    const personInput = isAddPersonNameInput(input)
      ? input
      : (() => {
          throw new Error("name-history: person entity requires AddPersonNameInput");
        })();

    const given = personInput.given.trim();
    const family = personInput.family.trim();
    const displayName = renderPersonDisplayName(personInput);
    const normalizedDisplay = normalizeName(displayName);

    const phoneticSource = family.length > 0 ? family : given;
    const codes = phoneticCodes(normalizeName(phoneticSource));

    statements.push(
      insertNameStatement(database, {
        id: nameId,
        entityId,
        entityKind: "person",
        nameRole: personInput.nameRole,
        prefix: personInput.prefix ?? null,
        given: given.length > 0 ? given : null,
        middle: personInput.middle ?? null,
        family: family.length > 0 ? family : null,
        suffix: personInput.suffix ?? null,
        normalizedDisplay,
        isCurrent: false,
        validFrom: now,
        validTo: null,
        createdAt: now,
      }),
    );
    statements.push(...insertPhoneticCodeStatements(database, nameId, codes));
  } else {
    const organizationInput = !isAddPersonNameInput(input)
      ? input
      : (() => {
          throw new Error("name-history: organization entity requires AddOrganizationNameInput");
        })();

    const legalName = organizationInput.legalName.trim();
    const normalizedDisplay = normalizeName(legalName);
    const codes = phoneticCodes(normalizedDisplay);

    statements.push(
      insertNameStatement(database, {
        id: nameId,
        entityId,
        entityKind: "organization",
        nameRole: organizationInput.nameRole,
        prefix: null,
        given: null,
        middle: null,
        family: null,
        suffix: null,
        normalizedDisplay,
        isCurrent: false,
        validFrom: now,
        validTo: null,
        createdAt: now,
      }),
    );
    statements.push(...insertPhoneticCodeStatements(database, nameId, codes));
  }

  // Audit row — records the alias addition for the domain audit trail.
  statements.push(
    directoryAuditStatement(database, options, "directory.entity.name_added", entityId),
  );

  await runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements,
    outboxMessages: [],
    responseCode: 201,
    responseBody: { ok: true },
    value: undefined,
    fromBody: () => undefined,
  }));
}

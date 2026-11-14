import {
  appendCursorPredicate,
  assemblePage,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  type Page,
} from "@magna-carta/data-access/cursor-pagination";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DirectoryNameId,
  DirectoryOrganizationId,
  DirectoryPersonId,
} from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.ts";
import { runDirectoryEffect } from "./run-directory-effect.ts";
import { DIRECTORY_ENTITY_RENAMED_TOPIC } from "./topics.ts";
import { assertEntityExists, entityKindFromId } from "./entity-kind.ts";
import { normalizeName } from "./normalize-name.ts";
import { phoneticCodes } from "./phonetics.ts";
import {
  flipCurrentNameToFormerStatement,
  insertNameStatement,
  insertPhoneticCodeStatements,
  retireMistypedCurrentNameStatement,
  updateOrganizationNameStatement,
  updatePersonNameStatement,
} from "./statements.ts";
import type { EntityKind, NameRole } from "./types.ts";

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
//
// A CORRECTION (`kind: "correction"`) differs only in step 1: the prior name was a typing mistake,
// so it is retired (soft-deleted) rather than kept as a former name. It is still a new row and not
// an edit of the old one, so the phonetic codes and the trigram index travel with each row exactly
// as they do for a change, and the outbox row still fires, because a corrected spelling can change
// what a conflicts check finds.
export async function changeName(
  database: BatchDatabase,
  entityId: DirectoryPersonId | DirectoryOrganizationId,
  input: ChangeNameInput,
  options: DirectoryWriteOptions,
  kind: "change" | "correction" = "change",
): Promise<void> {
  // Fail fast before any write, exactly as addName does: directory_name carries no foreign key to the
  // node tables, so renaming an entity that does not exist (or has been merged away) would insert an
  // orphan current-flagged name row plus its phonetic codes into the conflicts corpus, silently no-op
  // the flip and the node-row update, and still report success.
  await assertEntityExists(database, entityId);

  const nameId: DirectoryNameId = newIdentifier("directoryName", options.randomSource);
  const now = options.clock.now();
  const entityKind = entityKindFromId(entityId);

  const statements: SqlStatement[] = [];

  // Step 1: flip the prior current name to former, or retire it when it was mistyped.
  statements.push(
    kind === "correction"
      ? retireMistypedCurrentNameStatement(database, entityId, now)
      : flipCurrentNameToFormerStatement(database, entityId, now),
  );

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
  statements.push(
    directoryAuditStatement(
      database,
      options,
      kind === "correction" ? "directory.entity.name_corrected" : "directory.entity.renamed",
      entityId,
    ),
  );

  await runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements,
    outboxMessages: [{ topic: DIRECTORY_ENTITY_RENAMED_TOPIC, payload: { entityId } }],
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
/**
 * Composes the rows one further name writes, without committing and without checking the entity:
 * the caller either checked it or is creating it in the same batch.
 */
export function composeAddName(
  database: BatchDatabase,
  entityId: DirectoryPersonId | DirectoryOrganizationId,
  input: AddNameInput,
  options: DirectoryWriteOptions,
): SqlStatement[] {
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

  return statements;
}

export async function addName(
  database: BatchDatabase,
  entityId: DirectoryPersonId | DirectoryOrganizationId,
  input: AddNameInput,
  options: DirectoryWriteOptions,
): Promise<void> {
  // Fail fast before any write: an alias must attach to a live entity (directory_name carries no FK to
  // the node tables, so an unchecked entity id would insert an orphan name row and falsely report 201).
  await assertEntityExists(database, entityId);
  const statements = composeAddName(database, entityId, input, options);

  await runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements,
    outboxMessages: [],
    responseCode: 201,
    responseBody: { ok: true },
    value: undefined,
    fromBody: () => undefined,
  }));
}

// ── readNames ────────────────────────────────────────────────────────────────

/**
 * One name an entity has held, as the corpus holds it.
 *
 * `displayName` is the name as it was RECORDED, and it is null for an organization: an organization
 * name row stores only `normalized_display` (case-folded, punctuation stripped), because the node
 * row carries the current legal name and nothing needed the earlier spellings back. So a caller
 * shows `displayName` where there is one and `normalizedDisplay` otherwise, and gets an honest
 * lowercase former name rather than an invented capitalization. Restoring the recorded casing for an
 * organization alias wants a column on `directory_name`, and is a schema change, not a read.
 */
export interface DirectoryNameRecord {
  readonly id: string;
  readonly entityId: string;
  readonly entityKind: EntityKind;
  readonly nameRole: NameRole;
  /** True for the one row the entity currently answers to. Exactly one row per live entity carries it. */
  readonly isCurrent: boolean;
  readonly prefix: string | null;
  readonly given: string | null;
  readonly middle: string | null;
  readonly family: string | null;
  readonly suffix: string | null;
  readonly displayName: string | null;
  readonly normalizedDisplay: string;
  /** When this name came into use, and when it stopped — null while it is still in use. */
  readonly validFrom: string | null;
  readonly validTo: string | null;
  /** When the firm wrote the row down, which is not when the name came into use. */
  readonly recordedAt: string;
}

// Render a person's recorded name from the parts on the row, collapsing blanks the same way the
// write path renders the display name it denormalizes onto the node row.
function renderRecordedName(row: {
  name_prefix: string | null;
  name_given: string | null;
  name_middle: string | null;
  name_family: string | null;
  name_suffix: string | null;
}): string | null {
  const assembled = [
    row.name_prefix,
    row.name_given,
    row.name_middle,
    row.name_family,
    row.name_suffix,
  ]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
  return assembled === "" ? null : assembled;
}

/**
 * Every name an entity has held, newest first and cursor-paged.
 *
 * Newest-first is what puts the current name at the head of the rail: a name change inserts the new
 * current row, so the most recently written row is the one the entity answers to today and the page
 * reads backwards from it through the marriages, the deed polls and the trading names. Ordered by
 * when the firm WROTE each row rather than by `valid_from`, because a maiden name recorded onto a
 * twenty-year-old file has a validity that predates every other row and would otherwise sort to the
 * bottom of a rail nobody scrolled.
 *
 * Soft-deleted name rows are excluded, as they are from every other read of the corpus.
 */
export async function readNames(
  database: SqlDatabase,
  entityId: DirectoryPersonId | DirectoryOrganizationId,
  options: { readonly cursor?: string; readonly pageSize?: number } = {},
): Promise<Page<DirectoryNameRecord>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const conditions = ["entity_id = ?1", "deleted_at IS NULL"];
  const bindings: unknown[] = [entityId];
  appendCursorPredicate(conditions, bindings, decodeCursor(options.cursor));
  bindings.push(pageSize + 1);

  const { results } = await database
    .prepare(
      `SELECT id, entity_id, entity_kind, name_role, name_prefix, name_given, name_middle,
              name_family, name_suffix, normalized_display, is_current, valid_from, valid_to, created_at
         FROM directory_name
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT ?${String(bindings.length)}`,
    )
    .bind(...bindings)
    .all<{
      id: string;
      entity_id: string;
      entity_kind: string;
      name_role: string;
      name_prefix: string | null;
      name_given: string | null;
      name_middle: string | null;
      name_family: string | null;
      name_suffix: string | null;
      normalized_display: string;
      is_current: number;
      valid_from: string | null;
      valid_to: string | null;
      created_at: string;
    }>();

  return assemblePage(results, pageSize, (row) => ({
    id: row.id,
    entityId: row.entity_id,
    entityKind: row.entity_kind as EntityKind,
    nameRole: row.name_role as NameRole,
    isCurrent: row.is_current === 1,
    prefix: row.name_prefix,
    given: row.name_given,
    middle: row.name_middle,
    family: row.name_family,
    suffix: row.name_suffix,
    displayName: renderRecordedName(row),
    normalizedDisplay: row.normalized_display,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    recordedAt: row.created_at,
  }));
}

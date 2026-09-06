import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  blindIndexValue,
  composeProtectedWrite,
  protectedField,
  readProtected,
  type ProtectedFieldDeclaration,
  type ProtectedReadContext,
} from "@magna-carta/data-access/protected-fields";
import { directoryIdentifierValue } from "@magna-carta/data-access/protected-field-registry";
import {
  normalizeToDigits,
  normalizeUppercaseStrip,
  withStatePrefix,
} from "@magna-carta/encryption/normalize";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DirectoryIdentifierId } from "@magna-carta/identifiers/types";
import { directoryAuditStatement } from "./audit.ts";
import { assertEntityExists } from "./entity-kind.ts";
import { runDirectoryEffect, type DirectoryIdempotencyContext } from "./run-directory-effect.ts";
import { DIRECTORY_IDENTIFIER_TABLE } from "./statements.ts";
import { DIRECTORY_IDENTIFIER_ADDED_TOPIC } from "./topics.ts";
import { accountNumberOf } from "./identifier-shape.ts";
import type { IdentifierType } from "./types.ts";

// Sensitive typed identifiers (SSN, EIN, driver's license, account, bar number, SSN-last-four) live in
// directory_identifier, one physical (value_ciphertext, value_blind_index) column pair per row. Every
// value is sealed through the protected-field chokepoint in `@magna-carta/data-access` — the plaintext never reaches a
// column or a log. The identifier_type discriminates the per-type policy: which exact-match blind-index
// channel a value gets, and the frozen normalize transform feeding it. The blind index is the conflicts
// exact-identifier channel — matched by indexed equality with no decrypt and no permission.

// The context every directory identifier operation runs under: the firm-scoped protected-read context
// (firm key, the per-firm database, the caller's effective permissions, the acting user, the clock),
// plus the route's optional Idempotency-Key context. addIdentifier and findByIdentifier use only its
// write/index halves; readIdentifier uses the full permission-gated, audited read; the mutating paths
// (addIdentifier, mergeEntities) thread idempotency into their committed batch so a retry dedups.
export type DirectoryIdentifierContext = ProtectedReadContext & {
  readonly idempotency?: DirectoryIdempotencyContext;
};

// Thrown when a lookup is attempted against an identifier type that carries no standalone blind index
// (bar number, SSN-last-four — too low-entropy to index without leaking distribution). There is nothing to
// match on; conflicts resolves these by decrypt-and-compare over a candidate set, never a direct
// equality probe. The code is stable for callers to branch on.
export class IdentifierNotIndexableError extends Error {
  readonly code = "no-standalone-index";
  readonly identifierType: IdentifierType;
  constructor(identifierType: IdentifierType) {
    super(`identifier type ${identifierType} has no standalone blind index (no-standalone-index)`);
    this.name = "IdentifierNotIndexableError";
    this.identifierType = identifierType;
  }
}

// The driver's-license value arrives state-qualified as "STATE:LICENSE" (a license number is unique only
// within its issuing state). The frozen transform binds the state into the index so two states' identical
// license strings never collide. A value with no state separator normalizes the whole string under the
// empty-state prefix — defensible and still deterministic.
function normalizeDriversLicense(value: string): string {
  const separator = value.indexOf(":");
  if (separator === -1) return withStatePrefix("", value);
  return withStatePrefix(value.slice(0, separator), value.slice(separator + 1));
}

// The per-identifier-type protected-field declaration. Every type seals into the same physical column
// through the one canonical decrypt declaration (directoryIdentifierValue carries the purpose, the
// directory:viewSensitiveIdentifiers permission, and the AAD column); a type the policy
// standalone-indexes clones that declaration and adds its blind-index spec — the frozen normalize plus
// the truncation length in bits (16 for the lower-entropy identifiers, 24 for higher-entropy account
// numbers). The bar number and SSN-last-four get the bare declaration — protected, never standalone-indexed,
// because their entropy is too low to index without leaking the value distribution.
const IDENTIFIER_DECLARATIONS: Readonly<Record<IdentifierType, ProtectedFieldDeclaration>> = {
  // SSN — standalone blind index, L=16, digit-strip.
  ssn: protectedField({
    ...directoryIdentifierValue,
    blindIndex: {
      name: "ssn_exact",
      normalize: normalizeToDigits,
      lengthBits: 16,
      column: "value_blind_index",
    },
  }),
  // EIN (an organization's tax id, the SSN-equivalent) — standalone blind index, L=16, digit-strip.
  ein: protectedField({
    ...directoryIdentifierValue,
    blindIndex: {
      name: "ein_exact",
      normalize: normalizeToDigits,
      lengthBits: 16,
      column: "value_blind_index",
    },
  }),
  // Driver's license — standalone blind index, L=16, uppercase+strip, state-prefixed.
  drivers_license: protectedField({
    ...directoryIdentifierValue,
    blindIndex: {
      name: "drivers_license_exact",
      normalize: normalizeDriversLicense,
      lengthBits: 16,
      column: "value_blind_index",
    },
  }),
  // An account — the number with the username and secret that belong to it, sealed as one value
  // (identifier-shape.ts says the shape). Standalone blind index on the NUMBER alone, L=24 (higher
  // entropy), uppercase+strip: the username and secret never reach an index.
  account: protectedField({
    ...directoryIdentifierValue,
    blindIndex: {
      name: "account_exact",
      normalize: (value) => normalizeUppercaseStrip(accountNumberOf(value)),
      lengthBits: 24,
      column: "value_blind_index",
    },
  }),
  // SSN last-four — protected, NEVER standalone-indexed.
  ssn_last_four: directoryIdentifierValue,
  // Bar number — professional public record the firm nonetheless holds encrypted, so reading one is
  // still permission-gated and audited. NEVER standalone-indexed: a bar number is a short
  // state-scoped integer whose entropy is too low to index without leaking the value distribution,
  // and nothing needs to equality-search one.
  bar_number: directoryIdentifierValue,
};

// A directory_identifier row. value_ciphertext is the chokepoint-sealed value; value_blind_index is the
// exact-match index, NULL for a never-indexed type (bar number, SSN-last-four). label is the plaintext
// part a list shows without a reveal — the issuing region, the jurisdiction, who an account is held
// with — and never any part of the value.
interface InsertIdentifierRow {
  readonly id: DirectoryIdentifierId;
  readonly entityId: string;
  readonly identifierType: IdentifierType;
  readonly label: string | null;
  readonly valueCiphertext: string;
  readonly valueBlindIndex: string | null;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly createdAt: string;
}

// Composes the directory_identifier INSERT. Kept in this file (the one allow-listed home for the
// directory protected-column names) so the value_ciphertext / value_blind_index references stay inside
// the chokepoint-adjacent write path the no-plaintext-escape scan sanctions.
function insertIdentifierStatement(database: SqlDatabase, row: InsertIdentifierRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DIRECTORY_IDENTIFIER_TABLE} (id, entity_id, identifier_type, label, value_ciphertext, value_blind_index, valid_from, valid_to, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, NULL)`,
    )
    .bind(
      row.id,
      row.entityId,
      row.identifierType,
      row.label,
      row.valueCiphertext,
      row.valueBlindIndex,
      row.validFrom,
      row.validTo,
      row.createdAt,
    );
}

// The exact-match probe: live (not soft-deleted) entity ids whose identifier of this type carries the
// given blind index. Plain WHERE equality on value_blind_index — the index already encodes the frozen
// normalization, so a formatted and an unformatted value match the same row.
function selectByBlindIndexStatement(
  database: SqlDatabase,
  identifierType: IdentifierType,
  index: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT entity_id FROM ${DIRECTORY_IDENTIFIER_TABLE} WHERE identifier_type = ?1 AND value_blind_index = ?2 AND deleted_at IS NULL`,
    )
    .bind(identifierType, index);
}

// The conflicts exact-identifier channel for an EXISTING subject entity, where no plaintext value is
// in hand: every OTHER live identifier row whose (type, blind index) equals one the subject already
// carries. A pure blind-index self-join — no decrypt, no permission, no audit, exactly as findByIdentifier
// matches a plaintext probe. `value_blind_index IS NOT NULL` excludes the never-indexed types (DOB,
// SSN-last-four store NULL there); merge-resolution and soft-deleted-entity exclusion are left to the
// caller's resolveMergedId pass, identical to the plaintext channel's raw hits.
function selectEntitiesSharingBlindIndexStatement(
  database: SqlDatabase,
  subjectEntityId: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT DISTINCT other.entity_id AS entity_id, other.identifier_type AS identifier_type
         FROM ${DIRECTORY_IDENTIFIER_TABLE} AS subject
         JOIN ${DIRECTORY_IDENTIFIER_TABLE} AS other
           ON other.identifier_type = subject.identifier_type
          AND other.value_blind_index = subject.value_blind_index
        WHERE subject.entity_id = ?1
          AND other.entity_id <> ?1
          AND subject.value_blind_index IS NOT NULL
          AND subject.deleted_at IS NULL
          AND other.deleted_at IS NULL`,
    )
    .bind(subjectEntityId);
}

// Raw (pre-merge-resolution) exact-identifier hits for a subject entity: other entity ids that share a
// standalone-indexed identifier's blind index with it, each paired with the type that matched. The
// conflicts party channel for a subject already persisted (its plaintext is sealed away) — matched by
// indexed equality alone. The caller resolves each raw id to its surviving master exactly as it does the
// plaintext channel's hits.
export async function findEntitiesSharingIdentifiers(
  database: SqlDatabase,
  subjectEntityId: string,
): Promise<Array<{ entityId: string; identifierType: string }>> {
  const { results } = await selectEntitiesSharingBlindIndexStatement(
    database,
    subjectEntityId,
  ).all<{
    entity_id: string;
    identifier_type: string;
  }>();
  return results.map((row) => ({ entityId: row.entity_id, identifierType: row.identifier_type }));
}

// D1 caps bound parameters at 100 per query, so the set-valued read below chunks its IN list.
const MAX_IDENTIFIER_BOUND_PARAMETERS = 100;

// The same exact-identifier hits for a WHOLE SET of subjects, in one read per chunk rather than one
// read per subject. The conflicts traversal asks this of every entity it reaches, and at one query
// each that is a query count proportional to the closure size.
//
// It lives here rather than at the call site for the reason the single-subject reader does:
// `value_blind_index` is a protected column and this module is its chokepoint. A blind index is a
// stable fingerprint of a plaintext, so a query naming it anywhere else is a correlation surface that
// the package's own no-plaintext-escape probe refuses — and rightly, because a self-join that never
// decrypts anything is exactly the shape that looks harmless while it leaks.
//
// The SUBJECT side is projected, so each hit names whose identifier matched it. Raw ids, exactly as
// the single-subject reader returns them: the caller resolves each to its surviving master.
export async function findEntitiesSharingIdentifiersBatch(
  database: SqlDatabase,
  subjectEntityIds: readonly string[],
): Promise<Map<string, Array<{ entityId: string; identifierType: string }>>> {
  const bySubject = new Map<string, Array<{ entityId: string; identifierType: string }>>();
  const unique = [...new Set(subjectEntityIds)];
  for (let start = 0; start < unique.length; start += MAX_IDENTIFIER_BOUND_PARAMETERS) {
    const chunk = unique.slice(start, start + MAX_IDENTIFIER_BOUND_PARAMETERS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT DISTINCT subject.entity_id AS subject_id, other.entity_id AS entity_id, other.identifier_type AS identifier_type
           FROM ${DIRECTORY_IDENTIFIER_TABLE} AS subject
           JOIN ${DIRECTORY_IDENTIFIER_TABLE} AS other
             ON other.identifier_type = subject.identifier_type
            AND other.value_blind_index = subject.value_blind_index
          WHERE subject.entity_id IN (${placeholders})
            AND other.entity_id <> subject.entity_id
            AND subject.value_blind_index IS NOT NULL
            AND subject.deleted_at IS NULL
            AND other.deleted_at IS NULL`,
      )
      .bind(...chunk)
      .all<{ subject_id: string; entity_id: string; identifier_type: string }>();
    for (const row of results) {
      const hits = bySubject.get(row.subject_id) ?? [];
      hits.push({ entityId: row.entity_id, identifierType: row.identifier_type });
      bySubject.set(row.subject_id, hits);
    }
  }
  return bySubject;
}

// The caller-supplied fields for a new identifier: its type, its plaintext value, and optional temporal
// validity. The value is sealed immediately — it is never held beyond composing the batch.
export interface AddIdentifierInput {
  readonly type: IdentifierType;
  /** The plaintext to seal, already in the type's canonical shape (identifier-shape.ts checks it). */
  readonly value: string;
  /** The plaintext part a list shows: the issuing region, the jurisdiction, who an account is held with. */
  readonly label?: string | null;
  readonly validFrom?: string | null;
  readonly validTo?: string | null;
}

/** What sealing one identifier contributes to a batch: its insert, its audit row, its announcement. */
export interface ComposedIdentifierWrite {
  readonly identifierId: DirectoryIdentifierId;
  readonly statements: readonly SqlStatement[];
  readonly outboxMessages: EffectWrite["outboxMessages"];
}

// Seals the value and composes everything one identifier writes, without committing. addIdentifier
// commits exactly this; a create that records a whole person in one batch composes several of these
// beside the person's own rows, so a person is never half-recorded with a sealed number and no name.
export async function composeIdentifierWrite(
  context: DirectoryIdentifierContext,
  entityId: string,
  input: AddIdentifierInput,
): Promise<ComposedIdentifierWrite> {
  const declaration = IDENTIFIER_DECLARATIONS[input.type];
  const identifierId = newIdentifier("directoryIdentifier", context.randomSource);
  const now = context.clock.now();
  const sealed = await composeProtectedWrite(context, declaration, identifierId, input.value);
  const label = input.label?.trim() ?? "";
  return {
    identifierId,
    statements: [
      insertIdentifierStatement(context.database, {
        id: identifierId,
        entityId,
        identifierType: input.type,
        label: label === "" ? null : label,
        valueCiphertext: sealed.ciphertextValue,
        valueBlindIndex: sealed.blindIndexValue ?? null,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
        createdAt: now,
      }),
      // The audit subject is the identifier row, so a later read/merge correlates by it.
      directoryAuditStatement(
        context.database,
        {
          clock: context.clock,
          actorUserId: context.actorUserId,
          randomSource: context.randomSource,
        },
        "directory.identifier.added",
        identifierId,
      ),
    ],
    // One outbox row, in the batch this write was already composing. An SSN or EIN entered after a
    // matter was screened makes an exact-identifier match possible where none could fire before, so
    // the arrival is announced. The payload names the entity, the identifier ROW, and its TYPE —
    // never the value and never the blind index. A blind index is a stable fingerprint of the
    // plaintext: putting one on a relayed message would let anything that reads the bus correlate a
    // person across firms without ever decrypting anything.
    outboxMessages: [
      {
        topic: DIRECTORY_IDENTIFIER_ADDED_TOPIC,
        payload: { identifierId, entityId, identifierType: input.type },
      },
    ],
  };
}

// Seals a typed identifier value for an entity and composes the directory_identifier INSERT plus a
// domain audit row into one atomic batch. The ciphertext (and, where the policy standalone-indexes the
// type, the blind index) are the ONLY representations stored — never the plaintext. Computing the blind
// index needs no permission; sealing is a property of the write.
export async function addIdentifier(
  context: DirectoryIdentifierContext,
  entityId: string,
  input: AddIdentifierInput,
): Promise<void> {
  // Fail fast before sealing or writing: an identifier must attach to a live entity (directory_identifier
  // carries no FK to the node tables, so an unchecked entity id would insert an orphan row and falsely
  // report 201).
  await assertEntityExists(context.database, entityId);
  const composed = await composeIdentifierWrite(context, entityId, input);

  await runDirectoryEffect(context.database, context.idempotency, context.clock, () => ({
    statements: [...composed.statements],
    outboxMessages: composed.outboxMessages,
    responseCode: 201,
    responseBody: { ok: true },
    value: undefined,
    fromBody: () => undefined,
  }));
}

export interface FindByIdentifierInput {
  readonly type: IdentifierType;
  readonly value: string;
}

// The conflicts exact-identifier channel: computes the blind index for the (normalized) value and matches
// value_blind_index equality. NO permission and NO audit — matching reveals nothing the caller did not
// already supply. REFUSES a type with no standalone index (DOB, SSN-last-four) with a named code; those
// are resolved by decrypt-and-compare elsewhere, never a direct probe. Returns the matching entity ids.
export async function findByIdentifier(
  context: DirectoryIdentifierContext,
  input: FindByIdentifierInput,
): Promise<string[]> {
  const declaration = IDENTIFIER_DECLARATIONS[input.type];
  if (declaration.blindIndex === undefined) {
    throw new IdentifierNotIndexableError(input.type);
  }

  const index = await blindIndexValue(context, declaration, input.value);
  const { results } = await selectByBlindIndexStatement(context.database, input.type, index).all<{
    entity_id: string;
  }>();
  return results.map((row) => row.entity_id);
}

// Decrypts an entity's identifier value of a given type — the `@magna-carta/data-access` readProtected path: permission
// check (absent → ProtectedReadForbiddenError, no decrypt, no audit) → an audit_log decrypt row committed
// BEFORE any plaintext → AAD decrypt bound to the row. The gate, the audit, and the decrypt are
// inseparable and fail-closed. Returns null when the entity holds no identifier of that type.
export async function readIdentifier(
  context: DirectoryIdentifierContext,
  entityId: string,
  type: IdentifierType,
): Promise<string | null> {
  const declaration = IDENTIFIER_DECLARATIONS[type];
  const { results } = await selectIdentifierRowStatement(context.database, entityId, type).all<{
    id: string;
    value_ciphertext: string;
  }>();
  const row = results[0];
  if (row === undefined) return null;
  return readProtected(context, declaration, { value_ciphertext: row.value_ciphertext }, row.id);
}

// The ciphertext + row id for an entity's identifier of a given type — the input readProtected decrypts
// (the AAD binds the ciphertext to its row id). Declared here rather than in statements.ts so the
// chokepoint-adjacent read stays beside its only caller. Most-recently-created row wins on duplicates.
function selectIdentifierRowStatement(
  database: BatchDatabase,
  entityId: string,
  type: IdentifierType,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, value_ciphertext FROM ${DIRECTORY_IDENTIFIER_TABLE} WHERE entity_id = ?1 AND identifier_type = ?2 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .bind(entityId, type);
}

// ── what the firm holds, without reading any of it ───────────────────────────

/**
 * One sealed identifier, described but never disclosed: its type, the period it is valid for, and
 * when it was recorded. There is no value field on this shape, and adding one would be the whole bug.
 */
export interface IdentifierRecord {
  readonly id: string;
  readonly type: IdentifierType;
  /** The plaintext part: the issuing region, the jurisdiction, who an account is held with. */
  readonly label: string | null;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly recordedAt: string;
}

/**
 * Which identifiers an entity holds, WITHOUT decrypting any of them.
 *
 * A screen has to be able to say "the firm holds a social security number for this person" without
 * anybody reading it: the decrypt is the privileged, audited act, and a record that had to perform
 * one just to draw a list of headings would put a plaintext social security number into an audit log
 * every time a page rendered. So this read touches no ciphertext, names no blind index, needs no
 * permission beyond the session, and writes no audit row — because it reveals nothing a member with
 * the record open did not already have.
 *
 * The count answers the third question that shape leaves open: a person can hold two account numbers,
 * and one heading per type would silently hide the second.
 */
export async function listIdentifierRecords(
  database: SqlDatabase,
  entityId: string,
): Promise<IdentifierRecord[]> {
  const { results } = await database
    .prepare(
      `SELECT id, identifier_type, label, valid_from, valid_to, created_at
         FROM ${DIRECTORY_IDENTIFIER_TABLE}
        WHERE entity_id = ?1 AND deleted_at IS NULL
        ORDER BY identifier_type ASC, created_at DESC, id DESC`,
    )
    .bind(entityId)
    .all<{
      id: string;
      identifier_type: string;
      label: string | null;
      valid_from: string | null;
      valid_to: string | null;
      created_at: string;
    }>();
  return results.map((row) => ({
    id: row.id,
    type: row.identifier_type as IdentifierType,
    label: row.label,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    recordedAt: row.created_at,
  }));
}

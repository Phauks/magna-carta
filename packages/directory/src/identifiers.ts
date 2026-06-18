import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
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
import { runDirectoryEffect, type DirectoryIdempotencyContext } from "./run-directory-effect.ts";
import { DIRECTORY_IDENTIFIER_TABLE } from "./statements.ts";
import type { IdentifierType } from "./types.ts";

// Sensitive typed identifiers (SSN, EIN, driver's license, account number, DOB, SSN-last-four) live in
// directory_identifier, one physical (value_ciphertext, value_blind_index) column pair per row. Every
// value is sealed through the slice 1·2 protected-field chokepoint — the plaintext never reaches a
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
// (DOB, SSN-last-four — too low-entropy to index without leaking distribution). There is nothing to
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
// numbers). DOB and SSN-last-four get the bare declaration — protected, never standalone-indexed,
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
  // Financial / account number — standalone blind index, L=24 (higher entropy), uppercase+strip.
  account: protectedField({
    ...directoryIdentifierValue,
    blindIndex: {
      name: "account_exact",
      normalize: normalizeUppercaseStrip,
      lengthBits: 24,
      column: "value_blind_index",
    },
  }),
  // DOB — protected, NEVER standalone-indexed (low entropy leaks distribution); decrypt-and-compare.
  dob: directoryIdentifierValue,
  // SSN last-four — protected, NEVER standalone-indexed.
  ssn_last_four: directoryIdentifierValue,
};

// A directory_identifier row. value_ciphertext is the chokepoint-sealed value; value_blind_index is the
// exact-match index, NULL for a never-indexed type (DOB, SSN-last-four).
interface InsertIdentifierRow {
  readonly id: DirectoryIdentifierId;
  readonly entityId: string;
  readonly identifierType: IdentifierType;
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
      `INSERT INTO ${DIRECTORY_IDENTIFIER_TABLE} (id, entity_id, identifier_type, value_ciphertext, value_blind_index, valid_from, valid_to, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, NULL)`,
    )
    .bind(
      row.id,
      row.entityId,
      row.identifierType,
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

// The caller-supplied fields for a new identifier: its type, its plaintext value, and optional temporal
// validity. The value is sealed immediately — it is never held beyond composing the batch.
export interface AddIdentifierInput {
  readonly type: IdentifierType;
  readonly value: string;
  readonly validFrom?: string | null;
  readonly validTo?: string | null;
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
  const declaration = IDENTIFIER_DECLARATIONS[input.type];
  const identifierId = newIdentifier("directoryIdentifier", context.randomSource);
  const now = context.clock.now();

  const sealed = await composeProtectedWrite(context, declaration, identifierId, input.value);

  await runDirectoryEffect(context.database, context.idempotency, context.clock, () => ({
    statements: [
      insertIdentifierStatement(context.database, {
        id: identifierId,
        entityId,
        identifierType: input.type,
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
    outboxMessages: [],
    responseCode: 201,
    responseBody: { ok: true },
    value: undefined,
    fromBody: () => undefined,
  }));
}

// The caller-supplied lookup: an identifier type and the plaintext value to match. Formatting-insensitive
// — the value is normalized by the type's frozen transform before the index is computed.
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

// Decrypts an entity's identifier value of a given type — the slice 1·2 readProtected path: permission
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

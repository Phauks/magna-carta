import type { AadContext } from "@magna-carta/encryption/aad";
import { computeBlindIndex, type BlindIndexSpec } from "@magna-carta/encryption/blind-index";
import { ALGO_VERSION_AES256GCM_V1 } from "@magna-carta/encryption/envelope";
import {
  deriveAesGcmPurposeKey,
  deriveIndexSubkey,
  type Purpose,
} from "@magna-carta/encryption/keys";
import { decryptProtectedValue, encryptProtectedValue } from "@magna-carta/encryption/protect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import type { Permission } from "@magna-carta/access-control/registry";
import { insertAuditLogStatement } from "./audit-statements.ts";
import type { BatchDatabase } from "./effect-batch.ts";
import type { FirmKeyProvider } from "./firm-key-provider.ts";

// The protected-field chokepoint: the single seam every encrypted column is written and read
// through, so no protected value reaches storage in the clear and no plaintext leaves storage
// without a permission check and an audit row. It composes @magna-carta/encryption (purpose keys,
// AAD-bound seal, blind index) on top of the firm-scoped key provider, and rides the same
// firm-scoped gate as every other read.
//
// A field is DECLARED once as a module-level constant (protectedField). The declaration carries the
// (table, column) it guards, the purpose key it seals under, the permission required to decrypt, and
// an optional blind-index spec. The conformance fitness test pins every declaration to the schema
// and the access-control registry.

// A declared protected field. Static; constructed at module load via protectedField().
export interface ProtectedFieldDeclaration {
  readonly table: string;
  // The ciphertext column the sealed value is stored in (e.g. description_ciphertext). This is the
  // PROTECTED_COLUMNS column name — the AAD's `field` component, so a ciphertext cannot be replayed
  // into another column.
  readonly column: string;
  readonly purpose: Purpose;
  // The access-control registry key a caller must hold to decrypt this field. Checked on read; never
  // consulted on write or on a blind-index computation (matching reveals nothing new).
  readonly permission: Permission;
  // Optional exact-match channel over the sealed column. When present, composeProtectedWrite also
  // emits the blind-index value for the sibling indexed column.
  readonly blindIndex?: ProtectedBlindIndexSpec;
}

// The blind-index half of a declaration: the index name (its reindex/version identity), the frozen
// normalize transform, and the truncation length. Mirrors @magna-carta/encryption's BlindIndexSpec
// minus (table, field), which the declaration already carries.
export interface ProtectedBlindIndexSpec {
  readonly name: string;
  readonly normalize: (value: string) => string;
  readonly lengthBits: 16 | 24 | 32;
  // The sibling indexed column the value is stored in (e.g. ssn_blind_index).
  readonly column: string;
}

export function protectedField(declaration: ProtectedFieldDeclaration): ProtectedFieldDeclaration {
  return declaration;
}

// The firm-scoped context every protected operation runs under. firmId is supplied by the
// data-access firm context, NEVER by the caller — it is part of the AAD binding. The provider turns
// the firm's wrapped key into the non-extractable HKDF base key purpose/index keys derive from.
export interface ProtectedContext {
  readonly firmId: FirmId;
  readonly firmKeyVersion: number;
  readonly firmKeyProvider: FirmKeyProvider;
}

// What a read additionally needs: the per-firm database handle to write the decrypt audit, the
// caller's effective permission set (the gate), the acting user, and the clock. The audit row is
// committed BEFORE any plaintext is returned, so a failed audit write means no plaintext.
export interface ProtectedReadContext extends ProtectedContext {
  readonly database: BatchDatabase;
  readonly effectivePermissions: ReadonlySet<Permission>;
  readonly actorUserId: UserId | null;
  readonly clock: { now(): string };
  readonly randomSource?: RandomSource;
}

// Thrown when a caller without the field's permission attempts a protected read. Maps to the
// standard 403 problem at the HTTP boundary. No decrypt is attempted and NO audit row is written —
// a refused read is not a read.
export class ProtectedReadForbiddenError extends Error {
  readonly table: string;
  readonly field: string;
  readonly permission: string;
  constructor(declaration: ProtectedFieldDeclaration) {
    super(
      `permission ${declaration.permission} required to decrypt ${declaration.table}.${declaration.column}`,
    );
    this.name = "ProtectedReadForbiddenError";
    this.table = declaration.table;
    this.field = declaration.column;
    this.permission = declaration.permission;
  }
}

// The event name written to the per-firm audit_log for every protected decrypt.
export const PROTECTED_DECRYPT_EVENT = "protected.decrypt";

// What composeProtectedWrite hands back for the caller's effect batch: the ciphertext value plus,
// when the field declares a blind index, the index value — each tagged with its destination column
// so the caller binds them positionally into its own INSERT/UPDATE.
export interface ProtectedWriteValue {
  readonly column: string;
  readonly ciphertextValue: string;
  readonly blindIndexColumn?: string;
  readonly blindIndexValue?: string;
}

function aadFor(
  context: ProtectedContext,
  declaration: ProtectedFieldDeclaration,
  rowPrimaryKey: string,
): AadContext {
  return {
    firmId: context.firmId,
    table: declaration.table,
    field: declaration.column,
    rowPrimaryKey,
    algoVersion: ALGO_VERSION_AES256GCM_V1,
    keyVersion: context.firmKeyVersion,
  };
}

// Seals a plaintext for a protected column, binding it to its (firm, table, field, row) context, and
// — when the field declares a blind index — also computes the index value. Returns the values for
// the caller's atomic effect batch; no plaintext is stored. Encryption is a property of the field
// type, never a step to remember.
export async function composeProtectedWrite(
  context: ProtectedContext,
  declaration: ProtectedFieldDeclaration,
  rowPrimaryKey: string,
  plaintext: string,
): Promise<ProtectedWriteValue> {
  const firmHkdfKey = await context.firmKeyProvider.getFirmHkdfKey(context.firmId);
  const purposeKey = await deriveAesGcmPurposeKey(firmHkdfKey, declaration.purpose);
  const aad = aadFor(context, declaration, rowPrimaryKey);
  const ciphertextValue = await encryptProtectedValue(purposeKey, aad, plaintext);

  if (declaration.blindIndex === undefined) {
    return { column: declaration.column, ciphertextValue };
  }
  const blindIndexValue = await computeFieldBlindIndex(context, declaration, plaintext);
  return {
    column: declaration.column,
    ciphertextValue,
    blindIndexColumn: declaration.blindIndex.column,
    blindIndexValue,
  };
}

// Reads a protected value: (1) the permission gate — absent → ProtectedReadForbiddenError with NO
// decrypt and NO audit; (2) the decrypt-audit row committed in an immediate single-statement batch
// BEFORE any plaintext is returned (fail-closed: an audit write that throws means no plaintext); (3)
// decrypt under the full AAD. The audit write and the read are not separable. The stored value is
// read from the declaration's column on the supplied row.
export async function readProtected(
  context: ProtectedReadContext,
  declaration: ProtectedFieldDeclaration,
  row: { readonly [column: string]: unknown },
  rowPrimaryKey: string,
): Promise<string | null> {
  if (!context.effectivePermissions.has(declaration.permission)) {
    throw new ProtectedReadForbiddenError(declaration);
  }

  const stored = row[declaration.column];
  // A null/absent ciphertext is a row with nothing sealed (expand-contract: ciphertext not yet
  // written). Nothing to decrypt, nothing to reveal — no audit row for a non-read.
  if (stored === null || stored === undefined) return null;
  if (typeof stored !== "string") {
    throw new TypeError(
      `protected column ${declaration.table}.${declaration.column} holds a non-string value`,
    );
  }

  // Audit BEFORE return. The single-statement batch commits the decrypt record; if it throws, the
  // plaintext is never produced.
  await context.database.batch([
    insertAuditLogStatement(context.database, {
      id: newIdentifier("auditLog", context.randomSource),
      event: PROTECTED_DECRYPT_EVENT,
      actorUserId: context.actorUserId,
      subjectId: rowPrimaryKey,
      // ids and field identity ONLY — NEVER the value or any plaintext.
      metadata: { table: declaration.table, field: declaration.column },
      now: context.clock.now(),
    }),
  ]);

  const firmHkdfKey = await context.firmKeyProvider.getFirmHkdfKey(context.firmId);
  const purposeKey = await deriveAesGcmPurposeKey(firmHkdfKey, declaration.purpose);
  const aad = aadFor(context, declaration, rowPrimaryKey);
  return decryptProtectedValue(purposeKey, aad, stored);
}

// Computes the blind-index value for an equality lookup against the field's sibling indexed column.
// NO permission and NO audit: matching reveals nothing beyond what the caller already supplied. The
// declaration must carry a blindIndex spec.
export async function blindIndexValue(
  context: ProtectedContext,
  declaration: ProtectedFieldDeclaration,
  plaintext: string,
): Promise<string> {
  if (declaration.blindIndex === undefined) {
    throw new Error(`field ${declaration.table}.${declaration.column} declares no blind index`);
  }
  return computeFieldBlindIndex(context, declaration, plaintext);
}

async function computeFieldBlindIndex(
  context: ProtectedContext,
  declaration: ProtectedFieldDeclaration,
  plaintext: string,
): Promise<string> {
  const blindIndex = declaration.blindIndex;
  if (blindIndex === undefined) {
    throw new Error(`field ${declaration.table}.${declaration.column} declares no blind index`);
  }
  const firmHkdfKey = await context.firmKeyProvider.getFirmHkdfKey(context.firmId);
  const subkey = await deriveIndexSubkey(
    firmHkdfKey,
    declaration.table,
    declaration.column,
    blindIndex.name,
  );
  const spec: BlindIndexSpec = {
    table: declaration.table,
    field: declaration.column,
    indexName: blindIndex.name,
    normalize: blindIndex.normalize,
    lengthBits: blindIndex.lengthBits,
  };
  return computeBlindIndex(subkey, spec, plaintext);
}

import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  composeProtectedWrite,
  readProtected,
  type ProtectedContext,
  type ProtectedReadContext,
} from "@magna-carta/data-access/protected-fields";
import { matterAssetIdentifierValue } from "@magna-carta/data-access/protected-field-registry";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterAssetId, MatterAssetIdentifierId } from "@magna-carta/identifiers/types";
import { readMatterAsset } from "./asset-statements.ts";
import {
  insertMatterAssetIdentifierStatement,
  readMatterAssetIdentifierSealedRow,
} from "./identifier-statements.ts";
import type { MatterAssetServiceOptions } from "./valuation-service.ts";
import {
  MatterAssetValidationError,
  assertIdentifierKind,
  assertIdentifierShape,
  assertNotCredentialName,
  displaySuffixOf,
} from "./validation.ts";

// A credential-adjacent identifier — a full account, policy, certificate, or tax number — sealed on
// write and readable in full only through the data-access decrypt chokepoint.
//
// TWO RULES BIND HERE AND NEITHER HAS AN ESCAPE HATCH.
//
// First, NO CREDENTIAL IS STORABLE. A password, passphrase, seed or recovery phrase, private key,
// personal identification number, or safe combination is refused by name before anything is written,
// with its own explainable code. A sealed column is decryptable by any member holding the decrypt
// permission, and for a self-custodied digital asset the seed phrase IS the asset: whoever reads it
// can take it, irreversibly, with no record. The correct home for a secret whose disclosure is a
// transfer of the asset is a sealed envelope in the custody register.
//
// Second, THERE IS ONE READ PATH FOR THE FULL VALUE and it is the platform's existing chokepoint:
// permission gate (absent → refusal, no decrypt, no audit) → an audit row committed BEFORE any
// plaintext → an AAD decrypt bound to the row. This module writes no second reader. Every other read
// in this package projects the four-character suffix, which is what a letter needs.

export interface RecordMatterAssetIdentifierInput {
  readonly assetId: MatterAssetId;
  // Free-form at this boundary on purpose: a caller asking to store a "seedPhrase" gets the
  // credential refusal by name rather than an unknown-value shrug from a schema.
  readonly kind: string;
  // The full number, sealed before it reaches storage. Optional — a firm may record no full number
  // at all, and the suffix alone is a complete and often preferable record.
  readonly value?: string | null;
  // Supplied only where no full value is given; otherwise it is derived from the value, so the two
  // cannot drift.
  readonly displaySuffix?: string | null;
}

export async function recordMatterAssetIdentifier(
  database: SqlDatabase,
  protectedContext: ProtectedContext,
  input: RecordMatterAssetIdentifierInput,
  options: MatterAssetServiceOptions,
): Promise<{ identifierId: MatterAssetIdentifierId; effect: EffectWrite }> {
  const kind = assertIdentifierKind(input.kind);
  const value = input.value ?? null;
  if (value !== null) assertNotCredentialName(value, "value");
  const suffix = value === null ? (input.displaySuffix ?? null) : displaySuffixOf(value);
  assertIdentifierShape(suffix, value);

  const asset = await readMatterAsset(database, input.assetId);
  if (asset === undefined) {
    throw new MatterAssetValidationError(
      "matter-asset-unknown-asset",
      "no such asset in this firm",
    );
  }

  const identifierId = newIdentifier("matterAssetIdentifier", options.randomSource);
  // Sealed BEFORE the statement is built, bound to (firm, table, column, row) so a ciphertext cannot
  // be replayed into another row or another column.
  const sealed =
    value === null
      ? null
      : await composeProtectedWrite(
          protectedContext,
          matterAssetIdentifierValue,
          identifierId,
          value,
        );

  const now = options.clock.now();
  return {
    identifierId,
    effect: {
      statements: [
        insertMatterAssetIdentifierStatement(database, {
          id: identifierId,
          assetId: input.assetId,
          kind,
          displaySuffix: suffix,
          valueCiphertext: sealed?.ciphertextValue ?? null,
          createdBy: options.actorUserId,
          now,
        }),
        // Identifiers and the kind only. Never the suffix, never the value.
        domainAuditStatement(database, {
          event: "matterAsset.identifier.recorded",
          subjectId: identifierId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: asset.matter_id, assetId: input.assetId, kind },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// The one full-value read. Returns null where the row holds no sealed value (a suffix-only record),
// and throws the chokepoint's forbidden error where the caller lacks the decrypt permission — a
// NAMED failure and never a blank, so nobody reads an empty field as "there is no account number".
export async function readMatterAssetIdentifierValue(
  context: ProtectedReadContext,
  identifierId: MatterAssetIdentifierId,
): Promise<string | null> {
  const row = await readMatterAssetIdentifierSealedRow(context.database, identifierId);
  if (row === undefined) {
    throw new MatterAssetValidationError(
      "matter-asset-unknown-identifier",
      "no such identifier in this firm",
    );
  }
  return readProtected(
    context,
    matterAssetIdentifierValue,
    { value_ciphertext: row.value_ciphertext },
    row.id,
  );
}

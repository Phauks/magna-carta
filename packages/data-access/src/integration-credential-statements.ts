import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { IntegrationCredentialId } from "@magna-carta/identifiers/types";
import { commitEffectBatch, type BatchDatabase } from "./effect-batch.ts";
import { integrationCredentialValue } from "./protected-field-registry.ts";
import {
  composeProtectedWrite,
  ProtectedReadForbiddenError,
  readProtected,
  type ProtectedContext,
  type ProtectedReadContext,
} from "./protected-fields.ts";

// A connected integration's credential store: a small key/value table addressed by the
// `credential_ref` an integration_connection row carries, whose values are always sealed at rest
// under the firm key. Written through the same protected-field chokepoint as every other encrypted
// column (the integrationCredentialValue declaration) and read back through readProtected, so a write
// seals with the firm key and a read is permission-gated (integrations:useConnection) and audited
// exactly like any protected read — the decrypt audit row commits before the plaintext returns.
//
// This module never logs a credential. The value is a bearer secret for an external account: it
// belongs on no telemetry path, in no error message, and in no audit metadata (the decrypt row
// records the field's identity and the actor, never the value).

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. integration_credential exists only in the per-firm database.
export const INTEGRATION_CREDENTIAL_TABLE = "integration_credential";

interface IntegrationCredentialRow {
  readonly id: string;
  readonly ciphertext: string;
}

async function readCredentialRow(
  database: BatchDatabase,
  credentialRef: string,
): Promise<IntegrationCredentialRow | undefined> {
  const { results } = await database
    .prepare(`SELECT id, ciphertext FROM ${INTEGRATION_CREDENTIAL_TABLE} WHERE credential_ref = ?1`)
    .bind(credentialRef)
    .all<IntegrationCredentialRow>();
  return results[0];
}

// Upserts a credential, sealing the value under the firm secrets key with the AAD bound to the row's
// id. An existing ref reuses its row id (so the stored ciphertext stays decryptable — the AAD binds
// to that id) and moves updated_at; a new ref mints one. That reuse is what makes reconnecting an
// account a rotation IN PLACE: the new credential overwrites the old at the same ref rather than
// leaving a revoked one behind under an orphaned row. Committed as a single atomic effect batch.
//
// No permission check here: storing a credential is a firm-scoped configuration action gated at the
// route that performs the connect, and the decrypt on read is what carries the
// integrations:useConnection gate and its audit.
export async function putIntegrationCredential(
  context: ProtectedContext & {
    readonly database: BatchDatabase;
    readonly clock: { now(): string };
  },
  credentialRef: string,
  value: string,
): Promise<void> {
  const existing = await readCredentialRow(context.database, credentialRef);
  const rowId: IntegrationCredentialId =
    existing === undefined
      ? newIdentifier("integrationCredential")
      : (existing.id as IntegrationCredentialId);
  const sealed = await composeProtectedWrite(context, integrationCredentialValue, rowId, value);
  const now = context.clock.now();

  const statement =
    existing === undefined
      ? context.database
          .prepare(
            `INSERT INTO ${INTEGRATION_CREDENTIAL_TABLE} (id, credential_ref, ciphertext, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)`,
          )
          .bind(rowId, credentialRef, sealed.ciphertextValue, now)
      : context.database
          .prepare(
            `UPDATE ${INTEGRATION_CREDENTIAL_TABLE} SET ciphertext = ?2, updated_at = ?3 WHERE id = ?1`,
          )
          .bind(rowId, sealed.ciphertextValue, now);

  await commitEffectBatch(
    context.database,
    { statements: [statement], outboxMessages: [] },
    { now: () => now },
  );
}

// Reads a credential. The integrations:useConnection gate is checked first (a caller without it is
// forbidden whether or not the ref exists, so non-existence is not leaked); an absent ref then yields
// null with NO decrypt and NO audit (a non-read). A present ref is decrypted through readProtected,
// which writes the decrypt audit row before returning the plaintext.
export async function getIntegrationCredential(
  context: ProtectedReadContext,
  credentialRef: string,
): Promise<string | null> {
  if (!context.effectivePermissions.has(integrationCredentialValue.permission)) {
    throw new ProtectedReadForbiddenError(integrationCredentialValue);
  }
  const row = await readCredentialRow(context.database, credentialRef);
  if (row === undefined) return null;
  return readProtected(context, integrationCredentialValue, { ciphertext: row.ciphertext }, row.id);
}

// Removes a credential. Disconnecting an account must not leave a revoked key sealed in the firm's
// database: the connection row going away is what a member sees, and a credential outliving it is a
// secret nothing points at any more. No permission check, for the same reason the write has none —
// the disconnect route is the gate, and deleting ciphertext reveals nothing.
export function deleteIntegrationCredentialStatement(
  database: BatchDatabase,
  credentialRef: string,
) {
  return database
    .prepare(`DELETE FROM ${INTEGRATION_CREDENTIAL_TABLE} WHERE credential_ref = ?1`)
    .bind(credentialRef);
}

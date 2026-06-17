import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmSecretId } from "@magna-carta/identifiers/types";
import { commitEffectBatch, type BatchDatabase } from "./effect-batch.ts";
import { firmSecretValue } from "./protected-field-registry.ts";
import {
  composeProtectedWrite,
  ProtectedReadForbiddenError,
  readProtected,
  type ProtectedContext,
  type ProtectedReadContext,
} from "./protected-fields.ts";

// The per-firm named-secret store: a small key/value table whose values are always sealed at rest
// under the firm secrets key. The core Worker decrypts and hands plaintext to plugin Workers; plugin
// Workers never see key material. A value is written through the same protected-field chokepoint as
// every other encrypted column (firmSecretValue declaration) and read back through readProtected, so
// putSecret seals with the firm key and getSecret is permission-gated (firm:manageSecrets) and
// audited exactly like any protected read (the decrypt audit row commits before the plaintext
// returns).

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. firm_secret exists only in the per-firm database.
export const FIRM_SECRET_TABLE = "firm_secret";

interface FirmSecretRow {
  readonly id: string;
  readonly ciphertext: string;
}

async function readSecretRow(
  database: BatchDatabase,
  name: string,
): Promise<FirmSecretRow | undefined> {
  const { results } = await database
    .prepare(`SELECT id, ciphertext FROM ${FIRM_SECRET_TABLE} WHERE name = ?1`)
    .bind(name)
    .all<FirmSecretRow>();
  return results[0];
}

// Upserts a named secret, sealing the value under the firm secrets key with the AAD bound to the
// secret's row id. An existing name reuses its row id (so the stored ciphertext stays decryptable —
// the AAD binds to that id) and moves updated_at; a new name mints a row id. Committed as a single
// atomic effect batch. No permission check here: writing a secret is a firm-scoped configuration
// action gated at the route; the decrypt on read is what carries the firm:manageSecrets gate + audit.
export async function putSecret(
  context: ProtectedContext & {
    readonly database: BatchDatabase;
    readonly clock: { now(): string };
  },
  name: string,
  value: string,
): Promise<void> {
  const existing = await readSecretRow(context.database, name);
  const rowId: FirmSecretId =
    existing === undefined ? newIdentifier("firmSecret") : (existing.id as FirmSecretId);
  const sealed = await composeProtectedWrite(context, firmSecretValue, rowId, value);
  const now = context.clock.now();

  const statement =
    existing === undefined
      ? context.database
          .prepare(
            `INSERT INTO ${FIRM_SECRET_TABLE} (id, name, ciphertext, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)`,
          )
          .bind(rowId, name, sealed.ciphertextValue, now)
      : context.database
          .prepare(`UPDATE ${FIRM_SECRET_TABLE} SET ciphertext = ?2, updated_at = ?3 WHERE id = ?1`)
          .bind(rowId, sealed.ciphertextValue, now);

  await commitEffectBatch(
    context.database,
    { statements: [statement], outboxMessages: [] },
    { now: () => now },
  );
}

// Reads a named secret. The firm:manageSecrets gate is checked first (a caller without it is
// forbidden whether or not the name exists, so non-existence is not leaked); an absent name then
// yields null with NO decrypt and NO audit (a non-read). A present name is decrypted through
// readProtected, which writes the decrypt audit row before returning the plaintext.
export async function getSecret(
  context: ProtectedReadContext,
  name: string,
): Promise<string | null> {
  if (!context.effectivePermissions.has(firmSecretValue.permission)) {
    throw new ProtectedReadForbiddenError(firmSecretValue);
  }
  const row = await readSecretRow(context.database, name);
  if (row === undefined) return null;
  return readProtected(context, firmSecretValue, { ciphertext: row.ciphertext }, row.id);
}

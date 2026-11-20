/*
 * One read of one bank connection: the bank's balances, then every line that changed since the last
 * read. Writes only the bank feed tables. Safe to run twice at once or to repeat after a failure:
 * every write is an upsert keyed by the provider's own ids, and the cursor advances only in the last
 * batch, after every line it covers is stored.
 */
import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { BankFeedPort } from "@magna-carta/bank-feeds/port";
import {
  markBankFeedTransactionRemovedStatement,
  recordBankSignInNeededStatement,
  recordBankSyncStatement,
  selectBankFeedAccountsOfConnectionStatement,
  upsertBankFeedAccountStatement,
  upsertBankFeedTransactionStatement,
  type BankConnectionRow,
} from "@magna-carta/bank-feeds/statements";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { BankFeedAccountId } from "@magna-carta/identifiers/types";
import type { CredentialStore } from "@magna-carta/integrations/credentials";
import { readBankAccessToken } from "./bank-credential-store.ts";

/**
 * How old a connection's last read may be before opening the Banking screen reads it again. Plaid
 * bills each live balance read, so this is the price of the figure being fresh, not a technical
 * limit.
 */
export const SYNC_AFTER_MINUTES = 30;

/** Statements per committed batch while storing a long first read. */
const BATCH_SIZE = 500;

export interface BankSyncPorts {
  readonly port: BankFeedPort;
  readonly credentials: CredentialStore;
  readonly database: BatchDatabase;
  readonly now: () => Date;
}

export type BankSyncOutcome = "synced" | "sign-in-needed" | "failed";

export function connectionIsStale(connection: BankConnectionRow, now: Date): boolean {
  if (connection.last_synced_at === null) return true;
  const age = now.getTime() - Date.parse(connection.last_synced_at);
  return !(age >= 0 && age < SYNC_AFTER_MINUTES * 60_000);
}

async function commitInBatches(
  database: BatchDatabase,
  statements: readonly SqlStatement[],
  now: () => string,
): Promise<void> {
  for (let start = 0; start < statements.length; start += BATCH_SIZE) {
    await commitEffectBatch(
      database,
      { statements: statements.slice(start, start + BATCH_SIZE), outboxMessages: [] },
      { now },
    );
  }
}

export async function syncBankConnection(
  ports: BankSyncPorts,
  connection: BankConnectionRow,
): Promise<BankSyncOutcome> {
  const { database, port } = ports;
  const instant = () => ports.now().toISOString();
  const accessToken = await readBankAccessToken(ports.credentials, connection.credential_ref);
  if (accessToken === null) return "failed";

  const signInNeeded = async (): Promise<BankSyncOutcome> => {
    await commitEffectBatch(
      database,
      {
        statements: [recordBankSignInNeededStatement(database, connection.id)],
        outboxMessages: [],
      },
      { now: instant },
    );
    return "sign-in-needed";
  };

  const accounts = await port.accounts(accessToken);
  if (!accounts.ok) return accounts.reason === "sign-in-needed" ? signInNeeded() : "failed";
  const now = instant();
  await commitInBatches(
    database,
    accounts.value.map((account) =>
      upsertBankFeedAccountStatement(database, {
        id: newIdentifier("bankFeedAccount"),
        connectionId: connection.id,
        account,
        now,
      }),
    ),
    instant,
  );

  const changes = await port.transactions(accessToken, connection.sync_cursor);
  if (!changes.ok) return changes.reason === "sign-in-needed" ? signInNeeded() : "failed";

  const { results } = await selectBankFeedAccountsOfConnectionStatement(
    database,
    connection.id,
  ).all<{ id: BankFeedAccountId; remote_account_id: string }>();
  const accountIds = new Map(results.map((row) => [row.remote_account_id, row.id]));
  const statements: SqlStatement[] = [];
  for (const transaction of [...changes.value.added, ...changes.value.modified]) {
    // A line on an account the bank did not list (one the sign-in left out) has nowhere to go.
    const accountId = accountIds.get(transaction.remoteAccountId);
    if (accountId === undefined) continue;
    statements.push(
      upsertBankFeedTransactionStatement(database, {
        id: newIdentifier("bankFeedTransaction"),
        accountId,
        transaction,
        now,
      }),
    );
  }
  for (const remoteTransactionId of changes.value.removed) {
    statements.push(
      markBankFeedTransactionRemovedStatement(database, connection.id, remoteTransactionId, now),
    );
  }
  // The cursor last, in the last batch: a failure before it leaves the next read to fetch the same
  // lines again, which the upserts absorb.
  statements.push(
    recordBankSyncStatement(database, connection.id, { cursor: changes.value.nextCursor, now }),
  );
  await commitInBatches(database, statements, instant);
  return "synced";
}

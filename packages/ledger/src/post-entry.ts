import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { LedgerAccountId, LedgerEntryId } from "@magna-carta/identifiers/types";
import { toMinor } from "@magna-carta/money/format";
import { balanceDelta } from "./normal-balance.ts";
import {
  applyBalanceDeltaStatement,
  insertEntryStatement,
  insertLineStatement,
  selectAccountSnapshotsStatement,
} from "./statements.ts";
import type { AccountSnapshot, AccountType, ClockPort, PostEntryInput } from "./types.ts";
import { validateEntry } from "./validate.ts";

export const LEDGER_ENTRY_POSTED_TOPIC = "ledger.entry.posted";
// One ordered outbox sequence per firm — total order for ledger consumers, cheap at per-firm scale.
export const LEDGER_AGGREGATE_KEY = "ledger";

export interface PostEntryOptions {
  readonly clock: ClockPort;
  readonly randomSource?: RandomSource; // fixtures pass the seeded source (ADR-0034)
}

export interface PostedEntry {
  readonly entryId: LedgerEntryId;
  readonly effect: EffectWrite;
}

interface SnapshotRow {
  id: string;
  type: AccountType;
  currency: string;
  active: number;
  has_children: number;
  has_balance_row: number;
}

export async function loadAccountSnapshots(
  database: SqlDatabase,
  accountIds: readonly LedgerAccountId[],
): Promise<Map<string, AccountSnapshot>> {
  const { results } = await selectAccountSnapshotsStatement(
    database,
    accountIds,
  ).all<SnapshotRow>();
  return new Map(
    results.map((row) => [
      row.id,
      {
        id: row.id as LedgerAccountId,
        type: row.type,
        currency: row.currency,
        active: row.active === 1,
        hasChildren: row.has_children === 1,
        hasBalanceRow: row.has_balance_row === 1,
      },
    ]),
  );
}

// Validate in memory, then COMPOSE statements — no logic runs mid-transaction (D1 single-batch
// reality, ADR-0063/0064 amendments). The caller commits via the data-access chokepoint
// (commitEffectBatch / runIdempotentEffect), which is what makes the write idempotency-capable.
export async function postEntry(
  database: SqlDatabase,
  input: PostEntryInput,
  options: PostEntryOptions,
): Promise<PostedEntry> {
  const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
  const accounts = await loadAccountSnapshots(database, accountIds);
  validateEntry(input, accounts, options.clock.today());
  return composePostedEntry(database, input, accounts, options, null);
}

// Shared with reverseEntry (which sets reversesEntryId). Exported for the sibling module, not for
// external callers — external entry points are postEntry/reverseEntry, which always validate first.
export function composePostedEntry(
  database: SqlDatabase,
  input: PostEntryInput,
  accounts: ReadonlyMap<string, AccountSnapshot>,
  options: PostEntryOptions,
  reversesEntryId: LedgerEntryId | null,
): PostedEntry {
  const recordedAt = options.clock.now();
  const entryId = newIdentifier("ledgerEntry", options.randomSource);

  const statements = [
    insertEntryStatement(database, {
      id: entryId,
      description: input.description,
      effectiveDate: input.effectiveDate,
      recordedAt,
      reversesEntryId,
    }),
    ...input.lines.map((line, lineIndex) =>
      insertLineStatement(database, {
        id: newIdentifier("ledgerLine", options.randomSource),
        entryId,
        accountId: line.accountId,
        lineIndex,
        direction: line.direction,
        amountMinor: toMinor(line.amount),
      }),
    ),
  ];

  // One balance UPDATE per touched account, deltas aggregated in normal-balance terms.
  const deltas = new Map<string, number>();
  for (const line of input.lines) {
    const account = accounts.get(line.accountId);
    if (!account) throw new Error(`unreachable: validated account missing ${line.accountId}`);
    const delta = balanceDelta(account.type, line.direction, toMinor(line.amount));
    deltas.set(line.accountId, (deltas.get(line.accountId) ?? 0) + delta);
  }
  for (const [accountId, delta] of deltas) {
    statements.push(
      applyBalanceDeltaStatement(database, accountId as LedgerAccountId, delta, recordedAt),
    );
  }

  const payload: Record<string, string> = { entryId };
  if (reversesEntryId) payload["reversesEntryId"] = reversesEntryId;
  const outboxMessages: OutboxMessage[] = [
    { topic: LEDGER_ENTRY_POSTED_TOPIC, payload, aggregateKey: LEDGER_AGGREGATE_KEY },
  ];

  return { entryId, effect: { statements, outboxMessages } };
}

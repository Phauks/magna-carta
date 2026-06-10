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
import type {
  AccountSnapshot,
  AccountType,
  ClockPort,
  EntryLineInput,
  PostEntryInput,
} from "./types.ts";
import { validateEntry } from "./validate.ts";

// toMinor is pure; the named helper makes "the line insert and the balance delta carry the SAME
// minor value" visible at both call sites instead of relying on the reader knowing purity.
const minorOf = (line: EntryLineInput): number => toMinor(line.amount);

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
  // An empty entry has no snapshots to load (and the snapshot statement rightly refuses an empty
  // IN-list) — validateEntry against the empty map throws the named too-few-lines refusal instead
  // of a programmer error surfacing from the read.
  const accounts =
    accountIds.length === 0
      ? new Map<string, AccountSnapshot>()
      : await loadAccountSnapshots(database, accountIds);
  validateEntry(input, accounts, options.clock.today());
  return composePostedEntry(database, input, accounts, options, null);
}

// Shared with reverseEntry (which sets reversesEntryId). Exported for the sibling module, not for
// external callers — external entry points are postEntry/reverseEntry, which always validate first.
// CONTRACT: callers pass the SAME accounts map they ran validateEntry against — its unknown-account
// check is what makes the per-line lookup below unreachable; a miss here is a programmer error
// (deliberately a plain Error, not a LedgerValidationError: nothing the caller's user can fix).
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
        amountMinor: minorOf(line),
      }),
    ),
  ];

  // One balance UPDATE per touched account, deltas aggregated in normal-balance terms. The leaf
  // check happened pre-batch (validateEntry) — a concurrent createAccount adding a child between
  // that read and this batch's commit is not re-checked in-batch (cross-row predicates cannot abort
  // a D1 batch); the sequential version of that hazard is closed on the creation side instead
  // (createAccount refuses a parent that already has postings), and the fitness queries re-prove
  // the invariant table-wide.
  // Aggregated in BigInt for the same reason validateEntry sums in BigInt: per-line deltas are
  // safe integers, their running sum near 2^53 is not. Number() at the statement boundary makes an
  // unsafe aggregate fail loud there (assertMinorUnits), never silently rounded.
  const deltas = new Map<string, bigint>();
  for (const line of input.lines) {
    const account = accounts.get(line.accountId);
    if (!account) throw new Error(`unreachable: validated account missing ${line.accountId}`);
    const delta = BigInt(balanceDelta(account.type, line.direction, minorOf(line)));
    deltas.set(line.accountId, (deltas.get(line.accountId) ?? 0n) + delta);
  }
  for (const [accountId, delta] of deltas) {
    statements.push(
      applyBalanceDeltaStatement(database, accountId as LedgerAccountId, Number(delta), recordedAt),
    );
  }

  const payload: Record<string, string> = { entryId };
  if (reversesEntryId) payload["reversesEntryId"] = reversesEntryId;
  const outboxMessages: OutboxMessage[] = [
    { topic: LEDGER_ENTRY_POSTED_TOPIC, payload, aggregateKey: LEDGER_AGGREGATE_KEY },
  ];

  return { entryId, effect: { statements, outboxMessages } };
}

import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { LedgerAccountId, LedgerEntryId } from "@magna-carta/identifiers/types";
import { fromMinor } from "@magna-carta/money/format";
import { currencyFromCode } from "@magna-carta/money/money";
import {
  composePostedEntry,
  loadAccountSnapshots,
  type PostedEntry,
  type PostEntryOptions,
} from "./post-entry.ts";
import {
  selectEntryStatement,
  selectLinesForEntryStatement,
  selectReversalOfStatement,
} from "./statements.ts";
import type { Direction, EntryLineInput, PostEntryInput } from "./types.ts";
import { LedgerValidationError, validateEntry } from "./validate.ts";

export interface ReverseEntryInput {
  readonly entryId: LedgerEntryId;
  readonly description: string;
  readonly effectiveDate: string;
}

interface LineRow {
  account_id: string;
  line_index: number;
  direction: Direction;
  amount_minor: number;
}

// Compose the EXACT mirror of an existing entry (directions flipped, amounts identical), linked via
// reverses_entry_id. The pre-check refuses politely; the UNIQUE index settles the concurrent race —
// the losing batch rolls back whole. Reversing a reversal is allowed (it re-instates the original).
// NOTE: re-validates via validateEntry, so a line on an inactive account would refuse — unreachable
// today (no closing service exists); revisit when account closing ships (corrections must always
// stay possible).
export async function reverseEntry(
  database: SqlDatabase,
  input: ReverseEntryInput,
  options: PostEntryOptions,
): Promise<PostedEntry> {
  const { results: entries } = await selectEntryStatement(database, input.entryId).all();
  if (entries.length === 0) {
    throw new LedgerValidationError("unknown-entry", `no such entry: ${input.entryId}`);
  }
  const { results: reversals } = await selectReversalOfStatement(database, input.entryId).all();
  if (reversals.length > 0) {
    throw new LedgerValidationError("already-reversed", `entry already reversed: ${input.entryId}`);
  }
  const { results: lines } = await selectLinesForEntryStatement(
    database,
    input.entryId,
  ).all<LineRow>();

  const accountIds = [...new Set(lines.map((line) => line.account_id))] as LedgerAccountId[];
  const accounts = await loadAccountSnapshots(database, accountIds);

  const mirroredLines: EntryLineInput[] = lines.map((line) => {
    // The map was built from this entry's own line account ids — a miss is corruption, the same
    // programmer-error class as composePostedEntry's unreachable guard (plain Error, not a
    // LedgerValidationError; nothing a caller's user can fix).
    const accountCurrency = accounts.get(line.account_id)?.currency;
    if (!accountCurrency) {
      throw new Error(`unreachable: account ${line.account_id} missing from snapshot`);
    }
    return {
      accountId: line.account_id as LedgerAccountId,
      direction: line.direction === "debit" ? ("credit" as const) : ("debit" as const),
      amount: fromMinor(line.amount_minor, currencyFromCode(accountCurrency)),
    };
  });

  const mirrored: PostEntryInput = {
    description: input.description,
    effectiveDate: input.effectiveDate,
    lines: mirroredLines,
  };
  // validateEntry enforces structural invariants only (ADR-0072). Balance-bound enforcement
  // (trust min bounds — ADR-0009) is deliberately deferred to the batch commit: if the mirror
  // would violate a bound (reversing a deposit whose funds were since disbursed), the CHECK
  // fires there and the whole batch rolls back — correct, but the error arrives from
  // commitEffectBatch, not from this function. Callers handle both error paths.
  validateEntry(mirrored, accounts, options.clock.today());
  return composePostedEntry(database, mirrored, accounts, options, input.entryId);
}

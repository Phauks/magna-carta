import { isPositive } from "@magna-carta/money/compare";
import { currencyCode, toMinor } from "@magna-carta/money/format";
import type { AccountSnapshot, PostEntryInput } from "./types.ts";

// Every refusal carries a stable machine-readable code: callers (API layer, fixtures assertions)
// branch on codes, never on message text. Codes for account creation and reversal live here too —
// one error type for the whole domain module.
export type LedgerValidationCode =
  | "too-few-lines"
  | "empty-description"
  | "invalid-effective-date"
  | "future-effective-date"
  | "non-positive-amount"
  | "unknown-account"
  | "inactive-account"
  | "non-leaf-account"
  | "missing-balance-row"
  | "currency-mismatch"
  | "unbalanced"
  | "empty-account-name"
  | "unknown-parent-account"
  | "parent-mismatch"
  | "unknown-entry"
  | "already-reversed";

export class LedgerValidationError extends Error {
  constructor(
    readonly code: LedgerValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "LedgerValidationError";
  }
}

const ISO_CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A real ISO calendar date — the round-trip catches rollovers like 2026-02-30 without a Temporal
// dependency (UTC parse, so no zone can shift the date).
export function isValidCalendarDate(date: string): boolean {
  if (!ISO_CALENDAR_DATE.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

// The ledger invariants (ADR-0072) — what makes the ledger a ledger; consumer rules (trust
// bounds values, period close) bind elsewhere. Pure: accounts arrive as pre-loaded snapshots.
export function validateEntry(
  input: PostEntryInput,
  accounts: ReadonlyMap<string, AccountSnapshot>,
  today: string,
): void {
  if (input.lines.length < 2) {
    throw new LedgerValidationError("too-few-lines", "an entry needs at least 2 lines");
  }
  if (input.description.trim().length === 0) {
    throw new LedgerValidationError("empty-description", "an entry needs a description");
  }
  if (!isValidCalendarDate(input.effectiveDate)) {
    throw new LedgerValidationError(
      "invalid-effective-date",
      `not a calendar date (YYYY-MM-DD): ${input.effectiveDate}`,
    );
  }
  // ISO dates compare lexicographically. Backdating is by design; future-dating is not — a ledger
  // records what happened (scheduled transactions are a workflow concern, Phase 3+).
  if (input.effectiveDate > today) {
    throw new LedgerValidationError(
      "future-effective-date",
      `effective date ${input.effectiveDate} is after today (${today})`,
    );
  }

  // Sum-to-zero over signed minor units: integers are exact and the money sum() cannot express an
  // empty side. No rounding occurs — ADR-0061 holds.
  let net = 0;
  let entryCurrency: string | undefined;
  for (const line of input.lines) {
    if (!isPositive(line.amount)) {
      throw new LedgerValidationError("non-positive-amount", "line amounts must be positive");
    }
    const account = accounts.get(line.accountId);
    if (!account) {
      throw new LedgerValidationError("unknown-account", `no such account: ${line.accountId}`);
    }
    if (!account.active) {
      throw new LedgerValidationError("inactive-account", `account is closed: ${account.id}`);
    }
    if (account.hasChildren) {
      throw new LedgerValidationError(
        "non-leaf-account",
        `postings land on leaf accounts; ${account.id} has children (parents are roll-ups)`,
      );
    }
    if (!account.hasBalanceRow) {
      throw new LedgerValidationError(
        "missing-balance-row",
        `account ${account.id} has no balance row — corruption, refusing to post`,
      );
    }
    const lineCurrency = currencyCode(line.amount);
    if (lineCurrency !== account.currency) {
      throw new LedgerValidationError(
        "currency-mismatch",
        `line currency ${lineCurrency} != account currency ${account.currency}`,
      );
    }
    entryCurrency ??= lineCurrency;
    if (lineCurrency !== entryCurrency) {
      throw new LedgerValidationError("currency-mismatch", "all lines must share one currency");
    }
    const minor = toMinor(line.amount);
    net += line.direction === "debit" ? minor : -minor;
  }
  if (net !== 0) {
    throw new LedgerValidationError("unbalanced", `entry does not balance (net ${net} minor)`);
  }
}

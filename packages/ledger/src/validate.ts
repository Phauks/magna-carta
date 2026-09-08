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
  | "entry-too-large"
  | "unknown-account"
  | "inactive-account"
  | "non-leaf-account"
  | "missing-balance-row"
  | "currency-mismatch"
  | "unbalanced"
  | "empty-account-name"
  | "unknown-account-type"
  | "unsupported-currency"
  | "unknown-parent-account"
  | "parent-mismatch"
  | "parent-has-postings"
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

// The exactness cap: the sum of ALL line magnitudes in one entry must stay ≤ 2^53 - 1. Doubles
// add integers exactly while the true sum stays in that range, so under the cap every partial sum
// here (the net) AND every per-account delta aggregation in composePostedEntry — a subset of the
// same contributions — is provably exact in plain number arithmetic; past it, float rounding could
// hide a real imbalance or land a silently wrong balance. No honest entry comes near it (~$90T of
// total line magnitude): only corrupt or malicious input does, and that is refused by name rather
// than computed. Mirrors the money package's posture — amounts at this scale are out-of-domain,
// fail loud.
export const MAX_ENTRY_MAGNITUDE_MINOR = Number.MAX_SAFE_INTEGER;

// A real ISO calendar date — the shape, and the day actually being on the calendar so a rollover
// like 2026-02-30 is caught. Both, and the exclusion of year 0000 this package's own validator once
// carried alone, are @magna-carta/civil-time's; the ledger's name for it is kept because the
// invariants below and their tests read in the ledger's own vocabulary.
import { isCivilDate } from "@magna-carta/civil-time/civil-date";

export { isCivilDate as isValidCalendarDate };

// The ledger invariants — what makes the ledger a ledger; consumer rules (trust
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
  if (!isCivilDate(input.effectiveDate)) {
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

  // Sum-to-zero over signed minor units. Each amount is a safe integer (money() asserts it) and
  // the magnitude cap keeps every running sum below 2^53, where integer float addition is exact —
  // the no-rounding promise holds at the aggregate BECAUSE the cap is checked first.
  let magnitude = 0;
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
    // Checked BEFORE adding (both operands ≤ 2^53 - 1, so the subtraction is exact too): after
    // this guard, magnitude + minor cannot leave the exact-integer range.
    if (minor > MAX_ENTRY_MAGNITUDE_MINOR - magnitude) {
      throw new LedgerValidationError(
        "entry-too-large",
        `entry line magnitudes exceed the exactness cap (${MAX_ENTRY_MAGNITUDE_MINOR} minor total)`,
      );
    }
    magnitude += minor;
    net += line.direction === "debit" ? minor : -minor;
  }
  if (net !== 0) {
    throw new LedgerValidationError("unbalanced", `entry does not balance (net ${net} minor)`);
  }
}

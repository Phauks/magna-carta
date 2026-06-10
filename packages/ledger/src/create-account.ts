import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import { isRegisteredCurrencyCode } from "@magna-carta/money/money";
import { loadAccountSnapshots } from "./post-entry.ts";
import {
  insertAccountStatement,
  insertBalanceRowStatement,
  selectAccountHasLinesStatement,
} from "./statements.ts";
import { ACCOUNT_TYPES, type AccountType, type ClockPort } from "./types.ts";
import { LedgerValidationError } from "./validate.ts";

export interface CreateAccountInput {
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly parentAccountId?: LedgerAccountId;
}

export interface CreatedAccount {
  readonly accountId: LedgerAccountId;
  readonly effect: EffectWrite;
}

// Account + its balance row commit together: postings may assume the row exists (validateEntry
// surfaces a missing one as corruption). No outbox message — account creation has no external
// consequence yet (YAGNI; the seam is one OutboxMessage away).
export async function createAccount(
  database: SqlDatabase,
  input: CreateAccountInput,
  options: { clock: ClockPort; randomSource?: RandomSource },
): Promise<CreatedAccount> {
  if (input.name.trim().length === 0) {
    throw new LedgerValidationError("empty-account-name", "an account needs a name");
  }
  // Compile-time AccountType does not survive untyped callers (a future API layer); the DDL CHECK
  // is the last line of defense, this is the polite one with a named code.
  if (!ACCOUNT_TYPES.includes(input.type)) {
    throw new LedgerValidationError(
      "unknown-account-type",
      `not an account type: ${String(input.type)} (one of: ${ACCOUNT_TYPES.join(", ")})`,
    );
  }
  // The currency must resolve in the money registry: a typo'd code ('usd', '') would commit an
  // account no Money value can ever match — permanently unpostable, and append-only means no
  // account-update path could ever repair it. Refused at the only door it can enter through.
  if (!isRegisteredCurrencyCode(input.currency)) {
    throw new LedgerValidationError(
      "unsupported-currency",
      `not a registered currency code: ${input.currency}`,
    );
  }
  if (input.parentAccountId) {
    const parents = await loadAccountSnapshots(database, [input.parentAccountId]);
    const parent = parents.get(input.parentAccountId);
    if (!parent) {
      throw new LedgerValidationError(
        "unknown-parent-account",
        `no such parent account: ${input.parentAccountId}`,
      );
    }
    if (parent.type !== input.type || parent.currency !== input.currency) {
      throw new LedgerValidationError(
        "parent-mismatch",
        "a child account must share its parent's type and currency",
      );
    }
    // Unreachable until the account-closing service exists (no account is inactive today), but the
    // snapshot already carries the flag — a closed account must never gain children.
    if (!parent.active) {
      throw new LedgerValidationError(
        "inactive-account",
        `parent account is closed: ${input.parentAccountId}`,
      );
    }
    // The leaf-only invariant, enforced on the creation side (the posting side checks
    // has_children pre-batch): a parent with direct postings would strand them outside
    // every child roll-up.
    // TOCTOU: a concurrent postEntry could commit a line on this account between this read and the
    // batch commit — both sides' pre-checks pass simultaneously (cross-row predicates cannot abort
    // a D1 batch; the mirror of the race acknowledged in composePostedEntry).
    // parentAccountsWithPostingsStatement (fitness.ts) re-proves the leaf-only invariant table-wide.
    const { results } = await selectAccountHasLinesStatement(database, input.parentAccountId).all<{
      has_lines: number;
    }>();
    if (results[0]?.has_lines === 1) {
      throw new LedgerValidationError(
        "parent-has-postings",
        `account ${input.parentAccountId} already carries postings and cannot become a parent`,
      );
    }
  }
  const createdAt = options.clock.now();
  const accountId = newIdentifier("ledgerAccount", options.randomSource);
  return {
    accountId,
    effect: {
      statements: [
        insertAccountStatement(database, {
          id: accountId,
          name: input.name,
          type: input.type,
          currency: input.currency,
          parentAccountId: input.parentAccountId ?? null,
          createdAt,
        }),
        insertBalanceRowStatement(database, accountId, createdAt),
      ],
      outboxMessages: [],
    },
  };
}

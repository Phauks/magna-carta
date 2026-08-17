import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  TrustAccountId,
  TrustBankStatementId,
  TrustBankStatementLineId,
  UserId,
} from "@magna-carta/identifiers/types";
import { currencyCode, toMinor } from "@magna-carta/money/format";
import type { Money } from "@magna-carta/money/money";
import { loadTrustAccount, type TrustServiceOptions } from "./account-tree.ts";
import {
  insertTrustBankStatementLineStatement,
  insertTrustBankStatementStatement,
  MAX_TRUST_RECONCILIATION_ROWS,
  selectTrustBankStatementLinesStatement,
  selectTrustBankStatementStatement,
  selectTrustBankStatementsForAccountStatement,
} from "./statements.ts";
import { TrustValidationError } from "./trust-validation.ts";
import type {
  TrustBankStatementLineDirection,
  TrustBankStatementLineSnapshot,
  TrustBankStatementSnapshot,
  TrustBankStatementSource,
} from "./types.ts";

// The bank's side of the money. Every other table in this package is the firm's own assertion about
// its own records; this is the only place the institution's version arrives, which is why it is the
// only place an item the firm never recorded — a bank fee, a returned deposit, a forged check — can
// be seen at all. The no-negative floor guards the firm's book and cannot guard the bank.
//
// A statement is recorded, never edited. When a bank reissues a period, the corrected figures are a
// NEW statement naming the one it supersedes, because a reconciliation that already closed against
// the original attested to the figures as they then read, and an attestation about a moment cannot
// be rewritten afterwards.
//
// A CLOSED trust account still takes statements. The last statement of an account almost always
// arrives after the account was closed, and refusing it would leave the final period unreconciled —
// exactly the period a firm most needs to be able to prove.

// The widest a single statement may be. A month on one trust account is hundreds of items; this is
// the ceiling that keeps one request's batch inside what a handler should be composing at all.
export const MAX_TRUST_BANK_STATEMENT_LINES = 2_000;

interface BankStatementRow {
  id: string;
  trust_account_id: string;
  period_start: string;
  period_end: string;
  opening_balance_minor: number;
  closing_balance_minor: number;
  currency: string;
  statement_reference: string | null;
  source: TrustBankStatementSource;
  supersedes_statement_id: string | null;
  recorded_by: string;
  recorded_at: string;
}

interface BankStatementLineRow {
  id: string;
  statement_id: string;
  posted_on: string;
  direction: TrustBankStatementLineDirection;
  amount_minor: number;
  description: string;
  reference: string | null;
  counterparty_name: string | null;
  source_row_number: number | null;
}

function toStatementSnapshot(row: BankStatementRow): TrustBankStatementSnapshot {
  return {
    id: row.id as TrustBankStatementId,
    trustAccountId: row.trust_account_id as TrustAccountId,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    openingBalanceMinor: row.opening_balance_minor,
    closingBalanceMinor: row.closing_balance_minor,
    currency: row.currency,
    statementReference: row.statement_reference,
    source: row.source,
    supersedesStatementId: row.supersedes_statement_id as TrustBankStatementId | null,
    recordedBy: row.recorded_by as UserId,
    recordedAt: row.recorded_at,
  };
}

function toLineSnapshot(row: BankStatementLineRow): TrustBankStatementLineSnapshot {
  return {
    id: row.id as TrustBankStatementLineId,
    statementId: row.statement_id as TrustBankStatementId,
    postedOn: row.posted_on,
    direction: row.direction,
    amountMinor: row.amount_minor,
    description: row.description,
    reference: row.reference,
    counterpartyName: row.counterparty_name,
    sourceRowNumber: row.source_row_number,
  };
}

// `.all()` + `results[0]`, never `.first()` — the one-row read convention (one sentinel for
// "no row"), stated in packages/data-access/src/idempotency-statements.ts.
export async function readTrustBankStatement(
  database: SqlDatabase,
  statementId: TrustBankStatementId,
): Promise<TrustBankStatementSnapshot> {
  const { results } = await selectTrustBankStatementStatement(
    database,
    statementId,
  ).all<BankStatementRow>();
  const row = results[0];
  if (!row) {
    throw new TrustValidationError(
      "unknown-trust-bank-statement",
      `no such trust bank statement: ${statementId}`,
    );
  }
  return toStatementSnapshot(row);
}

export async function readTrustBankStatements(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<readonly TrustBankStatementSnapshot[]> {
  const { results } = await selectTrustBankStatementsForAccountStatement(
    database,
    trustAccountId,
  ).all<BankStatementRow>();
  return results.map(toStatementSnapshot);
}

export async function readTrustBankStatementLines(
  database: SqlDatabase,
  statementId: TrustBankStatementId,
): Promise<readonly TrustBankStatementLineSnapshot[]> {
  const { results } = await selectTrustBankStatementLinesStatement(
    database,
    statementId,
  ).all<BankStatementLineRow>();
  return results.map(toLineSnapshot);
}

export interface TrustBankStatementLineInput {
  readonly postedOn: string; // YYYY-MM-DD civil date, as the bank posted it
  readonly direction: TrustBankStatementLineDirection;
  readonly amount: Money;
  readonly description: string;
  readonly reference?: string | null;
  readonly counterpartyName?: string | null;
  // The row of the imported file this line came from, and absent on a line a member typed.
  readonly sourceRowNumber?: number | null;
}

export interface RecordTrustBankStatementInput {
  readonly trustAccountId: TrustAccountId;
  readonly periodStart: string; // YYYY-MM-DD civil date
  readonly periodEnd: string; // YYYY-MM-DD civil date
  // Signed, and no sign is refused: an overdrawn trust bank account is precisely the condition a
  // reconciliation exists to surface, and a schema that would not record it would not surface it.
  readonly openingBalance: Money;
  readonly closingBalance: Money;
  readonly statementReference?: string | null;
  readonly source: TrustBankStatementSource;
  readonly supersedesStatementId?: TrustBankStatementId | null;
  readonly lines: readonly TrustBankStatementLineInput[];
  readonly recordedBy: UserId;
}

export interface ComposedTrustBankStatement {
  readonly statementId: TrustBankStatementId;
  readonly lineIds: readonly TrustBankStatementLineId[];
  readonly effect: EffectWrite;
}

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

// The statement and every one of its lines in ONE batch. A statement that committed without its
// lines would read as a period in which the bank reported balances and no transactions, which is a
// shape a reconciliation cannot tell apart from a genuinely empty month.
export async function composeTrustBankStatement(
  database: SqlDatabase,
  input: RecordTrustBankStatementInput,
  options: TrustServiceOptions,
): Promise<ComposedTrustBankStatement> {
  const account = await loadTrustAccount(database, input.trustAccountId);

  if (!CIVIL_DATE.test(input.periodStart) || !CIVIL_DATE.test(input.periodEnd)) {
    throw new TrustValidationError(
      "statement-period-invalid",
      `a statement period is two civil dates in YYYY-MM-DD form; received ${input.periodStart} to ${input.periodEnd}`,
    );
  }
  if (input.periodEnd < input.periodStart) {
    throw new TrustValidationError(
      "statement-period-invalid",
      `a statement period ends on or after it begins; received ${input.periodStart} to ${input.periodEnd}`,
    );
  }
  for (const balance of [input.openingBalance, input.closingBalance]) {
    if (currencyCode(balance) !== account.currency) {
      throw new TrustValidationError(
        "statement-currency-mismatch",
        `a ${currencyCode(balance)} statement cannot describe a ${account.currency} trust account`,
      );
    }
  }
  if (input.lines.length === 0) {
    throw new TrustValidationError(
      "statement-has-no-lines",
      "a bank statement records at least one line; a period the bank reported as empty is recorded as such by the firm, not inferred from an empty request",
    );
  }
  if (input.lines.length > MAX_TRUST_BANK_STATEMENT_LINES) {
    throw new TrustValidationError(
      "statement-too-many-lines",
      `a bank statement records at most ${MAX_TRUST_BANK_STATEMENT_LINES} lines; ${input.lines.length} were supplied`,
    );
  }
  for (const [index, line] of input.lines.entries()) {
    if (currencyCode(line.amount) !== account.currency) {
      throw new TrustValidationError(
        "statement-currency-mismatch",
        `line ${index + 1} is in ${currencyCode(line.amount)}; this trust account holds ${account.currency}`,
      );
    }
    if (toMinor(line.amount) <= 0) {
      throw new TrustValidationError(
        "statement-period-invalid",
        `line ${index + 1} carries no amount; a statement line's direction says which way it went and its amount is always positive`,
      );
    }
    // A line dated outside the period it is filed under is either a typo or the wrong file, and
    // both are worth refusing now: a reconciliation over a period whose lines are not that period's
    // proves nothing about that period. The import preview reports the same condition per row,
    // before anything is stored.
    if (line.postedOn < input.periodStart || line.postedOn > input.periodEnd) {
      throw new TrustValidationError(
        "statement-line-outside-period",
        `line ${index + 1} is posted ${line.postedOn}, outside the ${input.periodStart} to ${input.periodEnd} period this statement covers`,
      );
    }
  }

  if (input.supersedesStatementId != null) {
    const superseded = await readTrustBankStatement(database, input.supersedesStatementId);
    if (superseded.trustAccountId !== account.id) {
      throw new TrustValidationError(
        "statement-supersedes-other-account",
        `${input.supersedesStatementId} belongs to a different trust account and cannot be superseded by this one`,
      );
    }
    // The UNIQUE index is the guarantee — two corrections racing leave one, and the loser's whole
    // batch aborts. This read is the refusal that names what happened.
    const existing = await readTrustBankStatements(database, account.id);
    if (existing.some((row) => row.supersedesStatementId === input.supersedesStatementId)) {
      throw new TrustValidationError(
        "statement-already-superseded",
        `${input.supersedesStatementId} has already been superseded; supersede the correction instead`,
      );
    }
  }

  const statementId = newIdentifier("trustBankStatement", options.randomSource);
  const recordedAt = options.clock.now();
  const lineIds = input.lines.map(() =>
    newIdentifier("trustBankStatementLine", options.randomSource),
  );

  return {
    statementId,
    lineIds,
    effect: {
      statements: [
        insertTrustBankStatementStatement(database, {
          id: statementId,
          trustAccountId: account.id,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          openingBalanceMinor: toMinor(input.openingBalance),
          closingBalanceMinor: toMinor(input.closingBalance),
          currency: account.currency,
          statementReference: input.statementReference ?? null,
          source: input.source,
          supersedesStatementId: input.supersedesStatementId ?? null,
          recordedBy: input.recordedBy,
          recordedAt,
        }),
        ...input.lines.map((line, index) =>
          insertTrustBankStatementLineStatement(database, {
            id: lineIds[index] as TrustBankStatementLineId,
            statementId,
            postedOn: line.postedOn,
            direction: line.direction,
            amountMinor: toMinor(line.amount),
            description: line.description,
            reference: line.reference ?? null,
            counterpartyName: line.counterpartyName ?? null,
            sourceRowNumber: line.sourceRowNumber ?? null,
            recordedAt,
          }),
        ),
      ],
      outboxMessages: [],
    },
  };
}

// Re-exported so a caller bounding its own page size uses the same ceiling the reads do rather than
// inventing a second one.
export { MAX_TRUST_RECONCILIATION_ROWS };

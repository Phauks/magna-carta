import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  LedgerEntryId,
  TrustBankStatementLineId,
  TrustReconciliationId,
  TrustReconciliationMatchId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { TrustServiceOptions } from "./account-tree.ts";
import { readTrustBankStatementLines } from "./bank-statements.ts";
import { readTrustReconciliation } from "./reconciliation.ts";
import {
  insertTrustReconciliationMatchStatement,
  selectActiveTrustReconciliationMatchesStatement,
  selectTrustReconciliationMatchStatement,
} from "./statements.ts";
import { readOutstandingTrustBankItems } from "./three-way-proof.ts";
import { TrustValidationError } from "./trust-validation.ts";
import type {
  TrustBankItem,
  TrustBankStatementLineSnapshot,
  TrustMatchSignal,
  TrustMatchSuggestion,
  TrustReconciliationMatchSnapshot,
} from "./types.ts";

// Matching a bank statement line to something the firm recorded.
//
// NOTHING HERE MATCHES ANYTHING. `suggestTrustStatementMatches` returns candidates and the reasons
// it considers them candidates; a match exists only when a member names both ends through
// `composeTrustReconciliationMatch`. That is not caution about an unfinished feature — a wrong
// automatic match is the single most damaging thing this subsystem could do, because it makes the
// totals tie out while the ledger and the bank disagree about which events actually happened, and
// the reconciliation then certifies the discrepancy it exists to find. A person confirming forty
// obvious pairs is the cost; the alternative is a report nobody can rely on.
//
// UNMATCHED IS AN OUTCOME, NOT A FAILURE. An unmatched statement line is very often the bank fee,
// the returned deposit, or the check the firm never recorded — the item the no-negative floor cannot
// see and the reason reconciliation is a correctness feature rather than a report. An unmatched
// recorded item is a deposit in transit or an outstanding check. Both are first-class, both are
// named in the proof, and neither is anything a caller has to clear before closing.

// How many candidates one line is offered. A person choosing among five is choosing; a person
// scrolling ninety is confirming whatever is at the top, which is automatic matching with extra
// steps.
export const MAX_TRUST_MATCH_SUGGESTIONS_PER_LINE = 5;

// How far apart the bank's posting date and the firm's effective date may be and still be the same
// event. A check written at the end of one month and cleared in the next is ordinary; two months is
// not a coincidence worth suggesting.
export const TRUST_MATCH_WINDOW_DAYS = 45;

export interface TrustMatchSuggestionOptions {
  readonly maxPerLine?: number;
  readonly windowDays?: number;
}

const MILLISECONDS_PER_DAY = 86_400_000;

// Both dates are civil dates with no time part, so this is exact date arithmetic rather than a
// duration in a time zone — the two values never carry one.
function dayGapBetween(bankDate: string, bookDate: string): number {
  const bank = Date.parse(`${bankDate}T00:00:00Z`);
  const book = Date.parse(`${bookDate}T00:00:00Z`);
  if (Number.isNaN(bank) || Number.isNaN(book)) return Number.POSITIVE_INFINITY;
  return Math.round((bank - book) / MILLISECONDS_PER_DAY);
}

function normalizeName(value: string | null): string {
  return (value ?? "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

// Deliberately blunt: one name contains the other, on normalized text, and only when both are long
// enough that a containment is not an accident. It is a REASON shown to a person, never a threshold
// that decides anything, so a cleverer similarity would buy nothing and would be harder to explain
// on a screen.
function namesLookSimilar(bank: string | null, book: string | null): boolean {
  const left = normalizeName(bank);
  const right = normalizeName(book);
  if (left.length < 4 || right.length < 4) return false;
  return left.includes(right) || right.includes(left);
}

// One line's candidates, ranked. The amount must match exactly and the direction must correspond —
// those two are the bound that keeps the candidate set small and reviewable, not a scoring weight.
// Everything else is a reason a person can check against the two rows in front of them.
function suggestionsForLine(
  line: TrustBankStatementLineSnapshot,
  items: readonly TrustBankItem[],
  maxPerLine: number,
  windowDays: number,
): TrustMatchSuggestion[] {
  const wanted = line.direction === "deposit" ? 1 : -1;
  const candidates: TrustMatchSuggestion[] = [];

  for (const item of items) {
    if (Math.sign(item.bankDeltaMinor) !== wanted) continue;
    if (Math.abs(item.bankDeltaMinor) !== line.amountMinor) continue;
    const dayGap = dayGapBetween(line.postedOn, item.effectiveDate);
    if (!Number.isFinite(dayGap) || Math.abs(dayGap) > windowDays) continue;

    const signals: TrustMatchSignal[] = ["amount-equal"];
    signals.push(dayGap === 0 ? "same-day" : "within-window");
    if (
      line.reference !== null &&
      item.reference !== null &&
      line.reference.trim() !== "" &&
      line.reference.trim() === item.reference.trim()
    ) {
      signals.push("reference-equal");
    }
    if (namesLookSimilar(line.counterpartyName, item.counterpartyName)) {
      signals.push("counterparty-similar");
    }
    candidates.push({ statementLineId: line.id, entryId: item.entryId, signals, dayGap });
  }

  return candidates
    .sort((left, right) => {
      if (left.signals.length !== right.signals.length) {
        return right.signals.length - left.signals.length;
      }
      if (Math.abs(left.dayGap) !== Math.abs(right.dayGap)) {
        return Math.abs(left.dayGap) - Math.abs(right.dayGap);
      }
      // A stable tail, so the same data always offers the same list in the same order — a suggestion
      // list that reshuffles between two reads is one a person stops reading.
      return left.entryId < right.entryId ? -1 : 1;
    })
    .slice(0, maxPerLine);
}

// Pure, and takes the two lists rather than a database, so the whole ranking is testable against
// fixed data and nothing about it can reach a write path.
export function suggestTrustStatementMatches(
  lines: readonly TrustBankStatementLineSnapshot[],
  items: readonly TrustBankItem[],
  options: TrustMatchSuggestionOptions = {},
): readonly TrustMatchSuggestion[] {
  const maxPerLine = options.maxPerLine ?? MAX_TRUST_MATCH_SUGGESTIONS_PER_LINE;
  const windowDays = options.windowDays ?? TRUST_MATCH_WINDOW_DAYS;
  return lines.flatMap((line) => suggestionsForLine(line, items, maxPerLine, windowDays));
}

// The suggestion surface a caller shows: the lines this reconciliation has not accounted for, the
// items it has not accounted for, and the candidate pairings between them. Three reads, no fan.
export async function readTrustMatchSuggestions(
  database: SqlDatabase,
  reconciliationId: TrustReconciliationId,
  options: TrustMatchSuggestionOptions = {},
): Promise<{
  unmatchedLines: readonly TrustBankStatementLineSnapshot[];
  outstandingItems: readonly TrustBankItem[];
  suggestions: readonly TrustMatchSuggestion[];
}> {
  const reconciliation = await readTrustReconciliation(database, reconciliationId);
  const [lines, items, matches] = await Promise.all([
    readTrustBankStatementLines(database, reconciliation.statementId),
    readOutstandingTrustBankItems(database, reconciliation),
    readActiveTrustReconciliationMatches(database, reconciliationId),
  ]);
  const matchedLineIds = new Set(matches.map((match) => match.statementLineId));
  const unmatchedLines = lines.filter((line) => !matchedLineIds.has(line.id));
  return {
    unmatchedLines,
    outstandingItems: items,
    suggestions: suggestTrustStatementMatches(unmatchedLines, items, options),
  };
}

interface MatchRow {
  id: string;
  reconciliation_id: string;
  statement_line_id: string;
  entry_id: string;
  unmatches_match_id: string | null;
  unmatched_by_match_id: string | null;
  matched_by: string;
  matched_at: string;
}

function toMatchSnapshot(row: MatchRow): TrustReconciliationMatchSnapshot {
  return {
    id: row.id as TrustReconciliationMatchId,
    reconciliationId: row.reconciliation_id as TrustReconciliationId,
    statementLineId: row.statement_line_id as TrustBankStatementLineId,
    entryId: row.entry_id as LedgerEntryId,
    unmatchesMatchId: row.unmatches_match_id as TrustReconciliationMatchId | null,
    unmatchedByMatchId: row.unmatched_by_match_id as TrustReconciliationMatchId | null,
    matchedBy: row.matched_by as UserId,
    matchedAt: row.matched_at,
  };
}

export async function readTrustReconciliationMatch(
  database: SqlDatabase,
  matchId: TrustReconciliationMatchId,
): Promise<TrustReconciliationMatchSnapshot> {
  const { results } = await selectTrustReconciliationMatchStatement(
    database,
    matchId,
  ).all<MatchRow>();
  const row = results[0];
  if (!row) {
    throw new TrustValidationError(
      "unknown-trust-reconciliation-match",
      `no such trust reconciliation match: ${matchId}`,
    );
  }
  return toMatchSnapshot(row);
}

export async function readActiveTrustReconciliationMatches(
  database: SqlDatabase,
  reconciliationId: TrustReconciliationId,
): Promise<readonly TrustReconciliationMatchSnapshot[]> {
  const { results } = await selectActiveTrustReconciliationMatchesStatement(
    database,
    reconciliationId,
  ).all<MatchRow>();
  return results.map(toMatchSnapshot);
}

export interface RecordTrustMatchInput {
  readonly reconciliationId: TrustReconciliationId;
  readonly statementLineId: TrustBankStatementLineId;
  readonly entryId: LedgerEntryId;
  readonly matchedBy: UserId;
}

export interface ComposedTrustMatch {
  readonly matchId: TrustReconciliationMatchId;
  readonly effect: EffectWrite;
}

// A member's assertion that this line and this entry are the same event. BOTH ends are named by the
// caller; there is no overload that takes a suggestion, on purpose, because the moment one existed
// a caller could pass the top suggestion in a loop and the human confirmation would be gone without
// anything in this file having changed.
export async function composeTrustReconciliationMatch(
  database: SqlDatabase,
  input: RecordTrustMatchInput,
  options: TrustServiceOptions,
): Promise<ComposedTrustMatch> {
  const reconciliation = await readTrustReconciliation(database, input.reconciliationId);
  if (reconciliation.status !== "open") {
    throw new TrustValidationError(
      "reconciliation-closed",
      "this reconciliation is closed; what it matched is part of what it attested to, so open a new one rather than changing it",
    );
  }

  const lines = await readTrustBankStatementLines(database, reconciliation.statementId);
  if (!lines.some((line) => line.id === input.statementLineId)) {
    throw new TrustValidationError(
      "unknown-trust-bank-statement-line",
      `${input.statementLineId} is not a line on the statement this reconciliation covers`,
    );
  }

  // One line to one entry, in this reconciliation. The database cannot express it — active-ness is
  // derived from the absence of a withdrawal row, not from a column — so it is checked here and
  // re-proved over stored rows by the fitness suite, exactly as the hold model's is.
  const active = await readActiveTrustReconciliationMatches(database, input.reconciliationId);
  if (active.some((match) => match.statementLineId === input.statementLineId)) {
    throw new TrustValidationError(
      "statement-line-already-matched",
      `${input.statementLineId} is already matched in this reconciliation; withdraw that match before recording another`,
    );
  }
  if (active.some((match) => match.entryId === input.entryId)) {
    throw new TrustValidationError(
      "ledger-entry-already-matched",
      `${input.entryId} is already matched in this reconciliation; withdraw that match before recording another`,
    );
  }

  // That the entry belongs to this account's trust bank is a TRIGGER, and stays one: a route is one
  // code path among several that will reach this table. Reading the outstanding set here turns that
  // abort into a sentence, and catches the ordinary case of an entry that has already cleared on
  // another period's statement.
  const items = await readOutstandingTrustBankItems(database, reconciliation);
  if (!items.some((item) => item.entryId === input.entryId)) {
    throw new TrustValidationError(
      "entry-is-not-a-bank-item",
      `${input.entryId} is not an outstanding item on this trust account as of the statement period; it either never touched this bank account, was recorded after the period ended, or has already cleared on another statement`,
    );
  }

  const matchId = newIdentifier("trustReconciliationMatch", options.randomSource);
  return {
    matchId,
    effect: {
      statements: [
        insertTrustReconciliationMatchStatement(database, {
          id: matchId,
          reconciliationId: input.reconciliationId,
          statementLineId: input.statementLineId,
          entryId: input.entryId,
          unmatchesMatchId: null,
          matchedBy: input.matchedBy,
          matchedAt: options.clock.now(),
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface WithdrawTrustMatchInput {
  readonly matchId: TrustReconciliationMatchId;
  readonly withdrawnBy: UserId;
}

// Withdrawing INSERTS a row naming the match it releases, exactly as a hold release does. Nothing is
// edited and nothing is deleted, so that a person once asserted this pairing — and then took it back
// — stays on the record. The UNIQUE index on `unmatches_match_id` makes a concurrent double
// withdrawal lose at commit rather than at a pre-check both racers passed.
export async function composeTrustReconciliationUnmatch(
  database: SqlDatabase,
  input: WithdrawTrustMatchInput,
  options: TrustServiceOptions,
): Promise<ComposedTrustMatch> {
  const match = await readTrustReconciliationMatch(database, input.matchId);
  if (match.unmatchesMatchId !== null) {
    throw new TrustValidationError(
      "match-is-a-withdrawal",
      `${input.matchId} is itself a withdrawal and releases nothing`,
    );
  }
  if (match.unmatchedByMatchId !== null) {
    throw new TrustValidationError(
      "match-already-withdrawn",
      `${input.matchId} was already withdrawn by ${match.unmatchedByMatchId}`,
    );
  }
  const reconciliation = await readTrustReconciliation(database, match.reconciliationId);
  if (reconciliation.status !== "open") {
    throw new TrustValidationError(
      "reconciliation-closed",
      "this reconciliation is closed; what it matched is part of what it attested to, so open a new one rather than changing it",
    );
  }

  const withdrawalId = newIdentifier("trustReconciliationMatch", options.randomSource);
  return {
    matchId: withdrawalId,
    effect: {
      statements: [
        // The withdrawal repeats the line and the entry so the row is readable on its own; an audit
        // trail that has to join to be understood is one that gets misread.
        insertTrustReconciliationMatchStatement(database, {
          id: withdrawalId,
          reconciliationId: match.reconciliationId,
          statementLineId: match.statementLineId,
          entryId: match.entryId,
          unmatchesMatchId: match.id,
          matchedBy: input.withdrawnBy,
          matchedAt: options.clock.now(),
        }),
      ],
      outboxMessages: [],
    },
  };
}

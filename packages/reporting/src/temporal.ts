import { isValidCalendarDate } from "@magna-carta/ledger/validate";
import { ReportingValidationError } from "./reporting-validation.ts";

// THE TWO AXES A REPORT IS TAKEN OVER, and why there are two of them.
//
// The ledger and every append-only record beside it carry both: `effective_date` (when the event is
// deemed to have happened, backdatable, immutable once written) and `recorded_at` (when the platform
// learned of it, system-set, immutable). A report that filtered only on the effective axis would
// change its own past: a reversal posted next month with a backdated effective date silently moves
// last month's answer after somebody signed it. That is the failure the reconciliation freeze exists
// to prevent, and reading one axis would reintroduce it in every report.
//
// So the claim a period plus a knowledge instant buys, stated exactly: for one
// (periodStart, periodEnd, knownAsOf) triple, every figure in a ledger-backed report is a pure
// function of rows that can never change. Re-running the same triple in five years returns the same
// integers.
export interface ReportingPeriod {
  // Civil dates on the EFFECTIVE axis. Inclusive at both ends.
  readonly periodStart: string;
  readonly periodEnd: string;
  // A UTC instant on the KNOWLEDGE axis. Null means "everything known now", which is a live report:
  // it is stamped with the instant it was computed at and is NOT claimed to reproduce.
  readonly knownAsOf: string | null;
}

// The period a read that cannot honor a knowledge instant is taken over. It is a DIFFERENT TYPE
// rather than a ReportingPeriod with a null knownAsOf, because the two mean different things and the
// difference has to be unrepresentable rather than remembered: a live-only read is one whose
// underlying store is mutable (an unbilled time entry is edited during bill review and freezes only
// at billed or void), so no knowledge instant would make it reproduce. An endpoint over such a store
// does not accept the parameter at all — accepting it and ignoring it would answer a question about
// the past with a figure about the present.
export interface LiveOnlyPeriod {
  readonly periodStart: string;
  readonly periodEnd: string;
}

// What a report says about its own reproducibility, carried in the response rather than inferred:
// a reader cannot tell an as-of report from a live one by looking at the figures.
export type ReportingReproducibility =
  | {
      // Every figure re-derives from the stated triple, forever.
      readonly reproducible: true;
      readonly periodStart: string;
      readonly periodEnd: string;
      readonly knownAsOf: string;
    }
  | {
      // Computed from the rows as they stood at `computedAt`, and not claimed to reproduce.
      readonly reproducible: false;
      readonly periodStart: string;
      readonly periodEnd: string;
      readonly computedAt: string;
    };

// An instant, in the shape every `recorded_at` in the schema is written in. Strict rather than
// permissive: `recorded_at` values compare lexicographically in SQL, and a knowledge instant in a
// different shape ("2026-08-14T00:00:00+00:00", or a bare date) would compare wrong rather than fail
// — filtering out rows the caller meant to include, silently.
const ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function assertCivilDate(value: string, what: string): void {
  if (!isValidCalendarDate(value)) {
    throw new ReportingValidationError(
      "reporting-period-not-a-calendar-date",
      `${what} is not a calendar date (YYYY-MM-DD): ${value}`,
    );
  }
}

// The knowledge instant a caller states, checked against the clock the caller supplies. A future
// instant is refused rather than clamped: it would claim the report includes rows that have not been
// recorded yet, and a re-run after they are would return different integers under the same triple —
// the exact promise the two axes exist to make.
function assertKnowledgeInstant(knownAsOf: string, now: string): void {
  if (!ISO_UTC_INSTANT.test(knownAsOf)) {
    throw new ReportingValidationError(
      "reporting-knowledge-instant-not-an-instant",
      `the knowledge instant is not a UTC instant (YYYY-MM-DDThh:mm:ss.sssZ): ${knownAsOf}`,
    );
  }
  if (Number.isNaN(new Date(knownAsOf).getTime())) {
    throw new ReportingValidationError(
      "reporting-knowledge-instant-not-an-instant",
      `the knowledge instant is not a real instant: ${knownAsOf}`,
    );
  }
  if (knownAsOf > now) {
    throw new ReportingValidationError(
      "reporting-knowledge-instant-in-the-future",
      `the knowledge instant ${knownAsOf} is after now (${now}): a report cannot be taken as at a moment the platform has not reached`,
    );
  }
}

export interface ResolveReportingPeriodInput {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly knownAsOf?: string | null;
}

// Validates the triple and resolves the live case. `now` is passed in rather than read: this package
// holds no clock, on the same terms as every other domain package here.
export function resolveReportingPeriod(
  input: ResolveReportingPeriodInput,
  now: string,
): ReportingPeriod {
  assertCivilDate(input.periodStart, "the period start");
  assertCivilDate(input.periodEnd, "the period end");
  // ISO dates compare lexicographically, so this is the whole ordering check.
  if (input.periodStart > input.periodEnd) {
    throw new ReportingValidationError(
      "reporting-period-inverted",
      `the period starts (${input.periodStart}) after it ends (${input.periodEnd})`,
    );
  }
  const knownAsOf = input.knownAsOf ?? null;
  if (knownAsOf !== null) assertKnowledgeInstant(knownAsOf, now);
  return { periodStart: input.periodStart, periodEnd: input.periodEnd, knownAsOf };
}

export function resolveLiveOnlyPeriod(input: {
  readonly periodStart: string;
  readonly periodEnd: string;
}): LiveOnlyPeriod {
  assertCivilDate(input.periodStart, "the period start");
  assertCivilDate(input.periodEnd, "the period end");
  if (input.periodStart > input.periodEnd) {
    throw new ReportingValidationError(
      "reporting-period-inverted",
      `the period starts (${input.periodStart}) after it ends (${input.periodEnd})`,
    );
  }
  return { periodStart: input.periodStart, periodEnd: input.periodEnd };
}

// The knowledge bound the statements filter `recorded_at <= ?` on. A live report is bounded by the
// instant it was computed at rather than by nothing at all: an unbounded read over a database that
// is being written to while the report assembles could put a row into one section and not the next,
// so the two would not agree with each other even though neither is wrong. Pinning the bound at
// assembly makes a live pack internally consistent; it is what it is NOT claimed to be — reproducible
// across runs — that the reproducibility statement says out loud.
export function knowledgeBoundOf(period: ReportingPeriod, computedAt: string): string {
  return period.knownAsOf ?? computedAt;
}

// The day before the period starts, on the effective axis: the instant an opening balance is taken
// at. Computed here rather than at each call site, because "the balance brought forward" and "the
// balance as at the period end" are the same read at two dates, and a report whose opening balance
// was taken at periodStart itself would count the period's first day twice.
export function dayBefore(date: string): string {
  assertCivilDate(date, "the date");
  const stepped = new Date(`${date}T00:00:00.000Z`);
  stepped.setUTCDate(stepped.getUTCDate() - 1);
  return stepped.toISOString().slice(0, 10);
}

// What the response says about its own reproducibility.
export function reproducibilityOf(
  period: ReportingPeriod,
  computedAt: string,
): ReportingReproducibility {
  if (period.knownAsOf === null) {
    return {
      reproducible: false,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      computedAt,
    };
  }
  return {
    reproducible: true,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    knownAsOf: period.knownAsOf,
  };
}

// The sentence a produced artifact carries on its face, in the words a reader who is not a
// programmer has to be able to act on. It is deliberately narrow about WHAT reproduces: the figures
// do, and the captions beside them — a client's display name, an office's letterhead, the citation
// of a governing rule — are as they stood when the pack was produced, because those are mutable and
// saying otherwise would be a claim the platform cannot keep.
export function reproducibilityStatement(reproducibility: ReportingReproducibility): string {
  const period = `${reproducibility.periodStart} to ${reproducibility.periodEnd}`;
  if (reproducibility.reproducible) {
    return (
      `The figures in this report cover ${period} and include everything the platform had recorded ` +
      `as at ${reproducibility.knownAsOf}. Running the same period and the same knowledge instant ` +
      `again returns the same figures, whatever has been recorded since. Names, office details and ` +
      `rule citations are as they stood when this report was produced.`
    );
  }
  return (
    `The figures in this report cover ${period} and include everything the platform had recorded ` +
    `when it was produced, at ${reproducibility.computedAt}. This is a live report: running it again ` +
    `later will include anything recorded in the meantime, so it is not claimed to reproduce. Names, ` +
    `office details and rule citations are as they stood when this report was produced.`
  );
}

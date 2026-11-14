/*
 * The figures the Time ledger states about itself: the two on the footer bar, and the ones the
 * details panel says when nothing in particular is selected.
 *
 * SCOPE IS PART OF THE FIGURE. Unfiltered, a figure speaks for the whole matter; under a filter it
 * speaks for what is in view and says so, in the bar's own prefix and again on the hover. A number
 * whose scope a reader has to work out is a number they will get wrong.
 *
 * A VOID NEVER COUNTS. It stays on the ledger, numbered, with its chip, and contributes to nothing.
 * That rule is applied once, here, rather than at each figure.
 *
 * MONEY LEAVES HERE AS A NUMBER. Rendering an amount is presentation — it needs the matter's
 * currency and the reader's locale, and it belongs where the rendering happens. Durations do leave
 * as text, because their two-literacy rendering is a settled fact about durations rather than a
 * choice a surface makes.
 */
import { formatDuration } from "@magna-carta/design-system/formatters";
import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
import { timekeeperOf } from "./time-columns.ts";

/** One labelled figure on the footer bar. The bar renders these identically wherever they appear. */
export interface LedgerFigure {
  readonly identifier: string;
  readonly label: string;
  /** The amount in minor units. The surface turns it into money in the matter's own currency. */
  readonly amountMinor: number;
  /** The scope-honest caption, on the hover. */
  readonly caption: string;
}

/** The entries a figure is allowed to count. */
export function countable(entries: readonly TimeEntrySummary[]): readonly TimeEntrySummary[] {
  return entries.filter((entry) => entry.status !== "void");
}

function sumAmountMinor(entries: readonly TimeEntrySummary[]): number {
  return entries.reduce((total, entry) => total + (entry.amountMinor ?? 0), 0);
}

/**
 * The two money figures the footer carries: what is billable and not yet on a finalized bill, and
 * what a bill has taken up. No navigation rides either of them — the footer states figures, and the
 * link from an entry to its bill belongs on the entry.
 */
export function footerFigures(
  entries: readonly TimeEntrySummary[],
  options: { readonly filtered: boolean },
): readonly LedgerFigure[] {
  const live = countable(entries);
  const inView = options.filtered ? ", in view" : "";
  const billable = live.filter((entry) => entry.billable);
  return [
    {
      identifier: "unbilled",
      label: "unbilled",
      amountMinor: sumAmountMinor(billable.filter((entry) => entry.status !== "billed")),
      caption: `Billable time not yet on a finalized bill${inView}. Add it to a draft bill on the Billing tab.`,
    },
    {
      identifier: "billed",
      label: "billed",
      amountMinor: sumAmountMinor(billable.filter((entry) => entry.status === "billed")),
      caption: `Billable time on a finalized bill${inView}.`,
    },
  ];
}

/** One timekeeper's share of the matter's time. */
export interface TimekeeperShare {
  readonly name: string;
  /** Both literacies, as every duration renders. */
  readonly hours: string;
  readonly amountMinor: number;
}

/** What the panel says about the matter when no entry is selected. */
export interface MatterTimeSummary {
  readonly liveCount: number;
  readonly voidCount: number;
  readonly billedHours: string;
  readonly nonBillableHours: string;
  readonly byTimekeeper: readonly TimekeeperShare[];
}

export function matterTimeSummary(entries: readonly TimeEntrySummary[]): MatterTimeSummary {
  const live = countable(entries);
  const shares = new Map<string, { minutes: number; amountMinor: number }>();
  for (const entry of live) {
    const name = timekeeperOf(entry);
    const share = shares.get(name) ?? { minutes: 0, amountMinor: 0 };
    share.minutes += entry.durationMinutes;
    share.amountMinor += entry.amountMinor ?? 0;
    shares.set(name, share);
  }
  return {
    liveCount: live.length,
    voidCount: entries.length - live.length,
    billedHours: formatDuration(live.reduce((total, entry) => total + entry.durationMinutes, 0))
      .text,
    nonBillableHours: formatDuration(
      live
        .filter((entry) => !entry.billable)
        .reduce((total, entry) => total + entry.durationMinutes, 0),
    ).text,
    byTimekeeper: [...shares.entries()]
      .map(([name, share]) => ({
        name,
        hours: formatDuration(share.minutes).text,
        amountMinor: share.amountMinor,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

/** What the panel says about a selection of more than one entry. */
export interface SelectionSummary {
  readonly count: number;
  /** "3 draft · 1 billed", in the register's own words and the chain's own order. */
  readonly statusLine: string;
  readonly amountMinor: number;
  /** True where the selection holds a void, so the amount says what it left out. */
  readonly excludesVoids: boolean;
}

const CHAIN_ORDER: readonly TimeEntrySummary["status"][] = [
  "draft",
  "submitted",
  "approved",
  "billed",
  "void",
];

export function selectionSummary(
  entries: readonly TimeEntrySummary[],
  statusWord: (status: TimeEntrySummary["status"]) => string,
): SelectionSummary {
  const live = countable(entries);
  const counts = new Map<TimeEntrySummary["status"], number>();
  for (const entry of entries) counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
  return {
    count: entries.length,
    statusLine: CHAIN_ORDER.filter((status) => counts.has(status))
      .map((status) => `${String(counts.get(status))} ${statusWord(status).toLowerCase()}`)
      .join(" · "),
    amountMinor: sumAmountMinor(live),
    excludesVoids: live.length !== entries.length,
  };
}

/** The currency the matter's own entries are written in; the firm's default until one is read. */
export function ledgerCurrency(entries: readonly TimeEntrySummary[]): string {
  return entries[0]?.currency ?? "USD";
}

/**
 * What a PERIOD says about itself: the counts and the sums over a span of days, across matters.
 *
 * The footer figures above answer a matter's two money questions. A period answers a different set,
 * because the reader is asking about their week rather than about a file: how much time is on the
 * record at all, how much of it bills, and how much of what bills is still waiting for an invoice.
 * Hours lead, because a period ledger is read in hours; the money follows.
 *
 * EVERYTHING LEAVES AS A NUMBER. Minutes and minor units, never text — the currency belongs to the
 * surface and the duration's two literacies are the formatter's, on the rule this file already
 * follows for the footer.
 *
 * A VOID COUNTS TOWARD NOTHING and is counted separately, so a period that holds one can say so
 * rather than quietly presenting a smaller total than the row count implies.
 */
export interface PeriodTotals {
  /** Rows that count: everything but the voids. */
  readonly liveCount: number;
  readonly voidCount: number;
  /** Every live minute on the record for the period, billable or not, as billed. */
  readonly recordedMinutes: number;
  readonly billableMinutes: number;
  readonly nonBillableMinutes: number;
  /** Billable value no finalized invoice has taken up. */
  readonly unbilledAmountMinor: number;
  /** Billable value an invoice has taken up. */
  readonly billedAmountMinor: number;
}

function sumBilledMinutes(entries: readonly TimeEntrySummary[]): number {
  return entries.reduce((total, entry) => total + entry.durationMinutes, 0);
}

export function periodTotals(entries: readonly TimeEntrySummary[]): PeriodTotals {
  const live = countable(entries);
  const billable = live.filter((entry) => entry.billable);
  return {
    liveCount: live.length,
    voidCount: entries.length - live.length,
    recordedMinutes: sumBilledMinutes(live),
    billableMinutes: sumBilledMinutes(billable),
    nonBillableMinutes: sumBilledMinutes(live.filter((entry) => !entry.billable)),
    unbilledAmountMinor: sumAmountMinor(billable.filter((entry) => entry.status !== "billed")),
    billedAmountMinor: sumAmountMinor(billable.filter((entry) => entry.status === "billed")),
  };
}

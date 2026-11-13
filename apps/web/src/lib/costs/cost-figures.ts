/*
 * The figures the Cost ledger states about itself: the three on the footer bar, and the ones the
 * details panel says when nothing in particular is selected.
 *
 * THE FOOTER SPLITS THE MONEY THE WAY THE DECISIONS DO. What no column carries is where a cost has
 * got to: UNBILLED is what a bill may still take up, BILLED is what a finalized invoice already
 * took, and ABSORBED is the firm's own decision made visible. A ledger that showed only a total
 * would hide the decision.
 *
 * SCOPE IS PART OF THE FIGURE. Unfiltered, a figure speaks for the whole matter; under a filter it
 * speaks for what is in view and says so, in the bar's own prefix and again on the hover. A number
 * whose scope a reader has to work out is a number they will get wrong.
 *
 * A VOID NEVER COUNTS. It stays on the ledger with its chip and contributes to nothing: a withdrawn
 * cost was never charged. That rule is applied once, here, rather than at each figure.
 *
 * MONEY LEAVES HERE AS A NUMBER. Rendering an amount needs the matter's currency and the reader's
 * locale, and it belongs where the rendering happens.
 */
import type { CostStatus, CostSummary } from "$lib/matters/cost-api.ts";
import { COST_CHAIN_ORDER, payeeText } from "./cost-vocabulary.ts";

/** One labelled figure on the footer bar. The bar renders these identically wherever they appear. */
export interface LedgerFigure {
  readonly identifier: string;
  readonly label: string;
  /** The amount in minor units. The surface turns it into money in the matter's own currency. */
  readonly amountMinor: number;
  /** The scope-honest caption, on the hover. */
  readonly caption: string;
}

/** The costs a figure is allowed to count. */
export function countable(costs: readonly CostSummary[]): readonly CostSummary[] {
  return costs.filter((cost) => cost.status !== "void");
}

function sumAmountMinor(costs: readonly CostSummary[]): number {
  return costs.reduce((total, cost) => total + cost.amountMinor, 0);
}

/**
 * The three money figures the footer carries. No navigation rides any of them — the footer states
 * figures, and the link from a cost to its bill belongs on the cost.
 */
export function footerFigures(
  costs: readonly CostSummary[],
  options: { readonly filtered: boolean },
): readonly LedgerFigure[] {
  const live = countable(costs);
  const inView = options.filtered ? ", in view" : "";
  const billable = live.filter((cost) => cost.billable);
  return [
    {
      identifier: "unbilled",
      label: "unbilled",
      amountMinor: sumAmountMinor(billable.filter((cost) => cost.status !== "billed")),
      caption: `Billable costs not yet on a finalized bill${inView}. Add them to a draft bill in the Billing section.`,
    },
    {
      identifier: "billed",
      label: "billed",
      amountMinor: sumAmountMinor(billable.filter((cost) => cost.status === "billed")),
      caption: `Costs on a finalized bill${inView}.`,
    },
    {
      identifier: "absorbed",
      label: "absorbed",
      amountMinor: sumAmountMinor(live.filter((cost) => !cost.billable)),
      caption: `Costs the firm decided to absorb${inView}: never billed, visible so the decision is.`,
    },
  ];
}

/** One payee's share of what the matter has spent. */
export interface PayeeShare {
  readonly name: string;
  readonly amountMinor: number;
}

/** What the panel says about the matter when no cost is selected. */
export interface MatterCostSummary {
  readonly liveCount: number;
  readonly voidCount: number;
  /** Every live cost on the matter, whoever ends up paying for it. */
  readonly recordedMinor: number;
  readonly absorbedMinor: number;
  /** The biggest payees by what the firm has paid them, largest first. */
  readonly largestPayees: readonly PayeeShare[];
}

/** How many payees the panel names before the list stops being a summary. */
const LARGEST_PAYEE_COUNT = 4;

export function matterCostSummary(costs: readonly CostSummary[]): MatterCostSummary {
  const live = countable(costs);
  const shares = new Map<string, number>();
  // Only a cost that names somebody has a payee to rank; the rest are not a share of anyone.
  for (const cost of live) {
    if (cost.vendorId === null) continue;
    const name = payeeText(cost);
    shares.set(name, (shares.get(name) ?? 0) + cost.amountMinor);
  }
  return {
    liveCount: live.length,
    voidCount: costs.length - live.length,
    recordedMinor: sumAmountMinor(live),
    absorbedMinor: sumAmountMinor(live.filter((cost) => !cost.billable)),
    largestPayees: [...shares.entries()]
      .map(([name, amountMinor]) => ({ name, amountMinor }))
      .toSorted((left, right) => right.amountMinor - left.amountMinor)
      .slice(0, LARGEST_PAYEE_COUNT),
  };
}

/** What the panel says about a selection of more than one cost. */
export interface SelectionSummary {
  readonly count: number;
  /** "3 draft · 1 billed", in the register's own words and the chain's own order. */
  readonly statusLine: string;
  readonly amountMinor: number;
  readonly billableMinor: number;
  /** True where the selection holds a void, so the amount says what it left out. */
  readonly excludesVoids: boolean;
}

export function selectionSummary(
  costs: readonly CostSummary[],
  statusWord: (status: CostStatus) => string,
): SelectionSummary {
  const live = countable(costs);
  const counts = new Map<CostStatus, number>();
  for (const cost of costs) counts.set(cost.status, (counts.get(cost.status) ?? 0) + 1);
  return {
    count: costs.length,
    statusLine: COST_CHAIN_ORDER.filter((status) => counts.has(status))
      .map((status) => `${String(counts.get(status))} ${statusWord(status).toLowerCase()}`)
      .join(" · "),
    amountMinor: sumAmountMinor(live),
    billableMinor: sumAmountMinor(live.filter((cost) => cost.billable)),
    excludesVoids: live.length !== costs.length,
  };
}

/** The currency the matter's own costs are written in; the firm's default until one is read. */
export function ledgerCurrency(costs: readonly CostSummary[]): string {
  return costs[0]?.currency ?? "USD";
}

/** How many costs are waiting for review, which is what the Review control counts. */
export function submittedCount(costs: readonly CostSummary[]): number {
  return costs.filter((cost) => cost.status === "submitted").length;
}

/*
 * The figures the Cost ledger states about itself: the four on the footer bar, and the ones the
 * details panel says when nothing in particular is selected.
 *
 * THE FOOTER SPEAKS RECEIVABLE, NOT REVENUE. What no column carries is the shape of the money:
 * ADVANCED is the firm's cash out of pocket, RECOVERABLE is what the client may still be asked for,
 * BILLED is what a finalized invoice has taken up, and ABSORBED is the firm's own decision made
 * visible. A ledger that showed only a total would hide the decision.
 *
 * SCOPE IS PART OF THE FIGURE. Unfiltered, a figure speaks for the whole matter; under a filter it
 * speaks for what is in view and says so, in the bar's own prefix and again on the hover. A number
 * whose scope a reader has to work out is a number they will get wrong.
 *
 * A VOID NEVER COUNTS. It stays on the ledger with its chip and contributes to nothing: a withdrawn
 * cost was never advanced. That rule is applied once, here, rather than at each figure.
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
 * The four money figures the footer carries. No navigation rides any of them — the footer states
 * figures, and the link from a cost to its bill belongs on the cost.
 */
export function footerFigures(
  costs: readonly CostSummary[],
  options: { readonly filtered: boolean },
): readonly LedgerFigure[] {
  const live = countable(costs);
  const inView = options.filtered ? ", in view" : "";
  const recoverable = live.filter((cost) => cost.billable);
  return [
    {
      identifier: "advanced",
      label: "advanced",
      amountMinor: sumAmountMinor(live),
      caption: `Every live cost on the matter${inView}: money the firm is out of pocket for, or has charged back.`,
    },
    {
      identifier: "recoverable",
      label: "recoverable",
      amountMinor: sumAmountMinor(recoverable.filter((cost) => cost.status !== "billed")),
      caption: `Recoverable costs no invoice has billed yet${inView}: what the client may be asked for.`,
    },
    {
      identifier: "billed",
      label: "billed",
      amountMinor: sumAmountMinor(recoverable.filter((cost) => cost.status === "billed")),
      caption: `Costs a finalized invoice has taken up${inView}.`,
    },
    {
      identifier: "absorbed",
      label: "absorbed",
      amountMinor: sumAmountMinor(live.filter((cost) => !cost.billable)),
      caption: `Costs the firm decided to absorb${inView}: never billed, visible so the decision is.`,
    },
  ];
}

/** One payee's share of what the matter has advanced. */
export interface PayeeShare {
  readonly name: string;
  readonly amountMinor: number;
}

/** What the panel says about the matter when no cost is selected. */
export interface MatterCostSummary {
  readonly liveCount: number;
  readonly voidCount: number;
  /** Cash paid out to third parties. */
  readonly hardMinor: number;
  /** The firm's own resources charged back. */
  readonly softMinor: number;
  readonly absorbedMinor: number;
  /** The biggest payees by what the firm has advanced to them, largest first. */
  readonly largestPayees: readonly PayeeShare[];
}

/** How many payees the panel names before the list stops being a summary. */
const LARGEST_PAYEE_COUNT = 4;

export function matterCostSummary(costs: readonly CostSummary[]): MatterCostSummary {
  const live = countable(costs);
  const shares = new Map<string, number>();
  for (const cost of live) {
    if (cost.disbursementClass !== "hard") continue;
    const name = payeeText(cost);
    shares.set(name, (shares.get(name) ?? 0) + cost.amountMinor);
  }
  return {
    liveCount: live.length,
    voidCount: costs.length - live.length,
    hardMinor: sumAmountMinor(live.filter((cost) => cost.disbursementClass === "hard")),
    softMinor: sumAmountMinor(live.filter((cost) => cost.disbursementClass === "soft")),
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
  readonly recoverableMinor: number;
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
    recoverableMinor: sumAmountMinor(live.filter((cost) => cost.billable)),
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

/*
 * The words the cost ledger uses, and the small judgments behind them.
 *
 * A COST IS NOT A FEE. Money paid out or consumed for a matter is a payee-and-amount record: a
 * cost is typed exactly as spent, never computed from a rate and a quantity, and whether the
 * client is asked for it is a separate decision the ledger keeps visible.
 *
 * THE PAYEE IS OPTIONAL, AND ITS THREE STATES STAY DISTINCT. Some costs name who was paid, some
 * record nobody, and some name a directory entry that has since been deleted, in which case the
 * listing serves no name for it. Collapsing any two of those into one blank would hide a different
 * fact each time.
 *
 * WHAT A WORD MEANS RIDES A HOVER, NEVER A PRINTED SENTENCE. The status words themselves come from
 * the product's one status register, not from a second spelling here.
 */
import type { CostStatus, CostSummary } from "$lib/matters/cost-api.ts";

/** Who the money went to, in the only three shapes the record can honestly be in. */
export type PayeeState =
  | { readonly kind: "unrecorded" }
  | { readonly kind: "gone" }
  | { readonly kind: "named"; readonly name: string };

/**
 * The payee a cost records.
 *
 * `vendorName` is null both when no payee was recorded and when the directory entry behind one was
 * deleted; `vendorId` is what tells those two apart, which is the whole reason the listing serves
 * both.
 */
export function payeeState(cost: CostSummary): PayeeState {
  if (cost.vendorId === null) return { kind: "unrecorded" };
  const name = cost.vendorName ?? null;
  return name === null ? { kind: "gone" } : { kind: "named", name };
}

/** What the payee reads as in a cell, a filter list and a printed sheet: one wording, one home. */
export function payeeText(cost: CostSummary): string {
  const state = payeeState(cost);
  switch (state.kind) {
    case "unrecorded":
      return "Not recorded";
    case "gone":
      return "No longer in the directory";
    default:
      return state.name;
  }
}

/**
 * Why a payee has no name.
 *
 * A deleted directory entry takes the payee's name with it, which is the payee half of the rule
 * time already applies to timekeepers: a name is history, so it is recorded on the record at
 * capture rather than joined from a row somebody may later remove.
 */
export const GONE_PAYEE_NOTE =
  "The payee's directory entry was deleted, so its name can't be shown.";

/** The two words the billing decision wears. Absorbing is a decision, so it is kept visible. */
export function billingLabel(billable: boolean): string {
  return billable ? "Billable" : "Absorbed";
}

export function billingSentence(billable: boolean): string {
  return billable ? "Billable" : "Absorbed by the firm";
}

export const ABSORBED_MEANING =
  "Absorbed: the firm has decided not to ask the client for this cost.";

/** How a cost came to be on the record. The platform captures some of them itself. */
export type CostCaptureSource = "manual" | "grid" | "recovery";

export function sourceLabel(source: CostCaptureSource): string {
  switch (source) {
    case "recovery":
      return "Auto-captured from Shipping";
    case "grid":
      return "The capture grid";
    default:
      return "Recorded by hand";
  }
}

/**
 * What a cost's amount is, in the currency's major unit.
 *
 * A cost is an exact amount, never a rate times a quantity: it is typed as spent, and there is no
 * arithmetic behind it to show. That absence is the honest difference from a fee, and it is why
 * this ledger has no Hours column rather than an emptied one.
 */
export function costAmount(cost: CostSummary): number {
  return cost.amountMinor / 100;
}

/** A withdrawn cost was never charged, so it counts toward nothing. It stays on the record. */
export function countsInTotals(cost: CostSummary): boolean {
  return cost.status !== "void";
}

/** The chain order the ledger's own summaries read in. */
export const COST_CHAIN_ORDER: readonly CostStatus[] = [
  "draft",
  "submitted",
  "approved",
  "billed",
  "void",
];

/**
 * Whether a cost can still be worked on at all.
 *
 * A billed cost is evidence on a finalized invoice and a void cost is the record of a withdrawal;
 * neither is edited. Everything else in the chain is reachable by one verb or another.
 */
export function isFrozen(cost: CostSummary): boolean {
  return cost.status === "billed" || cost.status === "void";
}

/*
 * The words the cost ledger uses, and the small judgments behind them.
 *
 * A COST IS NOT A FEE. Money advanced or consumed for a matter is a payee-and-receipt record that
 * is legally a receivable: an advanced client cost is a loan until it is recovered. That is why
 * this file talks about advancing, recovering and absorbing rather than about charging, and why the
 * hard/soft class is load-bearing accounting data rather than a cosmetic tag.
 *
 * THE PAYEE HAS FOUR HONEST STATES AND THEY STAY DISTINCT. A soft cost has no payee by design,
 * because the firm's own resource was consumed and nobody outside was paid. A hard cost may have
 * none recorded. A recorded payee may have lost its directory entry, in which case the listing
 * serves no name for it. Otherwise there is a name. Collapsing any two of those into one blank
 * would hide a different fact each time.
 *
 * WHAT A WORD MEANS RIDES A HOVER, NEVER A PRINTED SENTENCE. The status words themselves come from
 * the product's one status register, not from a second spelling here.
 */
import type { CostStatus, CostSummary, DisbursementClass } from "$lib/matters/cost-api.ts";

/** Who the money went to, in the only four shapes the record can honestly be in. */
export type PayeeState =
  | { readonly kind: "soft" }
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
  if (cost.disbursementClass === "soft") return { kind: "soft" };
  if (cost.vendorId === null) return { kind: "unrecorded" };
  const name = cost.vendorName ?? null;
  return name === null ? { kind: "gone" } : { kind: "named", name };
}

/** What the payee reads as in a cell, a filter list and a printed sheet: one wording, one home. */
export function payeeText(cost: CostSummary): string {
  const state = payeeState(cost);
  switch (state.kind) {
    case "soft":
      return "— (soft cost)";
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
  "The directory entry behind this payee was deleted, and the listing serves no name for it. " +
  "Recording the name on the cost at capture, as time does for timekeepers, is an open gap.";

export const CLASS_LABELS: Readonly<Record<DisbursementClass, string>> = {
  hard: "Hard",
  soft: "Soft",
};

export const CLASS_MEANINGS: Readonly<Record<DisbursementClass, string>> = {
  hard:
    "A hard cost: cash the firm paid to a third party for this matter. Until it is billed and " +
    "repaid it is money advanced, a receivable rather than an expense.",
  soft:
    "A soft cost: the firm's own resource consumed and charged back, such as copies, postage or " +
    "research. No third party was paid, and the amount is the firm's set rate.",
};

/** The two words the recovery decision wears. Absorbing is a decision, so it is kept visible. */
export function billingLabel(billable: boolean): string {
  return billable ? "Recoverable" : "Absorbed";
}

export function billingSentence(billable: boolean): string {
  return billable ? "Recoverable from the client" : "Absorbed by the firm";
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

/** A withdrawn cost was never advanced, so it counts toward nothing. It stays on the record. */
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

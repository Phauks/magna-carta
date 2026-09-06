/*
 * The figures the Trust ledger states about itself: the three on the counts strip, and the ones
 * the details panel says when nothing in particular is selected.
 *
 * THE POSITION IS THE LEDGER'S, NOT THE ROWS'. Balance, Held and Available come from the ledger
 * read, which is the server's own arithmetic over every movement and every hold on the node. They
 * are never summed from the rows on screen: a filter narrows what a reader is looking at and does
 * not change what the client is owed, so the three figures hold still under a filter and a fourth,
 * the net of the rows in view, appears beside them while one is on.
 *
 * AN UNSERVED READ IS NULL, NEVER ZERO. A balance of nothing is a fact about a matter; a read that
 * has not happened is not. The figures carry null until the ledger read exists, and the surface
 * renders that as a dash with the gap title rather than a figure that reads as an empty ledger.
 *
 * MONEY LEAVES HERE AS A NUMBER. Rendering an amount needs the account's currency and the reader's
 * locale, and it belongs where the rendering happens.
 */
import type { TrustMatterLedger, TrustMovementRecord } from "./trust-api.ts";
import { direction, sumAmountMinor } from "./trust-vocabulary.ts";

/** One labelled figure on the counts strip. The strip renders these identically wherever they appear. */
export interface TrustFigure {
  readonly identifier: string;
  readonly label: string;
  /** The amount in minor units, or null where the read that would state it has not happened. */
  readonly amountMinor: number | null;
  /** The scope-honest caption, on the hover. */
  readonly caption: string;
}

/** The money that came in and the money that went out, over the movements given. */
export interface TrustFlow {
  readonly inMinor: number;
  readonly outMinor: number;
}

export function flow(
  movements: readonly TrustMovementRecord[],
  ownTrustLedgerNodeId: string | null,
): TrustFlow {
  return {
    inMinor: sumAmountMinor(
      movements.filter((movement) => direction(movement, ownTrustLedgerNodeId) === "in"),
    ),
    outMinor: sumAmountMinor(
      movements.filter((movement) => direction(movement, ownTrustLedgerNodeId) === "out"),
    ),
  };
}

/**
 * The figures the counts strip carries: the ledger's position, and the net of the rows in view
 * while a filter narrows them. No navigation rides any of them.
 */
export function footerFigures(
  ledger: TrustMatterLedger | null,
  movements: readonly TrustMovementRecord[],
  options: { readonly filtered: boolean },
): readonly TrustFigure[] {
  const figures: TrustFigure[] = [
    {
      identifier: "balance",
      label: "balance",
      amountMinor: ledger?.balanceMinor ?? null,
      caption:
        "What this matter's trust ledger holds: every movement netted, whatever a filter shows.",
    },
    {
      identifier: "held",
      label: "held",
      amountMinor: ledger?.heldMinor ?? null,
      caption:
        "The part of the balance under a disputed-funds hold, which no payment out may reach.",
    },
    {
      identifier: "available",
      label: "available",
      amountMinor: ledger?.availableMinor ?? null,
      caption: "The balance less what is held: what a payment out or a transfer may take.",
    },
  ];
  if (options.filtered) {
    const inView = flow(movements, ledger?.trustLedgerNodeId ?? null);
    figures.push({
      identifier: "netInView",
      label: "net in view",
      amountMinor: inView.inMinor - inView.outMinor,
      caption:
        "The rows the filter leaves in view, in less out. The three figures beside it are the " +
        "whole ledger's and do not narrow.",
    });
  }
  return figures;
}

/** What the panel says about the matter when no movement is selected. */
export interface MatterTrustSummary {
  readonly movementCount: number;
  readonly balanceMinor: number | null;
  readonly heldMinor: number | null;
  readonly availableMinor: number | null;
}

export function matterTrustSummary(
  ledger: TrustMatterLedger | null,
  movements: readonly TrustMovementRecord[],
): MatterTrustSummary {
  return {
    movementCount: movements.length,
    balanceMinor: ledger?.balanceMinor ?? null,
    heldMinor: ledger?.heldMinor ?? null,
    availableMinor: ledger?.availableMinor ?? null,
  };
}

/** The currency the matter's own movements are written in; the firm's default until one is read. */
export function ledgerCurrency(movements: readonly TrustMovementRecord[]): string {
  return movements[0]?.currency ?? "USD";
}

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
 * SCOPE IS THE FIGURE'S OWN, AND THE STRIP SAYS SO. The three position figures are the whole
 * record's and carry `whole-record`, so a filtered table never labels them "In view:"; the net of
 * the rows a filter leaves IS over those rows, so it carries the default scope and the shared strip
 * puts the prefix in front of it. Every money ledger states its figures through the same component
 * (DataTable.GridFigures), which owns the order, the separators and that prefix.
 *
 * AN UNSERVED READ IS NULL, NEVER ZERO. A balance of nothing is a fact about a matter; a read that
 * has not happened is not. So an unserved figure reads as a dash, with the reason it cannot be
 * stated as its caption, rather than as a figure that reads as an empty ledger.
 *
 * MONEY IS TURNED INTO WORDS BY THE CALLER. Rendering an amount needs the account's currency and
 * the reader's locale, so the surface hands this file the formatter and takes back finished text.
 */
import type { GridFigure } from "@magna-carta/design-system/data-table";
import type { TrustMatterLedger, TrustMovementRecord } from "./trust-api.ts";
import { direction, sumAmountMinor } from "./trust-vocabulary.ts";

/** A figure the read has not stated yet reads as a dash, never as nothing. */
export const UNSERVED_FIGURE = "—";

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

/** What the caller hands this file so a figure can come back as finished text. */
export interface TrustFigureReading {
  readonly filtered: boolean;
  /** An amount in the account's own currency, as the reader reads it. */
  readonly money: (amountMinor: number) => string;
  /** Why a position figure is a dash, in the words of whichever fact is true right now. */
  readonly unservedReason: string;
}

/**
 * The figures the counts strip carries: the ledger's position, and the net of the rows in view
 * while a filter narrows them. No navigation rides any of them.
 */
export function footerFigures(
  ledger: TrustMatterLedger | null,
  movements: readonly TrustMovementRecord[],
  options: TrustFigureReading,
): readonly GridFigure[] {
  const position = (
    identifier: string,
    label: string,
    amountMinor: number | null,
    caption: string,
  ): GridFigure => ({
    identifier,
    label,
    value: amountMinor === null ? UNSERVED_FIGURE : options.money(amountMinor),
    caption: amountMinor === null ? options.unservedReason : caption,
    scope: "whole-record",
  });

  const figures: GridFigure[] = [
    position(
      "balance",
      "balance",
      ledger?.balanceMinor ?? null,
      "What this matter's trust ledger holds: every movement netted, whatever a filter shows.",
    ),
    position(
      "held",
      "held",
      ledger?.heldMinor ?? null,
      "The part of the balance under a disputed-funds hold, which no payment out may reach.",
    ),
    position(
      "available",
      "available",
      ledger?.availableMinor ?? null,
      "The balance less what is held: what a payment out or a transfer may take.",
    ),
  ];
  if (options.filtered) {
    const inView = flow(movements, ledger?.trustLedgerNodeId ?? null);
    figures.push({
      identifier: "netInView",
      label: "net",
      value: options.money(inView.inMinor - inView.outMinor),
      caption: "The rows the filter leaves in view, in less out.",
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

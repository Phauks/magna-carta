/*
 * One fee charge, on paper.
 *
 * Every unit prints alone. A bill consolidates charges and a report combines them, but the charge
 * itself stands on its own sheet — which is the sheet somebody hands across a desk when a client
 * asks what one line of their bill was for.
 *
 * What reaches the paper is a closed set of stated strings. Money and dates arrive already
 * rendered, because the currency and the locale belong to the surface doing the printing.
 */
import type { PrintSheetDocument } from "@magna-carta/design-system/print-sheet/projection";
import { statusEntry } from "@magna-carta/design-system/status-register";
import { FEE_KIND_LABELS, type FeeCharge } from "./fee-charges.ts";

export interface FeeChargeSheetContext {
  readonly matterTitle: string;
  readonly matterNumber: string | null;
  /** Money in the matter's own currency, given the amount in minor units. */
  readonly money: (amountMinor: number) => string;
  readonly date: (isoDate: string) => string;
  /** What the invoice behind this charge stands at, in one sentence. */
  readonly invoiceStandingLine: string;
  readonly printedAt: string;
}

export function feeChargeSheet(
  charge: FeeCharge,
  context: FeeChargeSheetContext,
): PrintSheetDocument {
  return {
    heading: charge.kind === "credit" ? "Credit Note Line" : "Fee Charge",
    reference: charge.reference,
    subtitle:
      context.matterNumber === null
        ? context.matterTitle
        : `${context.matterTitle} · Matter ${context.matterNumber}`,
    sections: [
      {
        id: "facts",
        kind: "fields",
        fields: [
          { label: "Standing", value: statusEntry(charge.standing).label },
          { label: "Date", value: context.date(charge.date) },
          { label: charge.kind === "credit" ? "Credit Note" : "Invoice", value: charge.document },
          { label: "Kind", value: FEE_KIND_LABELS[charge.kind] },
          { label: "Amount", value: context.money(charge.amountMinor) },
          {
            label: "Agreement",
            // A charge that no version of the agreement composed says so rather than printing a
            // version it was not billed under.
            value: charge.arrangementLabel ?? "Not arrangement-composed",
          },
        ],
      },
      { id: "narrative", kind: "text", title: "Info", text: charge.narrative },
      {
        id: "document",
        kind: "text",
        title: "The Document Behind It",
        text: context.invoiceStandingLine,
      },
    ],
    footer: `Magna Carta · printed ${context.printedAt}`,
  };
}

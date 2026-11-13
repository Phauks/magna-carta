/*
 * One invoice, on paper — the RECORD's sheet, not the client's bill.
 *
 * Two different documents share a word and must not share a control. The bill a client receives is
 * the firm's letterhead, its terms, its remittance details and its rendered lines: an artifact with
 * a renderer behind it, and that renderer is not built (bill-actions.ts, `print`). This is the
 * other one — what the platform holds about the invoice, printed the way every other record in the
 * product prints, so somebody can put the state of a bill in a file.
 *
 * So the header's Print gives this, always, and the action bar's "Print / PDF" stays marked until
 * the artifact exists. Calling either of them by the other's name would let a firm send a reader's
 * working copy to a client.
 */
import type { PrintSheetDates } from "$lib/print-sheet";
import type { PrintSheetDocument } from "@magna-carta/design-system/print-sheet/projection";
import { statusEntry } from "@magna-carta/design-system/status-register";
import {
  billUnpaidMinor,
  creditedMinor,
  invoiceReference,
  invoiceStanding,
  matterShareMinor,
  type InvoiceRow,
} from "./invoice-standing.ts";

/**
 * Everything the sheet needs that is not the invoice itself.
 *
 * The matter is optional, because the same sheet is taken from a matter's register and from the
 * firm's. Standing in a matter, the sheet says which matter and what that matter's share was;
 * standing across the firm it says neither, because a bill may charge several matters and naming
 * one of them on the record's own sheet would be picking a matter out of a hat.
 */
export interface InvoiceSheetContext extends PrintSheetDates {
  readonly matterId?: string | null;
  readonly matterTitle?: string | null;
  readonly matterNumber?: string | null;
  readonly clientName: string;
  /** Money in the bill's own currency, given the amount in major units. */
  readonly money: (amount: number) => string;
  /** When the sheet was taken, already stated as an instant. */
  readonly printedAt: string;
}

/** Who the sheet is about: the client always, and the matter only where one is standing behind it. */
function subtitleFor(context: InvoiceSheetContext): string {
  const title = context.matterTitle ?? null;
  if (title === null) return context.clientName;
  const number = context.matterNumber ?? null;
  return number === null
    ? `${context.clientName} · ${title}`
    : `${context.clientName} · ${title} · Matter ${number}`;
}

/** What one invoice's record sheet says. */
export function invoiceRecordSheet(
  row: InvoiceRow,
  context: InvoiceSheetContext,
): PrintSheetDocument {
  const invoice = row.summary;
  const lines = row.detail?.lines ?? [];
  const matterId = context.matterId ?? null;
  const share = matterId === null ? null : matterShareMinor(row, matterId);
  const credited = creditedMinor(row);

  return {
    heading: invoice.status === "draft" ? "Draft Bill" : "Bill",
    reference: invoiceReference(row),
    subtitle: subtitleFor(context),
    sections: [
      {
        id: "standing",
        kind: "fields",
        fields: [
          { label: "Status", value: statusEntry(invoiceStanding(row)).label },
          { label: "Created", value: context.instantDate(invoice.createdAt) },
          {
            label: "Issued",
            value: invoice.issueDate === null ? "Not issued" : context.date(invoice.issueDate),
          },
          {
            label: "Due",
            value: invoice.dueDate === null ? "Not due" : context.date(invoice.dueDate),
          },
        ],
      },
      {
        id: "figures",
        kind: "fields",
        fields: [
          // Only where a matter is standing behind the sheet. Across the firm the line would be a
          // dash on every bill, which says nothing and reads as a figure that failed to load.
          ...(matterId === null
            ? []
            : [
                {
                  label: "This Matter",
                  value: share === null ? "—" : context.money(share / 100),
                },
              ]),
          { label: "Total", value: context.money(invoice.totalMinor / 100) },
          { label: "Applied", value: context.money(invoice.appliedMinor / 100) },
          { label: "Unpaid", value: context.money(billUnpaidMinor(row) / 100) },
          ...(credited === 0 ? [] : [{ label: "Credited", value: context.money(credited / 100) }]),
        ],
      },
      {
        id: "lines",
        kind: "fields",
        title: "Lines",
        fields: lines.map((line) => ({
          label: line.description,
          value: context.money(line.amountMinor / 100),
        })),
      },
      { id: "history", kind: "history", title: "History", events: [] },
    ],
    footer: `Magna Carta · printed ${context.printedAt}`,
  };
}

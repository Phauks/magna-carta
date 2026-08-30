/*
 * The charge ledger: what the agreement has actually charged.
 *
 * A FEE HAS NO WORK-IN-PROGRESS STORE, SO THIS IS A PROJECTION, NOT A TABLE. Fee value materializes
 * only as invoice lines at compose time. There is no fee record sitting between the agreement and
 * the bill, and this surface does not invent one: every row here is a line on one of the matter's
 * invoices, or a line of a credit note recorded beside one.
 *
 * COSTS ARE NOT FEES. A cost line never appears here — costs have their own section, and the two
 * meet only on the invoice.
 *
 * A CREDIT NOTE LINE IS A ROW OF ITS OWN, NEGATIVE. The bill it corrects is never edited, so the
 * correction stands beside the charge rather than reducing it in place, and the ledger reads as the
 * firm's books read: the charge, and then the credit against it.
 */
import { statusEntry, type StatusKey } from "@magna-carta/design-system/status-register";
import type { ArrangementVersion, InvoiceDetail, InvoiceLine } from "./billing-api.ts";
import { invoiceStanding, type InvoiceRow } from "./invoice-standing.ts";
import { ARRANGEMENT_KIND_LABELS } from "./fee-agreement.ts";

/** What a charge is: the four shapes a fee-side line takes. */
export type FeeChargeKind = "fee" | "flat_fee" | "discount" | "credit" | "other";

export const FEE_KIND_LABELS: Readonly<Record<FeeChargeKind, string>> = {
  fee: "Fee",
  flat_fee: "Flat Fee",
  discount: "Discount",
  credit: "Credit Note",
  other: "Adjustment",
};

/** What each kind MEANS, on the hover — the register's rule that meanings never print. */
export const FEE_KIND_MEANINGS: Readonly<Record<FeeChargeKind, string>> = {
  fee:
    "An hourly fee line: time entries consolidated onto the bill. The entries are the timekeeper's " +
    "record; the line is what the client was told.",
  flat_fee:
    "A flat-fee line: the agreement's amount, with the contributing time claimed at zero so " +
    "realization can still see the work the fee covered.",
  discount: "A discount: a named reduction on the bill, never a silent edit of a fee line.",
  credit:
    "A credit note: a correction recorded beside a finalized bill. The bill itself is never " +
    "edited; the credited amount stands as a client credit until refunded or applied.",
  other: "An adjustment recorded on the bill in its own right, beside the fees it sits with.",
};

/** One row of the charge ledger. */
export interface FeeCharge {
  readonly id: string;
  /** The invoice's issue date, or the date the credit note took effect. */
  readonly date: string;
  /** The document this charge rides: an invoice number, a draft, or a credit note. */
  readonly document: string;
  readonly kind: FeeChargeKind;
  /** What the client reads. */
  readonly narrative: string;
  /** Negative for a discount and for a credit note: the ledger reads as the books read. */
  readonly amountMinor: number;
  /** The charge's standing, read off the invoice it rides. */
  readonly standing: StatusKey;
  readonly invoiceId: string;
  readonly invoiceNumber: string | null;
  /** "00378 · L2" — where on the document this charge sits. */
  readonly reference: string;
  /** The agreement version this line was composed under, where the line is arrangement-composed. */
  readonly arrangementLabel: string | null;
}

/** Which invoice-line kinds belong to the fee side of the ledger. */
function feeKindOf(wireKind: string): FeeChargeKind | null {
  switch (wireKind) {
    case "fee":
      return "fee";
    case "flat_fee":
      return "flat_fee";
    case "discount":
      return "discount";
    case "cost":
      return null;
    default:
      return "other";
  }
}

/**
 * A charge's standing, read off the invoice it rides.
 *
 * The fee register is the INVOICE'S standing, not a review chain: a fee line is born as invoice
 * evidence, so claiming a draft-submitted-approved chain here would assert a lifecycle that does
 * not exist. A draft is changeable, a finalized bill is evidence awaiting payment, a paid one is
 * collected, and a credit note is the correction beside a bill.
 */
function chargeStanding(row: InvoiceRow): StatusKey {
  const standing = invoiceStanding(row);
  if (standing === "draft" || standing === "void") return standing;
  return standing === "paid" ? "paid" : "finalized";
}

/** The version of the agreement in force on a given day, out of its append-only history. */
export function arrangementInForceOn(
  history: readonly ArrangementVersion[],
  isoDate: string | null,
): ArrangementVersion | null {
  if (isoDate === null) return history.at(-1) ?? null;
  const governing = history.filter(
    (version) =>
      version.validFrom <= isoDate && (version.validTo === null || isoDate < version.validTo),
  );
  return governing.at(-1) ?? history.at(-1) ?? null;
}

function arrangementLabelFor(
  kind: FeeChargeKind,
  history: readonly ArrangementVersion[],
  isoDate: string | null,
): string | null {
  // The agreement version rides only arrangement-composed lines. An hourly fee line derives from
  // time entries and the rate cards in force, not from a version of the agreement.
  if (kind !== "flat_fee") return null;
  const version = arrangementInForceOn(history, isoDate);
  if (version === null) return null;
  return `v${String(version.version)} ${ARRANGEMENT_KIND_LABELS[version.kind]}`;
}

function documentOf(detail: InvoiceDetail): string {
  return detail.invoiceNumber ?? (detail.status === "draft" ? "Draft" : "Draft (voided)");
}

/**
 * The matter's fee charges, newest first.
 *
 * Only this matter's lines: an invoice may bill several of a client's matters, and a fee ledger
 * standing inside one matter that showed another matter's fees would be stating a figure the matter
 * never incurred.
 */
export function feeCharges(
  rows: readonly InvoiceRow[],
  matterId: string,
  arrangementHistory: readonly ArrangementVersion[],
): readonly FeeCharge[] {
  const charges: FeeCharge[] = [];

  for (const row of rows) {
    const detail = row.detail;
    if (detail === null) continue;
    const document = documentOf(detail);
    const standing = chargeStanding(row);
    const anchorDate = detail.issueDate ?? detail.createdAt.slice(0, 10);

    for (const line of detail.lines) {
      if (line.matterId !== matterId) continue;
      const kind = feeKindOf(line.kind);
      if (kind === null) continue;
      charges.push({
        id: line.id,
        date: anchorDate,
        document,
        kind,
        narrative: line.description,
        amountMinor: line.amountMinor,
        standing,
        invoiceId: detail.id,
        invoiceNumber: detail.invoiceNumber,
        reference: `${document} · L${String(line.lineIndex + 1)}`,
        arrangementLabel: arrangementLabelFor(kind, arrangementHistory, detail.issueDate),
      });
    }

    for (const note of row.creditNotes ?? []) {
      for (const line of note.lines) {
        if (line.matterId !== matterId) continue;
        if (feeKindOf(line.kind) === null) continue;
        charges.push({
          id: line.id,
          date: note.effectiveDate,
          document: creditNoteReference(document),
          kind: "credit",
          narrative: line.description,
          // The contract carries a credit note's lines as magnitudes. The ledger states direction.
          amountMinor: -line.amountMinor,
          standing: "credited",
          invoiceId: detail.id,
          invoiceNumber: detail.invoiceNumber,
          reference: creditNoteReference(document),
          arrangementLabel: null,
        });
      }
    }
  }

  return charges.toSorted((left, right) =>
    left.date === right.date
      ? left.id.localeCompare(right.id)
      : right.date.localeCompare(left.date),
  );
}

/**
 * How a credit note names itself.
 *
 * Credit notes carry no number of their own yet — the numbering question is an open decision — so
 * the note is named by the bill it stands beside rather than by a number nothing issued.
 */
export function creditNoteReference(invoiceDocument: string): string {
  return `Credit note against ${invoiceDocument}`;
}

/** The fee position a matter is in: what is unbilled, what has been billed, what was collected. */
export interface FeePosition {
  readonly unbilledMinor: number;
  readonly billedMinor: number;
  readonly collectedMinor: number;
}

/**
 * The three figures, over the charges given.
 *
 * BILLED counts every charge that is not a credit — a discount is part of what the client was
 * billed, because it is a line on the bill. COLLECTED counts the charges on paid invoices, net of
 * the credit notes recorded beside them: money handed back is money not collected.
 */
export function feePosition(charges: readonly FeeCharge[], unbilledMinor: number): FeePosition {
  return {
    unbilledMinor,
    billedMinor: charges
      .filter((charge) => charge.kind !== "credit")
      .reduce((total, charge) => total + charge.amountMinor, 0),
    collectedMinor: charges
      .filter((charge) => charge.kind === "credit" || charge.standing === "paid")
      .reduce((total, charge) => total + charge.amountMinor, 0),
  };
}

/** The word a charge's standing wears, out of the product's one register. */
export function chargeStandingLabel(standing: StatusKey): string {
  return statusEntry(standing).label;
}

/** What a charge line cannot say yet, and why. */
export const FEE_CHARGE_GAPS = {
  drawnFrom:
    "a read linking an invoice line to the time entries it consolidated, which the invoice detail " +
    "does not carry yet",
  history: "a read of an invoice line's own history, which the billing routes do not serve yet",
} as const;

/** The line an invoice sentence takes on a charge's panel. */
export function invoiceStandingLine(
  row: InvoiceRow,
  formatDate: (isoDate: string) => string,
): string {
  const invoice = row.summary;
  if (invoice.status === "draft") {
    return "On a draft invoice: it can change, or release its entries back to unbilled work, until the bill is finalized.";
  }
  if (invoice.status === "void") {
    return "On a voided draft. Its work returned to unbilled and nothing was ever charged.";
  }
  const issued = invoice.issueDate === null ? "an unrecorded date" : formatDate(invoice.issueDate);
  if (invoiceStanding(row) === "paid") {
    return `Evidence on a finalized invoice, issued ${issued} and paid. Money already collected comes back as a client credit.`;
  }
  const due = invoice.dueDate === null ? "" : `, due ${formatDate(invoice.dueDate)}`;
  return `Evidence on a finalized invoice, issued ${issued} and awaiting payment${due}. A correction is a credit note beside it, never an edit.`;
}

/** Every line of an invoice, in presentation order, for the panel that shows one charge's document. */
export function linesOfInvoice(detail: InvoiceDetail | null): readonly InvoiceLine[] {
  return detail === null ? [] : detail.lines;
}

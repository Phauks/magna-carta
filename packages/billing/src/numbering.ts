import type { SequenceNumberingTables } from "@magna-carta/sequence-numbering/counter-statements";

// The invoice sequence over the shared numbering idiom. The mechanism — ensure-row, guarded
// increment, and an allocation row whose composite primary key is the load-bearing backstop — and
// the reasoning that makes it correct live in @magna-carta/sequence-numbering.
export const INVOICE_NUMBERING_TABLES: SequenceNumberingTables = {
  counterTable: "invoice_number_counter",
  allocationTable: "invoice_number_allocation",
  ownerColumn: "invoice_id",
};

// The first number a firm's sequence hands out. A sequence that starts at zero produces an invoice
// numbered 0, which no firm wants to send.
export const INVOICE_NUMBER_START_VALUE = 1;

// Firm-wide by default. A multi-office firm issuing on two letterheads passes a per-Location scope
// and gets two independent sequences; a single-office firm passes nothing and gets one. The empty
// string is the firm-wide scope, the same convention matter numbering uses.
export const FIRM_WIDE_NUMBER_SCOPE = "";

const NUMBER_DIGITS = 5;

// The rendered number. Zero-padded so a year of bills sorts lexically the way it sorts numerically,
// and prefixed by the scope when there is one, so two offices' sequences are distinguishable on a
// remittance advice rather than colliding as bare integers.
export function renderInvoiceNumber(scopeKey: string, drawnValue: number): string {
  const digits = String(drawnValue).padStart(NUMBER_DIGITS, "0");
  return scopeKey === FIRM_WIDE_NUMBER_SCOPE ? digits : `${scopeKey}-${digits}`;
}

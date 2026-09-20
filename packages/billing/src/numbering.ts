import type { SequenceNumberingTables } from "@magna-carta/sequence-numbering/counter-statements";

// The invoice sequence over the shared numbering idiom. The mechanism — ensure-row, guarded
// increment, and an allocation row whose composite primary key is the load-bearing backstop — and
// the reasoning that makes it correct live in @magna-carta/sequence-numbering.
export const INVOICE_NUMBERING_TABLES: SequenceNumberingTables = {
  counterTable: "invoice_number_counter",
  allocationTable: "invoice_number_allocation",
  ownerColumn: "invoice_id",
};

// Firm-wide by default. A multi-office firm issuing on two letterheads passes a per-Location scope
// and gets two independent sequences; a single-office firm passes nothing and gets one. The empty
// string is the firm-wide scope, the same convention matter numbering uses.
//
// The scope is what the count runs within, and it is NOT a value the template renders: it is the
// letterhead chosen when the bill was finalized, so the draw passes it to the planner rather than
// deriving it (the `invoice` purpose is `scopeSource: "owner"` on the register). What the number
// LOOKS like is the firm's own choice, written on the numbering settings screen; the built-in
// default renders the same five-digit count this run has always rendered, and where a firm opens a
// second letterhead its scheme has to carry the office code so the two runs stay apart — which
// finalize refuses at the moment that second scope is opened.
export const FIRM_WIDE_NUMBER_SCOPE = "";

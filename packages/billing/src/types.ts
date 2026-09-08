import type { RandomSource } from "@magna-carta/identifiers/random";
import type { ClockPort } from "@magna-carta/ledger/types";

export type InvoiceStatus = "draft" | "final" | "void";

export type InvoiceLineKind =
  | "fee"
  | "cost"
  | "flat_fee"
  | "discount"
  | "adjustment"
  | "interest"
  | "tax";

export type InvoiceTaxTreatment = "taxable" | "exempt";

// How a bill spanning several matters is presented: one flowing document, or one page per matter
// plus a summary page. A render-shape fact on the invoice — snapshot at finalize from the firm's
// default (overridable per invoice), read by the render derivation, and never a rendering engine
// concern here.
export type InvoiceRenderShape = "combined" | "per_matter_pages";

// Every way value reaches an invoice. The kind is the direction and the provenance in one column: a
// reversal carries a positive amount and subtracts because it is a reversal, never because of a sign.
//
// Only `trust_transfer` is built today. The rest are the design's closed set and are carried in the
// schema's CHECK from the start, because SQLite cannot widen a CHECK without a destructive table
// rebuild — so the alternative to naming them now is that they could never be added additively.
export type InvoiceApplicationKind =
  | "trust_transfer"
  | "payment"
  | "credit_note"
  | "client_credit"
  | "write_off"
  | "reversal";

// The two work-in-progress stores an invoice draws from. Both were built with an invoice_id column
// that nothing set until this package existed.
// The three stores a draft invoice can claim from. Widening this union is what makes the compiler
// name every site that must handle a new kind — the claim table's own CHECK was widened to match in
// 20260907T221500_invoice-wip-claim-admits-a-fee.
export type WorkInProgressKind = "time_entry" | "cost_entry" | "fee_entry";

/**
 * Every store, as a value — for the places that must act on all of them.
 *
 * `satisfies` ties it to the union, so a kind added to the type without being added here is a
 * compile error rather than a store quietly skipped by whatever iterates this.
 */
export const WORK_IN_PROGRESS_KINDS = [
  "time_entry",
  "cost_entry",
  "fee_entry",
] as const satisfies readonly WorkInProgressKind[];

// How a bill reached a client. The closed set, carried in the schema's CHECK from the start for the
// reason `InvoiceApplicationKind` is: SQLite cannot widen a CHECK without a destructive table
// rebuild, so the alternative to naming them now is that they could never be added additively.
//
// EVERY ONE OF THESE IS RECORDED, NOT PERFORMED. Nothing here renders an invoice or carries one to a
// client. `email` is a mail the firm sent from its own mailbox; `e_billing_gateway` is a submission
// the firm made to the client's own portal; `client_portal` is the one value nothing can produce yet,
// and it is enumerated anyway so the portal lands without rebuilding a financial-evidence table.
export const INVOICE_DELIVERY_CHANNELS = [
  "email",
  "post",
  "hand",
  "client_portal",
  "e_billing_gateway",
] as const;

export type InvoiceDeliveryChannel = (typeof INVOICE_DELIVERY_CHANNELS)[number];

// What became of the attempt. Two values, and the second is why the column exists: a letter comes
// back, an address is dead, a gateway submission is rejected. A history that could only hold
// successes reads as complete when it is not, and a payment reminder sent on the strength of it
// would be a reminder about a bill nobody received.
export const INVOICE_DELIVERY_OUTCOMES = ["delivered", "failed"] as const;

export type InvoiceDeliveryOutcome = (typeof INVOICE_DELIVERY_OUTCOMES)[number];

// The closed set of roles a billing posting resolves. The product chart of accounts does not exist
// yet; until it does, this map is how a firm says which of its ledger accounts plays each part, and
// an unmapped role refuses finalization rather than posting somewhere plausible.
export const ACCOUNT_ROLES = [
  "accounts_receivable",
  "fee_income",
  "client_costs_advanced",
  "cost_recovery_income",
  "tax_payable",
  "fee_adjustments",
  "fee_write_off",
  "operating_bank",
  "client_credit_liability",
] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];

// The shipped service shape: nothing here reads a clock, generates randomness, or holds a D1
// binding ambiently. All three are injected.
export interface BillingServiceOptions {
  readonly clock: ClockPort;
  readonly randomSource?: RandomSource; // fixtures pass the seeded source
}

export interface InvoiceSnapshot {
  readonly id: string;
  readonly clientEntityId: string;
  readonly currency: string;
  readonly status: InvoiceStatus;
  readonly invoiceNumber: string | null;
  readonly issueDate: string | null;
  readonly dueDate: string | null;
}

export interface InvoiceLineSnapshot {
  readonly id: string;
  readonly invoiceId: string;
  readonly lineIndex: number;
  readonly matterId: string;
  readonly kind: InvoiceLineKind;
  readonly description: string;
  readonly quantityE4: number | null;
  readonly rateE4: number | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly taxTreatment: InvoiceTaxTreatment;
}

export interface InvoiceClaimSnapshot {
  readonly id: string;
  readonly invoiceId: string;
  readonly sourceKind: WorkInProgressKind;
  readonly sourceId: string;
  readonly invoiceLineId: string | null;
  readonly claimedAmountMinor: number;
  readonly releasedAt: string | null;
}

export interface InvoiceMatterBalanceSnapshot {
  readonly invoiceId: string;
  readonly matterId: string;
  readonly totalMinor: number;
  readonly appliedMinor: number;
  readonly currency: string;
}

export interface InvoiceApplicationSnapshot {
  readonly id: string;
  readonly invoiceId: string;
  readonly matterId: string;
  readonly kind: InvoiceApplicationKind;
  readonly amountMinor: number;
  readonly currency: string;
  readonly trustTransferId: string | null;
  readonly reversesApplicationId: string | null;
  readonly effectiveDate: string;
}

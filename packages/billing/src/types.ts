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
export type WorkInProgressKind = "time_entry" | "cost_entry";

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

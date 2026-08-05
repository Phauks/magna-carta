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

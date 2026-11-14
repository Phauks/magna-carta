import { z } from "zod";

// The rows of the financial, productivity and operational reports, as the wire carries them. A route
// in apps/api-worker/src/http/routes/billing/ builds each report's top-level response over these and
// the OpenAPI document reads them exactly as written here. Every figure is the assembler's own
// (src/financial, src/productivity, src/operational); nothing here adds anything up.

// ACCOUNTS RECEIVABLE AGING. Five buckets in a fixed order: current, 1 to 30, 31 to 60, 61 to 90 and
// over 90 days past due.
export const AgingFigures = z.array(z.number().int()).length(5);

export const AgingMatterRow = z.object({
  matterId: z.string(),
  matterTitle: z.string(),
  matterNumber: z.string().nullable(),
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  unpaidMinor: AgingFigures,
  totalMinor: z.number().int(),
});

export const AgingTotals = z.object({
  unpaidMinor: AgingFigures,
  totalMinor: z.number().int(),
  invoiceCount: AgingFigures.nullable(),
});

export const AgingOfficeRow = z.object({
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  unpaidMinor: AgingFigures,
  totalMinor: z.number().int(),
});

export const AgingClientRow = z.object({
  clientEntityId: z.string(),
  clientName: z.string().nullable(),
  unpaidMinor: AgingFigures,
  totalMinor: z.number().int(),
  matters: z.array(AgingMatterRow),
});

// WORK IN PROGRESS.
export const WorkInProgressFigures = z.object({
  timeMinutes: z.number().int(),
  timeMinor: z.number().int(),
  costMinor: z.number().int(),
  onDraftMinor: z.number().int(),
  totalMinor: z.number().int(),
});

export const WorkInProgressOfficeRow = z.object({
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  figures: WorkInProgressFigures,
});

export const WorkInProgressMatterRow = z.object({
  matterId: z.string(),
  matterTitle: z.string(),
  matterNumber: z.string().nullable(),
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  figures: WorkInProgressFigures,
});

export const WorkInProgressClientRow = z.object({
  clientEntityId: z.string().nullable(),
  clientName: z.string().nullable(),
  figures: WorkInProgressFigures,
  matters: z.array(WorkInProgressMatterRow),
});

export const WorkInProgressTimekeeperRow = z.object({
  timekeeperUserId: z.string(),
  timekeeperName: z.string().nullable(),
  figures: WorkInProgressFigures,
});

// REALIZATION.
export const RealizationFigures = z.object({
  standardValueMinor: z.number().int(),
  billedMinor: z.number().int(),
  creditedMinor: z.number().int(),
  appliedMinor: z.number().int(),
});

export const RealizationOfficeRow = z.object({
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  figures: RealizationFigures,
});

export const RealizationMatterRow = z.object({
  matterId: z.string(),
  matterTitle: z.string(),
  matterNumber: z.string().nullable(),
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  figures: RealizationFigures,
});

export const RealizationClientRow = z.object({
  clientEntityId: z.string().nullable(),
  clientName: z.string().nullable(),
  figures: RealizationFigures,
  matters: z.array(RealizationMatterRow),
});

// TIMEKEEPER PRODUCTIVITY. Minutes only, never money.
export const ProductivityFigures = z.object({
  entryCount: z.number().int(),
  billableMinutes: z.number().int(),
  nonBillableMinutes: z.number().int(),
  totalMinutes: z.number().int(),
  billableShareBasisPoints: z.number().int().nullable(),
});

export const ProductivityTimekeeperRow = z.object({
  timekeeperUserId: z.string(),
  timekeeperName: z.string().nullable(),
  matterCount: z.number().int(),
  figures: ProductivityFigures,
});

export const ProductivityOfficeRow = z.object({
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  figures: ProductivityFigures,
});

export const ProductivityClientRow = z.object({
  clientEntityId: z.string().nullable(),
  clientName: z.string().nullable(),
  figures: ProductivityFigures,
});

export const ProductivityNonBillableCategoryRow = z.object({
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  minutes: z.number().int(),
});

export const ProductivityTaskCodeRow = z.object({
  code: z.string().nullable(),
  label: z.string().nullable(),
  figures: ProductivityFigures,
});

// OPERATIONAL VOLUMES. Counts only, never money.
export const OperationalSections = z.enum(["matters", "billing", "trust", "costs"]);

export const OperationalMatterCount = z.object({
  measure: z.enum(["opened", "closed"]),
  matterTypeId: z.string().nullable(),
  matterTypeName: z.string().nullable(),
  count: z.number().int(),
});

export const OperationalBillingCounts = z.object({
  billsDrafted: z.number().int(),
  billsFinalized: z.number().int(),
  draftsVoided: z.number().int(),
  creditNotesIssued: z.number().int(),
  writeOffs: z.number().int(),
});

export const OperationalTrustCount = z.object({
  measure: z.enum([
    "movement",
    "disbursement-requested",
    "disbursement-decided",
    "reconciliation-opened",
    "reconciliation-closed",
  ]),
  detail: z.string().nullable(),
  count: z.number().int(),
});

export const OperationalCostCount = z.object({
  disbursementClass: z.enum(["hard", "soft"]),
  count: z.number().int(),
});

// INVOICES. One bill's money, and the number of distinct bills a group holds.
export const InvoiceFigures = z.object({
  invoiceCount: z.number().int(),
  billedMinor: z.number().int(),
  creditedMinor: z.number().int(),
  appliedMinor: z.number().int(),
  unpaidMinor: z.number().int(),
});

export const InvoiceOfficeRow = z.object({
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  figures: InvoiceFigures,
});

export const InvoiceMatterRow = z.object({
  matterId: z.string(),
  matterTitle: z.string(),
  matterNumber: z.string().nullable(),
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  figures: InvoiceFigures,
});

export const InvoiceRow = z.object({
  invoiceId: z.string(),
  invoiceNumber: z.string().nullable(),
  issueDate: z.string(),
  dueDate: z.string().nullable(),
  figures: InvoiceFigures,
  matters: z.array(InvoiceMatterRow),
});

export const InvoiceClientRow = z.object({
  clientEntityId: z.string(),
  clientName: z.string().nullable(),
  figures: InvoiceFigures,
  invoices: z.array(InvoiceRow),
});

// PAYMENTS APPLIED. Signed: a reversal is negative, and keeps its own kind.
export const ApplicationKinds = z.enum([
  "trust_transfer",
  "payment",
  "credit_note",
  "client_credit",
  "write_off",
  "reversal",
]);

export const AppliedFigures = z.object({
  entryCount: z.number().int(),
  paymentMinor: z.number().int(),
  trustTransferMinor: z.number().int(),
  clientCreditMinor: z.number().int(),
  creditNoteMinor: z.number().int(),
  writeOffMinor: z.number().int(),
  reversalMinor: z.number().int(),
  totalMinor: z.number().int(),
});

export const AppliedOfficeRow = z.object({
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  figures: AppliedFigures,
});

export const AppliedClientRow = z.object({
  clientEntityId: z.string(),
  clientName: z.string().nullable(),
  figures: AppliedFigures,
});

export const AppliedEntry = z.object({
  applicationId: z.string(),
  kind: ApplicationKinds,
  reversesKind: ApplicationKinds.exclude(["reversal"]).nullable(),
  effectiveDate: z.string(),
  amountMinor: z.number().int(),
  reason: z.string().nullable(),
  invoiceId: z.string(),
  invoiceNumber: z.string().nullable(),
  clientEntityId: z.string(),
  clientName: z.string().nullable(),
  matterId: z.string(),
  matterTitle: z.string(),
  matterNumber: z.string().nullable(),
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
});

// MATTER BALANCES. Three facts per matter, never added to one another.
export const MatterBalanceFigures = z.object({
  unbilledMinor: z.number().int(),
  owedMinor: z.number().int(),
  trustMinor: z.number().int(),
});

export const MatterBalanceOfficeRow = z.object({
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  figures: MatterBalanceFigures,
});

export const MatterBalanceMatterRow = z.object({
  matterId: z.string(),
  matterTitle: z.string(),
  matterNumber: z.string().nullable(),
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  figures: MatterBalanceFigures,
});

export const MatterBalanceClientRow = z.object({
  clientEntityId: z.string().nullable(),
  clientName: z.string().nullable(),
  figures: MatterBalanceFigures,
  matters: z.array(MatterBalanceMatterRow),
});

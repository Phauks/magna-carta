/*
 * The Billing section's response shapes and calls. Mirrors the billing operations in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 *
 * MONEY IS INTEGER MINOR UNITS, END TO END. Every amount on this wire is a whole number of cents
 * and every sum this app takes is a sum of those integers. The division by 100 happens once, at the
 * formatting boundary, and never before it — a bill whose total was reached through a float is a
 * bill that can be a cent wrong, and a cent wrong on an evidentiary document is a correction that
 * has to be issued as a credit note.
 *
 * A DRAFT AND A FINALIZED BILL ARE READ THE SAME WAY AND WRITTEN DIFFERENTLY. Both answer the same
 * detail read, which is what lets one surface present both; what changes at finalization is that
 * every write route stops accepting the invoice, because the freeze is a database trigger and not a
 * politeness. Nothing here tries to be clever about that: a refused write surfaces the server's own
 * words.
 */
import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
import { requestJson, type ApiOutcome, type Failure, type Page } from "$lib/api/request.ts";

/** The permissions the billing routes name. A member without one is refused server-side. */
export const BILLING_PERMISSIONS = {
  read: "billing:read",
  draft: "billing:draft",
  finalize: "billing:finalize",
  apply: "billing:apply",
  credit: "billing:credit",
  configure: "billing:configure",
} as const;

/** An invoice's own status. What it OWES is a separate, derived question (invoice-standing.ts). */
export type InvoiceStatus = "draft" | "final" | "void";

export interface InvoiceListItem {
  id: string;
  clientEntityId: string;
  /**
   * The client's name as the directory holds it, resolved by the listing. Null both when no
   * directory entry answers to the identifier and when the entry behind one is gone —
   * `clientEntityId` tells those two apart. Never the identifier standing in for a name.
   */
  clientName: string | null;
  currency: string;
  status: InvoiceStatus;
  /** Null until finalization draws one from the firm's sequence. */
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  totalMinor: number;
  appliedMinor: number;
  unpaidMinor: number;
  createdAt: string;
  /**
   * ONE MATTER'S SHARE OF THIS BILL — present only when the listing was narrowed to a matter.
   *
   * An invoice belongs to a client and may bill several of that client's matters, so a matter's own
   * register states each bill's share of it rather than the bill's whole total. These carry that
   * share on the listing row itself, which is what lets the money columns be right the moment the
   * list lands instead of after every bill's detail has been read.
   *
   * Three fields rather than one because a draft and a finalized bill hold the fact in different
   * places. `matterLinesMinor` is the sum of the matter's own lines and exists from the moment a
   * claim composes one — a draft's share. The other two come from the matter's balance row, which
   * finalization creates, so both are null on a draft: null means "not owed yet", never zero.
   */
  matterLinesMinor?: number;
  matterTotalMinor?: number | null;
  matterAppliedMinor?: number | null;
}

/**
 * Whether a bill has ever reached the client. It rides the detail rather than waiting to be asked
 * for, because the surface that has to show it is the one where a firm decides to take fees out of
 * a client's trust ledger.
 */
export interface InvoiceDeliveryState {
  delivered: boolean;
  /** The FIRST recorded success. A courtesy re-send later does not move this date. */
  deliveredOn: string | null;
  attemptCount: number;
  failedAttemptCount: number;
  lastAttemptOn: string | null;
}

export interface InvoiceLine {
  id: string;
  lineIndex: number;
  matterId: string;
  kind: string;
  description: string;
  amountMinor: number;
}

export interface InvoiceMatterBalance {
  matterId: string;
  totalMinor: number;
  appliedMinor: number;
  unpaidMinor: number;
}

export interface InvoiceDetail extends InvoiceListItem {
  delivery: InvoiceDeliveryState;
  /** In presentation order. A draft carries them too — a claim composes its line as it lands. */
  lines: InvoiceLine[];
  matterBalances: InvoiceMatterBalance[];
}

export interface MatterUnbilled {
  matterId: string;
  timeEntryCount: number;
  timeAmountMinor: number;
  costEntryCount: number;
  costAmountMinor: number;
  receivableTotalMinor: number;
  receivableAppliedMinor: number;
  receivableUnpaidMinor: number;
}

export type ArrangementKind = "hourly" | "flat_fee" | "contingency" | "retainer";
export type ContingencyBasis = "gross_recovery" | "net_after_costs";
export type AdvanceDepositDestination = "trust" | "operating";

export interface ArrangementVersion {
  id: string;
  matterId: string;
  version: number;
  kind: ArrangementKind;
  flatFeeAmountMinor: number | null;
  /** The share of a recovery at the rate scale: 3333 is 33.33%. */
  contingencyShareE4: number | null;
  contingencyBasis: ContingencyBasis | null;
  retainerTargetMinor: number | null;
  retainerThresholdMinor: number | null;
  advanceDepositDestination: AdvanceDepositDestination | null;
  currency: string;
  validFrom: string;
  validTo: string | null;
  /** The signed agreement behind this version, as a matter file; null where none was recorded. */
  agreementFileId: string | null;
  /** What that file is called, or null where it has since been deleted. */
  agreementFileName: string | null;
}

export interface ArrangementRecord {
  /** Null means the matter is billed hourly by absence: no agreement was ever recorded. */
  inForce: ArrangementVersion | null;
  history: ArrangementVersion[];
}

export interface ArrangementRequest {
  kind: ArrangementKind;
  flatFeeAmountMinor?: number;
  contingencyShareE4?: number;
  contingencyBasis?: ContingencyBasis;
  retainerTargetMinor?: number;
  retainerThresholdMinor?: number;
  advanceDepositDestination?: AdvanceDepositDestination | null;
  agreementFileId?: string | null;
  currency: "USD";
  validFrom: string;
}

export interface CreditNoteLine {
  id: string;
  matterId: string;
  kind: string;
  description: string;
  /** Positive: a credit note's direction is the document it is, so its lines carry magnitude only. */
  amountMinor: number;
  creditsInvoiceLineId: string | null;
}

export interface CreditNote {
  id: string;
  reason: string;
  effectiveDate: string;
  currency: string;
  issuedAt: string;
  totalMinor: number;
  lines: CreditNoteLine[];
}

export interface ClientCredit {
  id: string;
  matterId: string;
  creditNoteId: string;
  amountMinor: number;
  dischargedMinor: number;
  remainingMinor: number;
  currency: string;
  openedAt: string;
}

export type DeliveryOutcome = "delivered" | "failed";

export interface InvoiceDelivery {
  id: string;
  channel: string;
  recipientReference: string;
  deliveryDate: string;
  externalReference: string | null;
  outcome: string;
  recordedBy: string | null;
  recordedAt: string;
}

export interface InvoiceDeliveryRecord {
  state: InvoiceDeliveryState;
  data: InvoiceDelivery[];
  /** Capped rather than paged: the attempt order is a composite the platform's cursor cannot carry. */
  capped: boolean;
}

/**
 * How a bill reached the client. Every one of these is a delivery the FIRM made and is telling the
 * platform about: the platform sends nothing itself.
 */
export const DELIVERY_CHANNELS = ["email", "post", "hand", "portal", "ebilling"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/** The firm's own words for each channel, and what it means to have used it. */
export const DELIVERY_CHANNEL_LABELS: Readonly<Record<DeliveryChannel, string>> = {
  email: "Email",
  post: "Post",
  hand: "Hand",
  portal: "Client portal",
  ebilling: "E-billing gateway",
};

// ---- reads -------------------------------------------------------------------------------------

/** How a listing is narrowed. Every field is optional; nothing named is the firm's whole register. */
export interface InvoiceListScope {
  /** One client's bills, across every matter of theirs the firm bills. */
  readonly clientEntityId?: string;
  /**
   * The bills that charge ONE matter, drafts included, each carrying that matter's own share.
   *
   * An invoice belongs to a client and may bill several of that client's matters, so this is the
   * narrowing a matter's own register asks for: without it the register would list the client's
   * whole billing history and state totals that are true of the documents and false of the matter.
   */
  readonly matterId?: string;
  readonly status?: InvoiceStatus;
  readonly cursor?: string;
}

/**
 * Invoices, newest first, in whichever scope is asked for.
 *
 * ONE READ SERVES BOTH SURFACES. The firm's billing register asks with nothing named; a matter's
 * Billing section asks for its own matter and gets the same rows with that matter's share on each.
 * A second read shaped for one of them would be a second answer to what a bill is.
 */
export function listInvoices(
  fetchImpl: typeof fetch,
  scope: InvoiceListScope = {},
): Promise<ApiOutcome<Page<InvoiceListItem>>> {
  const query = new URLSearchParams();
  if (scope.clientEntityId !== undefined) query.set("clientEntityId", scope.clientEntityId);
  if (scope.matterId !== undefined) query.set("matterId", scope.matterId);
  if (scope.status !== undefined) query.set("status", scope.status);
  if (scope.cursor !== undefined) query.set("cursor", scope.cursor);
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return requestJson(fetchImpl, `/api/v1/billing/invoices${suffix}`);
}

export function readInvoice(
  fetchImpl: typeof fetch,
  invoiceId: string,
): Promise<ApiOutcome<InvoiceDetail>> {
  return requestJson(fetchImpl, `/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}`);
}

/** What is still billable on one matter, and what the matter already owes across its bills. */
export function readMatterUnbilled(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<MatterUnbilled>> {
  return requestJson(fetchImpl, `/api/v1/billing/matters/${encodeURIComponent(matterId)}/unbilled`);
}

export function readArrangement(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<ArrangementRecord>> {
  return requestJson(
    fetchImpl,
    `/api/v1/billing/matters/${encodeURIComponent(matterId)}/arrangement`,
  );
}

export function listInvoiceCreditNotes(
  fetchImpl: typeof fetch,
  invoiceId: string,
): Promise<ApiOutcome<Page<CreditNote>>> {
  return requestJson(
    fetchImpl,
    `/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/credit-notes`,
  );
}

export function listInvoiceDeliveries(
  fetchImpl: typeof fetch,
  invoiceId: string,
): Promise<ApiOutcome<InvoiceDeliveryRecord>> {
  return requestJson(
    fetchImpl,
    `/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/deliveries`,
  );
}

/**
 * The firm's unpaid receivables, bucketed by how far past due they are.
 *
 * Overdue is worked out at the moment of asking rather than stored, so a bill settled this morning
 * is never reported as late and nothing has to run a sweep to keep the figure true.
 */
export interface ReceivablesAgingBucket {
  /**
   * The bucket's own label, as the server names it. The boundaries are the server's to decide and
   * the screen prints what it is given — a screen that relabelled them would be a second opinion
   * about when a firm's money is late.
   */
  label: string;
  invoiceCount: number;
  unpaidMinor: number;
}

export interface ReceivablesAging {
  asOfDate: string;
  buckets: readonly ReceivablesAgingBucket[];
}

export function readReceivablesAging(
  fetchImpl: typeof fetch,
  asOfDate?: string,
): Promise<ApiOutcome<ReceivablesAging>> {
  const suffix = asOfDate === undefined ? "" : `?asOfDate=${encodeURIComponent(asOfDate)}`;
  return requestJson(fetchImpl, `/api/v1/billing/receivables/aging${suffix}`);
}

/** The client's open credits — money the firm has said is not its own and still holds. */
export function listClientCredits(
  fetchImpl: typeof fetch,
  clientEntityId: string,
): Promise<ApiOutcome<Page<ClientCredit>>> {
  return requestJson(
    fetchImpl,
    `/api/v1/billing/clients/${encodeURIComponent(clientEntityId)}/credits`,
  );
}

// ---- writes ------------------------------------------------------------------------------------
//
// Every one of these requires an idempotency key by contract. A retried finalize that drew a second
// number would consume a number the sequence can never give back, and a retried claim would
// double-bill, so the key is minted at the call site and never reused across a changed payload.

export interface CreateInvoiceRequest {
  clientEntityId: string;
  currency: "USD";
  billingPeriodStart?: string | null;
  billingPeriodEnd?: string | null;
  notes?: string | null;
}

export function createInvoice(
  fetchImpl: typeof fetch,
  request: CreateInvoiceRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ invoiceId: string }>> {
  return requestJson(fetchImpl, "/api/v1/billing/invoices", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export interface ClaimRequest {
  sourceKind: "time_entry" | "cost_entry";
  sourceId: string;
}

/** Claim work onto a draft. Work another draft already holds is refused by name, not by a read. */
export function addInvoiceClaims(
  fetchImpl: typeof fetch,
  invoiceId: string,
  claims: readonly ClaimRequest[],
  idempotencyKey: string,
): Promise<ApiOutcome<{ claimIds: string[] }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/claims`,
    { method: "POST", body: { claims: [...claims] }, idempotencyKey },
  );
}

export interface UpdateInvoiceLineRequest {
  description?: string;
  amountMinor?: number;
}

/**
 * Bill review edits what the CLIENT is told. The time entry a line was composed from is the
 * timekeeper's own record and is not touched by this.
 */
export function updateInvoiceLine(
  fetchImpl: typeof fetch,
  invoiceId: string,
  lineId: string,
  request: UpdateInvoiceLineRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ lineId: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/lines/${encodeURIComponent(lineId)}`,
    { method: "PATCH", body: request, idempotencyKey },
  );
}

export function voidInvoiceDraft(
  fetchImpl: typeof fetch,
  invoiceId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ invoiceId: string }>> {
  return requestJson(fetchImpl, `/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/void`, {
    method: "POST",
    body: { reason },
    idempotencyKey,
  });
}

export interface FinalizeRequest {
  issueDate: string;
  dueDate: string;
  renderShape?: "combined" | "per_matter_pages";
}

export interface FinalizeAck {
  invoiceId: string;
  invoiceNumber: string;
  totalMinor: number;
}

/**
 * One atomic write: the number is drawn, the wording is copied, the claimed work locks, the
 * per-matter balance is created with the ceiling that makes over-application impossible, and the
 * receivable posts. All of it, or none of it. There is no un-finalize.
 */
export function finalizeInvoice(
  fetchImpl: typeof fetch,
  invoiceId: string,
  request: FinalizeRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<FinalizeAck>> {
  return requestJson(
    fetchImpl,
    `/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/finalization`,
    { method: "POST", body: request, idempotencyKey },
  );
}

/*
 * APPLYING TRUST FUNDS IS NOT CALLED FROM HERE, AND THE CALL IS DELIBERATELY ABSENT RATHER THAN
 * WRITTEN AND UNUSED. A transfer names the trust account the money leaves, and nothing serves a
 * listing of a firm's trust accounts — both the matter-ledger read and the transfer itself take a
 * trust-account handle, and no route hands one out. The surface renders in full with the act
 * disabled and the dependency named (apply-trust-funds-dialog.svelte); the call is written when
 * there is an account to name.
 */

export interface CreditNoteLineRequest {
  matterId: string;
  kind: "fee" | "cost" | "flat_fee" | "discount" | "adjustment" | "interest" | "tax";
  description: string;
  amountMinor: number;
  creditsInvoiceLineId?: string | null;
}

export interface CreditNoteAck {
  creditNoteId: string;
  invoiceId: string;
  totalMinor: number;
  appliedMinor: number;
  clientCreditMinor: number;
}

/** A second permanent record standing beside the bill. It is never edited or withdrawn. */
export function issueCreditNote(
  fetchImpl: typeof fetch,
  invoiceId: string,
  request: { reason: string; effectiveDate: string; lines: readonly CreditNoteLineRequest[] },
  idempotencyKey: string,
): Promise<ApiOutcome<CreditNoteAck>> {
  return requestJson(
    fetchImpl,
    `/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/credit-notes`,
    { method: "POST", body: { ...request, lines: [...request.lines] }, idempotencyKey },
  );
}

/** The charge was right and the money is not coming: a different fact from a credit note. */
export function writeOffBalance(
  fetchImpl: typeof fetch,
  invoiceId: string,
  request: { matterId: string; amountMinor: number; reason: string; effectiveDate: string },
  idempotencyKey: string,
): Promise<ApiOutcome<{ applicationId: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/write-offs`,
    { method: "POST", body: request, idempotencyKey },
  );
}

/** Set an open client credit against a bill. No money moves: the debt and the credit cancel. */
export function applyClientCredit(
  fetchImpl: typeof fetch,
  clientCreditId: string,
  request: { invoiceId: string; matterId: string; amountMinor: number; effectiveDate: string },
  idempotencyKey: string,
): Promise<ApiOutcome<{ applicationId: string; remainingMinor: number }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/billing/client-credits/${encodeURIComponent(clientCreditId)}/applications`,
    { method: "POST", body: request, idempotencyKey },
  );
}

export function recordInvoiceDelivery(
  fetchImpl: typeof fetch,
  invoiceId: string,
  request: {
    channel: DeliveryChannel;
    recipientReference: string;
    deliveryDate: string;
    externalReference?: string | null;
    outcome: DeliveryOutcome;
  },
  idempotencyKey: string,
): Promise<ApiOutcome<{ deliveryId: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/deliveries`,
    { method: "POST", body: request, idempotencyKey },
  );
}

/** Record or amend how a matter is billed. An amendment is a NEW version; the old one stays. */
export function setArrangement(
  fetchImpl: typeof fetch,
  matterId: string,
  request: ArrangementRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<ArrangementRecord>> {
  return requestJson(
    fetchImpl,
    `/api/v1/billing/matters/${encodeURIComponent(matterId)}/arrangement`,
    { method: "PUT", body: request, idempotencyKey },
  );
}

/**
 * What a refused or unanswered call says to the person who asked for it.
 *
 * The server's own words come first, because it knows why it refused; the Error ID follows, because
 * that is the handle a firm quotes when it reports the failure. A dead transport says nothing
 * changed, which is the only thing anyone can be certain of.
 */
export function billingFailure(
  outcome: { kind: "problem"; failure: Failure } | { kind: "transport"; failure: Failure },
  whenSilent: string,
): StatedFailure {
  return stated(outcome.failure, whenSilent);
}

/**
 * Report a failed read through the firm's own pipeline, and nobody else's.
 *
 * What travels is the reporter's words, the correlation handles the failed read was given, the
 * route and the build. No document, no file name, no matter content, and never a third-party error
 * service.
 */
export function reportBillingProblem(
  fetchImpl: typeof fetch,
  report: { description: string; errorIds: readonly string[]; route: string; appVersion: string },
): Promise<ApiOutcome<{ id: string; status: string }>> {
  return requestJson(fetchImpl, "/api/v1/incidents", {
    method: "POST",
    body: {
      errorIds: [...report.errorIds],
      breadcrumbs: [],
      description: report.description,
      context: {
        route: report.route,
        appVersion: report.appVersion,
        clientAt: new Date().toISOString(),
      },
    },
  });
}

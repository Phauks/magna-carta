/*
 * What a person can actually do to a cost, and what the server will actually accept.
 *
 * The design gives this ledger a fuller verb set than the calls below: attach a file from the
 * matter's own documents, return a submitted cost to draft, delete a draft that never entered
 * review, write an internal memo, open the invoice a billed cost rides. Attaching has a route and
 * no picker to feed it a file identifier; the rest have no route at all. None of them is called from here — they are rendered where the
 * design puts them, disabled, saying what they wait on, so the difference between "designed" and
 * "working" is a difference a reader of this file can see.
 *
 * Every call goes through the one transport seam, so a dead network is an outcome rather than a
 * thrown error, and the surface can say something true about it.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";
import type { CostSummary } from "$lib/matters/cost-api.ts";
import type { CostCaptureSource } from "./cost-vocabulary.ts";

/**
 * A cost as the listing actually answers it.
 *
 * The wire carries `source` and `recoveryCategory` beyond what `$lib/matters/cost-api.ts` names,
 * and this ledger shows the first of them — a cost the platform captured for itself is a different
 * fact from one somebody typed. The shape belongs in the shared module once that module is widened;
 * until then it is stated here rather than read off an untyped field.
 */
export interface CostLedgerEntry extends CostSummary {
  readonly source: CostCaptureSource;
  readonly recoveryCategory: string | null;
}

/**
 * Every cost on the matter, most recently incurred first, in every status.
 *
 * No status is passed on purpose: a matter's cost record is all of the cost advanced for it, and
 * narrowing to one status answers the work-in-progress question a different caller asks.
 */
export function listMatterCostLedger(
  fetchImpl: typeof fetch,
  matterId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<CostLedgerEntry>>> {
  const query = new URLSearchParams({ matterId, ...(cursor === undefined ? {} : { cursor }) });
  return requestJson(fetchImpl, `/api/v1/costs?${query.toString()}`);
}

/** What the capture route answers: the identity of the cost it wrote. */
export interface CostAcknowledgement {
  costEntryId: string;
}

/** The facts a new draft is written from. Everything else about it is the server's to decide. */
export interface DraftCost {
  readonly matterId: string;
  readonly vendorId: string | null;
  readonly incurredDate: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly billable: boolean;
  readonly utbmsExpenseCodeId: string | null;
  readonly description: string;
}

/*
 * The capture contract still requires a hard/soft disbursement class, and this product records no
 * such distinction: whether anybody outside was paid is the payee field, and whether the client is
 * asked is the billing field. Every capture therefore sends the one value, nothing reads it back,
 * and it comes out of the request the moment it comes out of the contract.
 */
const CONTRACT_REQUIRED_DISBURSEMENT_CLASS = "hard";

/**
 * Record a draft cost. The contract requires an idempotency key on the write, because a retried
 * save must not put a second cost on the matter's ledger.
 */
export function createCost(
  fetchImpl: typeof fetch,
  draft: DraftCost,
  idempotencyKey: string,
): Promise<ApiOutcome<CostAcknowledgement>> {
  return requestJson(fetchImpl, "/api/v1/costs", {
    method: "POST",
    body: { ...draft, disbursementClass: CONTRACT_REQUIRED_DISBURSEMENT_CLASS },
    idempotencyKey,
  });
}

/** The parts of a cost the update route accepts. A billed or void cost is frozen and takes none. */
export interface CostChanges {
  readonly vendorId?: string | null;
  readonly incurredDate?: string;
  readonly amountMinor?: number;
  readonly billable?: boolean;
  readonly utbmsExpenseCodeId?: string | null;
  readonly description?: string;
}

export function patchCost(
  fetchImpl: typeof fetch,
  costEntryId: string,
  changes: CostChanges,
  idempotencyKey: string,
): Promise<ApiOutcome<CostAcknowledgement>> {
  return requestJson(fetchImpl, `/api/v1/costs/${encodeURIComponent(costEntryId)}`, {
    method: "PATCH",
    body: changes,
    idempotencyKey,
  });
}

function transition(
  fetchImpl: typeof fetch,
  costEntryId: string,
  action: string,
  idempotencyKey: string,
  body?: unknown,
): Promise<ApiOutcome<CostAcknowledgement>> {
  return requestJson(fetchImpl, `/api/v1/costs/${encodeURIComponent(costEntryId)}/${action}`, {
    method: "POST",
    idempotencyKey,
    ...(body === undefined ? {} : { body }),
  });
}

/** Send a draft to review. It locks until it is approved or kicked back. */
export function submitCost(
  fetchImpl: typeof fetch,
  costEntryId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<CostAcknowledgement>> {
  return transition(fetchImpl, costEntryId, "submit", idempotencyKey);
}

/** Approve a submitted cost. It becomes billable on the next invoice. */
export function approveCost(
  fetchImpl: typeof fetch,
  costEntryId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<CostAcknowledgement>> {
  return transition(fetchImpl, costEntryId, "approve", idempotencyKey);
}

/**
 * Return a cost to the person who recorded it, as an editable draft.
 *
 * The reason is required by the route and required by the control that sends it: what the recorder
 * has to change is the whole content of the act, and a blank one would be a rejection with no
 * instruction in it.
 */
export function kickBackCost(
  fetchImpl: typeof fetch,
  costEntryId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ApiOutcome<CostAcknowledgement>> {
  return transition(fetchImpl, costEntryId, "kick-back", idempotencyKey, { reason });
}

/** Withdraw a cost. It freezes, counts toward nothing, and stays on the record. */
export function voidCost(
  fetchImpl: typeof fetch,
  costEntryId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<CostAcknowledgement>> {
  return transition(fetchImpl, costEntryId, "void", idempotencyKey);
}

/** One ABA expense code the firm's catalogue holds. */
export interface ExpenseCode {
  id: string;
  codeSet: string;
  code: string;
  label: string;
  practiceArea: string | null;
  /** Non-zero where the firm has this code turned on for entry and billing exports. */
  active: number;
}

/**
 * The firm's expense-code catalogue.
 *
 * The listing is gated on the UTBMS management permission rather than a read permission, so an
 * account that may record costs may still be refused this. The refusal is an outcome the caller
 * renders, never an empty catalogue: "the firm has no expense codes" and "you may not read them"
 * are different facts and they must not look alike.
 */
export function listExpenseCodes(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: ExpenseCode[] }>> {
  return requestJson(fetchImpl, "/api/v1/utbms-codes?codeSet=expense");
}

/** A fresh idempotency key for one write attempt and its retries. */
export function writeKey(): string {
  return crypto.randomUUID();
}

/**
 * Reading an amount somebody typed, as minor units.
 *
 * A cost is recorded exactly: the field takes what was spent, with or without the currency mark and
 * the thousands separators a person naturally types, and nothing is computed from it. Zero is not
 * an amount — a cost of nothing was not advanced — so it reads as no answer.
 */
export function parseAmountMinor(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, "").replaceAll(",", "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const minor = Math.round(Number(trimmed) * 100);
  return minor > 0 ? minor : null;
}

/**
 * Why a draft cannot be saved as it stands, in the words the reader needs, or null when it can.
 *
 * The rule is the design's: an advance control validates before it enables, so nothing is pressed
 * only to come back with a failure the client could have named. The payee is not among these,
 * because it is optional: plenty of real costs were consumed rather than paid to anybody.
 */
export function costDraftRefusal(input: {
  readonly amountText: string;
  readonly description: string;
}): string | null {
  if (parseAmountMinor(input.amountText) === null) return "Enter the amount as spent";
  if (input.description.trim() === "") {
    return "Enter the Description: every cost states what it was for";
  }
  return null;
}

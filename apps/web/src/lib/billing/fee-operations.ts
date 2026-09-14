/*
 * What a person can actually do to a fee, and what the server will actually accept.
 *
 * A FEE IS TYPED, NEVER COMPUTED. Nothing on this seam reads a time entry, a rate or an
 * arrangement: an hourly matter's fee value is the time ledger's and a flat-fee arrangement's
 * amount is the arrangement's. What these calls write is the charge somebody decided on, which was
 * neither and so had nowhere to live.
 *
 * The verb set is the cost seam's, and deliberately so — the two records ride one chain and one
 * claim path, so a reader who has learned Costs already knows what these do. The one verb Costs
 * does not have is `deleteDraftFee`: a draft that never entered review has no record to preserve,
 * and the route refuses anything past it, which is voided instead.
 *
 * Every call goes through the one transport seam, so a dead network is an outcome rather than a
 * thrown error, and the surface can say something true about it.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";
import type { FeeRecord } from "./fee-record.ts";
// The chain's own rule about who may change a record, from the one home the three ledgers share.
// Re-exported rather than re-imported by every caller: this module is where the fee surfaces
// already ask what they may do to a fee.
export { canWorkDraft } from "$lib/records/work-in-progress-record.ts";

/**
 * Every fee on the matter, most recent service date first, in every status.
 *
 * No status is passed on purpose: a matter's fee record is every charge recorded against it, and
 * narrowing to one status answers the work-in-progress question a different caller asks.
 */
export function listMatterFeeLedger(
  fetchImpl: typeof fetch,
  matterId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<FeeRecord>>> {
  const query = new URLSearchParams({ matterId, ...(cursor === undefined ? {} : { cursor }) });
  return requestJson(fetchImpl, `/api/v1/fees?${query.toString()}`);
}

/** How the firm-wide listing is narrowed. Nothing named is the firm's whole fee record. */
export interface FeePeriodScope {
  /** The first service date, inclusive. Absent, the listing runs from the first fee recorded. */
  readonly from?: string;
  /** The last service date, inclusive. Absent, the listing runs to the present. */
  readonly to?: string;
  readonly matterId?: string;
  /** The statuses the screen's Status column holds; empty or absent is every status. */
  readonly statuses?: readonly FeeRecord["status"][];
  /** True for the billable fees, false for the absorbed; omitted, the listing answers both. */
  readonly billable?: boolean;
  /** The screen's search: the description, the matter's title and number, the timekeeper's name. */
  readonly search?: string;
  readonly cursor?: string;
}

/**
 * The firm's fees across every matter, most recent service date first, narrowed by whatever the
 * scope names.
 *
 * The listing's second shape, and the one the firm's Fees screen is built on: the per-matter read
 * above cannot answer "what did the firm charge for work done this month" without walking every
 * matter first. Each row names its own matter, resolved by the listing, so that screen never looks
 * one up. THE NARROWINGS ARE THE SCREEN'S COLUMN FILTERS AND ITS SEARCH, sent here so they hold
 * across every page rather than over the page in hand.
 */
export function listFeeLedgerInPeriod(
  fetchImpl: typeof fetch,
  scope: FeePeriodScope,
): Promise<ApiOutcome<Page<FeeRecord>>> {
  const query = new URLSearchParams();
  if (scope.from !== undefined) query.set("from", scope.from);
  if (scope.to !== undefined) query.set("to", scope.to);
  if (scope.matterId !== undefined) query.set("matterId", scope.matterId);
  for (const status of scope.statuses ?? []) query.append("status", status);
  if (scope.billable !== undefined) query.set("billable", scope.billable ? "true" : "false");
  if (scope.search !== undefined && scope.search.trim() !== "") {
    query.set("search", scope.search.trim());
  }
  if (scope.cursor !== undefined) query.set("cursor", scope.cursor);
  const suffix = query.toString();
  return requestJson(fetchImpl, `/api/v1/fees${suffix === "" ? "" : `?${suffix}`}`);
}

/** One fee by its id — what a deep link hands the ledger when the row is not on the loaded page. */
export function readFeeLedgerEntry(
  fetchImpl: typeof fetch,
  feeEntryId: string,
): Promise<ApiOutcome<FeeRecord>> {
  return requestJson(fetchImpl, `/api/v1/fees/${encodeURIComponent(feeEntryId)}`);
}

/** What every write answers: the identity of the fee it wrote. */
export interface FeeAcknowledgement {
  feeEntryId: string;
}

/** The facts a new draft is written from. Everything else about it is the server's to decide. */
export interface DraftFee {
  readonly matterId: string;
  readonly serviceDate: string;
  readonly timekeeperUserId: string | null;
  readonly description: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly billable: boolean;
  readonly memo: string | null;
}

/**
 * Record a draft fee. The contract requires an idempotency key on the write, because a retried save
 * must not put a second charge on the matter's ledger.
 */
export function createFee(
  fetchImpl: typeof fetch,
  draft: DraftFee,
  idempotencyKey: string,
): Promise<ApiOutcome<FeeAcknowledgement>> {
  return requestJson(fetchImpl, "/api/v1/fees", { method: "POST", body: draft, idempotencyKey });
}

/** The parts of a fee the update route accepts. A billed or void fee is frozen and takes none. */
export interface FeeChanges {
  readonly serviceDate?: string;
  readonly timekeeperUserId?: string | null;
  readonly description?: string;
  readonly amountMinor?: number;
  readonly billable?: boolean;
  readonly memo?: string | null;
}

export function patchFee(
  fetchImpl: typeof fetch,
  feeEntryId: string,
  changes: FeeChanges,
  idempotencyKey: string,
): Promise<ApiOutcome<FeeAcknowledgement>> {
  return requestJson(fetchImpl, `/api/v1/fees/${encodeURIComponent(feeEntryId)}`, {
    method: "PATCH",
    body: changes,
    idempotencyKey,
  });
}

function transition(
  fetchImpl: typeof fetch,
  feeEntryId: string,
  action: string,
  idempotencyKey: string,
  body?: unknown,
): Promise<ApiOutcome<FeeAcknowledgement>> {
  return requestJson(fetchImpl, `/api/v1/fees/${encodeURIComponent(feeEntryId)}/${action}`, {
    method: "POST",
    idempotencyKey,
    ...(body === undefined ? {} : { body }),
  });
}

/** Send a draft to review. It locks until it is approved or kicked back. */
export function submitFee(
  fetchImpl: typeof fetch,
  feeEntryId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<FeeAcknowledgement>> {
  return transition(fetchImpl, feeEntryId, "submit", idempotencyKey);
}

/** Approve a submitted fee. It becomes billable on the next invoice. */
export function approveFee(
  fetchImpl: typeof fetch,
  feeEntryId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<FeeAcknowledgement>> {
  return transition(fetchImpl, feeEntryId, "approve", idempotencyKey);
}

/**
 * Return a fee to the person who recorded it, as an editable draft.
 *
 * The reason is required by the route and required by the control that sends it: what the recorder
 * has to change is the whole content of the act, and a blank one would be a rejection with no
 * instruction in it.
 */
export function kickBackFee(
  fetchImpl: typeof fetch,
  feeEntryId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ApiOutcome<FeeAcknowledgement>> {
  return transition(fetchImpl, feeEntryId, "kick-back", idempotencyKey, { reason });
}

/** Withdraw a fee. It freezes, counts toward nothing, and stays on the record. */
export function voidFee(
  fetchImpl: typeof fetch,
  feeEntryId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<FeeAcknowledgement>> {
  return transition(fetchImpl, feeEntryId, "void", idempotencyKey);
}

/**
 * Remove a draft that never entered review.
 *
 * This is NOT voiding. A draft nobody has been shown is a typing mistake and leaves nothing behind;
 * anything submitted, approved, billed or voided is a record somebody may be asked to account for,
 * and the route refuses it here rather than tombstoning it — that record is withdrawn with
 * `voidFee` and stays on the ledger.
 */
export function deleteDraftFee(
  fetchImpl: typeof fetch,
  feeEntryId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<FeeAcknowledgement>> {
  return requestJson(fetchImpl, `/api/v1/fees/${encodeURIComponent(feeEntryId)}`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/** A fresh idempotency key for one write attempt and its retries. */
export function writeKey(): string {
  return crypto.randomUUID();
}

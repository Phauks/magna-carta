/*
 * The matter Costs section's response shapes and calls. Mirrors the cost operations in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 */
import { statusEntry, type StatusKey } from "@magna-carta/design-system/status-register";
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";

export type CostStatus = "draft" | "submitted" | "approved" | "billed" | "void";

/**
 * Whether the money left the firm's own pocket. A HARD cost is cash the firm advanced to somebody
 * else -- a filing fee, a court reporter, an expert. A SOFT cost is the firm's own resource
 * consumed, like copying. The distinction governs how the cost is recovered and, in some
 * jurisdictions, whether it may be marked up at all, so it is never inferred from the amount.
 */
export type DisbursementClass = "hard" | "soft";

export interface CostSummary {
  id: string;
  matterId: string;
  vendorId: string | null;
  incurredDate: string;
  amountMinor: number;
  currency: string;
  disbursementClass: DisbursementClass;
  billable: boolean;
  utbmsExpenseCodeId: string | null;
  description: string;
  status: CostStatus;
  /** Resolved by the listing; null when no vendor was recorded or its directory entry is gone. */
  vendorName?: string | null;
  /**
   * The matter's own name and number, resolved by the listing for the same reason the vendor's is.
   *
   * A firm-wide period listing prints the matter on every row, and resolving it a row at a time
   * would be a lookup per disbursement to fill one column.
   */
  matterNumber?: string | null;
  matterTitle?: string | null;
  /**
   * The invoice that took this cost up, or null while nothing has.
   *
   * It is what puts a billed cost one click from the bill that billed it — without it, a reader who
   * wants to see what the client was actually charged has to go looking through the matter's whole
   * billing register for the document that happens to carry this line.
   */
  invoiceId?: string | null;
  /**
   * When the cost was written down — a moment, not a day, and not the day the money went out.
   *
   * A disbursement captured three weeks after the fact is a different record from one captured the
   * day it was paid, and only this and `incurredDate` together say which of the two a reader has.
   */
  createdAt: string;
  /**
   * Who wrote it down, as an identifier and as a name.
   *
   * Both, because they answer different questions: the name is what a reader is shown, and a null
   * name over a present identifier means the member row is gone rather than that nobody recorded
   * it. It is not a permission fact — a cost belongs to the matter and not to its recorder, so
   * nothing about a cost is scoped by this.
   */
  createdByUserId: string | null;
  createdByName?: string | null;
  /**
   * Why a reviewer sent this cost back, or null.
   *
   * The lifecycle makes this a single, unambiguous fact rather than a note that lingers: the
   * kick-back transition sets it and returns the cost to draft, and the next submission clears it.
   * So a non-null value means "this draft came back and has not been sent again", and there is no
   * state in which a stale reason sits on a cost that has moved on.
   */
  kickBackReason: string | null;
}

/**
 * Every cost on the matter, newest first, in every status. The status parameter is deliberately not
 * passed: a matter's cost record is all of the cost advanced for it, and narrowing to one status is
 * the work-in-progress question a different caller asks.
 */
export function listMatterCosts(
  fetchImpl: typeof fetch,
  matterId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<CostSummary>>> {
  const query = new URLSearchParams({ matterId, ...(cursor === undefined ? {} : { cursor }) });
  return requestJson(fetchImpl, `/api/v1/costs?${query.toString()}`);
}

/**
 * A cost's status crossed into the register's own vocabulary.
 *
 * The wire enum and the register's workflow-chain keys are the same five words, so a status crosses
 * from one to the other unchanged; this function is the seam that says so in the type system.
 */
export function costStatusKey(status: CostStatus): StatusKey {
  return status;
}

/** The word a status wears, taken from the register rather than spelled a second time here. */
export function statusLabel(status: CostStatus): string {
  return statusEntry(costStatusKey(status)).label;
}

export function disbursementLabel(disbursementClass: DisbursementClass): string {
  return disbursementClass === "hard" ? "Hard" : "Soft";
}

/**
 * What the matter has cost, split the way the money actually behaves. Voided lines are excluded
 * from every figure -- a withdrawn cost was not advanced. `advanced` is every live cost the firm is
 * out of pocket for; `recoverable` is the billable subset, which is what the client may be asked
 * for. They differ by exactly the costs the firm has decided to absorb, and showing only one of
 * them hides that decision.
 */
export function costTotals(entries: readonly CostSummary[]): {
  advancedMinor: number;
  recoverableMinor: number;
  currency: string | null;
} {
  let advancedMinor = 0;
  let recoverableMinor = 0;
  let currency: string | null = null;
  for (const entry of entries) {
    if (entry.status === "void") continue;
    advancedMinor += entry.amountMinor;
    if (entry.billable) recoverableMinor += entry.amountMinor;
    currency = entry.currency;
  }
  return { advancedMinor, recoverableMinor, currency };
}

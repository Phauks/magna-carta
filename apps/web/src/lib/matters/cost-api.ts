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

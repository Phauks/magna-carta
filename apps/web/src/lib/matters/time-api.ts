/*
 * The matter Time section's response shapes and calls. Mirrors the time-entry operations in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 */
import { statusEntry, type StatusKey } from "@magna-carta/design-system/status-register";
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";

export type TimeEntryStatus = "draft" | "submitted" | "approved" | "billed" | "void";

/** One time entry as the per-matter listing answers it. */
export interface TimeEntrySummary {
  id: string;
  matterId: string;
  timekeeperUserId: string;
  workDate: string;
  /** Minutes as billed, after the firm's rounding increment. */
  durationMinutes: number;
  /** Minutes as actually worked, before rounding. Differs from the above wherever rounding bit. */
  rawDurationMinutes: number;
  narrative: string;
  billable: boolean;
  amountMinor: number | null;
  currency: string;
  status: TimeEntryStatus;
  /** Resolved by the listing; null where the member row is gone. */
  timekeeperName?: string | null;
  /**
   * The task this time was worked on, where the timekeeper named one. Null on most entries, and
   * always a task on this entry's own matter — the server refuses any other.
   */
  taskId?: string | null;
}

/**
 * Every entry on the matter, newest first, in every status. The status parameter is deliberately
 * not passed: a matter's time record is all of the time on it, and narrowing to one status is the
 * work-in-progress question a different caller asks.
 */
export function listMatterTimeEntries(
  fetchImpl: typeof fetch,
  matterId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<TimeEntrySummary>>> {
  const query = new URLSearchParams({ matterId, ...(cursor === undefined ? {} : { cursor }) });
  return requestJson(fetchImpl, `/api/v1/time-entries?${query.toString()}`);
}

/*
 * How a status reads on screen: the word, its tone and its meaning all come from the product's one
 * status register. This module used to hold a second answer — labels of its own, and a tone map
 * that coloured only "void" — on the argument that a column of times must not read as a traffic
 * light. That argument lost: an entry's standing is the same fact on a time ledger, a cost ledger
 * and an invoice, and two surfaces that colour it differently teach a reader something untrue. The
 * chain's five words are all toned, and there is exactly one place that decides how.
 *
 * The wire enum and the register's workflow-chain keys are the same five words, so a status crosses
 * from one to the other unchanged; this function is the seam that says so in the type system.
 */
export function timeEntryStatusKey(status: TimeEntryStatus): StatusKey {
  return status;
}

/** The word a status wears, taken from the register rather than spelled a second time here. */
export function statusLabel(status: TimeEntryStatus): string {
  return statusEntry(timeEntryStatusKey(status)).label;
}

/** Minutes as hours, to one decimal, the way a timesheet reads. */
export function hoursFromMinutes(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

/**
 * Billable minutes and their money, over the entries that still count. A voided entry is excluded
 * from both: it is a line that was withdrawn, and adding it to a total would misstate the matter.
 */
export function billableTotals(entries: readonly TimeEntrySummary[]): {
  minutes: number;
  amountMinor: number;
  currency: string | null;
} {
  let minutes = 0;
  let amountMinor = 0;
  let currency: string | null = null;
  for (const entry of entries) {
    if (entry.status === "void" || !entry.billable) continue;
    minutes += entry.durationMinutes;
    if (entry.amountMinor !== null) {
      amountMinor += entry.amountMinor;
      currency = entry.currency;
    }
  }
  return { minutes, amountMinor, currency };
}

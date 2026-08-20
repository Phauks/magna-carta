/*
 * The matter Time section's response shapes and calls. Mirrors the time-entry operations in
 * apps/worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

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
}

/**
 * Every entry on the matter, newest first, in every status. The status parameter is deliberately
 * not passed: a matter's time record is all of the time on it, and narrowing to one status is the
 * work-in-progress question a different caller asks.
 */
export function listMatterTimeEntries(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<{ data: TimeEntrySummary[] }>> {
  const query = new URLSearchParams({ matterId });
  return requestJson(fetchImpl, `/api/v1/time-entries?${query.toString()}`);
}

/*
 * How a status reads on screen. Not every one of these is a state a person put the entry in --
 * "billed" is where an invoice left it, "void" is where a correction left it -- so the labels say
 * what happened rather than naming the enum.
 */
const STATUS_LABELS: Record<TimeEntryStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  billed: "Billed",
  void: "Void",
};

export function statusLabel(status: TimeEntryStatus): string {
  return STATUS_LABELS[status];
}

/**
 * The status colour register. Only "void" earns a warning tone: it is the one status that means
 * the line does NOT count, and a reader scanning a column of times has to see that without
 * reading. The rest are ordinary progress and stay neutral, so the table does not turn into a
 * traffic light over information nobody needs coloured.
 */
export function statusTone(status: TimeEntryStatus): "neutral" | "warning" {
  return status === "void" ? "warning" : "neutral";
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

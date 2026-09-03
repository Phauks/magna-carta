/*
 * The matter Time section's response shapes and calls. Mirrors the time-entry operations in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 */
import { statusEntry, type StatusKey } from "@magna-carta/design-system/status-register";
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";

export type TimeEntryStatus = "draft" | "submitted" | "approved" | "billed" | "void";

/** Where a resolved rate came from, in the chain's own order. */
export type RateSource = "override" | "matter" | "client" | "timekeeper" | "role" | "card_default";

/** How an entry reached the record. */
export type TimeEntrySource =
  | "timer"
  | "manual"
  | "quick_add"
  | "grid"
  | "offline_sync"
  | "calendar";

/**
 * One time entry as the listing answers it.
 *
 * EVERY FIELD THE CONTRACT SERVES IS DECLARED HERE. A type that names a subset is not a smaller
 * truth, it is a screen that cannot see what the server sent: the surfaces read this interface to
 * decide what they can render, so a field missing here renders as a gap on a record that has one.
 * That is how the entry number, both dates, both people, the resolved rate, the UTBMS codes, the
 * memo and the attachment count spent a release marked "not recorded yet" while the listing was
 * carrying all of them.
 */
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
   * The rate frozen on the entry at capture, at scale 4, with where it came from and which card
   * resolved it. All three are null on non-billable internal time, which is a statement that
   * nothing is charged rather than a rate of zero.
   */
  rateE4?: number | null;
  rateSource?: RateSource | null;
  rateCardId?: string | null;
  /** The UTBMS task code — the entry's category — as its identifier, its code and its label. */
  utbmsTaskCodeId?: string | null;
  utbmsTaskCode?: string | null;
  utbmsTaskLabel?: string | null;
  /** The UTBMS activity code, the same three ways. */
  utbmsActivityCodeId?: string | null;
  utbmsActivityCode?: string | null;
  utbmsActivityLabel?: string | null;
  /** How the entry was captured: a timer, a typed row, the weekly grid, a quick add. */
  source?: TimeEntrySource;
  /** The invoice a billed entry rides. Null until billing locks the row. */
  invoiceId?: string | null;
  /** The firm's own note. Internal by contract: no client-facing projection selects it. */
  memo?: string | null;
  /**
   * The matter-scoped reference ("2026-0147.0042"), immutable and never reused.
   *
   * Null on an entry captured before the sequence existed — an honest gap the surfaces render as
   * one, never a number invented to fill the column.
   */
  entryNumber?: string | null;
  /** When the entry was written down, as distinct from the day the work was FOR. */
  createdAt?: string;
  /** Who wrote it down. The same person as the timekeeper unless somebody entered it for them. */
  createdByUserId?: string | null;
  createdByName?: string | null;
  /** How many of the matter's documents this entry points at. */
  attachmentCount?: number;
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
/** One time entry by its id — what a deep link hands the ledger when the row is not on the loaded page. */
export function readTimeEntry(
  fetchImpl: typeof fetch,
  timeEntryId: string,
): Promise<ApiOutcome<TimeEntrySummary>> {
  return requestJson(fetchImpl, `/api/v1/time-entries/${encodeURIComponent(timeEntryId)}`);
}

export function timeEntryStatusKey(status: TimeEntryStatus): StatusKey {
  return status;
}

/** The word a status wears, taken from the register rather than spelled a second time here. */
export function statusLabel(status: TimeEntryStatus): string {
  return statusEntry(timeEntryStatusKey(status)).label;
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

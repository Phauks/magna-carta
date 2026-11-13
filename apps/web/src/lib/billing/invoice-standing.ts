/*
 * What a bill is, worked out rather than looked up.
 *
 * NONE OF THIS IS STORED, AND THAT IS THE POINT. An invoice's standing, what a matter still owes on
 * it, and whether it is overdue are all derived from the per-matter balances at the moment somebody
 * asks. A stored "overdue" flag is a flag that is wrong every morning; a stored "unpaid" is a number
 * that drifts from what was actually applied. So the record holds the balances and this file holds
 * the arithmetic, and the two can never disagree.
 *
 * A DRAFT HAS NO STORED TOTAL. Balances are created at finalization, so before that the only figure
 * a draft has is the sum of the lines it is carrying, and it moves as work is claimed and released.
 * That is why `matterShare` reads lines for a draft and balances for a bill.
 *
 * MONEY STAYS IN MINOR UNITS. Every function here takes and returns whole cents. Rendering is the
 * surface's job, and it happens once, at the end.
 */
import type { StatusKey } from "@magna-carta/design-system/status-register";
import type {
  CreditNote,
  InvoiceDetail,
  InvoiceDeliveryState,
  InvoiceListItem,
} from "./billing-api.ts";

/** An invoice list row together with whatever of its detail has been read. */
export interface InvoiceRow {
  readonly summary: InvoiceListItem;
  /** The detail, once it has landed. Null while it is still being read. */
  readonly detail: InvoiceDetail | null;
  /** The credit notes recorded beside it, once read. Null while unread. */
  readonly creditNotes: readonly CreditNote[] | null;
}

/**
 * The bill's standing, in the product's own status vocabulary.
 *
 * Draft and Void are the invoice's own status. The other three are arithmetic over what has been
 * applied: nothing applied is Unpaid, some of it is Partially Paid, all of it is Paid.
 */
export function invoiceStanding(row: InvoiceRow): StatusKey {
  const invoice = row.summary;
  if (invoice.status === "draft") return "draft";
  if (invoice.status === "void") return "void";
  if (invoice.appliedMinor <= 0) return "unpaid";
  return invoice.appliedMinor < invoice.totalMinor ? "partially-paid" : "paid";
}

/** Where the bill has reached on the Draft to Finalized to Paid chain. */
export type BillStage = "draft" | "finalized" | "paid";

export function billStage(row: InvoiceRow): BillStage {
  if (row.summary.status !== "final") return "draft";
  return invoiceStanding(row) === "paid" ? "paid" : "finalized";
}

/** The sum of a draft's lines: the only total a draft has, and it moves as work is claimed. */
export function draftTotalMinor(detail: InvoiceDetail | null): number {
  if (detail === null) return 0;
  return detail.lines.reduce((total, line) => total + line.amountMinor, 0);
}

/**
 * This matter's share of the bill, or null where the bill charges nothing at all.
 *
 * A draft's share is the lines it carries; a finalized bill's is its per-matter balance. A voided
 * draft has no share, because it never charged anybody anything.
 *
 * THE LISTING ROW ANSWERS FIRST, AND THE DETAIL IS THE FALLBACK. A listing narrowed to a matter
 * carries that matter's own figures on every row, so the column is right the moment the list lands
 * rather than after each bill's detail has been read. A row read in a scope that named no matter —
 * the firm's own register — has no such figures, and there the detail answers as it always did.
 */
export function matterShareMinor(row: InvoiceRow, matterId: string): number | null {
  if (row.summary.status === "void") return null;
  if (row.summary.status === "draft") {
    if (row.summary.matterLinesMinor !== undefined) return row.summary.matterLinesMinor;
    if (row.detail === null) return null;
    return row.detail.lines
      .filter((line) => line.matterId === matterId)
      .reduce((total, line) => total + line.amountMinor, 0);
  }
  if (row.summary.matterTotalMinor !== undefined) return row.summary.matterTotalMinor;
  const balance = row.detail?.matterBalances.find((entry) => entry.matterId === matterId);
  return balance === undefined ? null : balance.totalMinor;
}

/**
 * What this matter still owes on the bill, or null where the question does not arise.
 *
 * A draft owes nothing yet — balances are created at finalization — and a voided draft never owed
 * anything. Both answer null rather than zero, because a zero would read as "settled".
 *
 * The listing row answers first, on the same terms as the share above.
 */
export function matterUnpaidMinor(row: InvoiceRow, matterId: string): number | null {
  if (row.summary.status !== "final") return null;
  const total = row.summary.matterTotalMinor;
  const applied = row.summary.matterAppliedMinor;
  if (total !== undefined && applied !== undefined) {
    return total === null || applied === null ? null : total - applied;
  }
  const balance = row.detail?.matterBalances.find((entry) => entry.matterId === matterId);
  return balance === undefined ? null : balance.unpaidMinor;
}

/** What the whole bill still owes, across every matter it charges. */
export function billUnpaidMinor(row: InvoiceRow): number {
  return row.summary.totalMinor - row.summary.appliedMinor;
}

/** What credit notes have taken off this bill, in total. */
export function creditedMinor(row: InvoiceRow): number {
  return (row.creditNotes ?? []).reduce((total, note) => total + note.totalMinor, 0);
}

/**
 * How many days past due an unpaid bill is, or zero where it is not late.
 *
 * Worked out from the date at the moment of asking, never a stored flag: a bill settled this
 * morning is never reported as late, and one that fell due overnight reports itself without anybody
 * running a sweep.
 */
export function overdueDays(row: InvoiceRow, today: string): number {
  const invoice = row.summary;
  if (invoice.status !== "final" || invoice.dueDate === null) return 0;
  if (billUnpaidMinor(row) <= 0) return 0;
  const due = Date.parse(`${invoice.dueDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(now)) return 0;
  const days = Math.round((now - due) / 86_400_000);
  return days > 0 ? days : 0;
}

/** Which matters a bill charges, whether it is a draft (its lines) or finalized (its balances). */
export function billedMatterIdentifiers(row: InvoiceRow): readonly string[] {
  const detail = row.detail;
  if (detail === null) return [];
  const source =
    detail.status === "final"
      ? detail.matterBalances.map((balance) => balance.matterId)
      : detail.lines.map((line) => line.matterId);
  return [...new Set(source)];
}

/**
 * The word the Delivered column filters and sorts on.
 *
 * A word rather than a formatted date, deliberately: the column's filter is the question a firm
 * actually asks of it — has this bill reached the client at all — and a set filter over one distinct
 * date per bill would offer a list nobody can use. The cell shows the date; the model answers the
 * question.
 */
export function deliveryStateWord(row: InvoiceRow): string {
  const state = row.detail?.delivery;
  if (state === undefined) return "Not read";
  if (state.delivered) return "Delivered";
  if (state.attemptCount > 0) return "All attempts failed";
  return row.summary.status === "final" ? "None recorded" : "Not deliverable yet";
}

/** How the Delivered column reads, and what its hover says. */
export interface DeliveryReading {
  readonly key: "delivered" | "failed" | "none" | "unreadable";
  readonly text: string;
  readonly title: string;
}

const PLATFORM_SENDS_NOTHING =
  "Magna Carta records deliveries the firm made. It doesn't send bills.";

export function deliveryReading(
  row: InvoiceRow,
  formatDate: (isoDate: string) => string,
): DeliveryReading {
  const state: InvoiceDeliveryState | undefined = row.detail?.delivery;
  if (state === undefined) {
    return {
      key: "unreadable",
      text: "—",
      title: "This bill's delivery record has not been read yet.",
    };
  }
  if (state.delivered && state.deliveredOn !== null) {
    const attempts =
      state.attemptCount === 1 ? "1 attempt" : `${String(state.attemptCount)} attempts`;
    return {
      key: "delivered",
      text: formatDate(state.deliveredOn),
      title: `First delivered ${formatDate(state.deliveredOn)} · ${attempts}. ${PLATFORM_SENDS_NOTHING}`,
    };
  }
  if (state.attemptCount > 0) {
    return {
      key: "failed",
      text: `Failed · ${String(state.attemptCount)}`,
      title: `Every recorded attempt failed. ${PLATFORM_SENDS_NOTHING}`,
    };
  }
  if (row.summary.status === "final") {
    return {
      key: "none",
      text: "None recorded",
      title: "No delivery of this bill has been recorded.",
    };
  }
  return { key: "none", text: "—", title: "Only a finalized bill can be delivered." };
}

/**
 * What the invoice column says where there is no number.
 *
 * A draft has not drawn one and a voided draft never will, and those are different facts: the first
 * is waiting, the second is finished. Neither is an absence to be rendered as a dash.
 */
export function invoiceReference(row: InvoiceRow): string {
  if (row.summary.invoiceNumber !== null) return row.summary.invoiceNumber;
  return row.summary.status === "draft" ? "Draft" : "Draft (voided)";
}

/**
 * The single sentence a bill states about being locked, or about not being locked yet.
 *
 * It is one printed line rather than a paragraph per state, and it says the thing that governs what
 * can be done next: a finalized bill is evidence and is corrected beside itself; a draft has
 * asserted nothing to anybody; a voided draft gave its work back.
 */
export function billLockLine(row: InvoiceRow): string {
  switch (row.summary.status) {
    case "final":
      return "A finalized bill can't be edited or un-finalized. To correct it, add a credit note. Money already collected is returned as a client credit.";
    case "draft":
      return "A draft can still change. It has no number and no work is locked until it's finalized.";
    default:
      return "This draft was voided and its work is unbilled again. To correct a finalized bill, add a credit note instead.";
  }
}

/** Today, as the civil date the billing routes take. */
export function civilToday(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * A civil date shifted by whole days, for the due date a draft dialog offers.
 *
 * The arithmetic runs in UTC on purpose: a civil date has no time zone, and stepping it through a
 * local-time Date is how a due date lands a day early for half the world.
 */
export function civilDatePlusDays(isoDate: string, days: number): string {
  const parsed = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed)) return isoDate;
  const shifted = new Date(parsed + days * 86_400_000);
  const year = String(shifted.getUTCFullYear()).padStart(4, "0");
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

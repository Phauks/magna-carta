import { DEFAULT_PAGE_SIZE } from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { CustodyItemId, CustodyPacketId } from "@magna-carta/identifiers/types";
import { overdueBucket, readOverdueCustodyCheckouts } from "./queries.ts";
import { readCustodyReviewsDue } from "./review-statements.ts";
import { calendarDate } from "./review-service.ts";

// THE EMISSION POINT. Everything this subsystem would ever want to remind a firm about resolves
// here, in one shape, from one call — a review that has come round and a check-out that has not come
// back. It is deliberately a QUERY, not a scheduler: there is no cron entry, no queue, no per-firm
// timer and no delivery in this package. Two consequences that are the point of building it this way:
//
//   - The register's reports read it directly, so the reminders are usable today with nothing else
//     built. A firm looks at the list; that is a legitimate answer for a subsystem whose events are
//     measured in years.
//   - When the Notifications registry lands, delivery subscribes to THIS function rather than
//     growing a second definition of "what is due". Wiring a delivery channel is then a change in
//     the notifications layer, not a redesign here — and the two reminder reasons cannot drift apart
//     into two schedulers with two answers.
//
// Nothing here carries an owner name, a borrower, an item description, or a location name. A
// reminder identifies the OBJECT (a handle and its custody number, which the recipient already has
// access to read) and says why it surfaced.

export type CustodyReminderReason = "review-due" | "checkout-overdue";

export interface CustodyReminder {
  readonly reason: CustodyReminderReason;
  readonly packetId: CustodyPacketId;
  // Set when the reminder is about one thing inside the packet rather than the packet itself.
  readonly itemId: CustodyItemId | null;
  readonly custodyNumber: string;
  // The calendar date the thing was due — a review date, or a due-back date.
  readonly dueOn: string;
  readonly daysOverdue: number;
  // Coarse age band, the same vocabulary the overdue gauge reports. Low-cardinality by construction
  // so a caller can aggregate without ever touching the object.
  readonly bucket: "0-7d" | "8-30d" | "31-90d" | "over-90d";
}

export interface CollectCustodyRemindersOptions {
  // Per-reason cap. A reminder run that would produce thousands of rows is a firm that has never
  // looked at its register, and truncating is better than either a timeout or a mail-bomb.
  readonly limit?: number;
}

const MILLISECONDS_PER_DAY = 86_400_000;

export async function collectCustodyReminders(
  database: SqlDatabase,
  asOfDate: string,
  options: CollectCustodyRemindersOptions = {},
): Promise<CustodyReminder[]> {
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const asOf = calendarDate(asOfDate);
  const [reviews, overdue] = await Promise.all([
    readCustodyReviewsDue(database, asOf, limit),
    readOverdueCustodyCheckouts(database, asOf, limit),
  ]);
  const dueReviews = reviews.map((row) =>
    reminderFor("review-due", row.packet_id, row.item_id, row.custody_number, row.review_on, asOf),
  );
  const dueCheckouts = overdue.map((row) =>
    reminderFor("checkout-overdue", row.packetId, null, row.custodyNumber, row.dueBackOn, asOf),
  );
  // Both reads already come back oldest first, so the combined list is a merge rather than a sort —
  // linear, stable, and it cannot disagree with the order the two underlying reads promised.
  return mergeByDueDate(dueReviews, dueCheckouts);
}

function mergeByDueDate(
  left: readonly CustodyReminder[],
  right: readonly CustodyReminder[],
): CustodyReminder[] {
  const merged: CustodyReminder[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const nextLeft = left[leftIndex];
    const nextRight = right[rightIndex];
    if (nextLeft === undefined || nextRight === undefined) break;
    // Ties go to the review: a date somebody set is a commitment the firm made to itself, and it
    // reads better at the top of a list than a borrowing that happens to share the date.
    if (nextLeft.dueOn <= nextRight.dueOn) {
      merged.push(nextLeft);
      leftIndex += 1;
    } else {
      merged.push(nextRight);
      rightIndex += 1;
    }
  }
  merged.push(...left.slice(leftIndex), ...right.slice(rightIndex));
  return merged;
}

function reminderFor(
  reason: CustodyReminderReason,
  packetId: CustodyPacketId,
  itemId: CustodyItemId | null,
  custodyNumber: string,
  dueOn: string,
  asOf: string,
): CustodyReminder {
  const daysOverdue = Math.max(
    0,
    Math.floor((Date.parse(asOf) - Date.parse(calendarDate(dueOn))) / MILLISECONDS_PER_DAY),
  );
  return {
    reason,
    packetId,
    itemId,
    custodyNumber,
    dueOn: calendarDate(dueOn),
    daysOverdue,
    bucket: overdueBucket(daysOverdue),
  };
}

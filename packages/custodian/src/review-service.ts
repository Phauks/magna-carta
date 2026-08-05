import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  CustodyItemId,
  CustodyMovementId,
  CustodyPacketId,
} from "@magna-carta/identifiers/types";
import { custodyAuditStatement, type CustodyAuditContext } from "./audit.ts";
import { insertCustodyMovementStatement } from "./movement-statements.ts";
import { readCustodyItem, readCustodyPacket } from "./packet-statements.ts";
import {
  CustodyIdempotencyConflictError,
  type CustodyIdempotencyContext,
} from "./packet-service.ts";
import {
  rollCustodyItemReviewStatement,
  rollCustodyPacketReviewStatement,
} from "./review-statements.ts";
import { TERMINAL_PACKET_STATUSES } from "./types.ts";
import { CustodyValidationError } from "./validation.ts";

// Completing a review. A review is "look at this again", not a deadline and not a retention clock —
// nothing expires when a review date passes, and nothing here derives a date the firm did not set.
// What a completed review does is two things at once, in one commit: it appends a `reviewed`
// movement (the ledger is this subsystem's only record that anything happened) and it rolls the
// scheduled date forward by the firm's own interval.
//
// The roll is ANNIVERSARY-anchored, not "today plus the interval". A packet on a five-year cycle
// reviewed eight months late stays on its original anniversary rather than drifting a third of a
// year every cycle; a review left ten years takes as many whole intervals as it needs to land past
// the review date, so the answer is never itself already overdue.

export interface CompleteCustodyReviewOptions extends CustodyAuditContext {
  readonly idempotency?: CustodyIdempotencyContext;
  readonly randomSource?: RandomSource;
}

export interface CompleteCustodyReviewInput {
  // Which object was reviewed. Absent means the packet itself; an item id means one thing inside it.
  readonly itemId?: CustodyItemId | null;
  // When the review actually happened, if that is not now. Back-dating is supported here for the
  // same reason it is on every other movement: the physical act and the typing are different events.
  readonly occurredAt?: string;
  // An explicit next date, when the firm wants one that is not the interval's answer. Null clears
  // the schedule outright — "we have looked at this and it does not need looking at again".
  readonly nextReviewOn?: string | null;
  readonly note?: string | null;
}

export interface CompletedCustodyReview {
  readonly movementId: CustodyMovementId;
  readonly nextReviewOn: string | null;
  readonly replayed: boolean;
}

// The body stored on the idempotency record, which the chokepoint replays verbatim to a retrying
// client. Keyed `id` because that is the platform's created-resource wire shape.
interface StoredReviewResponse {
  readonly id: CustodyMovementId;
  readonly nextReviewOn: string | null;
}

export async function completeCustodyReview(
  database: BatchDatabase,
  packetId: CustodyPacketId,
  input: CompleteCustodyReviewInput,
  options: CompleteCustodyReviewOptions,
): Promise<CompletedCustodyReview> {
  const packet = await readCustodyPacket(database, packetId);
  if (packet === undefined) {
    throw new CustodyValidationError(
      "custody-unknown-packet",
      `no such custody packet: ${packetId}`,
    );
  }
  if (TERMINAL_PACKET_STATUSES.includes(packet.status)) {
    throw new CustodyValidationError(
      "custody-packet-closed",
      `this packet is ${packet.status}; the firm no longer holds it, so there is nothing to review`,
    );
  }
  const item = input.itemId == null ? undefined : await readCustodyItem(database, input.itemId);
  if (input.itemId != null && item === undefined) {
    throw new CustodyValidationError(
      "custody-unknown-item",
      `no such custody item: ${input.itemId}`,
    );
  }
  if (item !== undefined && item.packet_id !== packetId) {
    throw new CustodyValidationError(
      "custody-invalid-movement",
      "the item named by this review belongs to a different packet",
    );
  }

  const scheduled = item === undefined ? packet.review_on : item.review_on;
  if (scheduled === null) {
    throw new CustodyValidationError(
      "custody-no-review-scheduled",
      "nothing is scheduled for review here — set a review date before recording a completed review",
    );
  }
  const intervalMonths =
    item === undefined ? packet.review_interval_months : item.review_interval_months;
  const movementId = newIdentifier("custodyMovement", options.randomSource);

  const result = await runIdempotentEffect({
    database,
    key: options.idempotency?.key,
    fingerprint: options.idempotency?.fingerprint ?? "",
    newRecordId: options.idempotency?.newRecordId,
    now: () => options.clock.now(),
    effect: () => {
      const now = options.clock.now();
      const occurredAt = input.occurredAt ?? now;
      const nextReviewOn =
        input.nextReviewOn === undefined
          ? nextReviewDate(scheduled, calendarDate(occurredAt), intervalMonths)
          : input.nextReviewOn;
      const statements: SqlStatement[] = [
        insertCustodyMovementStatement(database, {
          id: movementId,
          packetId,
          itemId: input.itemId ?? null,
          kind: "reviewed",
          occurredAt,
          recordedAt: now,
          recordedByUserId: options.actorUserId,
          fromLocationId: null,
          toLocationId: null,
          borrowerKind: null,
          borrowerUserId: null,
          borrowerEntityId: null,
          borrowerName: null,
          dueBackOn: null,
          reason: null,
          correctsMovementId: null,
          shipmentId: null,
          note: input.note ?? null,
        }),
        item === undefined
          ? rollCustodyPacketReviewStatement(database, packetId, nextReviewOn, scheduled, now)
          : rollCustodyItemReviewStatement(database, item.id, nextReviewOn, scheduled, now),
        custodyAuditStatement(database, options, "custodyReview.completed", movementId, {
          packetId,
          itemId: input.itemId ?? null,
          rescheduled: nextReviewOn !== null,
        }),
      ];
      const value: StoredReviewResponse = { id: movementId, nextReviewOn };
      return Promise.resolve({
        write: { statements, outboxMessages: [] },
        responseCode: 201,
        responseBody: canonicalJsonStringify(value),
      });
    },
  });

  switch (result.kind) {
    case "executed":
    case "replayed": {
      if (result.responseBody === null) {
        throw new Error("custody review effect stored no response body");
      }
      const value = JSON.parse(result.responseBody) as StoredReviewResponse;
      return {
        movementId: value.id,
        nextReviewOn: value.nextReviewOn,
        replayed: result.kind === "replayed",
      };
    }
    case "in-progress":
      throw new CustodyIdempotencyConflictError("in-progress");
    case "fingerprint-mismatch":
      throw new CustodyIdempotencyConflictError("fingerprint-mismatch");
  }
}

// The calendar date an instant falls on. Review dates are calendar dates, never instants: "review
// this in five years" is a day on a wall calendar, and giving it a time of day would make the answer
// depend on the hour the review was typed in.
export function calendarDate(value: string): string {
  return value.slice(0, 10);
}

// The next scheduled review after `completedOn`, anchored on `scheduled` and stepped by whole
// intervals. Returns null when there is no interval — a one-off review is done, not rescheduled.
export function nextReviewDate(
  scheduled: string,
  completedOn: string,
  intervalMonths: number | null,
): string | null {
  if (intervalMonths === null || intervalMonths <= 0) return null;
  const anchor = calendarDate(scheduled);
  const floor = completedOn > anchor ? completedOn : anchor;
  // Bounded rather than a while(true): a corrupt anchor (a date the schema would have refused) must
  // truncate to an obviously-wrong answer rather than spin. The bound is far past any real cycle —
  // a monthly review left un-completed for a century needs 1200 steps.
  const maxSteps = 2000;
  let next = anchor;
  for (let step = 1; step <= maxSteps; step++) {
    next = addCalendarMonths(anchor, intervalMonths * step);
    if (next > floor) return next;
  }
  return next;
}

// Calendar-month arithmetic with end-of-month clamping, stated rather than assumed: 31 January plus
// one month is 28 February (29 in a leap year), not 3 March. Written out here rather than taken from
// a Date round-trip because Date's month overflow rolls INTO the next month, which would silently
// move an annual review off its anniversary for every date after the 28th.
export function addCalendarMonths(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const zeroBased = month - 1 + months;
  const nextYear = year + Math.floor(zeroBased / 12);
  const nextMonth = ((zeroBased % 12) + 12) % 12;
  const clampedDay = Math.min(day, daysInMonth(nextYear, nextMonth));
  return `${pad(nextYear, 4)}-${pad(nextMonth + 1, 2)}-${pad(clampedDay, 2)}`;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(year: number, zeroBasedMonth: number): number {
  if (zeroBasedMonth === 1 && isLeapYear(year)) return 29;
  return MONTH_LENGTHS[zeroBasedMonth] ?? 30;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

// Reads the review schedule off a packet without loading the whole detail — the report path's
// cheapest question.
export async function readCustodyPacketReviewSchedule(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): Promise<{ reviewOn: string | null; reviewIntervalMonths: number | null } | undefined> {
  const packet = await readCustodyPacket(database, packetId);
  if (packet === undefined) return undefined;
  return { reviewOn: packet.review_on, reviewIntervalMonths: packet.review_interval_months };
}

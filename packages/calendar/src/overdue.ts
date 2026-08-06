import { endOfCivilDayInstant, instantForCivilDateTime } from "./time-zone.ts";

// Overdue is a COMPARISON, not a column. Nothing in this package writes it, no sweep maintains it,
// and no state transition records it.
//
// Three reasons, and the third decides it. A stored flag needs a per-firm sweep to maintain, which
// is machinery for a fact that is a subtraction. A stored flag can be WRONG — stale by up to the
// sweep interval — where a comparison cannot. And a platform that writes "missed" onto a firm's
// record has made an assertion about that firm's conduct it is not in a position to make: the
// deadline may have been extended by a stipulation nobody has typed in yet, satisfied by a filing
// recorded under another matter, or vacated by an order that arrived this morning. The platform
// reports what it can see. It does not adjudicate.

export interface DeadlineDueFacts {
  readonly dueOn: string; // civil date, YYYY-MM-DD
  readonly dueAtTime: string | null; // wall clock, HH:MM; null means "by the end of that day"
  readonly timeZone: string; // IANA identifier — the COURT'S zone, not the office's
  readonly state: string;
}

// The absolute instant a deadline falls due, in its own zone. A deadline with no recorded time is
// due at the END of its day rather than at its midnight: a filing deadline whose hour nobody wrote
// down is not missed at one minute past midnight, and reporting it that way would flag a whole day's
// worth of live deadlines as overdue every night.
export function dueInstantMilliseconds(deadline: DeadlineDueFacts): number {
  return deadline.dueAtTime === null
    ? endOfCivilDayInstant(deadline.dueOn, deadline.timeZone)
    : instantForCivilDateTime(deadline.dueOn, deadline.dueAtTime, deadline.timeZone);
}

// Overdue: still open, and its due instant has passed. A satisfied, vacated, or superseded deadline
// is never overdue however old it is — the firm dealt with it, and a list that kept reporting it
// would be a list nobody reads.
export function isOverdue(deadline: DeadlineDueFacts, now: string): boolean {
  if (deadline.state !== "open") return false;
  const nowMilliseconds = Date.parse(now);
  if (Number.isNaN(nowMilliseconds)) return false;
  return dueInstantMilliseconds(deadline) < nowMilliseconds;
}

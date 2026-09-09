import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import type { SequenceNumberingTables } from "@magna-carta/sequence-numbering/counter-statements";
import { COMMUNICATION_TABLE } from "./communication-statements.ts";

// The number a person says out loud about one call or one text.
//
// WHY A RECORD THAT ALREADY HAS A HANDLE NEEDS ONE (owner ruling, 2026-09-08). A handle is what the
// platform joins on; it is not something a receptionist can read back down a telephone, write on a
// message slip, or quote in a note on the file. Every other record a firm refers to out loud carries
// one — a matter, a time entry, an invoice, a custody packet — and a call is referred to out loud
// more often than any of them, because the person on the other end of it is still on the line.
//
// IT CARRIES THE DAY. `2026-09-08-0042` is the forty-second call or text the firm recorded as
// happening on the eighth. That is what makes it legible without a lookup — the reader knows when it
// happened from the number alone — and it is why the sequence is scoped per day rather than per
// firm: a firm-wide run reaches five digits inside a year and stops being a number anybody can read
// back.
//
// THE DAY IS THE UTC DAY OF THE INSTANT, which is the platform's rule for the day of a recorded
// moment used as a key (docs/conventions/dates.md — "the UTC day, for a query key or a sweep
// bucket"). A number is a key before it is a sentence: pinned to UTC it reads the same in every
// office, where a number derived from the reader's own zone would name two different days for one
// call depending on who was looking at it. What day the call fell on WHERE THE READER IS stays the
// record's own When field, which is rendered in their zone.

// The shared draw loop takes a tables record so it can recognise a conflict on an ALLOCATION table.
// This sequence has none, and that is the one place it departs from its three siblings: the rendered
// number contains the whole of its scope — the day is the scope key — so two draws that observed the
// same counter value in one day render byte-identical strings, and the partial unique index on
// `communication.reference_number` aborts the loser exactly as an allocation primary key would. The
// allocation half below therefore names the table that index is on and is never written to; the
// conflict this sequence actually raises is named by `isCommunicationNumberConflict`.
export const COMMUNICATION_NUMBERING_TABLES: SequenceNumberingTables = {
  counterTable: "communication_number_counter",
  allocationTable: COMMUNICATION_TABLE,
  ownerColumn: "id",
};

// The first number a day hands out. A sequence that starts at zero produces a call numbered 0, which
// reads as an error rather than as the first call of the day.
export const COMMUNICATION_NUMBER_START_VALUE = 1;

// Four digits, on the time entry's reasoning: it covers a day of any firm's traffic, and a firm past
// 9999 calls in one day simply grows a fifth digit rather than wrapping or refusing.
const COMMUNICATION_NUMBER_PAD_WIDTH = 4;

/** The counter a call drawn for this instant counts within: the UTC day it happened on. */
export function communicationNumberScope(occurredAt: string): string {
  return civilDateOf(occurredAt);
}

/** One rendered reference number: the day, then the day's own sequence. */
export function renderCommunicationNumber(scopeKey: string, drawnValue: number): string {
  return `${scopeKey}-${String(drawnValue).padStart(COMMUNICATION_NUMBER_PAD_WIDTH, "0")}`;
}

// The collision the counter cannot see by itself, and the load-bearing backstop on the draw: the
// partial UNIQUE index on `communication.reference_number`. Registered as the bounded retry's
// `alsoRetryable`, mirroring the matter number's arrangement with its own rendered-number index.
export function isCommunicationNumberConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${COMMUNICATION_TABLE}.reference_number`)
  );
}

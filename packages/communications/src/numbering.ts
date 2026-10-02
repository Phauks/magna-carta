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

/**
 * The day a call drawn for this instant is numbered under — the UTC day it happened on, which the
 * scheme's year, month and day parts render and scope the count by.
 *
 * What the number LOOKS like is the firm's own choice now, written on the numbering settings screen
 * under the `communication` purpose and read by the shared draw planner; the built-in default
 * renders the same `2026-09-08-0042` this run has always rendered, and lives on the purpose
 * register in @magna-carta/sequence-numbering with the reasoning for its shape.
 */
export function communicationNumberDate(occurredAt: string): string {
  return civilDateOf(occurredAt);
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

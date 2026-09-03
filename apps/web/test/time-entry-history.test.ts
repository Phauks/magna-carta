/*
 * An entry's recorded events, in the words a reader uses.
 *
 * The audit trail names events the way the write path does, so the translation is the whole of
 * this module — and the two cases worth holding still are the ones that would otherwise rot: an
 * event nobody has taught it, and metadata that is a field list rather than something a person
 * wrote.
 */
import { describe, expect, it } from "vitest";
import { historyEvents } from "../src/lib/time/time-entry-history.ts";
import type { TimeEntryEvent } from "../src/lib/time/time-operations.ts";

function event(overrides: Partial<TimeEntryEvent> = {}): TimeEntryEvent {
  return {
    at: "2026-08-12T09:00:00.000Z",
    event: "time_entry.captured",
    actorUserId: "user_osei",
    actorName: "Rosalind Osei",
    detail: null,
    ...overrides,
  };
}

describe("what an event is called on screen", () => {
  it("reads the recorded events as a person would say them", () => {
    const [captured, kicked] = historyEvents([event(), event({ event: "time_entry.kicked_back" })]);
    expect(captured?.action).toBe("Entered as a draft");
    expect(kicked?.action).toBe("Kicked back to draft");
  });

  /*
   * The server will grow events this file has not been told about. The honest answer to one is the
   * event's own name read back — never a blank row, and never a guess at what it meant.
   */
  it("reads an event it has never been taught rather than dropping it", () => {
    const [unknown] = historyEvents([event({ event: "time_entry.re_dated_by_supervisor" })]);
    expect(unknown?.action).toBe("Re dated by supervisor");
  });

  it("names the platform where nothing human acted", () => {
    const [system] = historyEvents([event({ actorUserId: null, actorName: null })]);
    expect(system?.source).toBe("Magna Carta");
  });

  /*
   * The audit's metadata is redacted by construction: it records WHICH fields an edit touched,
   * never their text. So the only thing worth quoting under an event is a reason somebody actually
   * wrote, and a field list must not be dressed up as one.
   */
  it("quotes a reason somebody wrote, and nothing else the audit recorded", () => {
    const [withReason] = historyEvents([
      event({
        event: "time_entry.kicked_back",
        detail: { reason: "The narrative names no client" },
      }),
    ]);
    expect(withReason?.detail).toBe("The narrative names no client");

    const [withFieldList] = historyEvents([
      event({ event: "time_entry.updated", detail: { fields: ["narrative", "workDate"] } }),
    ]);
    expect(withFieldList?.detail).toBeUndefined();

    const [withBlankReason] = historyEvents([event({ detail: { reason: "   " } })]);
    expect(withBlankReason?.detail).toBeUndefined();
  });

  it("gives two events sharing an instant identities of their own", () => {
    const rail = historyEvents([event(), event({ event: "time_entry.updated" })]);
    expect(rail[0]?.id).not.toBe(rail[1]?.id);
  });
});

/*
 * What a record still needs, as an answer that knows which field it is about — so the bar and the
 * field show one wording and a reader is told where to go rather than only what is wrong.
 */
import { describe, expect, it } from "vitest";
import {
  shortfall,
  shortfallFor,
  shortfallSentences,
  type Shortfall,
} from "$lib/calendar/shortfall.ts";
import {
  emptyEventDraft,
  eventDraftShortfalls,
  EVENT_FIELDS,
  TIMING_FIELDS,
} from "$lib/calendar/event-draft.ts";

describe("the shape", () => {
  it("carries a field and a sentence", () => {
    expect(shortfall("title", "A title is needed.")).toEqual({
      field: "title",
      sentence: "A title is needed.",
    });
  });

  it("reads out as sentences alone, in order, for the bar", () => {
    const list: Shortfall[] = [shortfall("a", "First."), shortfall("b", "Second.")];
    expect(shortfallSentences(list)).toEqual(["First.", "Second."]);
  });

  it("finds the sentence for one field, and nothing for a field that is answered", () => {
    const list = [shortfall("title", "A title is needed.")];
    expect(shortfallFor(list, "title")).toBe("A title is needed.");
    expect(shortfallFor(list, "startsOn")).toBeUndefined();
  });

  it("shows the FIRST of two things wrong with one field", () => {
    // Two sentences a reader cannot both act on: the second stops applying the moment the first is
    // satisfied, so asking for both asks somebody to satisfy a sentence that is about to vanish.
    const list = [
      shortfall("endsOn", "Does not read as a date."),
      shortfall("endsOn", "Before the start."),
    ];
    expect(shortfallFor(list, "endsOn")).toBe("Does not read as a date.");
  });
});

describe("what an event draft names", () => {
  it("points a missing title and a missing date at their own fields", () => {
    const shortfalls = eventDraftShortfalls(emptyEventDraft("America/New_York"));
    expect(shortfallFor(shortfalls, EVENT_FIELDS.title)).toBe("A title is needed.");
    expect(shortfallFor(shortfalls, TIMING_FIELDS.startsOn)).toBe("A date is needed.");
  });

  it("gives the bar the same sentences, in the order a person meets them", () => {
    const shortfalls = eventDraftShortfalls(emptyEventDraft(""));
    expect(shortfallSentences(shortfalls)[0]).toBe("A title is needed.");
    // Every shortfall names a field, so nothing can be shown on the bar with nowhere to point.
    expect(shortfalls.every((each) => each.field !== "")).toBe(true);
  });

  it("points a bad conference link at the link, not at the record", () => {
    const draft = {
      ...emptyEventDraft("America/New_York", "2026-09-15"),
      title: "Deposition",
      conferenceUrl: "not a link",
    };
    expect(shortfallFor(eventDraftShortfalls(draft), EVENT_FIELDS.conferenceUrl)).toBe(
      "The conference link does not read as a web address.",
    );
  });
});

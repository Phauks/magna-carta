import { describe, expect, it } from "vitest";
import type { Communication } from "$lib/communications/communications-api.ts";
import {
  draftChannel,
  draftEndTime,
  draftFromCommunication,
  draftOccurredAt,
  draftStoredNumber,
  durationFromEnd,
  emptyLogDraft,
  logDraftReady,
  logDraftRequest,
  logDraftShortfalls,
  updateDraftRequest,
  type LogDraft,
} from "$lib/communications/log-draft.ts";
import {
  anchorText,
  channelEntry,
  counterpartyNumberText,
  saidText,
} from "$lib/communications/communication-vocabulary.ts";

// The log form's model, which is where "what makes a record complete" lives — the window that
// records one and the window that corrects one both render these answers, so a rule asserted here is
// a rule both surfaces obey.

const NOW = "2026-09-08T17:00:00.000Z";

/** A draft with the fields a test cares about set, over the empty one's own defaults. */
function draft(overrides: Partial<LogDraft> = {}): LogDraft {
  return {
    ...emptyLogDraft(NOW),
    region: "US",
    counterpartyNumber: "(702) 555-0143",
    description: "Talked the offer through.",
    ...overrides,
  };
}

describe("what a record still needs", () => {
  it("wants the number, and says so in three words rather than a sentence", () => {
    // The refusal stands in the action bar for as long as the answer is missing, which on a form
    // somebody has just opened is the whole time they are filling it in. It names the field.
    const shortfalls = logDraftShortfalls(draft({ counterpartyNumber: "" }), NOW);
    expect(shortfalls[0]).toBe("The number.");
  });

  it("refuses a number that is not one in the country that was chosen", () => {
    expect(logDraftReady(draft({ counterpartyNumber: "12" }), NOW)).toBe(false);
  });

  it("takes the date and the time as two answers", () => {
    expect(logDraftShortfalls(draft({ occurredDate: "" }), NOW)[0]).toBe("The date.");
    expect(logDraftShortfalls(draft({ occurredTime: "" }), NOW)[0]).toBe("The time.");
  });

  it("refuses a call that has not happened yet", () => {
    // A slip in the year or the month is a typo every time, and a row dated forward sits above
    // everything real in a log ordered most-recent-first until the date arrives.
    const ahead = draft({ occurredDate: "2027-01-04", occurredTime: "09:00" });
    expect(logDraftShortfalls(ahead, NOW)[0]).toBe("That has not happened yet.");
  });

  it("needs the words of a text and accepts a call that is only its length", () => {
    expect(logDraftShortfalls(draft({ kind: "text", description: "" }), NOW)[0]).toBe(
      "What the text said.",
    );
    // A missed call is a real record: the phone rang, and that is the whole fact.
    const rang = draft({ description: "", durationMinutes: "0" });
    expect(logDraftReady(rang, NOW)).toBe(true);
  });

  it("refuses a call with neither a description nor an end, and names both", () => {
    const empty = draft({ description: "", durationMinutes: "" });
    expect(logDraftShortfalls(empty, NOW)[0]).toBe("What was said, or when the call ended.");
  });

  it("asks which matter, or why there is none, once an anchor is chosen", () => {
    expect(logDraftShortfalls(draft({ anchor: "matter" }), NOW)[0]).toBe("Which matter.");
    expect(logDraftShortfalls(draft({ anchor: "setAside" }), NOW)[0]).toBe(
      "Why it is on no matter.",
    );
    // Deciding later is a real answer a receptionist gives all day, and it needs nothing else.
    expect(logDraftReady(draft({ anchor: "undecided" }), NOW)).toBe(true);
  });
});

describe("what the write receives", () => {
  it("stores the number in its international form, composed from the country beside it", () => {
    // The server deliberately does not canonicalize on its own — that needs a country it has no way
    // to know. The form knows, because somebody picked it.
    expect(draftStoredNumber(draft())).toBe("+17025550143");
  });

  it("keeps what was typed when the digits and the country do not make a number", () => {
    // A number nobody can parse is still the number somebody was given.
    expect(draftStoredNumber(draft({ counterpartyNumber: "ext 4102" }))).toBe("ext 4102");
  });

  it("puts one description in the column its type belongs in", () => {
    const call = logDraftRequest(draft());
    expect(call.summary).toBe("Talked the offer through.");
    expect(call.body).toBeNull();

    const text = logDraftRequest(draft({ kind: "text", description: "Can we push to 3?" }));
    expect(text.body).toBe("Can we push to 3?");
    expect(text.summary).toBeNull();
  });

  it("never sends a duration on a text", () => {
    // The database refuses the pair outright, so a stale value left in the draft by somebody
    // switching the type mid-form would turn a correction into a rejection.
    const switched = draft({ kind: "text", description: "hello", durationMinutes: "12" });
    expect(logDraftRequest(switched).durationSeconds).toBeNull();
  });

  it("sends whichever anchor was chosen and never both", () => {
    const filed = logDraftRequest(draft({ anchor: "matter", matterId: "matter_x" }));
    expect(filed).toMatchObject({ matterId: "matter_x", disposition: null });

    const aside = logDraftRequest(draft({ anchor: "setAside", disposition: "spam" }));
    expect(aside).toMatchObject({ matterId: null, disposition: "spam" });

    // A matter left behind on a row somebody has since called firm business is not sent.
    const changed = draft({ anchor: "setAside", disposition: "spam", matterId: "matter_x" });
    expect(logDraftRequest(changed).matterId).toBeNull();
  });

  it("joins the date and the time in the reader's own zone", () => {
    const at = draftOccurredAt(draft({ occurredDate: "2026-09-07", occurredTime: "14:30" }));
    expect(new Date(at).getHours()).toBe(14);
    expect(new Date(at).getDate()).toBe(7);
  });

  it("leaves a correction's anchor out of the patch", () => {
    const fields = updateDraftRequest(draft({ anchor: "matter", matterId: "matter_x" }));
    expect(fields).not.toHaveProperty("matterId");
    expect(fields).not.toHaveProperty("disposition");
  });
});

describe("a picture message is a text, not a third kind", () => {
  const picture: Communication = {
    id: "communication_1",
    channel: "mms",
    direction: "inbound",
    matterId: null,
    matterTitle: null,
    matterStatus: null,
    matterNumber: null,
    consultationNumber: null,
    disposition: null,
    counterpartyNumber: "+17025550143",
    counterpartyEntityId: null,
    memberUserId: null,
    occurredAt: "2026-09-07T18:30:00.000Z",
    durationSeconds: null,
    body: "Here is the police report",
    summary: "Client's own note about it",
    producer: "member",
    loggedByUserId: "user_1",
    createdAt: "2026-09-07T18:35:00.000Z",
    updatedAt: "2026-09-07T18:35:00.000Z",
  };

  it("reads as a Text everywhere a person sees it", () => {
    expect(channelEntry("mms").label).toBe("Text");
    expect(channelEntry("sms").label).toBe("Text");
    expect(channelEntry("voice").label).toBe("Call");
  });

  it("stays a picture message when it is corrected", () => {
    // The form offers Call and Text. A text that arrived carrying a picture must not silently
    // become a plain one because somebody fixed a typo in it.
    const editing = draftFromCommunication(picture, null);
    expect(editing.kind).toBe("text");
    expect(draftChannel(editing)).toBe("mms");
    // A brand-new text is an ordinary one.
    expect(draftChannel(draft({ kind: "text" }))).toBe("sms");
  });

  it("keeps a note recorded beside a text under the old two-field form", () => {
    const editing = draftFromCommunication(picture, null);
    expect(editing.description).toBe("Here is the police report");
    expect(updateDraftRequest(editing).summary).toBe("Client's own note about it");
  });

  it("splits a stored number back into its country and its national digits", () => {
    const editing = draftFromCommunication(picture, null);
    expect(editing.region).toBe("US");
    expect(editing.counterpartyNumber).toBe("(702) 555-0143");
  });
});

describe("how a row reads", () => {
  const base: Communication = {
    id: "communication_2",
    channel: "voice",
    direction: "inbound",
    matterId: null,
    matterTitle: null,
    matterStatus: null,
    matterNumber: null,
    consultationNumber: null,
    disposition: null,
    counterpartyNumber: "+17025550143",
    counterpartyEntityId: null,
    memberUserId: null,
    occurredAt: "2026-09-07T18:30:00.000Z",
    durationSeconds: 300,
    body: null,
    summary: null,
    producer: "member",
    loggedByUserId: "user_1",
    createdAt: "2026-09-07T18:35:00.000Z",
    updatedAt: "2026-09-07T18:35:00.000Z",
  };

  it("names the reason a row is on no matter, and says so where nobody has decided", () => {
    expect(anchorText(base)).toBe("Not filed");
    expect(anchorText({ ...base, disposition: "spam" })).toBe("Spam or wrong number");
    expect(anchorText({ ...base, disposition: "firmBusiness" })).toBe("Firm business");
  });

  it("groups a stored number the way its own country writes it", () => {
    expect(counterpartyNumberText("+17025550143")).toBe("(702) 555-0143");
    // A number nobody can parse renders exactly as it is held.
    expect(counterpartyNumberText("ext 4102")).toBe("ext 4102");
  });

  it("says a call has no description rather than rendering an empty cell", () => {
    // A missed call is a real record — the phone rang and nobody wrote anything — and a blank there
    // reads as a gap the platform failed to fill.
    expect(saidText(base)).toBe("No description written");
    expect(saidText({ ...base, channel: "sms", body: "hello" })).toBe("hello");
  });
});

describe("a call's length is worked out from its start and its end", () => {
  /*
   * The owner's ruling of 2026-09-08: "Length in minutes should be duration, should auto-calculate
   * off start and stop." The form asks for the two clock times, because that is what somebody who
   * has just put the phone down knows; the record still stores the length, so the draft keeps the
   * length as its own field and these two functions are the bridge in each direction.
   */
  it("shows the end as the start plus the length", () => {
    expect(draftEndTime(draft({ occurredTime: "14:30", durationMinutes: "12" }))).toBe("14:42");
    expect(draftEndTime(draft({ occurredTime: "23:58", durationMinutes: "5" }))).toBe("00:03");
  });

  it("shows no end where there is no length, rather than inventing one", () => {
    expect(draftEndTime(draft({ occurredTime: "14:30", durationMinutes: "" }))).toBe("");
  });

  it("reads a typed end back as whole minutes", () => {
    expect(durationFromEnd(draft({ occurredTime: "14:30" }), "14:42")).toBe("12");
    // A call that started and ended on the same minute is a real record: the phone rang.
    expect(durationFromEnd(draft({ occurredTime: "14:30" }), "14:30")).toBe("0");
  });

  it("reads an end before the start as a call that ran past midnight", () => {
    expect(durationFromEnd(draft({ occurredTime: "23:58" }), "00:03")).toBe("5");
  });

  it("gives no length back for an end that is not a time", () => {
    expect(durationFromEnd(draft({ occurredTime: "14:30" }), "")).toBe("");
  });

  it("round-trips a recorded length through the two fields untouched", () => {
    const recorded = draft({ occurredTime: "09:05", durationMinutes: "45" });
    const end = draftEndTime(recorded);
    expect(durationFromEnd(recorded, end)).toBe("45");
  });
});

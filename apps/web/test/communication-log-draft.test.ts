import { describe, expect, it } from "vitest";
import type { Communication } from "$lib/communications/communications-api.ts";
import {
  activityRequest,
  draftChannel,
  draftEndedAt,
  draftFromCommunication,
  draftOccurredAt,
  draftSpanMinutes,
  draftStoredNumber,
  emptyLogDraft,
  parseDurationMinutes,
  logDraftReady,
  logDraftRequest,
  logDraftShortfalls,
  messageTaskTitle,
  updateDraftRequest,
  type LogDraft,
} from "$lib/communications/log-draft.ts";
import {
  anchorText,
  channelEntry,
  counterpartyNumberText,
  saidText,
  spanText,
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
    const rang = draft({ description: "", durationText: "0" });
    expect(logDraftReady(rang, NOW)).toBe(true);
  });

  it("refuses a call with neither a description nor a length, and names both", () => {
    const empty = draft({ description: "", durationText: "" });
    expect(logDraftShortfalls(empty, NOW)[0]).toBe("What was said, or how long the call ran.");
  });

  it("refuses a length that is not one, and shows the spellings that are", () => {
    expect(logDraftShortfalls(draft({ durationText: "about twenty" }), NOW)[0]).toBe(
      "A length reads as 20, 1h 5m or 1:20.",
    );
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
    const switched = draft({
      kind: "text",
      description: "hello",
      durationText: "12",
      endTime: "14:42",
    });
    expect(logDraftRequest(switched).durationSeconds).toBeNull();
    expect(logDraftRequest(switched).endedAt).toBeNull();
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
    referenceNumber: "2026-09-07-0003",
    channel: "mms",
    direction: "inbound",
    matterId: null,
    matterTitle: null,
    matterStatus: null,
    matterNumber: null,
    consultationNumber: null,
    intakeNumber: null,
    disposition: null,
    counterpartyNumber: "+17025550143",
    counterpartyEntityId: null,
    memberUserId: null,
    occurredAt: "2026-09-07T18:30:00.000Z",
    endedAt: null,
    durationSeconds: null,
    body: "Here is the police report",
    summary: "Client's own note about it",
    producer: "member",
    loggedByUserId: "user_1",
    callerIdName: null,
    outcome: null,
    spamKind: null,
    messageTaskId: null,
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

/** One recorded call, as the log answers it. Shared by every block below that reads a record. */
const base: Communication = {
  id: "communication_2",
  referenceNumber: "2026-09-07-0004",
  channel: "voice",
  direction: "inbound",
  matterId: null,
  matterTitle: null,
  matterStatus: null,
  matterNumber: null,
  consultationNumber: null,
  intakeNumber: null,
  disposition: null,
  counterpartyNumber: "+17025550143",
  counterpartyEntityId: null,
  memberUserId: null,
  occurredAt: "2026-09-07T18:30:00.000Z",
  endedAt: null,
  durationSeconds: 300,
  body: null,
  summary: null,
  producer: "member",
  loggedByUserId: "user_1",
  callerIdName: null,
  outcome: null,
  spamKind: null,
  messageTaskId: null,
  createdAt: "2026-09-07T18:35:00.000Z",
  updatedAt: "2026-09-07T18:35:00.000Z",
};

describe("how a row reads", () => {
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

describe("a call's length is typed, and it need not be the span", () => {
  /*
   * The owner's ruling of 2026-09-08: "you should be able to type in the length of time for the
   * call, and this doesn't need to match calculation, considering people can be put on hold." So the
   * start, the end and the length are three stored facts rather than two and a derivation, and the
   * only place they touch is the convenience below — an end fills an EMPTY length and never anything
   * else.
   */
  it("reads the four spellings a person actually types", () => {
    expect(parseDurationMinutes("20")).toBe(20);
    expect(parseDurationMinutes("45m")).toBe(45);
    expect(parseDurationMinutes("1h")).toBe(60);
    expect(parseDurationMinutes("1h 5m")).toBe(65);
    expect(parseDurationMinutes("1:20")).toBe(80);
  });

  it("reads nothing else as a length", () => {
    // "About twenty" is a note, and it belongs in the description rather than rounded into a number.
    expect(parseDurationMinutes("about twenty")).toBeNull();
    expect(parseDurationMinutes("")).toBeNull();
    expect(parseDurationMinutes("1:75")).toBeNull();
  });

  it("keeps a length that disagrees with the span, because that is the hold", () => {
    // An hour on the line, twenty minutes of call. Both are true, and the draft sends both.
    const held = draft({ occurredTime: "09:00", endTime: "10:00", durationText: "20" });
    expect(draftSpanMinutes(held)).toBe(60);
    expect(logDraftRequest(held).durationSeconds).toBe(20 * 60);
    const ended = logDraftRequest(held).endedAt ?? "";
    expect(new Date(ended).getTime() - new Date(draftOccurredAt(held)).getTime()).toBe(
      60 * 60 * 1000,
    );
  });

  it("reads an end before the start as a call that ran past midnight", () => {
    const midnight = draft({ occurredDate: "2026-09-07", occurredTime: "23:58", endTime: "00:03" });
    expect(draftSpanMinutes(midnight)).toBe(5);
    expect(new Date(draftEndedAt(midnight)).getDate()).toBe(8);
  });

  it("sends no end where nobody gave one, rather than inventing one from the length", () => {
    expect(draftEndedAt(draft({ durationText: "45" }))).toBe("");
    expect(logDraftRequest(draft({ durationText: "45" })).endedAt).toBeNull();
  });

  it("round-trips a recorded call's three answers untouched", () => {
    const recorded = draftFromCommunication(
      {
        ...base,
        occurredAt: "2026-09-07T18:30:00.000Z",
        endedAt: "2026-09-07T19:30:00.000Z",
        durationSeconds: 20 * 60,
      },
      null,
    );
    expect(recorded.durationText).toBe("20");
    expect(draftSpanMinutes(recorded)).toBe(60);
    expect(logDraftRequest(recorded).durationSeconds).toBe(20 * 60);
    expect(logDraftRequest(recorded).endedAt).toBe("2026-09-07T19:30:00.000Z");
  });

  it("states the span in the words a length is stated in, and only where there is one", () => {
    expect(spanText("2026-09-07T18:30:00.000Z", "2026-09-07T19:30:00.000Z")).toBe("1h");
    expect(spanText("2026-09-07T18:30:00.000Z", null)).toBeNull();
  });
});

describe("a number carries its extension", () => {
  /*
   * The owner's ruling of 2026-09-08: "for numbers longer than expected length of phone number,
   * don't drop formatting, show as extension instead, or allow a special extension field." The two
   * halves are one stored string, because a number and the direct dial behind it are one way of
   * reaching somebody — and libphonenumber reads the `x` form back into both.
   */
  it("stores the extension on the end of the international form", () => {
    expect(draftStoredNumber(draft({ counterpartyExtension: "4102" }))).toBe("+17025550143x4102");
  });

  it("shows both halves when the row is read back", () => {
    expect(counterpartyNumberText("+17025550143x4102")).toBe("(702) 555-0143 ext. 4102");
  });

  it("splits them apart again when the record is opened to be corrected", () => {
    const editing = draftFromCommunication(
      { ...base, counterpartyNumber: "+17025550143x4102" },
      null,
    );
    expect(editing.counterpartyNumber).toBe("(702) 555-0143");
    expect(editing.counterpartyExtension).toBe("4102");
  });
});

describe("the Activity a new record carries", () => {
  it("needs no notes on a spam call or one that rang out", () => {
    expect(logDraftReady(draft({ description: "", outcome: "spam" }), NOW)).toBe(true);
    expect(
      logDraftReady(draft({ description: "", direction: "outbound", outcome: "noAnswer" }), NOW),
    ).toBe(true);
    expect(logDraftReady(draft({ description: "", outcome: "answered" }), NOW)).toBe(false);
  });

  it("wants the colleague a transfer or a message names", () => {
    expect(
      logDraftShortfalls(draft({ direction: "inbound", outcome: "transferred" }), NOW),
    ).toContain("Who the call went to.");
    expect(
      logDraftShortfalls(draft({ direction: "inbound", outcome: "messageTaken" }), NOW),
    ).toContain("Who the message is for.");
  });

  it("files a spam call as spam whatever the anchor said", () => {
    const fields = activityRequest(
      draft({ outcome: "spam", spamKind: "sales", anchor: "matter", matterId: "matter_x" }),
      "America/Los_Angeles",
    );
    expect(fields).toMatchObject({ outcome: "spam", spamKind: "sales", matterId: null });
    expect(fields.disposition).toBe("spam");
  });

  it("turns a message into a task line named for the caller", () => {
    const fields = activityRequest(
      draft({
        direction: "inbound",
        outcome: "messageTaken",
        callerIdName: "Maria Lopez",
        messageForUserId: "user_marisol",
        messageByDate: "2026-09-10",
        messageUrgent: true,
      }),
      "America/Los_Angeles",
    );
    expect(fields.message).toEqual({
      forUserId: "user_marisol",
      title: "Call back Maria Lopez",
      dueOn: "2026-09-10",
      timeZone: "America/Los_Angeles",
      urgent: true,
    });
    expect(
      messageTaskTitle(draft({ messageRequest: "willCallAgain", callerIdName: "Maria Lopez" })),
    ).toBe("Maria Lopez will call again");
  });

  it("hands a transfer's member over as the member on the call", () => {
    const fields = activityRequest(
      draft({ direction: "inbound", outcome: "transferred", transferToUserId: "user_marisol" }),
      "UTC",
    );
    expect(fields.memberUserId).toBe("user_marisol");
  });
});

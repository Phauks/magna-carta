import { describe, expect, it } from "vitest";
import {
  normalizeContent,
  normalizeCounterpartyNumber,
  normalizeOccurredAt,
} from "../src/validation.ts";

const NOW = "2026-09-07T12:00:00.000Z";

describe("the counterparty number", () => {
  it("collapses the whitespace a paste leaves behind and keeps what was typed", () => {
    // NOT normalized to E.164, deliberately: rewriting it into a canonical form needs the firm's
    // own country, which this subsystem does not have and would be guessing at. What a person typed
    // is what the column holds until a carrier supplies something better.
    expect(normalizeCounterpartyNumber("  (702)  555-0143 ")).toBe("(702) 555-0143");
    expect(normalizeCounterpartyNumber("+1 702 555 0143")).toBe("+1 702 555 0143");
    expect(normalizeCounterpartyNumber("702-555-0143 x214")).toBe("702-555-0143 x214");
  });

  it("refuses something that is not a number at all", () => {
    expect(() => normalizeCounterpartyNumber("")).toThrow(/number at the other end/);
    expect(() => normalizeCounterpartyNumber("Mrs Herrera")).toThrow(/phone number/);
    // Punctuation alone passes the character class and is still not a number: a row holding it is
    // unreachable by every later lookup.
    expect(() => normalizeCounterpartyNumber("+++")).toThrow(/phone number/);
  });
});

describe("when it happened", () => {
  it("accepts a past instant and normalizes it", () => {
    expect(normalizeOccurredAt("2026-09-07T10:15:00Z", NOW)).toBe("2026-09-07T10:15:00.000Z");
  });

  it("tolerates a client clock that is slightly fast", () => {
    // A minute of slack, so a browser thirty seconds ahead is not an error.
    expect(normalizeOccurredAt("2026-09-07T12:00:30.000Z", NOW)).toBe("2026-09-07T12:00:30.000Z");
  });

  it("refuses an instant that has not happened yet", () => {
    // A slip in the year or the month is a typo every time, and a row dated forward sits above
    // everything real in a most-recent-first log until the date arrives.
    expect(() => normalizeOccurredAt("2027-09-07T10:15:00Z", NOW)).toThrow(/cannot have happened/);
  });

  it("refuses something that is not a date", () => {
    expect(() => normalizeOccurredAt("last Tuesday", NOW)).toThrow(/not a date/);
  });
});

describe("what each channel may carry", () => {
  it("keeps a text's words and a call's summary", () => {
    expect(normalizeContent({ channel: "sms", body: "  on my way  " })).toEqual({
      body: "on my way",
      summary: null,
      durationSeconds: null,
    });
    expect(
      normalizeContent({ channel: "voice", summary: "Talked it through", durationSeconds: 720 }),
    ).toEqual({
      body: null,
      summary: "Talked it through",
      durationSeconds: 720,
    });
  });

  it("accepts a call that records only its length, because a missed call is a real record", () => {
    expect(normalizeContent({ channel: "voice", durationSeconds: 0 })).toEqual({
      body: null,
      summary: null,
      durationSeconds: 0,
    });
  });

  it("refuses a body on a call and a duration on a message", () => {
    expect(() => normalizeContent({ channel: "voice", body: "hello" })).toThrow(
      /goes in the summary/,
    );
    expect(() => normalizeContent({ channel: "sms", body: "hi", durationSeconds: 30 })).toThrow(
      /no length in seconds/,
    );
  });

  it("refuses a call length that is not whole seconds, or is longer than a day", () => {
    expect(() => normalizeContent({ channel: "voice", durationSeconds: 12.5 })).toThrow(
      /whole number of seconds/,
    );
    expect(() => normalizeContent({ channel: "voice", durationSeconds: -1 })).toThrow(
      /whole number of seconds/,
    );
    expect(() => normalizeContent({ channel: "voice", durationSeconds: 86_401 })).toThrow(
      /longer than a day/,
    );
  });

  it("refuses a row that records nothing, and words the refusal per channel", () => {
    // A member sat down and typed this one, so an entirely empty one means they abandoned the form.
    expect(() => normalizeContent({ channel: "sms" })).toThrow(/a message needs its text/);
    expect(() => normalizeContent({ channel: "voice" })).toThrow(/summary of what was said/);
  });

  it("treats whitespace-only text as absent rather than as content", () => {
    expect(() => normalizeContent({ channel: "sms", body: "   " })).toThrow(/needs its text/);
  });
});

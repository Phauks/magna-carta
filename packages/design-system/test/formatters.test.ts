/*
 * The shared display vocabulary, asserted rule by rule.
 *
 * Each of these functions encodes a correction that has already been issued once, so the tests are
 * written against the correction rather than against the implementation: the decimal leads and the
 * clock form is there too, a timestamp is local and never elapsed, a version is a bare number, a
 * name is always the person's, and a placeholder is the field's name. Anything asserted about a
 * locale or a zone is pinned, because otherwise the test only checks that the machine running it
 * agrees with itself.
 */
import { describe, expect, it } from "vitest";
import { formatClock, formatDuration } from "../src/lib/formatters/duration.ts";
import { formatInstant, instantAttribute, readInstant } from "../src/lib/formatters/instant.ts";
import { personName, UNRECORDED_PERSON } from "../src/lib/formatters/person-name.ts";
import { placeholderOf, readsAsFieldName } from "../src/lib/formatters/placeholder.ts";
import { formatVersion } from "../src/lib/formatters/version.ts";

describe("formatDuration", () => {
  it("renders both forms, with the decimal leading", () => {
    const ninetyMinutes = formatDuration(90);
    expect(ninetyMinutes.decimal).toEqual("1.50");
    expect(ninetyMinutes.clock).toEqual("1:30");
    expect(ninetyMinutes.text).toEqual("1.50 (1:30)");
    expect(ninetyMinutes.text.indexOf("1.50")).toBeLessThan(ninetyMinutes.text.indexOf("1:30"));
  });

  it("renders zero as a duration, never as a blank or a dash", () => {
    expect(formatDuration(0)).toEqual({ decimal: "0.00", clock: "0:00", text: "0.00 (0:00)" });
  });

  it("pads the clock minutes so the form is unmistakable", () => {
    expect(formatDuration(65).clock).toEqual("1:05");
    expect(formatDuration(6).clock).toEqual("0:06");
  });

  it("keeps hours past a day as hours, because a duration is not a calendar", () => {
    expect(formatDuration(1500)).toEqual({
      decimal: "25.00",
      clock: "25:00",
      text: "25.00 (25:00)",
    });
  });

  it("rounds the decimal to the billing convention and the clock to whole minutes", () => {
    expect(formatDuration(7).decimal).toEqual("0.12");
    expect(formatDuration(7.4).clock).toEqual("0:07");
    expect(formatDuration(7.6).clock).toEqual("0:08");
  });

  it("takes a firm's own precision without changing the pairing", () => {
    const oneDigit = formatDuration(90, { decimalPlaces: 1 });
    expect(oneDigit.decimal).toEqual("1.5");
    expect(oneDigit.clock).toEqual("1:30");
  });

  it("carries a negative duration's sign on both forms", () => {
    const adjustment = formatDuration(-90);
    expect(adjustment.decimal).toEqual("-1.50");
    expect(adjustment.clock).toEqual("-1:30");
  });

  it("shows a value that is not a duration as what actually arrived", () => {
    expect(formatDuration(Number.NaN).text).toEqual("NaN");
    expect(formatDuration(Number.POSITIVE_INFINITY).text).toEqual("Infinity");
  });
});

describe("formatClock", () => {
  /*
   * The clock form the Time Sheet's running timer wears. It used to be a second implementation
   * living beside the sheet, which is why these assertions read as they do: the first two are the
   * sheet's own, moved here with the function, and the rest are what the sheet's copy never said.
   */
  it("writes a clock, to the second only while something is ticking", () => {
    expect(formatClock(5430)).toEqual("1:30");
    expect(formatClock(5430, { toTheSecond: true })).toEqual("1:30:30");
  });

  it("pads the minutes, and the seconds, so the form is unmistakable", () => {
    expect(formatClock(65)).toEqual("0:01");
    expect(formatClock(65, { toTheSecond: true })).toEqual("0:01:05");
  });

  it("keeps hours past a day as hours, because a duration is not a calendar", () => {
    expect(formatClock(90_000)).toEqual("25:00");
  });

  it("carries a sign the sheet's own copy dropped", () => {
    expect(formatClock(-5430)).toEqual("-1:30");
  });

  it("is the same clock formatDuration reports, which is the whole point of sharing it", () => {
    for (const minutes of [0, 6, 65, 90, 1500]) {
      expect(formatDuration(minutes).clock).toEqual(formatClock(minutes * 60));
    }
  });

  it("shows what arrived rather than dressing a non-duration as zero", () => {
    expect(formatClock(Number.NaN)).toEqual("NaN");
  });
});

describe("formatInstant", () => {
  // A fixed instant, written as the UTC the platform stores.
  const INSTANT = "2026-08-14T20:05:00.000Z";

  it("states the actual moment, with both the date and the time of day", () => {
    const text = formatInstant(INSTANT, { locale: "en-US", timeZone: "UTC" });
    expect(text).toContain("2026");
    expect(text).toContain("Aug");
    expect(text).toContain("14");
    expect(text).toMatch(/8:05|20:05/);
  });

  it("never renders elapsed time, however recent the instant is", () => {
    const text = formatInstant(new Date(), { locale: "en-US" });
    expect(text).not.toMatch(/just now|ago|moments|second|minute|hour/i);
    // An absolute rendering always carries the year; a relative one never does.
    expect(text).toMatch(/\d{4}/);
  });

  it("renders in the viewer's zone, not the zone the instant was stored in", () => {
    const stored = formatInstant(INSTANT, { locale: "en-US", timeZone: "UTC" });
    const viewer = formatInstant(INSTANT, { locale: "en-US", timeZone: "America/Los_Angeles" });
    expect(viewer).not.toEqual(stored);
    expect(viewer).toContain("1:05");
  });

  it("moves an instant across a day boundary into the viewer's own day", () => {
    // Half an hour past midnight UTC is still the previous evening on the west coast, and the
    // viewer's date is the one that must show.
    const justAfterMidnight = "2026-08-15T00:30:00.000Z";
    const stored = formatInstant(justAfterMidnight, { locale: "en-US", timeZone: "UTC" });
    const viewer = formatInstant(justAfterMidnight, {
      locale: "en-US",
      timeZone: "America/Los_Angeles",
    });
    expect(stored).toContain("15");
    expect(viewer).toContain("14");
  });

  it("accepts a Date, an ISO string and epoch milliseconds as the same moment", () => {
    const options = { locale: "en-US", timeZone: "UTC" };
    const fromString = formatInstant(INSTANT, options);
    expect(formatInstant(new Date(INSTANT), options)).toEqual(fromString);
    expect(formatInstant(Date.parse(INSTANT), options)).toEqual(fromString);
  });

  it("shows an unreadable value as what it actually says, rather than hiding it", () => {
    expect(formatInstant("recorded on a Tuesday")).toEqual("recorded on a Tuesday");
  });

  it("carries the machine-readable UTC instant, or nothing at all", () => {
    expect(instantAttribute(INSTANT)).toEqual(INSTANT);
    expect(instantAttribute("recorded on a Tuesday")).toBeUndefined();
  });

  it("reads an instant into a Date, and refuses what is not one", () => {
    expect(readInstant(INSTANT)?.toISOString()).toEqual(INSTANT);
    expect(readInstant("recorded on a Tuesday")).toBeNull();
  });
});

describe("formatVersion", () => {
  it("is a bare number, never prefixed", () => {
    expect(formatVersion(12)).toEqual("12");
    expect(formatVersion(1)).toEqual("1");
  });

  it("takes the word only where a bare number would dangle in prose", () => {
    expect(formatVersion(12, { inProse: true })).toEqual("version 12");
    expect(formatVersion(12, { inProse: false })).toEqual("12");
  });

  it("stays one token however large the number gets", () => {
    expect(formatVersion(1024)).toEqual("1024");
    expect(formatVersion(1024)).not.toContain(",");
  });

  it("shows a value that is not a number as what arrived, and never names it a version", () => {
    expect(formatVersion(Number.NaN, { inProse: true })).toEqual("NaN");
  });
});

describe("personName", () => {
  it("is the name the record carries", () => {
    expect(personName("Adaeze Okonkwo")).toEqual("Adaeze Okonkwo");
  });

  it("still names a person who has left the firm", () => {
    // There is no membership argument to consult, which is the point: a departed member's entries
    // read exactly as they always did.
    expect(personName("Marcus Hale")).toEqual("Marcus Hale");
    expect(personName("Marcus Hale")).not.toContain("No longer");
  });

  it("never renders a first-person stand-in as somebody's name", () => {
    expect(personName("You")).toEqual(UNRECORDED_PERSON);
    expect(personName("you")).toEqual(UNRECORDED_PERSON);
    expect(personName("Me")).toEqual(UNRECORDED_PERSON);
  });

  it("states the gap where the record carries no name", () => {
    expect(personName(null)).toEqual(UNRECORDED_PERSON);
    expect(personName(undefined)).toEqual(UNRECORDED_PERSON);
    expect(personName("   ")).toEqual(UNRECORDED_PERSON);
    expect(personName(null)).not.toEqual("");
  });

  it("lets a surface word the gap in its own voice", () => {
    expect(personName(null, { whenUnrecorded: "No name on the record" })).toEqual(
      "No name on the record",
    );
  });

  it("tidies the recorded name without rewriting it", () => {
    expect(personName("  Adaeze   Okonkwo ")).toEqual("Adaeze Okonkwo");
  });
});

describe("placeholderOf", () => {
  it("leaves a name that is already a noun phrase exactly as it is", () => {
    expect(placeholderOf("Internal Memo")).toEqual("Internal Memo");
    expect(placeholderOf("Time Worked")).toEqual("Time Worked");
    expect(placeholderOf("Payee")).toEqual("Payee");
  });

  it("drops the decoration a label carries beside the field", () => {
    expect(placeholderOf("Amount:")).toEqual("Amount");
    expect(placeholderOf("Description *")).toEqual("Description");
    expect(placeholderOf("  Reason  ")).toEqual("Reason");
  });
});

describe("readsAsFieldName", () => {
  it("accepts the field names the product actually uses", () => {
    for (const name of [
      "Amount",
      "Description",
      "Reason",
      "Payee",
      "Matter",
      "Time Worked",
      "Internal Memo",
      "Search",
    ]) {
      expect(readsAsFieldName(name)).toBe(true);
    }
  });

  it("rejects an instruction aimed at the reader", () => {
    expect(readsAsFieldName("Enter the amount")).toBe(false);
    expect(readsAsFieldName("Select a payee")).toBe(false);
    expect(readsAsFieldName("Type to narrow the choices")).toBe(false);
    expect(readsAsFieldName("Start typing a matter name")).toBe(false);
  });

  it("rejects a description, an example and a sentence", () => {
    expect(readsAsFieldName("What the client is billed for.")).toBe(false);
    expect(readsAsFieldName("e.g. 1.5")).toBe(false);
    expect(readsAsFieldName("Smith v Jones...")).toBe(false);
    expect(readsAsFieldName("The internal note nobody outside the firm ever sees")).toBe(false);
  });

  it("rejects nothing at all", () => {
    expect(readsAsFieldName("")).toBe(false);
    expect(readsAsFieldName("   ")).toBe(false);
  });
});

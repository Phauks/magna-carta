/*
 * A repeat rule as a sentence. The grammar is asserted in @magna-carta/civil-time's own suite; this
 * one is about the WORDS, because they are what a person checks a rule against before saving it.
 */
import { describe, expect, it } from "vitest";
import {
  formatRecurrence,
  weeklyRecurrence,
  type RecurrenceRule,
} from "@magna-carta/civil-time/recurrence";
import {
  recurrenceSentence,
  writtenRecurrence,
  WEEKDAY_CHOICES,
} from "$lib/calendar/recurrence-sentence.ts";

/** 2026-09-15 is a Tuesday, and the third Tuesday of its month. */
const TUESDAY = "2026-09-15";

function rule(patch: Partial<RecurrenceRule>): RecurrenceRule {
  return { ...weeklyRecurrence(), ...patch };
}

describe("the cadence", () => {
  it("reads a plain weekly rule as the day the series starts on", () => {
    expect(writtenRecurrence(weeklyRecurrence(), TUESDAY)).toBe("every week on Tuesday");
  });

  it("uses a word for the intervals a person has one for", () => {
    expect(writtenRecurrence(rule({ interval: 2 }), TUESDAY)).toBe("every second week on Tuesday");
    expect(writtenRecurrence(rule({ interval: 3 }), TUESDAY)).toBe("every third week on Tuesday");
  });

  it("falls back to a numeral, and pluralizes only there", () => {
    expect(writtenRecurrence(rule({ interval: 5 }), TUESDAY)).toBe("every 5 weeks on Tuesday");
  });

  it("lists the chosen weekdays rather than the start's", () => {
    expect(writtenRecurrence(rule({ weekdays: ["MO", "WE", "FR"] }), TUESDAY)).toBe(
      "every week on Monday, Wednesday and Friday",
    );
  });

  it("reads a daily rule without a weekday", () => {
    expect(writtenRecurrence(rule({ frequency: "daily" }), TUESDAY)).toBe("every day");
    expect(writtenRecurrence(rule({ frequency: "daily", interval: 2 }), TUESDAY)).toBe(
      "every second day",
    );
  });

  it("says which day of the month a monthly rule means, both ways", () => {
    expect(writtenRecurrence(rule({ frequency: "monthly" }), TUESDAY)).toBe(
      "every month on the 15th",
    );
    expect(writtenRecurrence(rule({ frequency: "monthly", monthly: "byWeekday" }), TUESDAY)).toBe(
      "every month on the third Tuesday",
    );
  });

  it("gets the ordinals right where the last digit does not decide them", () => {
    expect(writtenRecurrence(rule({ frequency: "monthly" }), "2026-09-01")).toContain("the 1st");
    expect(writtenRecurrence(rule({ frequency: "monthly" }), "2026-09-02")).toContain("the 2nd");
    expect(writtenRecurrence(rule({ frequency: "monthly" }), "2026-09-03")).toContain("the 3rd");
    expect(writtenRecurrence(rule({ frequency: "monthly" }), "2026-09-11")).toContain("the 11th");
    expect(writtenRecurrence(rule({ frequency: "monthly" }), "2026-09-12")).toContain("the 12th");
    expect(writtenRecurrence(rule({ frequency: "monthly" }), "2026-09-13")).toContain("the 13th");
    expect(writtenRecurrence(rule({ frequency: "monthly" }), "2026-09-21")).toContain("the 21st");
  });

  it("reads a yearly rule as a year", () => {
    expect(writtenRecurrence(rule({ frequency: "yearly" }), TUESDAY)).toBe("every year");
  });

  it("says the frequency alone where no start day fixes the rest", () => {
    expect(writtenRecurrence(weeklyRecurrence(), null)).toBe("every week");
    expect(writtenRecurrence(rule({ frequency: "monthly" }), null)).toBe("every month");
  });
});

describe("where it stops", () => {
  it("says nothing at all for a rule that never stops", () => {
    expect(writtenRecurrence(weeklyRecurrence(), TUESDAY)).not.toContain("until");
  });

  it("states a count", () => {
    expect(writtenRecurrence(rule({ end: { kind: "after", count: 12 } }), TUESDAY)).toBe(
      "every week on Tuesday, 12 times",
    );
  });

  it("states an end date", () => {
    expect(writtenRecurrence(rule({ end: { kind: "on", date: "2026-12-31" } }), TUESDAY)).toBe(
      "every week on Tuesday, until 2026-12-31",
    );
  });
});

describe("a stored line", () => {
  it("is nothing at all where the setting happens once", () => {
    expect(recurrenceSentence(null, TUESDAY)).toBeNull();
    expect(recurrenceSentence("", TUESDAY)).toBeNull();
  });

  it("reads back what the form wrote", () => {
    const written = formatRecurrence(rule({ interval: 2, end: { kind: "after", count: 12 } }));
    expect(recurrenceSentence(written, TUESDAY)).toBe("every second week on Tuesday, 12 times");
  });

  it("SAYS a rule it cannot present rather than reading as a one-off", () => {
    // BYMONTHDAY is a real RFC 5545 part this form does not offer. The wrong answer is null.
    expect(recurrenceSentence("FREQ=MONTHLY;BYMONTHDAY=15", TUESDAY)).toBe(
      "on a rule recorded in another calendar",
    );
  });
});

describe("the weekday chips", () => {
  it("offers all seven, in the week's own order, named in full for a screen reader", () => {
    expect(WEEKDAY_CHOICES).toHaveLength(7);
    expect(WEEKDAY_CHOICES[0]).toEqual({ code: "SU", name: "Sunday", short: "Sun" });
    expect(WEEKDAY_CHOICES.map((day) => day.code)).toEqual([
      "SU",
      "MO",
      "TU",
      "WE",
      "TH",
      "FR",
      "SA",
    ]);
  });
});

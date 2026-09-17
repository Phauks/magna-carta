/*
 * A setting that repeats: the rule a person answers, the RFC 5545 line it is stored as, and the
 * civil days it falls on. Every question a reader would argue about — what happens to the 31st in
 * February, whether a daylight-saving change moves a weekly nine o'clock, what a rule written by
 * another calendar does here — is answered without a browser.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_OCCURRENCES,
  formatRecurrence,
  occurrencesOf,
  parseRecurrence,
  weekdayOf,
  weekdayPositionOf,
  weeklyRecurrence,
  type RecurrenceRule,
} from "../src/recurrence.ts";

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { ...weeklyRecurrence(), ...overrides };
}

/** A window wide enough that the rule's own end is what stops it. */
const YEAR = { from: "2026-01-01", to: "2026-12-31" };

describe("writing a rule to its stored line", () => {
  it("writes the short line for the common rule", () => {
    expect(formatRecurrence(rule())).toBe("FREQ=WEEKLY");
  });

  it("writes only the parts that say something", () => {
    expect(
      formatRecurrence(
        rule({ interval: 2, weekdays: ["TU", "TH"], end: { kind: "after", count: 12 } }),
      ),
    ).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=12");
  });

  it("writes an end date as a civil date with no separators, as the standard spells it", () => {
    expect(formatRecurrence(rule({ end: { kind: "on", date: "2026-06-30" } }))).toBe(
      "FREQ=WEEKLY;UNTIL=20260630",
    );
  });

  it("orders the weekdays, so one rule has one spelling", () => {
    expect(formatRecurrence(rule({ weekdays: ["FR", "MO"] }))).toBe("FREQ=WEEKLY;BYDAY=MO,FR");
  });
});

describe("reading a stored line back", () => {
  it("round-trips every rule the form can ask for", () => {
    const rules: RecurrenceRule[] = [
      rule(),
      rule({ frequency: "daily", interval: 3 }),
      rule({ weekdays: ["MO", "WE", "FR"], end: { kind: "after", count: 10 } }),
      rule({ frequency: "monthly", monthly: "byWeekday" }),
      rule({ frequency: "yearly", end: { kind: "on", date: "2030-01-01" } }),
    ];
    for (const original of rules) {
      expect(parseRecurrence(formatRecurrence(original))).toEqual(original);
    }
  });

  it("is null for no rule at all", () => {
    expect(parseRecurrence(null)).toBeNull();
    expect(parseRecurrence("   ")).toBeNull();
  });

  it("refuses a rule this form could not present honestly", () => {
    // Half-showing another calendar's rule would offer to edit something it would then rewrite.
    expect(parseRecurrence("FREQ=SECONDLY")).toBeNull();
    expect(parseRecurrence("FREQ=MONTHLY;BYMONTHDAY=15")).toBeNull();
    expect(parseRecurrence("FREQ=WEEKLY;BYDAY=2TU")).toBeNull();
    expect(parseRecurrence("FREQ=MONTHLY;BYSETPOS=-1")).toBeNull();
    expect(parseRecurrence("nonsense")).toBeNull();
  });

  it("refuses a rule that ends twice, because guessing which is worse than refusing", () => {
    expect(parseRecurrence("FREQ=WEEKLY;COUNT=5;UNTIL=20260630")).toBeNull();
  });

  it("refuses an interval or a count outside what the form offers", () => {
    expect(parseRecurrence("FREQ=WEEKLY;INTERVAL=0")).toBeNull();
    expect(parseRecurrence("FREQ=WEEKLY;INTERVAL=999")).toBeNull();
    expect(parseRecurrence("FREQ=WEEKLY;COUNT=0")).toBeNull();
  });

  it("refuses an instant-shaped end, which is not the civil date this writes", () => {
    expect(parseRecurrence("FREQ=WEEKLY;UNTIL=20260630T170000Z")).toBeNull();
  });
});

describe("the days a rule falls on", () => {
  it("always includes the day the series starts, whatever the rule says", () => {
    // A weekly Tuesday rule on a series starting Friday still happens that Friday: it is the day
    // somebody chose, and "starting this Friday, then every Tuesday" is what they meant.
    const days = occurrencesOf(rule({ weekdays: ["TU"] }), "2026-01-02", {
      from: "2026-01-01",
      to: "2026-01-14",
    });
    expect(days[0]).toBe("2026-01-02");
    expect(days).toContain("2026-01-06");
  });

  it("walks a weekly rule a week at a time", () => {
    const days = occurrencesOf(rule(), "2026-01-06", { from: "2026-01-01", to: "2026-02-03" });
    expect(days).toEqual(["2026-01-06", "2026-01-13", "2026-01-20", "2026-01-27", "2026-02-03"]);
  });

  it("walks every chosen weekday, in order", () => {
    const days = occurrencesOf(rule({ weekdays: ["MO", "WE"] }), "2026-01-05", {
      from: "2026-01-01",
      to: "2026-01-19",
    });
    expect(days).toEqual(["2026-01-05", "2026-01-07", "2026-01-12", "2026-01-14", "2026-01-19"]);
  });

  it("counts whole weeks for an interval, from the week the series began", () => {
    const days = occurrencesOf(rule({ interval: 2 }), "2026-01-06", {
      from: "2026-01-01",
      to: "2026-03-03",
    });
    expect(days).toEqual(["2026-01-06", "2026-01-20", "2026-02-03", "2026-02-17", "2026-03-03"]);
  });

  it("walks a daily rule by its interval", () => {
    expect(
      occurrencesOf(rule({ frequency: "daily", interval: 3 }), "2026-03-01", {
        from: "2026-03-01",
        to: "2026-03-10",
      }),
    ).toEqual(["2026-03-01", "2026-03-04", "2026-03-07", "2026-03-10"]);
  });

  it("SKIPS a month that has no such date rather than inventing one", () => {
    // A firm that said the 31st did not mean the end of the month. February and April have no 31st
    // and are left out; March and May are not shifted by it.
    const days = occurrencesOf(rule({ frequency: "monthly" }), "2026-01-31", {
      from: "2026-01-01",
      to: "2026-06-30",
    });
    expect(days).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("walks a monthly rule by the weekday it started on, where asked", () => {
    // 2026-01-20 is the third Tuesday of January.
    expect(weekdayOf("2026-01-20")).toBe("TU");
    expect(weekdayPositionOf("2026-01-20")).toBe(3);
    const days = occurrencesOf(rule({ frequency: "monthly", monthly: "byWeekday" }), "2026-01-20", {
      from: "2026-01-01",
      to: "2026-04-30",
    });
    expect(days).toEqual(["2026-01-20", "2026-02-17", "2026-03-17", "2026-04-21"]);
  });

  it("walks a yearly rule by its interval", () => {
    expect(
      occurrencesOf(rule({ frequency: "yearly" }), "2026-04-01", {
        from: "2026-01-01",
        to: "2029-12-31",
      }),
    ).toEqual(["2026-04-01", "2027-04-01", "2028-04-01", "2029-04-01"]);
  });

  it("keeps a leap day only in the years that have one", () => {
    expect(
      occurrencesOf(rule({ frequency: "yearly" }), "2028-02-29", {
        from: "2028-01-01",
        to: "2036-12-31",
      }),
    ).toEqual(["2028-02-29", "2032-02-29", "2036-02-29"]);
  });
});

describe("where a series stops", () => {
  it("stops after the count, counted from the series' own beginning", () => {
    const days = occurrencesOf(rule({ end: { kind: "after", count: 3 } }), "2026-01-06", YEAR);
    expect(days).toEqual(["2026-01-06", "2026-01-13", "2026-01-20"]);
  });

  it("counts occurrences BEFORE the window against the count", () => {
    // The 12th of twelve is the twelfth from the start, not the twelfth the reader can see.
    const days = occurrencesOf(rule({ end: { kind: "after", count: 12 } }), "2026-01-06", {
      from: "2026-03-01",
      to: "2026-12-31",
    });
    expect(days).toEqual(["2026-03-03", "2026-03-10", "2026-03-17", "2026-03-24"]);
  });

  it("stops on its end date, inclusive", () => {
    const days = occurrencesOf(
      rule({ end: { kind: "on", date: "2026-01-20" } }),
      "2026-01-06",
      YEAR,
    );
    expect(days).toEqual(["2026-01-06", "2026-01-13", "2026-01-20"]);
  });

  it("returns nothing for a window entirely after the series ended", () => {
    expect(
      occurrencesOf(rule({ end: { kind: "after", count: 2 } }), "2026-01-06", {
        from: "2026-06-01",
        to: "2026-06-30",
      }),
    ).toEqual([]);
  });

  it("returns nothing for a window entirely before the series begins", () => {
    expect(occurrencesOf(rule(), "2026-06-01", { from: "2026-01-01", to: "2026-02-01" })).toEqual(
      [],
    );
  });

  it("never returns more than the ceiling, however long the rule runs", () => {
    const days = occurrencesOf(rule({ frequency: "daily" }), "2020-01-01", {
      from: "2020-01-01",
      to: "2030-12-31",
    });
    expect(days).toHaveLength(MAX_OCCURRENCES);
  });

  it("is empty for a start that is not a civil date", () => {
    expect(occurrencesOf(rule(), "not-a-date", YEAR)).toEqual([]);
  });
});

describe("daylight saving", () => {
  it("does not move a weekly setting across a change", () => {
    // The expansion walks CIVIL DAYS, so a nine o'clock Sunday is the same civil day and the same
    // wall clock on both sides of a change. Expanding over instants would move half a firm's
    // settings by an hour twice a year. US DST began 2026-03-08.
    const days = occurrencesOf(rule(), "2026-03-01", { from: "2026-03-01", to: "2026-03-22" });
    expect(days).toEqual(["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  CIVIL_DATE_PATTERN,
  civilDateFromParts,
  civilDateOf,
  civilDateParts,
  endOfCivilMonth,
  isCivilDate,
  startOfCivilMonth,
  todayInUtc,
} from "../src/civil-date.ts";
import { CANONICAL_INSTANT_PATTERN } from "../src/instant.ts";
import { WALL_CLOCK_TIME_PATTERN } from "../src/wall-clock.ts";

describe("the civil-date shape", () => {
  it("accepts a day on the calendar", () => {
    for (const day of ["2026-01-01", "2026-09-08", "2024-02-29", "1900-12-31", "2000-02-29"]) {
      expect(isCivilDate(day), day).toBe(true);
    }
  });

  it("refuses a day that is not on the calendar, which the pattern alone accepts", () => {
    // Each of these matches CIVIL_DATE_PATTERN. The round trip is the half that catches them, and
    // the two subsystems that wrote this check by hand are the reason it is one function.
    for (const notADay of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-04-31", "2025-02-29"]) {
      expect(CIVIL_DATE_PATTERN.test(notADay), notADay).toBe(true);
      expect(isCivilDate(notADay), notADay).toBe(false);
    }
  });

  it("refuses year 0000, which round-trips in V8 and is no date any record is about", () => {
    expect(CIVIL_DATE_PATTERN.test("0000-01-01")).toBe(true);
    expect(isCivilDate("0000-01-01")).toBe(false);
  });

  it("does not confuse a two-digit year with the twentieth century", () => {
    // Date.UTC(50, 0, 1) is 1950. Anything built on it rejects year 50 as a rollover and gets day
    // arithmetic near it wrong; this package constructs through setUTCFullYear instead.
    expect(isCivilDate("0050-06-15")).toBe(true);
    expect(addCalendarDays("0050-12-31", 1)).toBe("0051-01-01");
  });

  it("refuses anything that is not the shape at all", () => {
    for (const value of [
      "2026-9-8",
      "26-09-08",
      "2026-09-08T00:00:00Z",
      "2026-09-08 ",
      "",
      null,
      undefined,
      20260908,
      new Date(),
    ]) {
      expect(isCivilDate(value), String(value)).toBe(false);
    }
  });

  it("splits and rebuilds a day without changing it", () => {
    for (const day of ["2026-09-08", "0001-01-01", "9999-12-31"]) {
      expect(civilDateFromParts(civilDateParts(day))).toBe(day);
    }
  });

  it("accepts the years the ledger's own validator accepted", () => {
    expect(isCivilDate("9999-12-31")).toBe(true);
    expect(isCivilDate("0001-01-01")).toBe(true);
  });
});

describe("the shapes carry no regex flags", () => {
  it("stays flagless, because the OpenAPI emitter writes flags into the JSON Schema pattern", () => {
    // A `u` here shipped a pattern ending in "/u" to every generated client, which matches
    // nothing. The flag buys nothing either: the digit class is ASCII with or without it.
    expect(CIVIL_DATE_PATTERN.flags).toBe("");
    expect(WALL_CLOCK_TIME_PATTERN.flags).toBe("");
    expect(CANONICAL_INSTANT_PATTERN.flags).toBe("");
  });
});

describe("the civil date an instant has in UTC", () => {
  it("reads the UTC day, never a local one", () => {
    // 23:30 UTC on the 8th. In any zone west of Greenwich this is still the 8th in UTC terms, and
    // that is the answer: a civil date has no zone to be read in.
    expect(civilDateOf(new Date("2026-09-08T23:30:00Z"))).toBe("2026-09-08");
    expect(civilDateOf(new Date("2026-09-09T00:30:00Z"))).toBe("2026-09-09");
  });

  it("takes epoch milliseconds as readily as a Date", () => {
    const instant = Date.UTC(2026, 8, 8, 12);
    expect(civilDateOf(instant)).toBe(civilDateOf(new Date(instant)));
  });

  it("answers today from an injected clock, so a test states the day it means", () => {
    expect(todayInUtc(Date.UTC(2026, 0, 31, 23, 59, 59))).toBe("2026-01-31");
  });
});

describe("the day of a stored instant, taken by name rather than by slicing", () => {
  it("takes the instant as the string most callers hold one in", () => {
    // The point of the overload: `someInstant.slice(0, 10)` is invisible to every scan, and four
    // surfaces shipped a UTC-day bug written exactly that way.
    expect(civilDateOf("2026-09-08T12:00:00.000Z")).toBe("2026-09-08");
    expect(civilDateOf("2026-09-08T23:59:59.999Z")).toBe("2026-09-08");
  });

  it("agrees with the Date and the epoch-milliseconds forms", () => {
    const text = "2026-09-08T12:00:00.000Z";
    expect(civilDateOf(text)).toBe(civilDateOf(new Date(text)));
    expect(civilDateOf(text)).toBe(civilDateOf(Date.parse(text)));
  });

  it("refuses a string that is not a stored instant, rather than returning ten characters of it", () => {
    for (const value of ["2026-09-08", "2026-09-08T12:00:00Z", "not an instant", ""]) {
      expect(() => civilDateOf(value), value).toThrow(/is not a stored instant/);
    }
  });

  it("is NOT the day to show a reader, and the two differ by a day", () => {
    // 01:30Z is the previous evening on the west coast. This is the UTC day — correct for a
    // query key or a sweep bucket, and the wrong answer under a label reading "Date Entered".
    // formatInstantDate in the design system is the one that follows the reader.
    expect(civilDateOf("2026-09-08T01:30:00.000Z")).toBe("2026-09-08");
  });
});

describe("plain calendar-day arithmetic", () => {
  it("counts days, crossing months and years", () => {
    expect(addCalendarDays("2026-09-08", 1)).toBe("2026-09-09");
    expect(addCalendarDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addCalendarDays("2026-09-08", 0)).toBe("2026-09-08");
  });

  it("counts leap days as days", () => {
    expect(addCalendarDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addCalendarDays("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("lands on a weekend or a holiday without comment, because it is not a docketing rule", () => {
    // 2026-09-04 is a Friday. Three days on is a Sunday, and that is the honest answer: a person
    // moves the date, a template cannot know to.
    expect(addCalendarDays("2026-09-04", 3)).toBe("2026-09-07");
    expect(addCalendarDays("2026-12-24", 1)).toBe("2026-12-25");
  });
});

describe("the first day of a month", () => {
  it("is the first, whatever the date it was asked about", () => {
    expect(startOfCivilMonth(2026, 9)).toBe("2026-09-01");
    expect(startOfCivilMonth(2026, 12)).toBe("2026-12-01");
  });

  it("pads a month and a year the way the shape requires", () => {
    // The `${date.slice(0, 8)}01` this replaces got the padding for free from the string it cut up.
    // Going through the parts has to do it deliberately, so it is pinned here.
    expect(startOfCivilMonth(2026, 1)).toBe("2026-01-01");
    expect(startOfCivilMonth(999, 3)).toBe("0999-03-01");
  });
});

describe("the last day of a month", () => {
  it("knows the short months and the leap years", () => {
    expect(endOfCivilMonth(2026, 2)).toBe("2026-02-28");
    expect(endOfCivilMonth(2024, 2)).toBe("2024-02-29");
    expect(endOfCivilMonth(2026, 4)).toBe("2026-04-30");
    expect(endOfCivilMonth(2026, 12)).toBe("2026-12-31");
  });
});

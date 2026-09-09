import { describe, expect, it } from "vitest";
import {
  endOfCivilDayInstant,
  instantForCivilDateTime,
  isFixedOffset,
  isResolvableTimeZone,
  viewerTimeZone,
  zonedReading,
} from "../src/time-zone.ts";

const LOS_ANGELES = "America/Los_Angeles";

describe("a zone this platform will store", () => {
  it("accepts a named zone the runtime can resolve", () => {
    for (const zone of [LOS_ANGELES, "UTC", "Europe/London", "Australia/Sydney"]) {
      expect(isResolvableTimeZone(zone), zone).toBe(true);
    }
  });

  it("refuses a fixed offset, which is wrong for half the year wherever clocks change", () => {
    // This is the rule the two hand-written copies in packages/notes and packages/tasks did not
    // carry: both accepted these, so a note could store a zone a calendar entry could not.
    for (const offset of ["+05:00", "-0800", "+0000"]) {
      expect(isResolvableTimeZone(offset), offset).toBe(false);
    }
  });

  it("names an offset separately, so a refusal can say WHY it is refusing", () => {
    // The location service wants "never a fixed offset" rather than "not a zone we can resolve",
    // and getting that wording used to mean writing the shape out a second time.
    expect(isFixedOffset("+05:00")).toBe(true);
    expect(isFixedOffset("-0800")).toBe(true);
    expect(isFixedOffset("America/Los_Angeles")).toBe(false);
    expect(isFixedOffset("")).toBe(false);
  });

  it("refuses a zone that is not a zone", () => {
    for (const value of ["", "Mars/Olympus", "Not A Zone"]) {
      expect(isResolvableTimeZone(value), value).toBe(false);
    }
  });
});

describe("reading an instant in a zone", () => {
  it("gives the civil day and the wall clock that zone was on", () => {
    // 2026-09-08T16:20Z is 09:20 on the 8th in Los Angeles (PDT, UTC-7).
    expect(zonedReading(Date.parse("2026-09-08T16:20:00Z"), LOS_ANGELES)).toEqual({
      civilDate: "2026-09-08",
      wallClockTime: "09:20",
    });
  });

  it("reads the day the zone is on, not the day UTC is on", () => {
    // Still the 8th in Los Angeles when UTC has already turned over.
    expect(zonedReading(Date.parse("2026-09-09T05:00:00Z"), LOS_ANGELES).civilDate).toBe(
      "2026-09-08",
    );
  });

  it("renders midnight as hour zero rather than hour twenty-four", () => {
    expect(zonedReading(Date.parse("2026-09-08T07:00:00Z"), LOS_ANGELES).wallClockTime).toBe(
      "00:00",
    );
  });
});

describe("resolving a civil date and a wall clock to an instant", () => {
  it("round-trips an ordinary time", () => {
    const instant = instantForCivilDateTime("2026-09-08", "09:20", LOS_ANGELES);
    expect(zonedReading(instant, LOS_ANGELES)).toEqual({
      civilDate: "2026-09-08",
      wallClockTime: "09:20",
    });
  });

  it("treats a missing time as the start of the day", () => {
    const instant = instantForCivilDateTime("2026-09-08", null, LOS_ANGELES);
    expect(zonedReading(instant, LOS_ANGELES).wallClockTime).toBe("00:00");
  });

  it("takes the FIRST occurrence of a clock the autumn fall-back runs twice", () => {
    // 2026-11-01, Los Angeles: 01:30 happens at 08:30Z (PDT) and again at 09:30Z (PST). Resolving
    // to the second would quietly extend a deadline by an hour.
    expect(instantForCivilDateTime("2026-11-01", "01:30", LOS_ANGELES)).toBe(
      Date.parse("2026-11-01T08:30:00Z"),
    );
  });

  it("keeps the hour after a fall-back where it belongs", () => {
    // 02:14 PST is a perfectly ordinary time. Comparing candidate passes and taking the earlier
    // once resolved it to 01:14 — an hour before a moment that exists.
    const instant = instantForCivilDateTime("2026-11-01", "02:14", LOS_ANGELES);
    expect(zonedReading(instant, LOS_ANGELES).wallClockTime).toBe("02:14");
  });

  it("moves a clock inside the spring gap forward, never backward", () => {
    // 2026-03-08, Los Angeles: 02:30 never happened. A hearing typed into the gap is somebody's
    // typo about a real hearing; landing before the time they wrote would put it on the wrong side
    // of every deadline it is compared against.
    const instant = instantForCivilDateTime("2026-03-08", "02:30", LOS_ANGELES);
    expect(instant).toBeGreaterThanOrEqual(Date.parse("2026-03-08T10:00:00Z"));
    expect(zonedReading(instant, LOS_ANGELES).civilDate).toBe("2026-03-08");
  });
});

describe("the end of a civil day in its own zone", () => {
  it("is the last millisecond of that day, not its midnight", () => {
    const end = endOfCivilDayInstant("2026-09-08", LOS_ANGELES);
    expect(end).toBe(Date.parse("2026-09-09T07:00:00Z") - 1);
    expect(zonedReading(end, LOS_ANGELES).civilDate).toBe("2026-09-08");
  });

  it("holds in a zone whose transition happens at midnight", () => {
    // America/Santiago has moved its clocks AT midnight: the next day begins at 01:00 local, so the
    // end of this one is 23:59:59.999 local rather than a wall clock of 23:59 plus a guess.
    const end = endOfCivilDayInstant("2026-09-05", "America/Santiago");
    expect(zonedReading(end, "America/Santiago").civilDate).toBe("2026-09-05");
    expect(zonedReading(end + 1, "America/Santiago").civilDate).toBe("2026-09-06");
  });
});

describe("the viewer's own zone", () => {
  it("is a zone this platform would store", () => {
    expect(isResolvableTimeZone(viewerTimeZone())).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  CALENDAR_VIEWS,
  anchorFromAddress,
  calendarWindow,
  isCivilDate,
  restOfCalendarAddress,
  shiftAnchor,
  viewFromAddress,
  windowContains,
  windowOverlaps,
  windowTitle,
} from "$lib/calendar/calendar-window.ts";

describe("calendarWindow", () => {
  it("reads a month as the full weeks it spans, Sunday first by default", () => {
    // September 2026 starts on a Tuesday and ends on a Wednesday.
    const window = calendarWindow("month", "2026-09-15");
    expect(window.from).toBe("2026-08-30");
    expect(window.to).toBe("2026-10-03");
  });

  it("reads a month Monday-first when asked", () => {
    const window = calendarWindow("month", "2026-09-15", 1);
    expect(window.from).toBe("2026-08-31");
    expect(window.to).toBe("2026-10-04");
  });

  it("never asks for more than six weeks, which is inside the read's cap", () => {
    // Every month of a leap year and the year after it.
    for (const year of [2028, 2029]) {
      for (let month = 1; month <= 12; month += 1) {
        const anchor = `${String(year)}-${String(month).padStart(2, "0")}-10`;
        const window = calendarWindow("month", anchor);
        const from = new Date(`${window.from}T00:00:00Z`).getTime();
        const to = new Date(`${window.to}T00:00:00Z`).getTime();
        const days = Math.round((to - from) / 86_400_000) + 1;
        expect(days).toBeLessThanOrEqual(42);
        expect(days % 7).toBe(0);
      }
    }
  });

  it("gives February of a leap year its twenty-ninth day", () => {
    const window = calendarWindow("month", "2028-02-01");
    expect(windowContains(window, "2028-02-29")).toBe(true);
  });

  it("reads a week as seven days around the anchor", () => {
    const window = calendarWindow("week", "2026-09-02");
    expect(window.from).toBe("2026-08-30");
    expect(window.to).toBe("2026-09-05");
  });

  it("reads an agenda as a fortnight from the anchor", () => {
    const window = calendarWindow("agenda", "2026-09-02");
    expect(window.from).toBe("2026-09-02");
    expect(window.to).toBe("2026-09-15");
  });

  it("reads an agenda over the span a host asks for, never less than one day", () => {
    expect(calendarWindow("agenda", "2026-09-02", 0, 2).to).toBe("2026-09-03");
    expect(calendarWindow("agenda", "2026-09-02", 0, 30).to).toBe("2026-10-01");
    expect(calendarWindow("agenda", "2026-09-02", 0, 0).to).toBe("2026-09-02");
    expect(shiftAnchor("agenda", "2026-09-02", 1, 30)).toBe("2026-10-02");
    expect(shiftAnchor("agenda", "2026-09-02", -1, 2)).toBe("2026-08-31");
  });
});

describe("shiftAnchor", () => {
  it("steps a month from its first day so the thirty-first never clamps", () => {
    expect(shiftAnchor("month", "2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftAnchor("month", "2026-09-01", -1)).toBe("2026-08-01");
  });

  it("crosses a year boundary in both directions", () => {
    expect(shiftAnchor("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftAnchor("month", "2027-01-15", -1)).toBe("2026-12-01");
  });

  it("steps a week by seven days and an agenda by a fortnight", () => {
    expect(shiftAnchor("week", "2026-09-02", 1)).toBe("2026-09-09");
    expect(shiftAnchor("agenda", "2026-09-02", -1)).toBe("2026-08-19");
  });
});

describe("windowTitle", () => {
  it("names a month by month and year", () => {
    expect(windowTitle(calendarWindow("month", "2026-09-15"), "en-US")).toBe("September 2026");
  });

  it("names a span by its ends, repeating only what differs", () => {
    // The locale's range formatter chooses the separator and its spacing; the assertion reads
    // through them so an ICU update that changes a thin space does not fail the arithmetic.
    const plain = (text: string): string =>
      text.replaceAll(/\s+/g, " ").replaceAll(/[\u2013\u2014]/g, "-");
    expect(plain(windowTitle(calendarWindow("week", "2026-09-02"), "en-US"))).toBe(
      "Aug 30 - Sep 5, 2026",
    );
    expect(plain(windowTitle(calendarWindow("agenda", "2026-09-02"), "en-US"))).toBe(
      "Sep 2 - 15, 2026",
    );
    expect(plain(windowTitle(calendarWindow("week", "2026-12-30"), "en-US"))).toBe(
      "Dec 27, 2026 - Jan 2, 2027",
    );
  });
});

describe("windowOverlaps", () => {
  const window = calendarWindow("week", "2026-09-02");

  it("counts a span that starts before the window and ends inside it", () => {
    expect(windowOverlaps(window, "2026-08-28", "2026-08-31")).toBe(true);
  });

  it("leaves out a span that ends before the window or starts after it", () => {
    expect(windowOverlaps(window, "2026-08-20", "2026-08-29")).toBe(false);
    expect(windowOverlaps(window, "2026-09-06", null)).toBe(false);
  });
});

describe("the address", () => {
  it("reads a well-formed date and view and falls back otherwise", () => {
    expect(anchorFromAddress("2026-09-02", "2026-01-01")).toBe("2026-09-02");
    expect(anchorFromAddress("2026-02-30", "2026-01-01")).toBe("2026-01-01");
    expect(anchorFromAddress("yesterday", "2026-01-01")).toBe("2026-01-01");
    expect(anchorFromAddress(null, "2026-01-01")).toBe("2026-01-01");
    expect(viewFromAddress("week", "month")).toBe("week");
    expect(viewFromAddress("year", "month")).toBe("month");
    expect(isCivilDate("2026-13-01")).toBe(false);
  });
});

describe("restOfCalendarAddress", () => {
  it("names a colleague by identifier, and everyone while nobody is chosen yet", () => {
    expect(restOfCalendarAddress({ kind: "firm" }, "2026-09-02", "member", "user_1")).toBe(
      "/calendar?view=agenda&date=2026-09-02&scope=member%3Auser_1",
    );
    expect(restOfCalendarAddress({ kind: "firm" }, "2026-09-02", "member", null)).toBe(
      "/calendar?view=agenda&date=2026-09-02&scope=everyone",
    );
  });

  it("opens the matter's own calendar as an agenda on the same day, with the identifier escaped", () => {
    expect(
      restOfCalendarAddress({ kind: "matter", matterId: "matter 1/a" }, "2026-09-02", "everyone"),
    ).toBe("/matters/matter%201%2Fa/calendar?view=agenda&date=2026-09-02");
  });

  it("opens the room grid on the resource", () => {
    const resource = { kind: "resource", resourceId: "firmResource_1" } as const;
    expect(restOfCalendarAddress(resource, "2026-09-02", "everyone")).toBe(
      "/calendar/rooms?view=agenda&date=2026-09-02&resource=firmResource_1",
    );
  });

  it("opens the firm calendar on Mine for a mine scope, whatever was chosen", () => {
    const mine = { kind: "mine", memberId: "user_me" } as const;
    expect(restOfCalendarAddress(mine, "2026-09-02", "everyone")).toBe(
      "/calendar?view=agenda&date=2026-09-02&scope=mine",
    );
  });

  it("opens the firm calendar on the choice the card was painted under", () => {
    expect(restOfCalendarAddress({ kind: "firm" }, "2026-09-02", "everyone")).toBe(
      "/calendar?view=agenda&date=2026-09-02&scope=everyone",
    );
    expect(restOfCalendarAddress({ kind: "firm" }, "2026-09-02", "mine")).toBe(
      "/calendar?view=agenda&date=2026-09-02&scope=mine",
    );
  });
});

describe("the day view's window", () => {
  it("is exactly the day it is anchored on", () => {
    expect(calendarWindow("day", "2026-09-15")).toEqual({
      view: "day",
      anchor: "2026-09-15",
      from: "2026-09-15",
      to: "2026-09-15",
    });
  });

  it("steps by one day, over a month boundary and a leap day alike", () => {
    expect(shiftAnchor("day", "2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftAnchor("day", "2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftAnchor("day", "2028-03-01", -1)).toBe("2028-02-29");
  });

  it("names itself as a date rather than as a span of no length", () => {
    const title = windowTitle(calendarWindow("day", "2026-09-15"), "en-US");
    expect(title).toContain("2026");
    expect(title).not.toMatch(/[–-]\s*\w+\s*\d+,?\s*2026\s*$/);
  });

  it("is one of the views an address can name", () => {
    expect(viewFromAddress("day", "month")).toBe("day");
    expect(CALENDAR_VIEWS).toContain("day");
  });
});

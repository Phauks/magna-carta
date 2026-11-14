import { CalendarDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { parseTypedDate } from "../src/lib/components/date-picker/typed-date.ts";

// Friday, November 13, 2026.
const TODAY = new CalendarDate(2026, 11, 13);

function read(text: string): string | null {
  return parseTypedDate(text, TODAY)?.toString() ?? null;
}

describe("parseTypedDate", () => {
  it("reads the relative words", () => {
    expect(read("today")).toBe("2026-11-13");
    expect(read("Tomorrow")).toBe("2026-11-14");
    expect(read("yesterday")).toBe("2026-11-12");
  });

  it("reads a weekday as the next one on or after today, with last and next", () => {
    expect(read("fri")).toBe("2026-11-13");
    expect(read("mon")).toBe("2026-11-16");
    expect(read("Thursday")).toBe("2026-11-19");
    expect(read("last fri")).toBe("2026-11-06");
    expect(read("last thu")).toBe("2026-11-12");
    expect(read("next fri")).toBe("2026-11-20");
  });

  it("reads a count of days or weeks from today", () => {
    expect(read("+3")).toBe("2026-11-16");
    expect(read("-2")).toBe("2026-11-11");
    expect(read("+2w")).toBe("2026-11-27");
  });

  it("reads numbers month first, with this year when none is given", () => {
    expect(read("11/13")).toBe("2026-11-13");
    expect(read("1/5/27")).toBe("2027-01-05");
    expect(read("12-31-2025")).toBe("2025-12-31");
    expect(read("3.4.2026")).toBe("2026-03-04");
    expect(read("2026-02-28")).toBe("2026-02-28");
    expect(read("1113")).toBe("2026-11-13");
    expect(read("11132026")).toBe("2026-11-13");
    expect(read("13")).toBe("2026-11-13");
  });

  it("puts a two-digit year in the nearest century not more than twenty years ahead", () => {
    expect(read("1/1/46")).toBe("2046-01-01");
    expect(read("1/1/47")).toBe("1947-01-01");
  });

  it("reads a month by name in either order", () => {
    expect(read("Nov 13")).toBe("2026-11-13");
    expect(read("november 13th, 2027")).toBe("2027-11-13");
    expect(read("13 Sept 2026")).toBe("2026-09-13");
    expect(read("Dec. 1")).toBe("2026-12-01");
  });

  it("reads the field's own display back as itself", () => {
    expect(read("Fri, Nov 13, 2026")).toBe("2026-11-13");
  });

  it("refuses text that names no day, and days that do not exist", () => {
    expect(read("")).toBeNull();
    expect(read("soon")).toBeNull();
    expect(read("2/30")).toBeNull();
    expect(read("13/13/2026")).toBeNull();
    expect(read("Nov")).toBeNull();
    expect(read("Nov 13 2026 9")).toBeNull();
    expect(read("40")).toBeNull();
  });
});

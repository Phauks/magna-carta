import { describe, expect, it } from "vitest";
import { isWallClockTime, WALL_CLOCK_TIME_PATTERN } from "../src/wall-clock.ts";

describe("the wall-clock shape", () => {
  it("accepts every hour and minute a twenty-four-hour clock has", () => {
    for (const time of ["00:00", "09:30", "12:00", "23:59"]) {
      expect(isWallClockTime(time), time).toBe(true);
    }
  });

  it("refuses an hour or a minute that does not exist", () => {
    // The interesting half of the pattern. A looser \d{2}:\d{2} takes all of these.
    for (const time of ["24:00", "29:74", "23:60", "-1:00"]) {
      expect(isWallClockTime(time), time).toBe(false);
    }
  });

  it("refuses anything that is not the shape", () => {
    for (const value of ["9:30", "09:30:00", "09.30", "", null, undefined, 930]) {
      expect(isWallClockTime(value), String(value)).toBe(false);
    }
  });

  it("anchors the pattern at both ends", () => {
    expect(WALL_CLOCK_TIME_PATTERN.test("x09:30")).toBe(false);
    expect(WALL_CLOCK_TIME_PATTERN.test("09:30x")).toBe(false);
  });
});

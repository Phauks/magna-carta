/*
 * A date that is the wrong kind of date fails by name.
 *
 * Every one of these already failed before the guards existed. They failed as
 * `RangeError: Invalid time value` — no function, no argument, no value — or, in `civilDateParts`,
 * not at all: it returned a NaN day and let it travel. What is asserted here is the diagnosis.
 */
import { describe, expect, it } from "vitest";
import { addCalendarDays, civilDateOf, civilDateParts } from "../src/civil-date.ts";
import { CivilTimeArgumentError } from "../src/refuse.ts";
import { endOfCivilDayInstant, instantForCivilDateTime, zonedReading } from "../src/time-zone.ts";

const INSTANT = "2026-09-08T12:00:00.000Z";
const ZONE = "America/Los_Angeles";

describe("a stored instant handed to a function that takes a day", () => {
  /** The confusion the ruling ledger calls the one most worth getting right: it is a day out. */
  const takingADay: [string, () => unknown][] = [
    ["civilDateParts", () => civilDateParts(INSTANT)],
    ["addCalendarDays", () => addCalendarDays(INSTANT, 1)],
    ["instantForCivilDateTime", () => instantForCivilDateTime(INSTANT, "09:00", ZONE)],
    ["endOfCivilDayInstant", () => endOfCivilDayInstant(INSTANT, ZONE)],
  ];

  it.each(takingADay)("%s refuses it, and says it is an instant", (where, run) => {
    expect(run).toThrow(CivilTimeArgumentError);
    let message = "";
    try {
      run();
    } catch (error) {
      message = (error as Error).message;
    }
    // The four things a failure has to carry to be worth more than the RangeError it replaces.
    expect(message, "names the function").toContain(where);
    expect(message, "names the argument").toContain("the civil date");
    expect(message, "shows the value").toContain(INSTANT);
    expect(message, "says what it actually is").toContain("INSTANT");
    expect(message, "names the remedy").toContain("zonedReading");
  });

  it("no longer returns a NaN day in silence, which is what it used to do", () => {
    // `{ year: 2026, month: 9, day: NaN }` typechecks, reads as parsed, and poisons everything
    // built on it. This is the single most valuable of the guards.
    expect(() => civilDateParts(INSTANT)).toThrow(CivilTimeArgumentError);
  });
});

describe("the other shapes a date argument arrives in wrong", () => {
  it("names a wall-clock time that is not one, rather than parsing NaN out of it", () => {
    expect(() => instantForCivilDateTime("2026-09-08", "9am", ZONE)).toThrow(
      /instantForCivilDateTime: the wall-clock time "9am" is not a wall-clock time/,
    );
  });

  it("names an unparsed date reaching arithmetic as an Invalid Date", () => {
    expect(() => civilDateOf(new Date("not a date"))).toThrow(/is not a moment/);
    expect(() => zonedReading(Number.NaN, ZONE)).toThrow(/zonedReading: the instant NaN/);
  });

  it("says an absent day is absent, and whose job the check was", () => {
    expect(() => civilDateParts(null as unknown as string)).toThrow(/is absent/);
    expect(() => civilDateParts(undefined as unknown as string)).toThrow(/is absent/);
  });

  it("distinguishes a day-with-a-time from a canonical instant", () => {
    // A naive local datetime is a different mistake from a stored instant and gets its own sentence.
    expect(() => civilDateParts("2026-09-08 12:00")).toThrow(/a date with a time on it/);
  });

  it("says a shape-valid day that is not on the calendar is exactly that", () => {
    // `civilDateParts` takes it — arithmetic on a rollover has an answer — so this is about the
    // wording a caller sees from `requireCivilDate` when it does refuse elsewhere.
    expect(civilDateParts("2026-02-30")).toEqual({ year: 2026, month: 2, day: 30 });
  });

  it("truncates a long value rather than making it the whole message", () => {
    let message = "";
    try {
      civilDateParts("x".repeat(400));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.length).toBeLessThan(200);
    expect(message).toContain("…");
  });
});

describe("the guards do not change a correct call", () => {
  it("leaves every happy path exactly as it was", () => {
    expect(civilDateParts("2026-09-08")).toEqual({ year: 2026, month: 9, day: 8 });
    expect(addCalendarDays("2026-09-08", 3)).toBe("2026-09-11");
    expect(civilDateOf(Date.parse(INSTANT))).toBe("2026-09-08");
    expect(zonedReading(Date.parse("2026-09-08T16:20:00Z"), ZONE)).toEqual({
      civilDate: "2026-09-08",
      wallClockTime: "09:20",
    });
    expect(instantForCivilDateTime("2026-09-08", null, ZONE)).toBe(
      Date.parse("2026-09-08T07:00:00Z"),
    );
  });
});

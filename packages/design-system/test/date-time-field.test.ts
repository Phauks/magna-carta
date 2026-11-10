import { describe, expect, it } from "vitest";
import {
  minuteOfDay,
  spanLabel,
  timeChoices,
  timeOfMinute,
} from "../src/lib/components/date-time-field/time-choices.ts";
import { formatWallClockTime } from "../src/lib/formatters/wall-clock.ts";

describe("the date-time field's list of times", () => {
  it("offers every fifteen minutes across the day by default", () => {
    const choices = timeChoices({});
    expect(choices).toHaveLength(96);
    expect(choices[0]?.time).toBe("00:00");
    expect(choices[1]?.time).toBe("00:15");
    expect(choices.at(-1)?.time).toBe("23:45");
  });

  it("puts a time off the step into the list in its place", () => {
    const times = timeChoices({ selected: "09:40" }).map((choice) => choice.time);
    expect(times).toContain("09:40");
    expect(times.indexOf("09:40")).toBe(times.indexOf("09:30") + 1);
    expect(times.indexOf("09:45")).toBe(times.indexOf("09:40") + 1);
  });

  it("does not add a second row for a time already on the step", () => {
    expect(timeChoices({ selected: "09:30" })).toHaveLength(96);
  });

  it("starts after the time it is measured from and says how long each runs", () => {
    const choices = timeChoices({ from: "09:30" });
    expect(choices[0]).toEqual({ time: "09:45", minuteOfDay: 585, minutesAfter: 15 });
    expect(choices.find((choice) => choice.time === "10:30")?.minutesAfter).toBe(60);
  });

  it("takes another step where the caller asks for one", () => {
    expect(timeChoices({ step: 30 })).toHaveLength(48);
  });

  it("reads and writes the stored shape, and refuses what is not one", () => {
    expect(minuteOfDay("09:40")).toBe(580);
    expect(minuteOfDay("24:00")).toBeNull();
    expect(minuteOfDay("9:40")).toBeNull();
    expect(timeOfMinute(580)).toBe("09:40");
    expect(timeOfMinute(1440)).toBe("00:00");
  });

  it("says a span in hours and minutes", () => {
    expect(spanLabel(45)).toBe("45 min");
    expect(spanLabel(60)).toBe("1 hr");
    expect(spanLabel(90)).toBe("1 hr 30 min");
  });
});

describe("a wall-clock time as it reads", () => {
  it("prints the hour it was handed, in the reader's convention", () => {
    expect(formatWallClockTime("09:40", { locale: "en-US" })).toBe("9:40 AM");
    expect(formatWallClockTime("21:05", { locale: "en-GB" })).toBe("21:05");
  });

  it("shows what arrived when it is not a time", () => {
    expect(formatWallClockTime("25:00")).toBe("25:00");
    expect(formatWallClockTime("noon")).toBe("noon");
  });
});

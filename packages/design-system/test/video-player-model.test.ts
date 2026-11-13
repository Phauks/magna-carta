/*
 * The video player's arithmetic and words, pinned without a browser: where a pointer over the
 * timeline lands, how a position reads on screen and aloud, and how much has loaded.
 */
import { describe, expect, it } from "vitest";
import {
  clampPosition,
  formatMediaTime,
  loadedFraction,
  positionAtPointer,
  speedLabel,
  spokenMediaTime,
} from "../src/lib/components/video-player/video-player-model.ts";

describe("positionAtPointer", () => {
  it("maps the pointer across the timeline onto the recording", () => {
    expect(positionAtPointer(150, 100, 200, 60)).toBe(15);
    expect(positionAtPointer(300, 100, 200, 60)).toBe(60);
  });

  it("holds a pointer past either end at that end", () => {
    expect(positionAtPointer(50, 100, 200, 60)).toBe(0);
    expect(positionAtPointer(900, 100, 200, 60)).toBe(60);
  });

  it("answers the start for a timeline with no width or a recording of unknown length", () => {
    expect(positionAtPointer(150, 100, 0, 60)).toBe(0);
    expect(positionAtPointer(150, 100, 200, Number.NaN)).toBe(0);
  });
});

describe("the words for a position", () => {
  it("shows hours always, and zero while nothing is known", () => {
    expect(formatMediaTime(761)).toBe("0:12:41");
    expect(formatMediaTime(Number.NaN)).toBe("0:00:00");
  });

  it("says a position with its zero parts left out", () => {
    expect(spokenMediaTime(3723)).toBe("1 hour 2 minutes 3 seconds");
    expect(spokenMediaTime(60)).toBe("1 minute");
    expect(spokenMediaTime(0)).toBe("0 seconds");
  });

  it("names normal speed and writes the rest as multiples", () => {
    expect(speedLabel(1)).toBe("Normal");
    expect(speedLabel(1.5)).toBe("1.5×");
  });
});

describe("clampPosition and loadedFraction", () => {
  it("holds a target inside the recording", () => {
    expect(clampPosition(-5, 30)).toBe(0);
    expect(clampPosition(45, 30)).toBe(30);
  });

  it("measures loading by the furthest loaded point", () => {
    expect(
      loadedFraction(
        [
          { start: 0, end: 10 },
          { start: 20, end: 30 },
        ],
        60,
      ),
    ).toBe(0.5);
    expect(loadedFraction([], Number.POSITIVE_INFINITY)).toBe(0);
  });
});

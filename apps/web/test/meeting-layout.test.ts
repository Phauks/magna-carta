import { describe, expect, it } from "vitest";
import { arrangeTiles } from "../src/lib/meetings/screen/meeting-layout.ts";
import {
  DEFAULT_MEETING_VIEW,
  readMeetingView,
} from "../src/lib/meetings/meeting-view-preference.svelte.ts";

describe("arrangeTiles", () => {
  it("puts two people side by side on a laptop, never as two tall strips", () => {
    const fit = arrangeTiles(2, 1200, 640, 16);
    expect(fit.columns).toBe(2);
    expect(fit.tileWidth / fit.tileHeight).toBeGreaterThan(1.7);
  });

  it("stacks two people in a tall window", () => {
    expect(arrangeTiles(2, 500, 900, 16).columns).toBe(1);
  });

  it("draws six as three by two on a wide screen", () => {
    expect(arrangeTiles(6, 1400, 700, 16).columns).toBe(3);
  });

  it("never draws a tile wider than its share of the width or taller than its row", () => {
    const fit = arrangeTiles(5, 1000, 500, 16);
    const rows = Math.ceil(5 / fit.columns);
    expect(fit.tileWidth * fit.columns + 16 * (fit.columns - 1)).toBeLessThanOrEqual(1000);
    expect(fit.tileHeight * rows + 16 * (rows - 1)).toBeLessThanOrEqual(500);
  });

  it("answers no size before the space is measured", () => {
    expect(arrangeTiles(3, 0, 0, 16).tileWidth).toBe(0);
  });
});

describe("readMeetingView", () => {
  it("starts in speaker view with the member's own picture mirrored", () => {
    expect(readMeetingView(undefined)).toEqual(DEFAULT_MEETING_VIEW);
    expect(DEFAULT_MEETING_VIEW).toEqual({ layout: "speaker", mirrorSelf: true });
  });

  it("keeps what it can read and defaults the rest", () => {
    expect(readMeetingView({ layout: "gallery", mirrorSelf: "yes" })).toEqual({
      layout: "gallery",
      mirrorSelf: true,
    });
    expect(readMeetingView({ layout: "sideways", mirrorSelf: false })).toEqual({
      layout: "speaker",
      mirrorSelf: false,
    });
  });
});

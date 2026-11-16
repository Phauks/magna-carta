import { describe, expect, it } from "vitest";
import {
  draggedTo,
  keyTravel,
  outlinePoints,
  shareOf,
  snapTo,
} from "../src/lib/components/placement-board/placement-board-model.ts";

describe("PlacementBoard arithmetic", () => {
  it("states a position as a share of the board", () => {
    expect(shareOf(4_250, 8_500)).toBe("50.0000%");
    expect(shareOf(10, 0)).toBe("0%");
  });

  it("turns pointer travel into board units on the caller's grid", () => {
    // A board 8,500 units wide drawn 850 pixels wide: one pixel is ten units.
    expect(draggedTo(1_000, 13, 8_500, 850, 10)).toBe(1_130);
    expect(draggedTo(1_000, 13.4, 8_500, 850, 10)).toBe(1_130);
    expect(draggedTo(1_000, -7, 8_500, 850, 1)).toBe(930);
  });

  it("snaps to whole units when the step is one or less", () => {
    expect(snapTo(10.4, 1)).toBe(10);
    expect(snapTo(10.6, 0)).toBe(11);
    expect(snapTo(26, 10)).toBe(30);
  });

  it("moves by the step, or the larger step with Shift", () => {
    expect(keyTravel("ArrowRight", false, 10, 100)).toEqual({ x: 10, y: 0 });
    expect(keyTravel("ArrowUp", true, 10, 100)).toEqual({ x: 0, y: -100 });
    expect(keyTravel("Enter", false, 10, 100)).toBeNull();
  });

  it("draws an outline through the corners in order", () => {
    expect(
      outlinePoints([
        { x: 0, y: 0 },
        { x: 5, y: 1 },
      ]),
    ).toBe("0,0 5,1");
  });
});

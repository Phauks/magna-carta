import { describe, expect, it } from "vitest";
import {
  applyHomography,
  homography,
  STRAIGHTENED_HEIGHT,
  STRAIGHTENED_WIDTH,
  straightenScan,
  type Corners,
} from "../src/lib/trust/checks/straighten-scan.ts";

describe("straighten a scanned check", () => {
  it("maps each corner exactly onto its partner", () => {
    const from: Corners = [
      { x: 0, y: 0 },
      { x: 850, y: 0 },
      { x: 850, y: 350 },
      { x: 0, y: 350 },
    ];
    const to: Corners = [
      { x: 40, y: 30 },
      { x: 900, y: 60 },
      { x: 880, y: 420 },
      { x: 20, y: 380 },
    ];
    const coefficients = homography(from, to)!;
    from.forEach((point, index) => {
      const mapped = applyHomography(coefficients, point);
      expect(mapped.x).toBeCloseTo(to[index]!.x, 6);
      expect(mapped.y).toBeCloseTo(to[index]!.y, 6);
    });
  });

  it("refuses corners in a line", () => {
    const line: Corners = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(straightenScan({ width: 4, height: 4, data: new Uint8ClampedArray(64) }, line)).toBeNull();
  });

  it("flattens a dark mark at the check's top-left into the output's top-left", () => {
    const width = 1_000;
    const height = 500;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    // A dark square just inside the top-left corner of the check, which sits at (100, 50).
    for (let y = 55; y < 75; y += 1) {
      for (let x = 105; x < 125; x += 1) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
    const corners: Corners = [
      { x: 100, y: 50 },
      { x: 950, y: 50 },
      { x: 950, y: 400 },
      { x: 100, y: 400 },
    ];
    const flat = straightenScan({ width, height, data }, corners)!;
    expect(flat.width).toBe(STRAIGHTENED_WIDTH);
    expect(flat.height).toBe(STRAIGHTENED_HEIGHT);
    const at = (x: number, y: number) => flat.data[(y * STRAIGHTENED_WIDTH + x) * 4];
    expect(at(15, 15)).toBeLessThan(10);
    expect(at(400, 200)).toBeGreaterThan(245);
  });
});

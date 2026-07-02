import { describe, expect, it } from "vitest";
import { suppressSmallCells } from "../src/usage-suppression.ts";

describe("small-n suppression", () => {
  it("drops cells below k and reports the count", () => {
    const cells = [
      { feature: "a", distinctCount: 9 },
      { feature: "b", distinctCount: 4 },
      { feature: "c", distinctCount: 5 },
    ];
    const { kept, suppressed } = suppressSmallCells(cells);
    expect(kept.map((cell) => cell.feature)).toEqual(["a", "c"]);
    expect(suppressed).toBe(1);
  });
  it("honors a custom threshold", () => {
    const cells = [{ distinctCount: 7 }, { distinctCount: 10 }];
    const { kept, suppressed } = suppressSmallCells(cells, 8);
    expect(kept).toHaveLength(1);
    expect(suppressed).toBe(1);
  });
});

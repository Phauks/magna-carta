import { describe, expect, it } from "vitest";
import { assignNumbers } from "./assign.mjs";

describe("assignNumbers", () => {
  it("continues from the existing maximum", () => {
    expect(assignNumbers([1, 2, 100], ["alpha", "beta"])).toEqual([
      { slug: "alpha", number: 101 },
      { slug: "beta", number: 102 },
    ]);
  });

  it("starts at 1 when there are no existing numbers", () => {
    expect(assignNumbers([], ["first"])).toEqual([{ slug: "first", number: 1 }]);
  });

  it("returns an empty array when nothing is pending", () => {
    expect(assignNumbers([1, 2], [])).toEqual([]);
  });
});

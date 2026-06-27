import { describe, expect, it } from "vitest";
import { compareToBaseline } from "../src/compare.ts";

const A = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("compareToBaseline", () => {
  it("returns match when the recomputed SHA-256 equals the baseline", () => {
    expect(compareToBaseline(A, A)).toBe("match");
  });

  it("is case-insensitive on hex", () => {
    expect(compareToBaseline(A.toUpperCase(), A)).toBe("match");
  });

  it("returns mismatch when they differ", () => {
    expect(compareToBaseline(A, A.replace(/.$/, "0"))).toBe("mismatch");
  });

  it("returns no-baseline when the stored baseline is null or empty", () => {
    expect(compareToBaseline(A, null)).toBe("no-baseline");
    expect(compareToBaseline(A, "")).toBe("no-baseline");
  });
});

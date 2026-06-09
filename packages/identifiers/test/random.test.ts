import { describe, expect, it } from "vitest";
import { cryptoRandomSource, seededRandomSource } from "../src/random.ts";

describe("random sources", () => {
  it("cryptoRandomSource returns the requested number of bytes", () => {
    expect(cryptoRandomSource(16)).toHaveLength(16);
    expect(cryptoRandomSource(16)).toBeInstanceOf(Uint8Array);
  });

  it("cryptoRandomSource is not constant (overwhelmingly likely to differ)", () => {
    expect([...cryptoRandomSource(32)]).not.toEqual([...cryptoRandomSource(32)]);
  });

  it("seededRandomSource is deterministic: same seed -> identical byte sequence", () => {
    expect([...seededRandomSource("matter-fixtures")(24)]).toEqual([
      ...seededRandomSource("matter-fixtures")(24),
    ]);
    expect([...seededRandomSource(42)(24)]).toEqual([...seededRandomSource(42)(24)]);
  });

  it("seededRandomSource diverges for different seeds", () => {
    expect([...seededRandomSource("a")(24)]).not.toEqual([...seededRandomSource("b")(24)]);
  });

  it("seededRandomSource advances state across calls on the same instance", () => {
    const source = seededRandomSource("x");
    expect([...source(8)]).not.toEqual([...source(8)]);
  });

  it("seededRandomSource returns bytes in range 0-255", () => {
    for (const byte of seededRandomSource("range-check")(64)) {
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThanOrEqual(255);
    }
  });
});

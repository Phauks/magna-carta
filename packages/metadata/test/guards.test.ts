import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BombError, MAX_ENTRY_COUNT, oversize, safeUnzip } from "../src/guards.ts";

describe("guards", () => {
  it("oversize flags inputs above the cap", () => {
    expect(oversize(new Uint8Array(1024))).toBe(false);
    expect(oversize(new Uint8Array(20 * 1024 * 1024))).toBe(true);
  });

  it("safeUnzip returns entries for a normal archive", () => {
    const entries = safeUnzip(zipSync({ "a.txt": strToU8("hello") }));
    expect(new TextDecoder().decode(entries["a.txt"])).toBe("hello");
  });

  it("safeUnzip throws BombError when the entry count is exceeded", () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < MAX_ENTRY_COUNT + 1; i++) many[`f${i}.txt`] = strToU8("x");
    expect(() => safeUnzip(zipSync(many))).toThrow(BombError);
  });
});

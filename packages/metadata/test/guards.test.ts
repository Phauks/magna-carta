import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  BombError,
  MAX_ENTRY_COUNT,
  MAX_INFLATED_BYTES,
  oversize,
  safeUnzip,
  zipHasEntry,
} from "../src/guards.ts";

// The isolate this runs in has a 128 MiB memory ceiling; the inflated cap has to leave room for the
// input, two entry maps, and the XML working set at the same time.
const ISOLATE_MEMORY_CEILING = 128 * 1024 * 1024;

describe("guards", () => {
  it("oversize flags inputs above the cap", () => {
    expect(oversize(new Uint8Array(1024))).toBe(false);
    expect(oversize(new Uint8Array(20 * 1024 * 1024))).toBe(true);
  });

  it("caps total inflation far enough below the isolate ceiling to leave working room", () => {
    expect(MAX_INFLATED_BYTES).toBeLessThanOrEqual(ISOLATE_MEMORY_CEILING / 4);
  });

  it("zipHasEntry answers membership under the same caps", () => {
    const zip = zipSync({ "word/document.xml": strToU8("<w:document/>") });
    expect(zipHasEntry(zip, "word/document.xml")).toBe(true);
    expect(zipHasEntry(zip, "xl/workbook.xml")).toBe(false);
    expect(() => zipHasEntry(zip, "word/document.xml", { maxInflated: 4 })).toThrow(BombError);
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

  it("safeUnzip throws BombError pre-inflation when declared sizes exceed injected maxInflated", () => {
    // Build a zip with a 100 KB entry; then pass maxInflated: 1000 so the declared size alone
    // (100 KB >> 1000 bytes) trips the pre-inflation filter before fflate inflates anything.
    const big = new Uint8Array(100 * 1024).fill(65); // 100 KB of "A"
    const zip = zipSync({ "big.bin": big });
    expect(() => safeUnzip(zip, { maxInflated: 1000 })).toThrow(BombError);
  });

  it("safeUnzip accepts an archive whose total size is within an injected maxInflated", () => {
    const small = strToU8("hello world");
    const zip = zipSync({ "small.txt": small });
    // 11 bytes well within 1 KB limit.
    const entries = safeUnzip(zip, { maxInflated: 1024 });
    expect(new TextDecoder().decode(entries["small.txt"])).toBe("hello world");
  });
});

import { describe, expect, it } from "vitest";
import { normalizeKey } from "../src/apn.ts";

describe("normalizeKey", () => {
  it("stripSeparators removes dashes, dots, colons, and whitespace", () => {
    expect(normalizeKey("001-23.456", "stripSeparators")).toBe("00123456");
    expect(normalizeKey("  001 23 456 ", "stripSeparators")).toBe("00123456");
  });

  it("stripSeparators leaves an already-bare key unchanged", () => {
    expect(normalizeKey("00123456", "stripSeparators")).toBe("00123456");
  });

  it("keepSeparators preserves the displayed form (only trims surrounding whitespace)", () => {
    expect(normalizeKey(" 234-100.00-01 ", "keepSeparators")).toBe("234-100.00-01");
  });

  it("hawaiiTmk drops the island division and zero-pads to a 12-digit qPublic KeyValue", () => {
    expect(normalizeKey("(1) 9-4-044-078-0000-000", "hawaiiTmk")).toBe("940440780000");
    expect(normalizeKey("3-9-2-118-43", "hawaiiTmk")).toBe("921180430000");
    expect(normalizeKey("3-7-5-20-73-0082", "hawaiiTmk")).toBe("750200730082");
  });

  it("hawaiiTmk passes through an already-normalized 12-digit key", () => {
    expect(normalizeKey("940440780000", "hawaiiTmk")).toBe("940440780000");
  });
});

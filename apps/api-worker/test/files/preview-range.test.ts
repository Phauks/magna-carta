// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { parseSingleByteRange } from "../../src/files/preview-serve.ts";

describe("parseSingleByteRange", () => {
  it("returns null for no Range header (full body)", () => {
    expect(parseSingleByteRange(null, 1000)).toBeNull();
  });
  it("parses bytes=0-99 to offset 0 length 100", () => {
    expect(parseSingleByteRange("bytes=0-99", 1000)).toEqual({ offset: 0, length: 100 });
  });
  it("parses an open-ended bytes=500- to the remainder", () => {
    expect(parseSingleByteRange("bytes=500-", 1000)).toEqual({ offset: 500, length: 500 });
  });
  it("parses a suffix bytes=-100 to the last 100 bytes", () => {
    expect(parseSingleByteRange("bytes=-100", 1000)).toEqual({ offset: 900, length: 100 });
  });
  it("rejects a multi-range / malformed / out-of-range as unsatisfiable", () => {
    expect(parseSingleByteRange("bytes=0-10,20-30", 1000)).toBe("unsatisfiable");
    expect(parseSingleByteRange("items=0-99", 1000)).toBe("unsatisfiable");
    expect(parseSingleByteRange("bytes=2000-3000", 1000)).toBe("unsatisfiable");
  });
});

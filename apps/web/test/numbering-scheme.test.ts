/*
 * The numbering editor's model, pinned: the one rule the editor repeats from the server (exactly
 * one counter, text that can stand in a link), the parts' defaults, the list operations, and the
 * starters, which have to be schemes the server would accept.
 */
import { describe, expect, it } from "vitest";
import {
  matterNumberRefusal,
  moveNumberSegment,
  newNumberSegment,
  NUMBER_SEGMENT_VOCABULARY,
  NUMBERING_STARTERS,
  numberingSchemeRefusal,
  numberingSchemesEqual,
  numberSegmentSummary,
  removeNumberSegment,
  replaceNumberSegment,
  type NumberSegment,
} from "../src/lib/matters/numbering-scheme.ts";

const YEAR_COUNTER: readonly NumberSegment[] = [
  { kind: "year", digits: 4, scoping: true },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 4, start: 1 },
];

describe("numberingSchemeRefusal", () => {
  it("accepts a scheme with exactly one counter and link-safe text", () => {
    expect(numberingSchemeRefusal(YEAR_COUNTER)).toBeNull();
  });

  it("refuses an empty scheme, no counter, and two counters, each in its own words", () => {
    expect(numberingSchemeRefusal([])).toContain("counter");
    expect(numberingSchemeRefusal([{ kind: "year", digits: 4 }])).toContain("needs a counter");
    expect(
      numberingSchemeRefusal([
        { kind: "counter", padWidth: 4 },
        { kind: "counter", padWidth: 4 },
      ]),
    ).toContain("exactly one counter");
  });

  it("refuses text that cannot stand in a link, and empty text", () => {
    expect(
      numberingSchemeRefusal([
        { kind: "literal", text: "a b" },
        { kind: "counter", padWidth: 4 },
      ]),
    ).toContain('"a b"');
    expect(
      numberingSchemeRefusal([
        { kind: "literal", text: "" },
        { kind: "counter", padWidth: 4 },
      ]),
    ).toContain("empty");
  });

  it("refuses a counter narrower than one digit or starting below one", () => {
    expect(numberingSchemeRefusal([{ kind: "counter", padWidth: 0 }])).toContain("width");
    expect(numberingSchemeRefusal([{ kind: "counter", padWidth: 4, start: 0 }])).toContain(
      "starts at one",
    );
  });

  it("accepts every starter, so a shape the picker offers is never one the server refuses", () => {
    for (const starter of NUMBERING_STARTERS) {
      expect(numberingSchemeRefusal(starter.segments), starter.key).toBeNull();
    }
  });
});

describe("the parts", () => {
  it("has a vocabulary entry for every kind a new part can be", () => {
    for (const entry of NUMBER_SEGMENT_VOCABULARY) {
      expect(newNumberSegment(entry.kind).kind).toBe(entry.kind);
      expect(entry.label).not.toBe("");
      expect(entry.description).not.toBe("");
    }
  });

  it("starts a year part restarting the count, and a counter at four digits from one", () => {
    expect(newNumberSegment("year")).toEqual({ kind: "year", digits: 4, scoping: true });
    expect(newNumberSegment("counter")).toEqual({ kind: "counter", padWidth: 4, start: 1 });
  });

  it("reads each part in the reader's words", () => {
    expect(numberSegmentSummary({ kind: "literal", text: "-" })).toBe('"-"');
    expect(numberSegmentSummary({ kind: "counter", padWidth: 4, start: 1 })).toBe(
      "Counter, 4 digits",
    );
    expect(numberSegmentSummary({ kind: "counter", padWidth: 3, start: 100 })).toBe(
      "Counter, 3 digits, from 100",
    );
    expect(numberSegmentSummary({ kind: "year", digits: 2, scoping: true })).toBe(
      "Year, 2 digits, restarts the count",
    );
    expect(numberSegmentSummary({ kind: "location_code" })).toBe("Office Code");
    expect(numberSegmentSummary({ kind: "client_code", scoping: true })).toBe(
      "Client Code, restarts the count",
    );
  });
});

describe("the list operations", () => {
  it("moves a part up or down and leaves the list alone at either end", () => {
    const moved = moveNumberSegment(YEAR_COUNTER, 2, -1);
    expect(moved.map((segment) => segment.kind)).toEqual(["year", "counter", "literal"]);
    expect(moveNumberSegment(YEAR_COUNTER, 0, -1)).toBe(YEAR_COUNTER);
    expect(moveNumberSegment(YEAR_COUNTER, 2, 1)).toBe(YEAR_COUNTER);
  });

  it("replaces and removes by position without touching the rest", () => {
    const replaced = replaceNumberSegment(YEAR_COUNTER, 1, { kind: "literal", text: "." });
    expect(replaced[1]).toEqual({ kind: "literal", text: "." });
    expect(replaced[0]).toBe(YEAR_COUNTER[0]);
    expect(removeNumberSegment(YEAR_COUNTER, 1).map((segment) => segment.kind)).toEqual([
      "year",
      "counter",
    ]);
  });

  it("compares schemes part for part, and a null scheme against a list", () => {
    expect(numberingSchemesEqual(YEAR_COUNTER, [...YEAR_COUNTER])).toBe(true);
    expect(numberingSchemesEqual(YEAR_COUNTER, removeNumberSegment(YEAR_COUNTER, 1))).toBe(false);
    expect(numberingSchemesEqual(null, [])).toBe(false);
    expect(numberingSchemesEqual(null, null)).toBe(true);
  });
});

describe("matterNumberRefusal", () => {
  it("wants a number that can stand in a link", () => {
    expect(matterNumberRefusal("")).not.toBeNull();
    expect(matterNumberRefusal("   ")).not.toBeNull();
    expect(matterNumberRefusal("2019/044")).not.toBeNull();
    expect(matterNumberRefusal("CV-2019-044")).toBeNull();
    expect(matterNumberRefusal("  CV-2019-044  ")).toBeNull();
  });
});

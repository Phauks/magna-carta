/*
 * The numbering editor's model, pinned: the one rule the editor repeats from the server (exactly
 * one counter, text that can stand in a link), the parts' defaults, the list operations, and the
 * starters, which have to be schemes the server would accept.
 */
import { describe, expect, it } from "vitest";
import {
  isSchemeNumberingPurpose,
  matterNumberRefusal,
  moveNumberSegment,
  newNumberSegment,
  NUMBER_SEGMENT_VOCABULARY,
  NUMBERING_STARTERS,
  numberingFrozenSentence,
  numberingInForceDescriptor,
  numberingNothingInForceSentence,
  numberingSampleSentence,
  numberingSampleYear,
  numberingSavedSentence,
  numberingSchemeLabel,
  numberingSchemeRefusal,
  numberingSchemesEqual,
  numberingStartersFor,
  numberSegmentCellRefusal,
  numberSegmentSummary,
  numberSegmentVocabularyFor,
  removeNumberSegment,
  replaceNumberSegment,
  type NumberingPurposeRecord,
  type NumberSegment,
} from "../src/lib/matters/numbering-scheme.ts";

// Two purposes as the listing describes them: the matter run, which may use every part and has no
// default, and the conflicts check run, which carries only the day it was numbered.
const MATTER: NumberingPurposeRecord = {
  purpose: "matter",
  title: "Matter Numbers",
  label: "matter number",
  subject: "matter",
  subjects: "matters",
  drawnWhen: "Drawn once, the moment a matter opens, and frozen from then on.",
  formulation: "scheme",
  segmentKinds: NUMBER_SEGMENT_VOCABULARY.map((entry) => entry.kind),
  segments: null,
  usingDefault: false,
  fixedShape: null,
  example: null,
};
const CONFLICTS_CHECK: NumberingPurposeRecord = {
  purpose: "conflicts_check",
  title: "Conflicts Check Numbers",
  label: "conflicts check number",
  subject: "conflicts check",
  subjects: "conflicts checks",
  drawnWhen: "Drawn the moment a conflicts check is opened.",
  formulation: "scheme",
  segmentKinds: ["literal", "counter", "year", "date_opened"],
  segments: [
    { kind: "literal", text: "CC" },
    { kind: "year", digits: 4, scoping: true },
    { kind: "literal", text: "-" },
    { kind: "counter", padWidth: 5, start: 1 },
  ],
  usingDefault: true,
  fixedShape: null,
  example: "CC2026-00001",
};
const SAMPLE = {
  openedDate: "2026-09-18",
  locationCode: "RNO",
  matterTypeCode: "LIT",
  clientCode: "ASH",
  staffInitials: "EV",
  clientName: "Ashcombe Mercantile",
};

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

describe("a purpose's vocabulary", () => {
  it("offers only the parts the listing names for the purpose, in the picker's order", () => {
    expect(
      numberSegmentVocabularyFor(CONFLICTS_CHECK.segmentKinds ?? []).map((e) => e.kind),
    ).toEqual(["literal", "counter", "year", "date_opened"]);
    expect(numberSegmentVocabularyFor(MATTER.segmentKinds ?? [])).toHaveLength(
      NUMBER_SEGMENT_VOCABULARY.length,
    );
  });

  it("offers a starter only where every part of it is one the purpose may use", () => {
    const keys = numberingStartersFor(CONFLICTS_CHECK.segmentKinds ?? []).map((s) => s.key);
    expect(keys).toEqual(["year-counter", "counter"]);
    expect(numberingStartersFor(MATTER.segmentKinds ?? [])).toHaveLength(NUMBERING_STARTERS.length);
  });

  it("tells a scheme-shaped purpose from a fixed one", () => {
    expect(isSchemeNumberingPurpose("custody_packet")).toBe(true);
    expect(isSchemeNumberingPurpose("invoice")).toBe(false);
  });

  it("names in the sample sentence only the facts the purpose's parts can use", () => {
    expect(numberingSampleSentence(SAMPLE, CONFLICTS_CHECK)).toBe(
      "Previewed for a conflicts check numbered Sep 18, 2026.",
    );
    expect(numberingSampleSentence(SAMPLE, MATTER)).toBe(
      "Previewed for a matter numbered Sep 18, 2026 at office RNO, practice area LIT, client code ASH, attorney EV, client Ashcombe Mercantile.",
    );
  });

  it("names the sample's year, never a hard-coded one, in a starter's example", () => {
    expect(numberingSampleYear(SAMPLE)).toBe("2026");
    const yearCounter = NUMBERING_STARTERS.find((starter) => starter.key === "year-counter");
    expect(yearCounter?.exampleFor("2027")).toBe("2027-0001");
  });

  it("describes what is in force under the number: the parts, the built-in sequence, or nothing", () => {
    expect(numberingInForceDescriptor(MATTER, null, false)).toMatch(/cannot open/);
    expect(numberingInForceDescriptor(CONFLICTS_CHECK, CONFLICTS_CHECK.segments, true)).toBe(
      'The built-in sequence: "CC" · Year, 4 digits, restarts the count · "-" · Counter, 5 digits',
    );
    expect(numberingInForceDescriptor(MATTER, YEAR_COUNTER, false)).toBe(
      'Year, 4 digits, restarts the count · "-" · Counter, 4 digits',
    );
  });
});

describe("the editor's words", () => {
  it("names the scheme row for the sequence it shapes, never for the gesture", () => {
    // Owner ruling, 2026-09-11: "Start from" reads "Matter Numbering Scheme".
    expect(numberingSchemeLabel(MATTER)).toBe("Matter Numbering Scheme");
    expect(numberingSchemeLabel({ title: "Consultation Numbers" })).toBe(
      "Consultation Numbering Scheme",
    );
    expect(numberingSchemeLabel(CONFLICTS_CHECK)).toBe("Conflicts Check Numbering Scheme");
  });

  it("says on a part's hover why a column holds no fact for it, and nothing where it does", () => {
    expect(numberSegmentCellRefusal("literal", "text")).toBeNull();
    expect(numberSegmentCellRefusal("year", "text")).toMatch(/no text of its own/);
    expect(numberSegmentCellRefusal("counter", "digits")).toBeNull();
    expect(numberSegmentCellRefusal("year", "digits")).toBeNull();
    expect(numberSegmentCellRefusal("literal", "digits")).toMatch(/digit count/);
    expect(numberSegmentCellRefusal("counter", "start")).toBeNull();
    expect(numberSegmentCellRefusal("client_code", "start")).toMatch(/counter starts/);
    expect(numberSegmentCellRefusal("client_code", "scoping")).toBeNull();
    expect(numberSegmentCellRefusal("literal", "scoping")).toMatch(/cannot restart the count/);
  });

  it("states the consequence of an unset scheme in the sequence's own terms, without an em dash", () => {
    expect(numberingNothingInForceSentence(MATTER)).toMatch(/cannot open/);
    expect(numberingNothingInForceSentence(CONFLICTS_CHECK)).toBe(
      "Nothing of the firm's; the built-in sequence numbers conflicts checks until one is set.",
    );
    for (const record of [MATTER, CONFLICTS_CHECK]) {
      expect(numberingNothingInForceSentence(record)).not.toContain("—");
      expect(numberingSavedSentence(record)).toMatch(/^Saved\./);
      expect(numberingFrozenSentence(record)).toContain(record.subjects);
    }
    expect(numberingSavedSentence(CONFLICTS_CHECK)).toBe(
      "Saved. Conflicts checks numbered from now on draw their number from this scheme; numbers already drawn are unchanged.",
    );
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

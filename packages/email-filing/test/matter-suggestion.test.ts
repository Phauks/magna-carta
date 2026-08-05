import { describe, expect, it } from "vitest";
import {
  candidateMatterNumbers,
  MAX_SUBJECT_NUMBER_CANDIDATES,
  rankMatterSuggestions,
  type MatterSuggestionEvidence,
} from "../src/matter-suggestion.ts";

function evidence(
  matterId: string,
  signal: MatterSuggestionEvidence["signal"],
  detail: string | null = null,
): MatterSuggestionEvidence {
  return { matterId, signal, detail };
}

describe("rankMatterSuggestions", () => {
  it("returns nothing when nothing fired", () => {
    const ranking = rankMatterSuggestions([], 5);
    expect(ranking.suggestions).toEqual([]);
    expect(ranking.ambiguous).toBe(false);
  });

  it("ranks a filed conversation above a subject number above a correspondent", () => {
    const ranking = rankMatterSuggestions(
      [
        evidence("mat_party", "participantParty", "counsel@example.test"),
        evidence("mat_number", "subjectMatterNumber", "2026-0007"),
        evidence("mat_thread", "threadContinuation", "last filed 2026-08-01T00:00:00.000Z"),
      ],
      5,
    );
    expect(ranking.suggestions.map((item) => item.matterId)).toEqual([
      "mat_thread",
      "mat_number",
      "mat_party",
    ]);
    expect(ranking.suggestions[0]?.confidence).toBe("high");
    expect(ranking.suggestions[1]?.confidence).toBe("medium");
    expect(ranking.suggestions[2]?.confidence).toBe("low");
  });

  it("accumulates several corroborating correspondents on one matter, but not without limit", () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      evidence("mat_many", "participantParty", `person${index}@example.test`),
    );
    const ranking = rankMatterSuggestions(many, 5);
    // Three contributions of 20 — the cap — not eight.
    expect(ranking.suggestions[0]?.score).toBe(60);
    expect(ranking.suggestions[0]?.reasons).toHaveLength(8);
  });

  it("counts a repeated thread signal once, so a long filed conversation cannot out-shout everything", () => {
    const ranking = rankMatterSuggestions(
      [
        evidence("mat_a", "threadContinuation", "one"),
        evidence("mat_a", "threadContinuation", "two"),
        evidence("mat_a", "threadContinuation", "three"),
      ],
      5,
    );
    expect(ranking.suggestions[0]?.score).toBe(60);
  });

  it("combines signals on one matter and reports them strongest-first", () => {
    const ranking = rankMatterSuggestions(
      [
        evidence("mat_a", "searchTerm", "acme"),
        evidence("mat_a", "participantParty", "counsel@example.test"),
        evidence("mat_a", "threadContinuation", null),
      ],
      5,
    );
    expect(ranking.suggestions[0]?.score).toBe(90);
    expect(ranking.suggestions[0]?.signals).toEqual([
      "threadContinuation",
      "participantParty",
      "searchTerm",
    ]);
  });

  it("flags a tie as ambiguous and demotes what would otherwise read as high confidence", () => {
    const ranking = rankMatterSuggestions(
      [evidence("mat_a", "threadContinuation"), evidence("mat_b", "threadContinuation")],
      5,
    );
    expect(ranking.ambiguous).toBe(true);
    expect(ranking.suggestions.map((item) => item.confidence)).toEqual(["medium", "medium"]);
  });

  it("breaks ties on matter id so the same evidence always orders the same way", () => {
    const forward = rankMatterSuggestions(
      [evidence("mat_b", "searchTerm"), evidence("mat_a", "searchTerm")],
      5,
    );
    const reversed = rankMatterSuggestions(
      [evidence("mat_a", "searchTerm"), evidence("mat_b", "searchTerm")],
      5,
    );
    expect(forward.suggestions.map((item) => item.matterId)).toEqual(["mat_a", "mat_b"]);
    expect(reversed.suggestions.map((item) => item.matterId)).toEqual(["mat_a", "mat_b"]);
  });

  it("honours the limit, keeping the strongest candidates", () => {
    const ranking = rankMatterSuggestions(
      [
        evidence("mat_weak", "searchTerm"),
        evidence("mat_strong", "threadContinuation"),
        evidence("mat_middle", "subjectMatterNumber"),
      ],
      2,
    );
    expect(ranking.suggestions.map((item) => item.matterId)).toEqual(["mat_strong", "mat_middle"]);
  });

  it("carries a reason for every distinct piece of evidence, deduplicated", () => {
    const ranking = rankMatterSuggestions(
      [
        evidence("mat_a", "participantParty", "counsel@example.test (opposing_party)"),
        evidence("mat_a", "participantParty", "counsel@example.test (opposing_party)"),
      ],
      5,
    );
    expect(ranking.suggestions[0]?.reasons).toEqual([
      "counsel@example.test (opposing_party) is a party on this matter.",
    ]);
  });
});

describe("candidateMatterNumbers", () => {
  it("returns nothing for an absent subject", () => {
    expect(candidateMatterNumbers(null)).toEqual([]);
  });

  it("finds a number wrapped in the punctuation people put around it", () => {
    expect(candidateMatterNumbers("Re: [2026-0007] Discovery responses")).toContain("2026-0007");
  });

  it("keeps a number's internal separators intact", () => {
    expect(candidateMatterNumbers("FW: NY/2026/0007 — motion")).toContain("NY/2026/0007");
  });

  it("ignores words with no digit and tokens too short to be a number", () => {
    expect(candidateMatterNumbers("Re: motion to compel")).toEqual([]);
    expect(candidateMatterNumbers("a1 b2")).toEqual([]);
  });

  it("deduplicates repeated tokens", () => {
    expect(candidateMatterNumbers("2026-0007 again: 2026-0007")).toEqual(["2026-0007"]);
  });

  it("bounds a pathological subject line", () => {
    const subject = Array.from({ length: 200 }, (_, index) => `2026-${index}`).join(" ");
    expect(candidateMatterNumbers(subject)).toHaveLength(MAX_SUBJECT_NUMBER_CANDIDATES);
  });
});

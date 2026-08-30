/*
 * The conflicts vocabulary is the engine's own catalogue set for a reader, so the thing worth
 * asserting is that it stays a MAPPING and never becomes an opinion: every stored value has a word,
 * a word this build has not been told about prints itself rather than being explained away, and the
 * one loud tone on the surface belongs to an open question rather than to anybody's conclusion.
 */
import { describe, expect, it } from "vitest";
import {
  DISPOSITION_KINDS,
  EVIDENCE_TIERS,
  OPERATOR_TRIGGERS,
  SOURCE_CLASSES,
  STRICTNESS_LEVELS,
  TRIGGER_VOCABULARY,
  UNANSWERED,
  adjudicationChip,
  causeTopicLabel,
  dispositionVocabulary,
  edgeTypeLabel,
  evidenceTier,
  pathSummary,
  sourceVocabulary,
  strictnessVocabulary,
  triggerVocabulary,
} from "../src/lib/conflicts/conflicts-vocabulary.ts";

describe("every catalogue value has a word", () => {
  it("names all four evidence tiers by their ordinal", () => {
    for (const tier of EVIDENCE_TIERS) {
      expect(evidenceTier(tier).label).toBe(`Tier ${String(tier)}`);
      expect(evidenceTier(tier).meaning).not.toBe("");
    }
  });

  it("names every source class and every registered source with no class", () => {
    for (const source of SOURCE_CLASSES) {
      expect(sourceVocabulary(source).label).not.toBe(source);
    }
    expect(sourceVocabulary("prior_firm_history").label).toBe("Prior-firm history");
    expect(sourceVocabulary("nickname_equivalence").label).toBe("Nickname equivalents");
  });

  it("names both strictness bands and every trigger", () => {
    for (const level of STRICTNESS_LEVELS) {
      expect(strictnessVocabulary(level).label).not.toBe(level);
    }
    for (const trigger of Object.keys(TRIGGER_VOCABULARY)) {
      expect(triggerVocabulary(trigger).label).not.toBe(trigger);
    }
  });

  it("names every disposition kind", () => {
    for (const kind of DISPOSITION_KINDS) {
      expect(dispositionVocabulary(kind).label).not.toBe(kind);
    }
  });
});

describe("a word this build has not been told about", () => {
  it("prints itself rather than being explained away", () => {
    // The trigger catalogue is open on the contract, and a source key or a strictness word can
    // outlive the code that wrote it. Printing the stored value is honest; guessing is not.
    expect(triggerVocabulary("something_new").label).toBe("something_new");
    expect(sourceVocabulary("something_new").label).toBe("something_new");
    expect(strictnessVocabulary("something_new").label).toBe("something_new");
    expect(causeTopicLabel("something.new")).toBe("something.new");
    expect(edgeTypeLabel("something_new")).toBe("something_new");
  });
});

describe("only an open question is loud", () => {
  it("gives an unanswered hit the warning tone", () => {
    expect(adjudicationChip(null)).toEqual(UNANSWERED);
    expect(UNANSWERED.tone).toBe("warning");
  });

  it("keeps every reviewer's conclusion calm", () => {
    // A green tick or a red block beside a lawyer's professional judgement would be the platform
    // grading it, which is the one thing this subsystem may never do.
    for (const kind of DISPOSITION_KINDS) {
      expect(["neutral", "info"]).toContain(dispositionVocabulary(kind).tone);
    }
  });
});

describe("what a person may claim when they run a check by hand", () => {
  it("offers only the triggers a person can honestly claim", () => {
    expect([...OPERATOR_TRIGGERS]).toEqual(["preliminary", "comprehensive"]);
  });

  it("never offers a trigger that names a corpus change or the clock", () => {
    for (const trigger of OPERATOR_TRIGGERS) {
      expect(["entity_merged", "periodic_rescan", "personnel_changed"]).not.toContain(trigger);
    }
  });
});

describe("how a hit was reached", () => {
  it("calls a hit with no path direct", () => {
    expect(pathSummary([])).toBe("Direct");
  });

  it("counts the relationships walked", () => {
    expect(pathSummary([{}, {}])).toBe("2 relationships");
    expect(pathSummary([{}])).toBe("1 relationship");
  });

  it("says how many of them had already ended", () => {
    // An ended relationship is traversed rather than skipped, so the reviewer has to see it.
    expect(pathSummary([{ expiredAtCheck: true }, {}])).toBe("2 relationships (1 ended)");
  });
});

describe("an edge type reads as its class", () => {
  it("names the class a relationship belongs to", () => {
    expect(edgeTypeLabel("corporate_parent")).toContain("Corporate family");
    expect(edgeTypeLabel("affiliation")).toContain("Control");
    expect(edgeTypeLabel("relationship")).toContain("Family");
  });
});

import { describe, expect, it } from "vitest";
import type { MatterId } from "@magna-carta/identifiers/types";
import { corpusOfMatter, type CorpusScope } from "../src/corpus.ts";

const MATTER = "matter_test0000000000000000001" as MatterId;
const OTHER_MATTER = "matter_test0000000000000000002" as MatterId;

describe("corpus scope", () => {
  it("maps a matter to its own corpus, identically — the id is the matter's own handle", () => {
    const corpus = corpusOfMatter(MATTER);
    expect(corpus).toEqual({ kind: "matter", id: MATTER });
    // The identity is what keeps every derived key unchanged: nothing is hashed, prefixed, or renamed
    // on the way from a matter to its corpus.
    expect(String(corpus.id)).toBe(String(MATTER));
  });

  it("keeps two matters in two corpora", () => {
    expect(corpusOfMatter(MATTER)).not.toEqual(corpusOfMatter(OTHER_MATTER));
  });

  it("carries its kind as a discriminant, so a second kind is an additive member", () => {
    const corpus: CorpusScope = corpusOfMatter(MATTER);
    expect(corpus.kind).toBe("matter");
  });
});

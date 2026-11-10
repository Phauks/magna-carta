// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import type { FileId, FirmId, MatterId } from "@magna-carta/identifiers/types";
import { corpusOfMatter } from "@magna-carta/search/corpus";
import { found, searchEngineNotImplemented, type SearchHit } from "@magna-carta/search/port";
import type { Bindings } from "../src/bindings.ts";
import type { KeywordSearchInput } from "../src/search/keyword-search.ts";
import { runHybridSearch, type SearchHalf } from "../src/search/hybrid-search.ts";

const INPUT: KeywordSearchInput = {
  firmId: "firm_test0000000000000000000001" as FirmId,
  corpus: corpusOfMatter("matter_test0000000000000000001" as MatterId),
  text: "indemnify",
  limit: 10,
};

function hit(doc: string, chunk: string, score: number): SearchHit {
  return { documentId: doc as FileId, chunkId: chunk, score };
}

const half =
  (result: Parameters<typeof found>[0] | "deferred"): SearchHalf =>
  () =>
    Promise.resolve(result === "deferred" ? searchEngineNotImplemented() : found(result));

describe("runHybridSearch", () => {
  it("fuses the keyword and semantic rankings by reciprocal rank", async () => {
    // Keyword ranks A, B; semantic ranks B, C. B is surfaced by both halves, so fusion lifts it to top.
    const keyword = half([hit("dA", "c", 5), hit("dB", "c", 4)]);
    const semantic = half([hit("dB", "c", 0.9), hit("dC", "c", 0.8)]);
    const result = await runHybridSearch({} as Bindings, INPUT, keyword, semantic);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hits.map((h) => h.documentId)).toEqual(["dB", "dA", "dC"]);
    }
  });

  it("degrades to the keyword half when semantic is deferred", async () => {
    const keyword = half([hit("dA", "c", 5)]);
    const result = await runHybridSearch({} as Bindings, INPUT, keyword, half("deferred"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hits.map((h) => h.documentId)).toEqual(["dA"]);
  });

  it("degrades to the semantic half when keyword is deferred", async () => {
    const semantic = half([hit("dZ", "c", 0.9)]);
    const result = await runHybridSearch({} as Bindings, INPUT, half("deferred"), semantic);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hits.map((h) => h.documentId)).toEqual(["dZ"]);
  });

  it("reports the keyword failure when both halves are unavailable", async () => {
    const result = await runHybridSearch({} as Bindings, INPUT, half("deferred"), half("deferred"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("engine-not-implemented");
  });

  it("caps the fused result to the requested limit", async () => {
    const many = Array.from({ length: 20 }, (_, i) => hit(`d${i}`, "c", 20 - i));
    const result = await runHybridSearch(
      {} as Bindings,
      { ...INPUT, limit: 5 },
      half(many),
      half("deferred"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hits).toHaveLength(5);
  });

  it("defaults the semantic half to deferred, so a real hybrid call today is keyword-only", async () => {
    // No semantic half injected → the deferred default. Keyword injected returns one hit.
    const result = await runHybridSearch({} as Bindings, INPUT, half([hit("dK", "c", 1)]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hits.map((h) => h.documentId)).toEqual(["dK"]);
  });
});

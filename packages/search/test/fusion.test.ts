import { describe, expect, it } from "vitest";
import type { FileId } from "@magna-carta/identifiers/types";
import type { SearchHit } from "../src/port.ts";
import { reciprocalRankFusion } from "../src/fusion.ts";

function hit(doc: string, chunk: string, score: number): SearchHit {
  return { documentId: doc as FileId, chunkId: chunk, score };
}

describe("reciprocalRankFusion", () => {
  it("returns an empty ranking for no input or all-empty lists", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  it("preserves order for a single list and replaces the score with the RRF score", () => {
    const fused = reciprocalRankFusion([[hit("d1", "c1", 9.9), hit("d2", "c2", 0.1)]], 60);
    expect(fused.map((h) => h.documentId)).toEqual(["d1", "d2"]);
    // rank 0 → 1/61, rank 1 → 1/62; the original BM25 magnitudes are gone.
    expect(fused[0]?.score).toBeCloseTo(1 / 61, 10);
    expect(fused[1]?.score).toBeCloseTo(1 / 62, 10);
  });

  it("ranks a passage found by both halves above one found by only a single half", () => {
    // Keyword ranks A first, B second; semantic ranks B first, C second. B is the only passage both
    // halves surface, so RRF must lift it to the top even though neither half ranked it first twice.
    const keyword = [hit("dA", "c", 5), hit("dB", "c", 4)];
    const semantic = [hit("dB", "c", 0.9), hit("dC", "c", 0.8)];
    const fused = reciprocalRankFusion([keyword, semantic]);
    expect(fused[0]?.documentId).toBe("dB");
    // dB scores 1/61 (kw rank1) + 1/61 (sem rank0)... compute precisely: kw rank1 -> 1/62, sem rank0 -> 1/61.
    expect(fused[0]?.score).toBeCloseTo(1 / 62 + 1 / 61, 10);
    // dA and dC each appear once.
    expect(fused.map((h) => h.documentId)).toEqual(["dB", "dA", "dC"]);
  });

  it("fuses the same passage across lists once, and keeps distinct chunks of a document separate", () => {
    const listOne = [hit("d1", "c1", 3), hit("d1", "c2", 2)];
    const listTwo = [hit("d1", "c1", 0.9)];
    const fused = reciprocalRankFusion([listOne, listTwo]);
    // d1/c1 (in both) and d1/c2 (in one) are two distinct results, not collapsed to the document.
    expect(fused).toHaveLength(2);
    const c1 = fused.find((h) => h.chunkId === "c1");
    const c2 = fused.find((h) => h.chunkId === "c2");
    expect(c1?.score).toBeCloseTo(1 / 61 + 1 / 61, 10); // rank0 in both lists
    expect(c2?.score).toBeCloseTo(1 / 62, 10); // rank1 in one list
    expect(fused[0]?.chunkId).toBe("c1"); // the doubly-found passage ranks first
  });

  it("is order-independent across the input lists and deterministic on ties", () => {
    const a = [hit("dX", "c", 1)];
    const b = [hit("dY", "c", 1)];
    // dX and dY each score 1/61 → a tie, broken by document id (dX < dY), regardless of list order.
    expect(reciprocalRankFusion([a, b]).map((h) => h.documentId)).toEqual(["dX", "dY"]);
    expect(reciprocalRankFusion([b, a]).map((h) => h.documentId)).toEqual(["dX", "dY"]);
  });
});

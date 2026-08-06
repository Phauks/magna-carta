import { describe, expect, it } from "vitest";
import type { FileId, FirmId, MatterId } from "@magna-carta/identifiers/types";
import { corpusOfMatter } from "../src/corpus.ts";
import {
  found,
  indexed,
  removed,
  searchAdapterError,
  searchEngineNotImplemented,
  type IndexResult,
  type RemoveResult,
  type SearchIndexPort,
  type SearchQueryResult,
} from "../src/port.ts";

const FIRM = "firm_test0000000000000000000001" as FirmId;
const MATTER = "matter_test0000000000000000001" as MatterId;
const DOCUMENT = "file_test00000000000000000001" as FileId;
const CORPUS = corpusOfMatter(MATTER);

// A trivial in-memory implementation, proving the interface is implementable and documenting the shape
// a real adapter fills. It ignores splitKeys and just matches on substring — enough to exercise the port.
class InMemorySearchIndex implements SearchIndexPort {
  private readonly texts = new Map<string, { documentId: FileId; chunkId: string; text: string }>();

  async index(input: {
    documentId: FileId;
    objectKey: string;
    passages: readonly { chunkId: string; text: string }[];
  }): Promise<IndexResult> {
    for (const passage of input.passages) {
      this.texts.set(passage.chunkId, {
        documentId: input.documentId,
        chunkId: passage.chunkId,
        text: passage.text,
      });
    }
    // The engine writes where the caller told it to and echoes the key back.
    return indexed({
      objectKey: input.objectKey,
      documentCount: input.passages.length,
      sizeBytes: 1024,
      schemaGeneration: 1,
    });
  }

  async remove(input: { documentId: FileId }): Promise<RemoveResult> {
    for (const [chunkId, row] of this.texts) {
      if (row.documentId === input.documentId) this.texts.delete(chunkId);
    }
    return removed();
  }

  async query(input: { text: string; limit: number }): Promise<SearchQueryResult> {
    const hits = [...this.texts.values()]
      .filter((row) => row.text.includes(input.text))
      .slice(0, input.limit)
      .map((row) => ({ documentId: row.documentId, chunkId: row.chunkId, score: 1 }));
    return found(hits);
  }
}

describe("SearchIndexPort", () => {
  it("indexes passages, finds them by term, and removes a document", async () => {
    const port = new InMemorySearchIndex();
    const indexResult = await port.index({
      firmId: FIRM,
      corpus: CORPUS,
      documentId: DOCUMENT,
      version: 1,
      objectKey: `search/${MATTER}/splits/indexSplit_test0000000000000000001.split`,
      passages: [
        { chunkId: `${DOCUMENT}:p1`, text: "the seller shall indemnify the buyer" },
        { chunkId: `${DOCUMENT}:p2`, text: "environmental liability remains" },
      ],
    });
    expect(indexResult.ok).toBe(true);
    if (indexResult.ok) expect(indexResult.published.documentCount).toBe(2);

    const query = await port.query({
      firmId: FIRM,
      corpus: CORPUS,
      text: "indemnify",
      mode: "keyword",
      limit: 10,
      splitKeys: [],
    });
    expect(query.ok).toBe(true);
    if (query.ok) {
      expect(query.hits).toHaveLength(1);
      expect(query.hits[0]?.chunkId).toBe(`${DOCUMENT}:p1`);
    }

    await port.remove({ firmId: FIRM, corpus: CORPUS, documentId: DOCUMENT });
    const afterRemove = await port.query({
      firmId: FIRM,
      corpus: CORPUS,
      text: "indemnify",
      mode: "keyword",
      limit: 10,
      splitKeys: [],
    });
    expect(afterRemove.ok && afterRemove.hits).toHaveLength(0);
  });

  it("exposes the deferred and adapter-error outcomes as first-class results, never throws", () => {
    const deferred = searchEngineNotImplemented();
    expect(deferred).toEqual({ ok: false, reason: "engine-not-implemented" });

    const failed = searchAdapterError("container unreachable");
    expect(failed).toEqual({ ok: false, reason: "adapter-error", detail: "container unreachable" });
  });
});

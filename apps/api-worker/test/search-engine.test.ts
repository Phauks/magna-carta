// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import type { FileId, FirmId, MatterId } from "@magna-carta/identifiers/types";
import { corpusOfMatter } from "@magna-carta/search/corpus";
import type { SearchQueryInput } from "@magna-carta/search/port";
import type { Bindings } from "../src/bindings.ts";
import { resolveSearchIndexPort } from "../src/search/search-engine.ts";

// The engine adapter mints a split-object capability token per operation, so it needs the signing
// secret the Worker signs everything else with.
const AUTH_SECRET = "test-auth-secret-value-not-for-production";

const QUERY: SearchQueryInput = {
  firmId: "firm_test0000000000000000000001" as FirmId,
  corpus: corpusOfMatter("matter_test0000000000000000001" as MatterId),
  text: "indemnify",
  mode: "keyword",
  limit: 10,
  splits: [{ objectKey: "search/matter/splits/a.split", excludeDocumentIds: [] }],
};

describe("resolveSearchIndexPort", () => {
  it("returns the deferred port when no search service is bound", async () => {
    const port = resolveSearchIndexPort({} as Bindings);
    const result = await port.query(QUERY);
    expect(result).toEqual({ ok: false, reason: "engine-not-implemented" });
  });

  it("forwards a query to the bound service and parses the hits", async () => {
    let seen: { url: string; body: unknown } | undefined;
    const fetcher: Pick<Fetcher, "fetch"> = {
      fetch: async (input) => {
        const request = input as Request;
        seen = { url: request.url, body: await request.json() };
        return new Response(
          JSON.stringify({ hits: [{ documentId: "d1", chunkId: "c1", score: 2.5 }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    };
    const port = resolveSearchIndexPort({
      SEARCH_SERVICE: fetcher,
      AUTH_SECRET,
    } as unknown as Bindings);
    const result = await port.query(QUERY);

    expect(seen?.url).toBe("https://search/query");
    expect(seen?.body).toMatchObject({
      text: "indemnify",
      splits: [{ objectKey: "search/matter/splits/a.split", excludeDocumentIds: [] }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hits[0]?.score).toBe(2.5);
  });

  it("forwards a compaction with each source's own delete set", async () => {
    // The exclusions have to reach the engine PER SOURCE. They are what the merge deletes, and a merge
    // that received them flattened across the sources would drop a document from a split that still
    // holds its current version.
    let seen: { url: string; body: unknown } | undefined;
    const fetcher: Pick<Fetcher, "fetch"> = {
      fetch: async (input) => {
        const request = input as Request;
        seen = { url: request.url, body: await request.json() };
        return new Response(
          JSON.stringify({
            objectKey: "search/matter/splits/merged.split",
            documentCount: 40,
            sizeBytes: 4096,
            schemaGeneration: 1,
            excludedDocumentIds: ["file_test00000000000000000001"],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    };
    const port = resolveSearchIndexPort({
      SEARCH_SERVICE: fetcher,
      AUTH_SECRET,
    } as unknown as Bindings);
    const result = await port.compact({
      firmId: QUERY.firmId,
      corpus: QUERY.corpus,
      sources: [
        {
          objectKey: "search/matter/splits/a.split",
          excludeDocumentIds: ["file_test00000000000000000001" as FileId],
        },
        { objectKey: "search/matter/splits/b.split", excludeDocumentIds: [] },
      ],
      objectKey: "search/matter/splits/merged.split",
    });

    expect(seen?.url).toBe("https://search/compact");
    expect(seen?.body).toMatchObject({
      objectKey: "search/matter/splits/merged.split",
      sources: [
        {
          objectKey: "search/matter/splits/a.split",
          excludeDocumentIds: ["file_test00000000000000000001"],
        },
        { objectKey: "search/matter/splits/b.split", excludeDocumentIds: [] },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.published.documentCount).toBe(40);
      expect(result.published.excludedDocumentIds).toEqual(["file_test00000000000000000001"]);
    }
  });

  it("reports compaction as engine-not-implemented when no search service is bound", async () => {
    const port = resolveSearchIndexPort({} as Bindings);
    const result = await port.compact({
      firmId: QUERY.firmId,
      corpus: QUERY.corpus,
      sources: [{ objectKey: "search/matter/splits/a.split", excludeDocumentIds: [] }],
      objectKey: "search/matter/splits/merged.split",
    });
    expect(result).toEqual({ ok: false, reason: "engine-not-implemented" });
  });

  it("maps a non-2xx engine response to an adapter error, never throwing", async () => {
    const fetcher: Pick<Fetcher, "fetch"> = {
      fetch: async () => new Response("boom", { status: 500 }),
    };
    const port = resolveSearchIndexPort({
      SEARCH_SERVICE: fetcher,
      AUTH_SECRET,
    } as unknown as Bindings);
    const result = await port.query(QUERY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("adapter-error");
      expect(result.detail).toContain("500");
    }
  });

  it("maps a transport throw to an adapter error, never throwing", async () => {
    const fetcher: Pick<Fetcher, "fetch"> = {
      fetch: async () => {
        throw new Error("connection reset");
      },
    };
    const port = resolveSearchIndexPort({
      SEARCH_SERVICE: fetcher,
      AUTH_SECRET,
    } as unknown as Bindings);
    const result = await port.query(QUERY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("adapter-error");
      expect(result.detail).toBe("connection reset");
    }
  });
});

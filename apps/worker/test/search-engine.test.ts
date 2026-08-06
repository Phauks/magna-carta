import { describe, expect, it } from "vitest";
import type { FirmId, MatterId } from "@magna-carta/identifiers/types";
import { corpusOfMatter } from "@magna-carta/search/corpus";
import type { SearchQueryInput } from "@magna-carta/search/port";
import type { Bindings } from "../src/app.ts";
import { resolveSearchIndexPort } from "../src/search/search-engine.ts";

const QUERY: SearchQueryInput = {
  firmId: "firm_test0000000000000000000001" as FirmId,
  corpus: corpusOfMatter("matter_test0000000000000000001" as MatterId),
  text: "indemnify",
  mode: "keyword",
  limit: 10,
  splitKeys: ["search/matter/splits/a.split"],
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
    const port = resolveSearchIndexPort({ SEARCH_SERVICE: fetcher } as unknown as Bindings);
    const result = await port.query(QUERY);

    expect(seen?.url).toBe("https://search/query");
    expect(seen?.body).toMatchObject({
      text: "indemnify",
      splitKeys: ["search/matter/splits/a.split"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hits[0]?.score).toBe(2.5);
  });

  it("maps a non-2xx engine response to an adapter error, never throwing", async () => {
    const fetcher: Pick<Fetcher, "fetch"> = {
      fetch: async () => new Response("boom", { status: 500 }),
    };
    const port = resolveSearchIndexPort({ SEARCH_SERVICE: fetcher } as unknown as Bindings);
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
    const port = resolveSearchIndexPort({ SEARCH_SERVICE: fetcher } as unknown as Bindings);
    const result = await port.query(QUERY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("adapter-error");
      expect(result.detail).toBe("connection reset");
    }
  });
});

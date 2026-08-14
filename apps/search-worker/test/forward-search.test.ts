import { describe, expect, it } from "vitest";
import {
  ENGINE_OPERATIONS,
  engineOperationOf,
  forwardEngineOperation,
  pokeContainer,
  type SearchContainerFetcher,
} from "../src/forward-search.ts";
import { forwardSplitObjectCall, SPLIT_OBJECT_HOST } from "../src/split-object-forwarding.ts";
import { SEARCH_PRIMARY_SHARD_NAME, searchShardNameForFirm } from "../src/search-shard.ts";

function recordingContainer(response: Response): {
  container: SearchContainerFetcher;
  seen: Request[];
} {
  const seen: Request[] = [];
  return {
    seen,
    container: {
      fetch: (request) => {
        seen.push(request);
        return Promise.resolve(response.clone());
      },
    },
  };
}

describe("the proxy forwards only the operations the port defines", () => {
  it("recognises exactly the four engine operations", () => {
    expect([...ENGINE_OPERATIONS]).toEqual(["index", "query", "remove", "compact"]);
    for (const operation of ENGINE_OPERATIONS) {
      expect(engineOperationOf(`/${operation}`)).toBe(operation);
    }
  });

  it("refuses anything else rather than passing it to the engine", () => {
    // The service binding is the trust boundary, but a boundary that forwards whatever it is handed
    // is not one — an unknown path must stop here, not reach the container.
    for (const path of ["/", "/health", "/index/../query", "/Query", "/indexx"]) {
      expect(engineOperationOf(path), path).toBeNull();
    }
  });

  it("passes the body through to the container's own path", async () => {
    const { container, seen } = recordingContainer(
      Response.json({ hits: [], rangedReads: 0 }, { status: 200 }),
    );
    const response = await forwardEngineOperation(
      new Request("https://search/query", { method: "POST", body: '{"firmId":"firm_x"}' }),
      "query",
      container,
    );
    expect(response.status).toBe(200);
    expect(seen[0]?.url).toBe("http://search/query");
    expect(await seen[0]?.text()).toBe('{"firmId":"firm_x"}');
  });

  it("pokes the container's readiness endpoint and nothing else", async () => {
    const { container, seen } = recordingContainer(new Response(null, { status: 200 }));
    await pokeContainer(container);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("http://search/ready");
  });
});

describe("shard routing keeps a firm's working set in one place", () => {
  it("sends a firm to the same instance every time", () => {
    const first = searchShardNameForFirm("firm_abcdefghijklmnopqrstuvwxyz01");
    expect(searchShardNameForFirm("firm_abcdefghijklmnopqrstuvwxyz01")).toBe(first);
    // Not a stability claim about the hash: the point is that a firm's queries land where its splits
    // are already open, which is the only reason a warm engine is worth paying for.
    expect(first).toMatch(/^search-\d$/);
  });

  it("spreads different firms across the configured instances", () => {
    const names = new Set(
      Array.from({ length: 40 }, (_, index) => searchShardNameForFirm(`firm_spread_${index}`)),
    );
    expect(names.size).toBeGreaterThan(1);
  });

  it("sends a call with no firm to the warm primary rather than waking a cold instance", () => {
    // A health poke must never be the thing that starts a container.
    expect(searchShardNameForFirm(null)).toBe(SEARCH_PRIMARY_SHARD_NAME);
    expect(searchShardNameForFirm("")).toBe(SEARCH_PRIMARY_SHARD_NAME);
  });
});

describe("the engine's object calls are forwarded, never rewritten", () => {
  it("names the same internal host the app worker mounts", () => {
    // Two constants, two repositories of truth about one hostname; they are asserted equal here so a
    // rename on one side fails a test rather than turning every engine read into blocked egress.
    expect(SPLIT_OBJECT_HOST).toBe("splits.magna-carta.internal");
  });

  it("hands the app worker the request verbatim, range header and all", async () => {
    // This hop must add nothing and strip nothing: the capability token rides in the engine's own
    // headers and is verified on the far side, and the Range header is what makes the read ranged.
    let forwarded: Request | undefined;
    const appWorker = {
      fetch: (request: Request) => {
        forwarded = request;
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 206 }));
      },
    } as unknown as Fetcher;

    const original = new Request(`http://${SPLIT_OBJECT_HOST}/search-objects/search/m/s.split`, {
      headers: { range: "bytes=10-19", "x-mc-split-token": "token-value" },
    });
    const response = await forwardSplitObjectCall(original, appWorker);

    expect(response.status).toBe(206);
    expect(forwarded?.url).toBe(original.url);
    expect(forwarded?.headers.get("range")).toBe("bytes=10-19");
    expect(forwarded?.headers.get("x-mc-split-token")).toBe("token-value");
  });
});

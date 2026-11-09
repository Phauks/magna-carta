import { describe, expect, it } from "vitest";
import {
  ADDRESS_SOURCE_HOST,
  SOURCE_LIST_URL,
  serveSourceCall,
  sourceOutputUrl,
  upstreamUrlOf,
  type SourceFetch,
} from "../src/source-host.ts";

function recordingFetch(response: () => Response): {
  fetcher: SourceFetch;
  seen: { input: string; init: RequestInit }[];
} {
  const seen: { input: string; init: RequestInit }[] = [];
  return {
    seen,
    fetcher: (input, init) => {
      seen.push({ input, init });
      return Promise.resolve(response());
    },
  };
}

function sourceRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`http://${ADDRESS_SOURCE_HOST}${path}`, init);
}

describe("the source host's allow-list", () => {
  it("maps exactly the two shapes a build needs", () => {
    expect(upstreamUrlOf(sourceRequest("/api/data"))).toBe(
      "https://batch.openaddresses.io/api/data",
    );
    expect(upstreamUrlOf(sourceRequest("/job/38412/source.geojson.gz"))).toBe(
      "https://v2.openaddresses.io/batch-prod/job/38412/source.geojson.gz",
    );
    expect(SOURCE_LIST_URL).toBe("https://batch.openaddresses.io/api/data");
    expect(sourceOutputUrl("1")).toBe(
      "https://v2.openaddresses.io/batch-prod/job/1/source.geojson.gz",
    );
  });

  it("refuses every other path, method and query", () => {
    const refused = [
      sourceRequest("/"),
      sourceRequest("/api/data/"),
      sourceRequest("/api/data?layer=addresses"),
      sourceRequest("/api/data", { method: "POST", body: "{}" }),
      sourceRequest("/api/data", { method: "HEAD" }),
      sourceRequest("/api/login"),
      sourceRequest("/job/abc/source.geojson.gz"),
      sourceRequest("/job/1234567890123/source.geojson.gz"),
      sourceRequest("/job/1/source.geojson"),
      sourceRequest("/job/1/../../etc/passwd"),
      sourceRequest("/job/1/source.geojson.gz?redirect=https://example.com"),
      sourceRequest("/batch-prod/job/1/source.geojson.gz"),
    ];
    for (const request of refused) {
      expect(upstreamUrlOf(request), `${request.method} ${request.url}`).toBeNull();
    }
  });

  it("answers a refused call with 404 and never fetches", async () => {
    const { fetcher, seen } = recordingFetch(() => new Response("never"));
    const response = await serveSourceCall(sourceRequest("/api/login"), fetcher);
    expect(response.status).toBe(404);
    expect(seen).toEqual([]);
  });
});

describe("forwarding", () => {
  it("fetches the source list fresh, without the container's headers", async () => {
    const { fetcher, seen } = recordingFetch(() =>
      Response.json([{ source: "us/nc/alamance" }], { status: 200 }),
    );
    const response = await serveSourceCall(
      sourceRequest("/api/data", { headers: { authorization: "Bearer leaked", cookie: "a=b" } }),
      fetcher,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ source: "us/nc/alamance" }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.input).toBe(SOURCE_LIST_URL);
    const headers = new Headers(seen[0]?.init.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
  });

  it("follows the redirect to the presigned object and streams its body back", async () => {
    const gzipBytes = new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3]);
    const { fetcher, seen } = recordingFetch(
      () =>
        new Response(gzipBytes, {
          status: 200,
          headers: {
            "content-type": "application/gzip",
            "content-length": String(gzipBytes.byteLength),
            "x-amz-request-id": "upstream-detail",
          },
        }),
    );
    const response = await serveSourceCall(sourceRequest("/job/38412/source.geojson.gz"), fetcher);
    expect(seen[0]?.init.redirect).toBe("follow");
    expect(seen[0]?.init.method).toBe("GET");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/gzip");
    expect(response.headers.get("content-length")).toBe("7");
    expect(response.headers.get("x-amz-request-id")).toBeNull();
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...gzipBytes]);
  });

  it("passes an upstream miss through as the build's to handle", async () => {
    const { fetcher } = recordingFetch(() => new Response("missing", { status: 404 }));
    const response = await serveSourceCall(sourceRequest("/job/1/source.geojson.gz"), fetcher);
    expect(response.status).toBe(404);
  });

  it("drops a length that a decoded body would not match", async () => {
    const { fetcher } = recordingFetch(
      () =>
        new Response("plain", {
          headers: { "content-length": "3", "content-encoding": "gzip" },
        }),
    );
    const response = await serveSourceCall(sourceRequest("/api/data"), fetcher);
    expect(response.headers.get("content-length")).toBeNull();
  });
});

describe("the host name", () => {
  it("names the same internal host the container calls", () => {
    // Duplicated in containers/address on purpose (a worker and a container cannot share a constant);
    // pinned here so a rename on one side fails a test rather than turning every source fetch into
    // blocked egress.
    expect(ADDRESS_SOURCE_HOST).toBe("openaddresses.magna-carta.internal");
  });
});

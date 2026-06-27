import { describe, expect, it } from "vitest";
import { forwardBuild } from "../src/forward-build.ts";
import { handleBundleR2 } from "../src/outbound-r2.ts";

// A minimal fake container that returns a fixed response. The real container is a Docker image
// that cannot run under the local test pool; forwardBuild only needs a { fetch } object.
function fakeContainer(response: Response): { fetch(req: Request): Promise<Response> } {
  return { fetch: async () => response };
}

describe("forwardBuild", () => {
  it("forwards POST /build to the container and returns the response verbatim", async () => {
    const buildResponse = {
      ok: true,
      volumes: [{ key: "bundles/abc/bundle.zip", sizeBytes: 1024 }],
    };
    const container = fakeContainer(
      new Response(JSON.stringify(buildResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = new Request("http://bundle-worker/build", {
      method: "POST",
      body: JSON.stringify({ jobId: "job-1", format: "zip" }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await forwardBuild(request, container);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(buildResponse);
  });

  it("forwards POST /build?stream=1 and passes the streaming body through", async () => {
    // ZIP magic bytes — the container returns a streamed archive for the encrypted lane.
    const archiveBytes = new Uint8Array([80, 75, 3, 4]);
    const container = fakeContainer(
      new Response(archiveBytes, {
        status: 200,
        headers: { "Content-Type": "application/zip" },
      }),
    );

    const request = new Request("http://bundle-worker/build?stream=1", {
      method: "POST",
      body: JSON.stringify({ jobId: "job-2", encryption: { password: "x" } }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await forwardBuild(request, container);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    const buffer = await response.arrayBuffer();
    expect(new Uint8Array(buffer)).toEqual(archiveBytes);
  });

  it("passes the request body and query string through to the container", async () => {
    // A capturing fake records the request the proxy actually sends to the container, so we can assert
    // the manifest body and the ?stream flag reach it (not just that some response comes back).
    let seenUrl = "";
    let seenBody = "";
    const container = {
      async fetch(req: Request): Promise<Response> {
        seenUrl = req.url;
        seenBody = await req.text();
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      },
    };
    const manifest = JSON.stringify({ jobId: "job-3", format: "sevenZip", entries: [] });
    const request = new Request("http://bundle-worker/build?stream=1", {
      method: "POST",
      body: manifest,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await forwardBuild(request, container);
    expect(seenBody).toBe(manifest);
    expect(seenUrl).toContain("/build?stream=1");
  });

  it("returns 404 for a non-POST method", async () => {
    const container = fakeContainer(new Response("ok", { status: 200 }));
    const request = new Request("http://bundle-worker/build", { method: "GET" });
    const response = await forwardBuild(request, container);
    expect(response.status).toBe(404);
  });

  it("returns 404 for a non-/build path", async () => {
    const container = fakeContainer(new Response("ok", { status: 200 }));
    const request = new Request("http://bundle-worker/scan", {
      method: "POST",
      body: "x",
    });
    const response = await forwardBuild(request, container);
    expect(response.status).toBe(404);
  });

  it("propagates non-200 status codes from the container", async () => {
    const container = fakeContainer(new Response("build failed", { status: 500 }));
    const request = new Request("http://bundle-worker/build", {
      method: "POST",
      body: "{}",
    });
    const response = await forwardBuild(request, container);
    expect(response.status).toBe(500);
  });

  it("captures the query string when forwarding to the container", async () => {
    let capturedUrl: string | undefined;
    const container = {
      fetch: async (req: Request) => {
        capturedUrl = req.url;
        return new Response(JSON.stringify({ ok: true, volumes: [] }), { status: 200 });
      },
    };

    const request = new Request("http://bundle-worker/build?stream=1", {
      method: "POST",
      body: "{}",
    });

    await forwardBuild(request, container);
    expect(capturedUrl).toContain("stream=1");
  });
});

// Fake R2Bucket that stores and retrieves Uint8Array values from an in-memory map.
// Only implements get and put — the two operations handleBundleR2 uses.
function fakeR2Bucket(store: Map<string, Uint8Array>): R2Bucket {
  return {
    async get(key: string) {
      const data = store.get(key);
      if (data === undefined) return null;
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(data);
            controller.close();
          },
        }),
        key,
        size: data.byteLength,
        httpMetadata: {},
        customMetadata: {},
        checksums: {},
        httpEtag: "",
        etag: "",
        uploaded: new Date(),
        version: "",
        storageClass: "Standard",
        writeHttpMetadata(_headers: Headers) {},
        arrayBuffer: async () => data.buffer as ArrayBuffer,
        bytes: async () => data,
        text: async () => new TextDecoder().decode(data),
        json: async () => JSON.parse(new TextDecoder().decode(data)),
        blob: async () => new Blob([data]),
      } as unknown as R2ObjectBody;
    },
    async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob) {
      if (value !== null && value !== undefined) {
        const bytes = new Uint8Array(await new Response(value as BodyInit).arrayBuffer());
        store.set(key, bytes);
      }
      return {
        key,
        size: 0,
        httpEtag: "",
        etag: "",
        uploaded: new Date(),
        version: "",
        storageClass: "Standard",
        checksums: {},
        httpMetadata: {},
        customMetadata: {},
        writeHttpMetadata(_headers: Headers) {},
      } as unknown as R2Object;
    },
  } as unknown as R2Bucket;
}

describe("handleBundleR2", () => {
  it("streams the stored object body on a GET hit", async () => {
    const content = new TextEncoder().encode("archive content");
    const store = new Map([["bundles/job-1/bundle.zip", content]]);
    const r2 = fakeR2Bucket(store);

    const request = new Request("http://bundle-r2/bundles/job-1/bundle.zip");
    const response = await handleBundleR2(request, r2);
    expect(response.status).toBe(200);
    const buffer = new Uint8Array(await response.arrayBuffer());
    expect(buffer).toEqual(content);
  });

  it("returns 404 on a GET miss", async () => {
    const r2 = fakeR2Bucket(new Map());
    const request = new Request("http://bundle-r2/missing/key.zip");
    const response = await handleBundleR2(request, r2);
    expect(response.status).toBe(404);
  });

  it("stores the body on a PUT and returns 200", async () => {
    const store = new Map<string, Uint8Array>();
    const r2 = fakeR2Bucket(store);
    const content = new TextEncoder().encode("source file bytes");

    const request = new Request("http://bundle-r2/files/source.pdf", {
      method: "PUT",
      body: content,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await handleBundleR2(request, r2);
    expect(response.status).toBe(200);
    expect(store.get("files/source.pdf")).toEqual(content);
  });

  it("returns 405 for unsupported methods", async () => {
    const r2 = fakeR2Bucket(new Map());
    const request = new Request("http://bundle-r2/some/key", { method: "DELETE" });
    const response = await handleBundleR2(request, r2);
    expect(response.status).toBe(405);
  });
});

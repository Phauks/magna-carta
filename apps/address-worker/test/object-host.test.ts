import { describe, expect, it } from "vitest";
import {
  ADDRESS_OBJECT_HOST,
  MULTIPART_PART_SIZE_BYTES,
  OBJECT_SIZE_HEADER,
  SMALL_OBJECT_LIMIT_BYTES,
  addressObjectKeyOf,
  parseByteRange,
  serveObjectCall,
  uploadedPartsOf,
  type ObjectHostAccess,
} from "../src/object-host.ts";
import { memoryBucket, type MemoryBucket } from "./fakes/memory-bucket.ts";

const SPLIT_KEY = "us/build-1/northeast.split";
const POINTER_KEY = "us/current.json";

// Bytes 0..255 repeated, so any slice says where it came from.
function patterned(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => index % 256);
}

function call(
  storage: MemoryBucket,
  path: string,
  init: RequestInit & { duplex?: "half" } = {},
  access: ObjectHostAccess = "read-write",
): Promise<Response> {
  return serveObjectCall(new Request(`http://${ADDRESS_OBJECT_HOST}${path}`, init), {
    bucket: storage.bucket,
    access,
    knownLength: (body) => body,
  });
}

describe("object keys", () => {
  it("accepts keys under a two-letter country", () => {
    for (const key of [POINTER_KEY, SPLIT_KEY, "us/build-1/attribution.json", "ca/x_y/z.split"]) {
      expect(addressObjectKeyOf(key), key).toBe(key);
    }
  });

  it("refuses anything else", () => {
    for (const key of [
      "",
      "us",
      "us/",
      "usa/current.json",
      "US/current.json",
      "/us/current.json",
      "us/../secrets",
      "us/a/../b",
      "us//current.json",
      "us/current.json/",
      "us/Current.json",
      "us/current%2Ejson",
      "us/current json",
      "u1/current.json",
    ]) {
      expect(addressObjectKeyOf(key), key).toBeNull();
    }
  });

  it("answers a bad key with 400 and touches no storage", async () => {
    const storage = memoryBucket();
    const response = await call(storage, "/objects/us/../escape", { method: "HEAD" });
    expect(response.status).toBe(400);
    expect(storage.operations).toEqual([]);
  });
});

describe("byte ranges", () => {
  it("parses the one closed range the engine sends", () => {
    expect(parseByteRange("bytes=0-0")).toEqual({ first: 0, last: 0 });
    expect(parseByteRange("bytes=10-19")).toEqual({ first: 10, last: 19 });
  });

  it("refuses open, suffix, multiple, inverted and oversized ranges", () => {
    for (const header of [
      "bytes=5-",
      "bytes=-5",
      "bytes=0-1,4-5",
      "bytes=9-3",
      "items=0-1",
      "bytes=0-99999999999999999999",
      "",
    ]) {
      expect(parseByteRange(header), header).toBeNull();
    }
  });
});

describe("HEAD /objects/<key>", () => {
  it("answers the size in content-length and in the size header", async () => {
    const storage = memoryBucket();
    storage.put(SPLIT_KEY, patterned(1000));
    const response = await call(storage, `/objects/${SPLIT_KEY}`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("1000");
    expect(response.headers.get(OBJECT_SIZE_HEADER)).toBe("1000");
    expect(storage.operations).toEqual(["head"]);
  });

  it("answers 404 for an absent object", async () => {
    const response = await call(memoryBucket(), `/objects/${SPLIT_KEY}`, { method: "HEAD" });
    expect(response.status).toBe(404);
  });
});

describe("GET /objects/<key>", () => {
  it("serves exactly the requested bytes with one storage read", async () => {
    const storage = memoryBucket();
    storage.put(SPLIT_KEY, patterned(1000));
    const response = await call(storage, `/objects/${SPLIT_KEY}`, {
      headers: { range: "bytes=300-309" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("content-range")).toBe("bytes 300-309/1000");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      44, 45, 46, 47, 48, 49, 50, 51, 52, 53,
    ]);
    expect(storage.operations).toEqual(["get"]);
  });

  it("serves the last byte and a single byte", async () => {
    const storage = memoryBucket();
    storage.put(SPLIT_KEY, patterned(1000));
    const response = await call(storage, `/objects/${SPLIT_KEY}`, {
      headers: { range: "bytes=999-999" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 999-999/1000");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([999 % 256]);
  });

  it("serves a range that runs past the end up to the end, and says where it stopped", async () => {
    const storage = memoryBucket();
    storage.put(SPLIT_KEY, patterned(1000));
    const response = await call(storage, `/objects/${SPLIT_KEY}`, {
      headers: { range: "bytes=990-1999" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("content-range")).toBe("bytes 990-999/1000");
    expect((await response.arrayBuffer()).byteLength).toBe(10);
  });

  it("answers 416 with the size for a range that starts past the end", async () => {
    const storage = memoryBucket();
    storage.put(SPLIT_KEY, patterned(1000));
    const response = await call(storage, `/objects/${SPLIT_KEY}`, {
      headers: { range: "bytes=1000-1009" },
    });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */1000");
    expect(await response.json()).toEqual({ error: "range-not-satisfiable" });
  });

  it("refuses a GET without a range rather than serving a split whole", async () => {
    const storage = memoryBucket();
    storage.put(SPLIT_KEY, patterned(1000));
    const response = await call(storage, `/objects/${SPLIT_KEY}`);
    expect(response.status).toBe(416);
    expect(await response.json()).toEqual({ error: "range-required" });
    // The refusal costs no storage read: the expensive shape never reaches R2.
    expect(storage.operations).toEqual([]);
  });

  it("refuses a malformed range with 400 and no storage read", async () => {
    const storage = memoryBucket();
    storage.put(SPLIT_KEY, patterned(1000));
    const response = await call(storage, `/objects/${SPLIT_KEY}`, {
      headers: { range: "bytes=10-" },
    });
    expect(response.status).toBe(400);
    expect(storage.operations).toEqual([]);
  });

  it("answers 404 for an absent object", async () => {
    const response = await call(memoryBucket(), `/objects/${SPLIT_KEY}`, {
      headers: { range: "bytes=0-9" },
    });
    expect(response.status).toBe(404);
  });

  it("serves a small object whole when asked for it by name", async () => {
    const storage = memoryBucket();
    storage.put(POINTER_KEY, '{"build":"build-1"}');
    const response = await call(storage, `/objects/${POINTER_KEY}`, {
      headers: { "x-mc-whole": "small" },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"build":"build-1"}');
  });

  it("refuses a whole read of anything over a mebibyte", async () => {
    const storage = memoryBucket();
    storage.put(SPLIT_KEY, patterned(SMALL_OBJECT_LIMIT_BYTES + 1));
    const response = await call(storage, `/objects/${SPLIT_KEY}`, {
      headers: { "x-mc-whole": "small" },
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too-large" });
  });

  it("does not treat any other value of the whole header as a request for the whole object", async () => {
    const storage = memoryBucket();
    storage.put(POINTER_KEY, "{}");
    const response = await call(storage, `/objects/${POINTER_KEY}`, {
      headers: { "x-mc-whole": "yes" },
    });
    expect(response.status).toBe(416);
  });
});

describe("PUT and DELETE /objects/<key>", () => {
  it("puts a small object", async () => {
    const storage = memoryBucket();
    const response = await call(storage, `/objects/${POINTER_KEY}`, {
      method: "PUT",
      body: '{"build":"build-2"}',
    });
    expect(response.status).toBe(204);
    expect(new TextDecoder().decode(storage.objects.get(POINTER_KEY)?.bytes)).toBe(
      '{"build":"build-2"}',
    );
  });

  it("refuses a body over a mebibyte, whatever its header says, and stores nothing", async () => {
    const storage = memoryBucket();
    const response = await call(storage, `/objects/${POINTER_KEY}`, {
      method: "PUT",
      body: patterned(SMALL_OBJECT_LIMIT_BYTES + 1),
    });
    expect(response.status).toBe(413);
    expect(storage.objects.has(POINTER_KEY)).toBe(false);
  });

  it("refuses a declared length over a mebibyte before reading the body", async () => {
    const storage = memoryBucket();
    const response = await call(storage, `/objects/${POINTER_KEY}`, {
      method: "PUT",
      body: "{}",
      headers: { "content-length": String(SMALL_OBJECT_LIMIT_BYTES + 1) },
    });
    expect(response.status).toBe(413);
    expect(storage.operations).toEqual([]);
  });

  it("deletes an object", async () => {
    const storage = memoryBucket();
    storage.put(SPLIT_KEY, patterned(10));
    const response = await call(storage, `/objects/${SPLIT_KEY}`, { method: "DELETE" });
    expect(response.status).toBe(204);
    expect(storage.objects.has(SPLIT_KEY)).toBe(false);
  });

  it("refuses an unknown method on an object", async () => {
    const response = await call(memoryBucket(), `/objects/${SPLIT_KEY}`, { method: "POST" });
    expect(response.status).toBe(404);
  });
});

describe("multipart uploads", () => {
  async function startUpload(storage: MemoryBucket): Promise<string> {
    const response = await call(storage, `/uploads/${SPLIT_KEY}`, { method: "POST" });
    expect(response.status).toBe(200);
    const { uploadId } = (await response.json()) as { uploadId: string };
    expect(uploadId).toBeTruthy();
    return uploadId;
  }

  function putPart(
    storage: MemoryBucket,
    uploadId: string,
    part: number | string,
    bytes: Uint8Array,
  ): Promise<Response> {
    return call(
      storage,
      `/uploads/${SPLIT_KEY}?uploadId=${encodeURIComponent(uploadId)}&part=${String(part)}`,
      {
        method: "PUT",
        body: new Response(bytes).body,
        headers: { "content-length": String(bytes.byteLength) },
        duplex: "half",
      },
    );
  }

  it("assembles an object from parts uploaded in any order", async () => {
    const storage = memoryBucket();
    const uploadId = await startUpload(storage);
    const whole = patterned(250);
    const first = whole.slice(0, 100);
    const second = whole.slice(100, 200);
    const last = whole.slice(200);

    const etags: Record<number, string> = {};
    for (const [part, bytes] of [
      [2, second],
      [1, first],
      [3, last],
    ] as const) {
      const response = await putPart(storage, uploadId, part, bytes);
      expect(response.status).toBe(200);
      etags[part] = (await response.json<{ etag: string }>()).etag;
    }

    const complete = await call(
      storage,
      `/uploads/${SPLIT_KEY}/complete?uploadId=${encodeURIComponent(uploadId)}`,
      {
        method: "POST",
        body: JSON.stringify({
          parts: [
            { part: 3, etag: etags[3] },
            { part: 1, etag: etags[1] },
            { part: 2, etag: etags[2] },
          ],
        }),
      },
    );
    expect(complete.status).toBe(204);
    expect([...(storage.objects.get(SPLIT_KEY)?.bytes ?? [])]).toEqual([...whole]);
  });

  it("requires a declared length on a part", async () => {
    const storage = memoryBucket();
    const uploadId = await startUpload(storage);
    const response = await call(storage, `/uploads/${SPLIT_KEY}?uploadId=${uploadId}&part=1`, {
      method: "PUT",
      body: new Response(patterned(10)).body,
      duplex: "half",
    });
    expect(response.status).toBe(411);
    expect(storage.operations).not.toContain("uploadPart");
  });

  it("refuses a part larger than the part size before reading it", async () => {
    const storage = memoryBucket();
    const uploadId = await startUpload(storage);
    const response = await call(storage, `/uploads/${SPLIT_KEY}?uploadId=${uploadId}&part=1`, {
      method: "PUT",
      body: "x",
      headers: { "content-length": String(MULTIPART_PART_SIZE_BYTES + 1) },
    });
    expect(response.status).toBe(413);
    expect(storage.operations).not.toContain("uploadPart");
  });

  it("refuses a part number outside R2's range", async () => {
    const storage = memoryBucket();
    const uploadId = await startUpload(storage);
    for (const part of [0, 10_001, "1.5", "-1", "one"]) {
      const response = await putPart(storage, uploadId, part, patterned(4));
      expect(response.status, String(part)).toBe(400);
    }
    expect(storage.operations).not.toContain("uploadPart");
  });

  it("refuses a part or a completion without an upload identifier", async () => {
    const storage = memoryBucket();
    const part = await call(storage, `/uploads/${SPLIT_KEY}?part=1`, {
      method: "PUT",
      body: "x",
    });
    expect(part.status).toBe(400);
    const complete = await call(storage, `/uploads/${SPLIT_KEY}/complete`, {
      method: "PUT",
      body: "{}",
    });
    expect(complete.status).toBe(400);
  });

  it("refuses a malformed part list without completing", async () => {
    const storage = memoryBucket();
    const uploadId = await startUpload(storage);
    const response = await call(storage, `/uploads/${SPLIT_KEY}/complete?uploadId=${uploadId}`, {
      method: "POST",
      body: JSON.stringify({ parts: [{ part: 1 }] }),
    });
    expect(response.status).toBe(400);
    expect(storage.operations).not.toContain("complete");
  });

  it("answers a storage refusal with 502 and no detail", async () => {
    const storage = memoryBucket();
    const response = await putPart(storage, "upload-that-was-never-started", 1, patterned(4));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "storage-error" });
  });

  it("refuses a bad key on every upload route", async () => {
    const storage = memoryBucket();
    expect((await call(storage, "/uploads/US/x.split", { method: "POST" })).status).toBe(400);
    expect(
      (await call(storage, "/uploads/us/../x/complete?uploadId=u", { method: "POST", body: "{}" }))
        .status,
    ).toBe(400);
    expect(storage.operations).toEqual([]);
  });
});

describe("the part list", () => {
  it("maps the engine's vocabulary to R2's, in part order", () => {
    expect(
      uploadedPartsOf(
        JSON.stringify({
          parts: [
            { part: 2, etag: "b" },
            { part: 1, etag: "a" },
          ],
        }),
      ),
    ).toEqual([
      { partNumber: 1, etag: "a" },
      { partNumber: 2, etag: "b" },
    ]);
  });

  it("refuses duplicates, gaps in shape, and non-lists", () => {
    for (const text of [
      "not json",
      "[]",
      JSON.stringify({ parts: [] }),
      JSON.stringify({
        parts: [
          { part: 1, etag: "a" },
          { part: 1, etag: "b" },
        ],
      }),
      JSON.stringify({ parts: [{ part: "1", etag: "a" }] }),
      JSON.stringify({ parts: [{ part: 1, etag: "" }] }),
      JSON.stringify({ parts: [{ part: 0, etag: "a" }] }),
      JSON.stringify({ parts: [null] }),
    ]) {
      expect(uploadedPartsOf(text), text).toBeNull();
    }
  });
});

describe("the query container's read-only access", () => {
  it("reads", async () => {
    const storage = memoryBucket();
    storage.put(SPLIT_KEY, patterned(100));
    const head = await call(storage, `/objects/${SPLIT_KEY}`, { method: "HEAD" }, "read");
    expect(head.status).toBe(200);
    const range = await call(
      storage,
      `/objects/${SPLIT_KEY}`,
      { headers: { range: "bytes=0-9" } },
      "read",
    );
    expect(range.status).toBe(206);
  });

  it("cannot write, delete or upload", async () => {
    const storage = memoryBucket();
    storage.put(POINTER_KEY, "{}");
    const attempts = [
      call(storage, `/objects/${POINTER_KEY}`, { method: "PUT", body: "{}" }, "read"),
      call(storage, `/objects/${POINTER_KEY}`, { method: "DELETE" }, "read"),
      call(storage, `/uploads/${SPLIT_KEY}`, { method: "POST" }, "read"),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(404);
    }
    expect(storage.operations).toEqual([]);
    expect(new TextDecoder().decode(storage.objects.get(POINTER_KEY)?.bytes)).toBe("{}");
  });
});

describe("anything else", () => {
  it("is a 404", async () => {
    const storage = memoryBucket();
    for (const path of ["/", "/objects", "/buckets/us/current.json", "/object/us/current.json"]) {
      const response = await call(storage, path);
      expect(response.status, path).toBe(404);
    }
  });
});

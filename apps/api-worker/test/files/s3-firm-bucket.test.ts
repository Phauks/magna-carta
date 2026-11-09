// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { createS3FirmBucket } from "../../src/files/s3-firm-bucket.ts";

// The S3-backed firm bucket cannot be exercised by the Miniflare pool: it binds one R2 namespace from
// wrangler.jsonc and serves no S3 endpoint, so under test every firm resolves to that binding. This
// module is therefore driven entirely through a stubbed fetch, and what is asserted is the two things
// a stub CAN prove: the request this adapter builds, and what it makes of the response it gets back.
//
// The property behind every case here is that a caller cannot tell this from the binding. Where the S3
// API genuinely cannot answer what the binding would have (list metadata), the adapter is asserted to
// do the extra work rather than return a plausible wrong answer.

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

function stub(responder: (request: Recorded) => Response | Promise<Response>) {
  const seen: Recorded[] = [];
  const fetchImpl = async (request: Request): Promise<Response> => {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => (headers[name.toLowerCase()] = value));
    const recorded: Recorded = {
      method: request.method,
      url: request.url,
      headers,
      body: request.body === null ? "" : await request.clone().text(),
    };
    seen.push(recorded);
    return responder(recorded);
  };
  return { seen, fetchImpl };
}

function bucketWith(
  responder: (request: Recorded) => Response | Promise<Response>,
  region: "us" | "eu" = "us",
) {
  const { seen, fetchImpl } = stub(responder);
  const bucket = createS3FirmBucket({
    bucketName: "magna-carta-production-firm-abc123",
    accountId: "account0001",
    credentials: () => Promise.resolve({ accessKeyId: "AKIATEST", secretAccessKey: "secret" }),
    region,
    fetchImpl,
  });
  return { bucket, seen };
}

const OBJECT_HEADERS = {
  etag: '"d41d8cd98f00b204e9800998ecf8427e"',
  "content-length": "11",
  "last-modified": "Mon, 01 Sep 2026 07:00:00 GMT",
  "content-type": "text/plain",
  "x-amz-meta-object_class": "email-original",
  "x-amz-storage-class": "Standard",
};

describe("the S3-backed firm bucket — addressing", () => {
  it("addresses the firm's own bucket at the account endpoint, with the key path-encoded", async () => {
    const { bucket, seen } = bucketWith(() => new Response(null, { headers: OBJECT_HEADERS }));
    await bucket.head("files/file_01/version 1");
    expect(seen[0]?.url).toBe(
      "https://account0001.r2.cloudflarestorage.com/magna-carta-production-firm-abc123/files/file_01/version%201",
    );
  });

  it("signs every request — an unsigned call would be refused by R2, so this is not cosmetic", async () => {
    const { bucket, seen } = bucketWith(() => new Response(null, { headers: OBJECT_HEADERS }));
    await bucket.head("files/a");
    expect(seen[0]?.headers["authorization"]).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST\//);
    expect(seen[0]?.headers["x-amz-content-sha256"]).toBeDefined();
  });

  // A jurisdiction-bound bucket exists at NO other host, so getting this wrong is not a slow path —
  // it is a 404 for every object the firm owns.
  it("addresses an EU firm's bucket at the EU jurisdiction endpoint", async () => {
    const { bucket, seen } = bucketWith(
      () => new Response(null, { headers: OBJECT_HEADERS }),
      "eu",
    );
    await bucket.head("files/a");
    expect(seen[0]?.url).toContain("https://account0001.eu.r2.cloudflarestorage.com/");
  });
});

describe("the S3-backed firm bucket — reads", () => {
  it("reports an absent object as null rather than throwing, like the binding", async () => {
    const { bucket } = bucketWith(() => new Response(null, { status: 404 }));
    expect(await bucket.head("files/gone")).toBeNull();
    expect(await bucket.get("files/gone")).toBeNull();
  });

  it("surfaces a real fault as a throw, so a retryable failure is never read as a missing object", async () => {
    const { bucket } = bucketWith(() => new Response("boom", { status: 500 }));
    await expect(bucket.get("files/a")).rejects.toThrow(/failed for .*files\/a: 500/);
  });

  it("maps the response headers onto the R2Object fields callers actually read", async () => {
    const { bucket } = bucketWith(() => new Response("hello world", { headers: OBJECT_HEADERS }));
    const object = await bucket.get("files/a");
    expect(object?.key).toBe("files/a");
    expect(object?.size).toBe(11);
    expect(object?.etag).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(object?.httpEtag).toBe('"d41d8cd98f00b204e9800998ecf8427e"');
    expect(object?.customMetadata).toEqual({ object_class: "email-original" });
    expect(object?.httpMetadata?.contentType).toBe("text/plain");
    expect(object?.uploaded.toISOString()).toBe("2026-09-01T07:00:00.000Z");
    expect(await object?.text()).toBe("hello world");
  });

  it("translates an offset+length range into a Range header", async () => {
    const { bucket, seen } = bucketWith(
      () =>
        new Response("bcd", {
          status: 206,
          headers: { ...OBJECT_HEADERS, "content-range": "bytes 1-3/11", "content-length": "3" },
        }),
    );
    await bucket.get("files/a", { range: { offset: 1, length: 3 } });
    expect(seen[0]?.headers["range"]).toBe("bytes=1-3");
  });

  it("translates an open-ended and a suffix range", async () => {
    const { bucket, seen } = bucketWith(
      () => new Response("x", { status: 206, headers: OBJECT_HEADERS }),
    );
    await bucket.get("files/a", { range: { offset: 5 } });
    await bucket.get("files/a", { range: { suffix: 20 } });
    expect(seen[0]?.headers["range"]).toBe("bytes=5-");
    expect(seen[1]?.headers["range"]).toBe("bytes=-20");
  });

  // content-length on a 206 is the size of the SLICE. A preview that read it as the object size would
  // report a 3-byte video, so the total is taken from content-range.
  it("reports the object's full size on a ranged read, not the length of the slice", async () => {
    const { bucket } = bucketWith(
      () =>
        new Response("bcd", {
          status: 206,
          headers: { ...OBJECT_HEADERS, "content-range": "bytes 1-3/4096", "content-length": "3" },
        }),
    );
    const object = await bucket.get("files/a", { range: { offset: 1, length: 3 } });
    expect(object?.size).toBe(4096);
  });

  it("treats an unsatisfiable range as a miss, the way the binding does", async () => {
    const { bucket } = bucketWith(() => new Response(null, { status: 416 }));
    expect(await bucket.get("files/a", { range: { offset: 99_999 } })).toBeNull();
  });
});

describe("the S3-backed firm bucket — writes", () => {
  it("sends the dimension stamp as x-amz-meta headers, so an object is never written unscoped", async () => {
    const { bucket, seen } = bucketWith(() => new Response(null, { headers: OBJECT_HEADERS }));
    await bucket.put("files/a", "bytes", {
      customMetadata: { object_class: "email-original", matter_id: "matter_01" },
      httpMetadata: { contentType: "message/rfc822" },
    });
    expect(seen[0]?.method).toBe("PUT");
    expect(seen[0]?.headers["x-amz-meta-object_class"]).toBe("email-original");
    expect(seen[0]?.headers["x-amz-meta-matter_id"]).toBe("matter_01");
    expect(seen[0]?.headers["content-type"]).toBe("message/rfc822");
  });

  it("carries the storage class, which is the whole point of the tiering sweep's write", async () => {
    const { bucket, seen } = bucketWith(() => new Response(null, { headers: OBJECT_HEADERS }));
    await bucket.put("files/a", "bytes", { storageClass: "InfrequentAccess" });
    expect(seen[0]?.headers["x-amz-storage-class"]).toBe("InfrequentAccess");
  });

  it("throws on a rejected write rather than resolving to an object that was never stored", async () => {
    const { bucket } = bucketWith(() => new Response("denied", { status: 403 }));
    await expect(bucket.put("files/a", "bytes")).rejects.toThrow(/put failed/);
  });

  // A stream has no length to sign and no hash to compute, so it cannot be a single PUT. Uniform parts
  // are what make it signable at all — the same shape the bundle build already uses.
  it("uploads a streamed body as a multipart upload rather than an unsignable single PUT", async () => {
    const { bucket, seen } = bucketWith((request) => {
      if (request.url.includes("?uploads")) {
        return new Response(
          "<InitiateMultipartUploadResult><UploadId>up-1</UploadId>" +
            "</InitiateMultipartUploadResult>",
        );
      }
      if (request.url.includes("partNumber")) {
        return new Response(null, { headers: { etag: '"part"' } });
      }
      if (request.url.includes("uploadId")) return new Response("<CompleteMultipartUploadResult/>");
      return new Response(null, { headers: OBJECT_HEADERS });
    });
    const stream = new Response("streamed bytes").body!;
    await bucket.put("bundles/a.zip", stream);
    expect(seen.map((request) => request.method)).toEqual(["POST", "PUT", "POST", "HEAD"]);
    expect(seen[0]?.url).toContain("?uploads");
    expect(seen[1]?.url).toContain("partNumber=1");
  });

  it("aborts a streamed upload whose part fails, so no dangling multipart is left behind", async () => {
    const { bucket, seen } = bucketWith((request) => {
      if (request.url.includes("?uploads")) {
        return new Response("<UploadId>up-1</UploadId>");
      }
      if (request.url.includes("partNumber")) return new Response("nope", { status: 500 });
      return new Response(null, { status: 204 });
    });
    await expect(bucket.put("bundles/a.zip", new Response("bytes").body!)).rejects.toThrow(
      /upload part 1/,
    );
    expect(seen.at(-1)?.method).toBe("DELETE");
    expect(seen.at(-1)?.url).toContain("uploadId=up-1");
  });
});

describe("the S3-backed firm bucket — deletes", () => {
  it("treats an absent key as deleted, because delete is idempotent", async () => {
    const { bucket } = bucketWith(() => new Response(null, { status: 404 }));
    await expect(bucket.delete("files/gone")).resolves.toBeUndefined();
  });

  it("deletes a batch in one call and names the keys", async () => {
    const { bucket, seen } = bucketWith(() => new Response("<DeleteResult/>"));
    await bucket.delete(["files/a", "files/b"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toContain("?delete");
    expect(seen[0]?.body).toContain("<Key>files/a</Key>");
    expect(seen[0]?.body).toContain("<Key>files/b</Key>");
  });

  it("splits a batch over the 1000-key request cap the binding does not have", async () => {
    const { bucket, seen } = bucketWith(() => new Response("<DeleteResult/>"));
    await bucket.delete(Array.from({ length: 1001 }, (_, index) => `files/${index}`));
    expect(seen).toHaveLength(2);
  });

  // Quiet mode reports only what FAILED, so a body carrying <Error> means objects survived. Reporting
  // that as success is how a retention sweep comes to believe it reclaimed bytes that are still there.
  it("throws when the batch response reports a key it could not delete", async () => {
    const { bucket } = bucketWith(
      () =>
        new Response(
          "<DeleteResult><Error><Key>files/a</Key><Message>AccessDenied</Message></Error></DeleteResult>",
        ),
    );
    await expect(bucket.delete(["files/a"])).rejects.toThrow(/AccessDenied/);
  });

  it("does nothing at all for an empty batch", async () => {
    const { bucket, seen } = bucketWith(() => new Response("<DeleteResult/>"));
    await bucket.delete([]);
    expect(seen).toHaveLength(0);
  });
});

const LIST_BODY =
  "<ListBucketResult>" +
  "<IsTruncated>true</IsTruncated>" +
  "<NextContinuationToken>page-2</NextContinuationToken>" +
  "<Contents><Key>files/a</Key><Size>10</Size><ETag>&quot;e1&quot;</ETag>" +
  "<LastModified>2026-09-01T07:00:00.000Z</LastModified><StorageClass>Standard</StorageClass></Contents>" +
  "<Contents><Key>files/b</Key><Size>20</Size><ETag>&quot;e2&quot;</ETag>" +
  "<LastModified>2026-09-01T07:00:00.000Z</LastModified><StorageClass>InfrequentAccess</StorageClass></Contents>" +
  "</ListBucketResult>";

describe("the S3-backed firm bucket — listing", () => {
  it("pages with prefix, limit and cursor the way the sweeps drive it", async () => {
    const { bucket, seen } = bucketWith(() => new Response(LIST_BODY));
    const page = await bucket.list({ prefix: "files/", limit: 100, cursor: "page-1" });
    const url = new URL(seen[0]!.url);
    expect(url.searchParams.get("list-type")).toBe("2");
    expect(url.searchParams.get("prefix")).toBe("files/");
    expect(url.searchParams.get("max-keys")).toBe("100");
    expect(url.searchParams.get("continuation-token")).toBe("page-1");
    expect(page.objects.map((object) => object.key)).toEqual(["files/a", "files/b"]);
    expect(page.objects[0]?.size).toBe(10);
    expect(page.objects[1]?.storageClass).toBe("InfrequentAccess");
    expect(page.truncated).toBe(true);
    expect(page.truncated ? page.cursor : undefined).toBe("page-2");
  });

  it("reports a final page as not truncated, so a paging loop terminates", async () => {
    const { bucket } = bucketWith(
      () => new Response("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>"),
    );
    const page = await bucket.list({ prefix: "files/" });
    expect(page.truncated).toBe(false);
    expect(page.objects).toEqual([]);
  });

  // THE CASE THIS MODULE'S `include` HANDLING EXISTS FOR. ListObjectsV2 returns no user metadata at
  // all. Returning undefined customMetadata would tell the dimension backfill sweep that every object
  // in the firm's bucket is unstamped, and set it rewriting the whole bucket. So the adapter HEADs
  // each object instead — the expensive answer rather than the wrong one.
  it("fills customMetadata by HEADing each object, because a listing does not carry it", async () => {
    const { bucket, seen } = bucketWith((request) =>
      request.method === "HEAD"
        ? new Response(null, { headers: OBJECT_HEADERS })
        : new Response(LIST_BODY),
    );
    const page = await bucket.list({ prefix: "files/", include: ["customMetadata"] });
    expect(seen.filter((request) => request.method === "HEAD")).toHaveLength(2);
    expect(page.objects[0]?.customMetadata).toEqual({ object_class: "email-original" });
  });

  it("does not HEAD anything when the caller did not ask for metadata", async () => {
    const { bucket, seen } = bucketWith(() => new Response(LIST_BODY));
    await bucket.list({ prefix: "files/" });
    expect(seen.filter((request) => request.method === "HEAD")).toHaveLength(0);
  });
});

describe("the S3-backed firm bucket — multipart", () => {
  it("returns a handle whose parts and completion address the same upload", async () => {
    const { bucket, seen } = bucketWith((request) => {
      if (request.url.includes("?uploads")) return new Response("<UploadId>up-9</UploadId>");
      if (request.url.includes("partNumber")) {
        return new Response(null, { headers: { etag: '"p1"' } });
      }
      if (request.method === "POST") return new Response("<CompleteMultipartUploadResult/>");
      return new Response(null, { headers: OBJECT_HEADERS });
    });
    const upload = await bucket.createMultipartUpload("bundles/a.zip", {
      customMetadata: { object_class: "download-bundle" },
    });
    expect(upload.uploadId).toBe("up-9");
    expect(seen[0]?.headers["x-amz-meta-object_class"]).toBe("download-bundle");
    const part = await upload.uploadPart(1, new Uint8Array([1, 2, 3]));
    expect(part).toEqual({ partNumber: 1, etag: '"p1"' });
    await upload.complete([part]);
    const completion = seen.find((request) => request.body.includes("CompleteMultipartUpload"));
    expect(completion?.body).toContain("<PartNumber>1</PartNumber>");
    expect(completion?.url).toContain("uploadId=up-9");
  });

  // S3 writes the status line before the parts are assembled, so a completion can fail INSIDE a 200.
  // Trusting the status here would mark a bundle ready that was never written.
  it("treats an error reported inside a 200 completion as a failure", async () => {
    const { bucket } = bucketWith((request) => {
      if (request.url.includes("?uploads")) return new Response("<UploadId>up-9</UploadId>");
      return new Response("<Error><Code>InternalError</Code></Error>");
    });
    const upload = await bucket.createMultipartUpload("bundles/a.zip");
    await expect(upload.complete([{ partNumber: 1, etag: '"p1"' }])).rejects.toThrow(
      /reported an error in its body/,
    );
  });

  it("treats aborting an already-gone upload as success", async () => {
    const { bucket } = bucketWith((request) =>
      request.url.includes("?uploads")
        ? new Response("<UploadId>up-9</UploadId>")
        : new Response(null, { status: 404 }),
    );
    const upload = await bucket.createMultipartUpload("bundles/a.zip");
    await expect(upload.abort()).resolves.toBeUndefined();
  });
});

describe("the S3-backed firm bucket — what it refuses", () => {
  // The rule for this module is that a difference from the binding must be loud. These are the members
  // no caller uses; a silent no-op would be a difference nothing would notice.
  it("throws rather than silently ignoring an option it cannot honour", async () => {
    const { bucket } = bucketWith(() => new Response(null, { headers: OBJECT_HEADERS }));
    await expect(bucket.list({ delimiter: "/" })).rejects.toThrow(/not implemented/);
    await expect(bucket.get("files/a", { onlyIf: { etagMatches: "x" } })).rejects.toThrow(
      /not implemented/,
    );
  });
});

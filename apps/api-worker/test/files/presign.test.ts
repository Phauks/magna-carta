// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import type { MatterId } from "@magna-carta/identifiers/types";
import { matterScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import { describe, expect, it } from "vitest";
import { createR2Presigner } from "../../src/files/presign.ts";

// The presigner targets R2's S3-compatible endpoint. These tests assert the SigV4 URL/request SHAPE
// over a stubbed fetch — never a real network call: a presigned URL is a deterministic signing
// artifact, and the multipart create/complete/abort calls are exercised against a fake fetch
// that records the signed request and returns canned R2 XML.

const ACCOUNT_ID = "acc1234567890";
const CREDENTIALS = {
  accountId: ACCOUNT_ID,
  accessKeyId: "AKIAEXAMPLEKEYID",
  secretAccessKey: "wJalrXUtnFEMI-EXAMPLE-SECRETKEY",
};
const BUCKET = "magna-carta-production-firm-files";
const KEY = "files/fil_abc/fvr_def";
const ENDPOINT_HOST = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const MATTER = "matter_01hzz0000000000000000000" as MatterId;
const DIMENSIONS = matterScopedObjectDimensions({
  objectClass: "working-document",
  matterId: MATTER,
});

describe("createR2Presigner.presignPut", () => {
  it("produces a query-signed SigV4 PUT URL against the R2 S3 endpoint", async () => {
    const presigner = createR2Presigner(CREDENTIALS);
    const presigned = await presigner.presignPut(BUCKET, KEY, "application/pdf", 900, DIMENSIONS);
    const url = new URL(presigned.url);

    expect(url.host).toBe(ENDPOINT_HOST);
    expect(url.pathname).toBe(`/${BUCKET}/${KEY}`);
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toContain(CREDENTIALS.accessKeyId);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    // Content-Type is bound into the signature so the uploaded object carries the declared type and
    // a client cannot substitute another (the gate also re-sniffs).
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    // The object's scope is signed alongside it, and returned for the client to send: an upload that
    // omits either header fails the signature check rather than landing an object nothing can place.
    const signedHeaders = url.searchParams.get("X-Amz-SignedHeaders") ?? "";
    expect(signedHeaders).toContain("x-amz-meta-matter");
    expect(signedHeaders).toContain("x-amz-meta-object_class");
    expect(presigned.headers).toMatchObject({
      "x-amz-meta-matter": MATTER,
      "x-amz-meta-object_class": "working-document",
    });
  });
});

describe("createR2Presigner.presignGet", () => {
  it("produces a query-signed SigV4 GET URL against the R2 S3 endpoint", async () => {
    const presigner = createR2Presigner(CREDENTIALS);
    const urlString = await presigner.presignGet(BUCKET, KEY, 300);
    const url = new URL(urlString);

    expect(url.host).toBe(ENDPOINT_HOST);
    expect(url.pathname).toBe(`/${BUCKET}/${KEY}`);
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toContain(CREDENTIALS.accessKeyId);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    // A GET sends no body, so content-type is not part of the signed header set.
    expect(url.searchParams.get("X-Amz-SignedHeaders")).not.toContain("content-type");
  });
});

describe("createR2Presigner.presignUploadPart", () => {
  it("produces a query-signed SigV4 URL carrying the uploadId and partNumber", async () => {
    const presigner = createR2Presigner(CREDENTIALS);
    const urlString = await presigner.presignUploadPart(BUCKET, KEY, "r2-upload-id-xyz", 3, 900);
    const url = new URL(urlString);

    expect(url.host).toBe(ENDPOINT_HOST);
    expect(url.pathname).toBe(`/${BUCKET}/${KEY}`);
    expect(url.searchParams.get("uploadId")).toBe("r2-upload-id-xyz");
    expect(url.searchParams.get("partNumber")).toBe("3");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
  });
});

describe("createR2Presigner.createMultipartUpload", () => {
  it("POSTs to ?uploads, signs the request, and parses the UploadId from the R2 XML response", async () => {
    let seen: Request | undefined;
    const presigner = createR2Presigner({
      ...CREDENTIALS,
      fetchImpl: (request) => {
        seen = request;
        return Promise.resolve(
          new Response(
            `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult><Bucket>${BUCKET}</Bucket><Key>${KEY}</Key><UploadId>multipart-upload-id-123</UploadId></InitiateMultipartUploadResult>`,
            { status: 200 },
          ),
        );
      },
    });

    const result = await presigner.createMultipartUpload(
      BUCKET,
      KEY,
      "application/pdf",
      DIMENSIONS,
    );

    expect(result).toEqual({ uploadId: "multipart-upload-id-123" });
    expect(seen?.method).toBe("POST");
    const seenUrl = new URL(seen?.url ?? "");
    expect(seenUrl.host).toBe(ENDPOINT_HOST);
    expect(seenUrl.pathname).toBe(`/${BUCKET}/${KEY}`);
    expect(seenUrl.searchParams.has("uploads")).toBe(true);
    // A server-side signed request authenticates with the Authorization header, not query params.
    expect(seen?.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
    // Metadata is fixed at create for a multipart object — the parts carry none and the completion
    // carries none — so the stamp has to ride this call.
    expect(seen?.headers.get("x-amz-meta-matter")).toBe(MATTER);
    expect(seen?.headers.get("x-amz-meta-object_class")).toBe("working-document");
  });

  it("throws when R2 answers the create with a non-2xx status", async () => {
    const presigner = createR2Presigner({
      ...CREDENTIALS,
      fetchImpl: () => Promise.resolve(new Response("AccessDenied", { status: 403 })),
    });
    await expect(
      presigner.createMultipartUpload(BUCKET, KEY, "application/pdf", DIMENSIONS),
    ).rejects.toThrow();
  });
});

describe("createR2Presigner.completeMultipartUpload", () => {
  it("POSTs the part manifest XML to ?uploadId and signs it", async () => {
    let seen: Request | undefined;
    let body: string | undefined;
    const presigner = createR2Presigner({
      ...CREDENTIALS,
      fetchImpl: async (request) => {
        seen = request;
        body = await request.text();
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult><Location>https://${ENDPOINT_HOST}/${BUCKET}/${KEY}</Location></CompleteMultipartUploadResult>`,
          { status: 200 },
        );
      },
    });

    await presigner.completeMultipartUpload(BUCKET, KEY, "r2-upload-id-xyz", [
      { partNumber: 1, etag: "etag-one" },
      { partNumber: 2, etag: "etag-two" },
    ]);

    expect(seen?.method).toBe("POST");
    expect(new URL(seen?.url ?? "").searchParams.get("uploadId")).toBe("r2-upload-id-xyz");
    expect(body).toContain("<PartNumber>1</PartNumber>");
    expect(body).toContain("etag-one");
    expect(body).toContain("<PartNumber>2</PartNumber>");
    expect(body).toContain("etag-two");
    expect(seen?.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
  });

  it("throws when R2 answers the complete with a non-2xx status", async () => {
    const presigner = createR2Presigner({
      ...CREDENTIALS,
      fetchImpl: () => Promise.resolve(new Response("NoSuchUpload", { status: 404 })),
    });
    await expect(
      presigner.completeMultipartUpload(BUCKET, KEY, "r2-upload-id-xyz", [
        { partNumber: 1, etag: "etag-one" },
      ]),
    ).rejects.toThrow();
  });
});

describe("createR2Presigner.abortMultipartUpload", () => {
  it("DELETEs ?uploadId and signs the request", async () => {
    let seen: Request | undefined;
    const presigner = createR2Presigner({
      ...CREDENTIALS,
      fetchImpl: (request) => {
        seen = request;
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });

    await presigner.abortMultipartUpload(BUCKET, KEY, "r2-upload-id-xyz");

    expect(seen?.method).toBe("DELETE");
    expect(new URL(seen?.url ?? "").searchParams.get("uploadId")).toBe("r2-upload-id-xyz");
    expect(seen?.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
  });
});

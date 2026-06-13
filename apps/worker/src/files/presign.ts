import { AwsClient } from "aws4fetch";

// The R2 presigner: every byte of an upload or download flows DIRECTLY between the client and R2's
// S3-compatible endpoint, never through the Worker (the Worker only mints the credential). Each URL
// is single-key, single-method, short-TTL (ADR-0081 custody): one account-scoped R2 API token signs
// PUT/GET URLs the client uses directly and the server-side multipart create/complete/abort calls.
//
// presignPut/presignUploadPart return a query-signed URL string (the client uploads to it).
// createMultipartUpload/completeMultipartUpload/abortMultipartUpload are server-side S3 calls the
// Worker makes itself (header-signed), so they take an injectable fetch for testing.
export interface R2Presigner {
  presignPut(
    bucket: string,
    key: string,
    contentType: string,
    expiresSeconds: number,
  ): Promise<string>;
  presignUploadPart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    expiresSeconds: number,
  ): Promise<string>;
  createMultipartUpload(
    bucket: string,
    key: string,
    contentType: string,
  ): Promise<{ uploadId: string }>;
  completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: readonly { partNumber: number; etag: string }[],
  ): Promise<void>;
  abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void>;
}

export interface R2PresignerOptions {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  // Injectable for tests; defaults to the runtime fetch. Used only by the server-side multipart calls.
  readonly fetchImpl?: (request: Request) => Promise<Response>;
}

// R2 keys are opaque and already URL-safe (the data-access layer mints them from identifier handles),
// but each path segment is still percent-encoded defensively so a key can never break out of its path.
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function createR2Presigner(options: R2PresignerOptions): R2Presigner {
  const endpoint = `https://${options.accountId}.r2.cloudflarestorage.com`;
  // region "auto" is R2's S3 region; service "s3" selects the S3 signing canonicalization.
  const client = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const doFetch = options.fetchImpl ?? ((request: Request) => fetch(request));
  const objectUrl = (bucket: string, key: string) => `${endpoint}/${bucket}/${encodeKey(key)}`;

  return {
    async presignPut(bucket, key, contentType, expiresSeconds) {
      const url = `${objectUrl(bucket, key)}?X-Amz-Expires=${expiresSeconds}`;
      // The Content-Type header is signed (X-Amz-SignedHeaders), binding the upload to the declared
      // type — the client must send a matching Content-Type, and the ingest gate re-sniffs the bytes.
      // allHeaders is required because aws4fetch treats content-type as unsignable by default (a
      // browser-mutable header); the only header signed here is the one we set, so the signed set is
      // exactly content-type;host.
      const signed = await client.sign(url, {
        method: "PUT",
        headers: { "content-type": contentType },
        aws: { signQuery: true, allHeaders: true },
      });
      return signed.url;
    },

    async presignUploadPart(bucket, key, uploadId, partNumber, expiresSeconds) {
      const url =
        `${objectUrl(bucket, key)}?partNumber=${partNumber}` +
        `&uploadId=${encodeURIComponent(uploadId)}&X-Amz-Expires=${expiresSeconds}`;
      const signed = await client.sign(url, { method: "PUT", aws: { signQuery: true } });
      return signed.url;
    },

    async createMultipartUpload(bucket, key, contentType) {
      const signed = await client.sign(`${objectUrl(bucket, key)}?uploads`, {
        method: "POST",
        headers: { "content-type": contentType },
      });
      const response = await doFetch(signed);
      if (!response.ok) {
        throw new Error(`R2 create multipart upload failed: ${response.status}`);
      }
      const xml = await response.text();
      const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1];
      if (uploadId === undefined) {
        throw new Error("R2 create multipart upload response carried no UploadId");
      }
      return { uploadId };
    },

    async completeMultipartUpload(bucket, key, uploadId, parts) {
      // S3 requires the parts in ascending part-number order.
      const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      const body =
        "<CompleteMultipartUpload>" +
        ordered
          .map(
            (part) =>
              `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag}</ETag></Part>`,
          )
          .join("") +
        "</CompleteMultipartUpload>";
      const signed = await client.sign(
        `${objectUrl(bucket, key)}?uploadId=${encodeURIComponent(uploadId)}`,
        { method: "POST", body, headers: { "content-type": "application/xml" } },
      );
      const response = await doFetch(signed);
      if (!response.ok) {
        throw new Error(`R2 complete multipart upload failed: ${response.status}`);
      }
    },

    async abortMultipartUpload(bucket, key, uploadId) {
      const signed = await client.sign(
        `${objectUrl(bucket, key)}?uploadId=${encodeURIComponent(uploadId)}`,
        { method: "DELETE" },
      );
      const response = await doFetch(signed);
      // 404 = the upload is already gone (a replayed abort, or R2 lifecycle reaped it): abort is
      // idempotent, so an already-absent upload is success, not an error.
      if (!response.ok && response.status !== 404) {
        throw new Error(`R2 abort multipart upload failed: ${response.status}`);
      }
    },
  };
}

// The local/test presigner: the way the dev FirmResourceProvider stands in for the REST one. It
// mints deterministic non-network URLs (the bytes never leave the test) and treats the multipart
// server-side calls as no-ops — selected when the real credential set is incomplete (presignerForEnv
// in presigner-wiring.ts; CLOUDFLARE_ACCOUNT_ID is absent off-production).
export function createDevR2Presigner(): R2Presigner {
  return {
    presignPut(bucket, key) {
      return Promise.resolve(`https://r2.dev.local/${bucket}/${key}?dev-presigned=put`);
    },
    presignUploadPart(bucket, key, uploadId, partNumber) {
      return Promise.resolve(
        `https://r2.dev.local/${bucket}/${key}?uploadId=${encodeURIComponent(uploadId)}` +
          `&partNumber=${partNumber}&dev-presigned=part`,
      );
    },
    createMultipartUpload(_bucket, key) {
      return Promise.resolve({ uploadId: `dev-multipart-${key}` });
    },
    completeMultipartUpload() {
      return Promise.resolve();
    },
    abortMultipartUpload() {
      return Promise.resolve();
    },
  };
}

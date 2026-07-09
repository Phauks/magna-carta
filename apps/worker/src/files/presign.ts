import { AwsClient } from "aws4fetch";
import { BULK_PREFIX } from "@magna-carta/file-manager/file-statements";
import type { R2EventMessage } from "./ingest-consumer.ts";

// The R2 presigner: every byte of an upload or download flows DIRECTLY between the client and R2's
// S3-compatible endpoint, never through the Worker (the Worker only mints the credential). Each URL
// is single-key, single-method, short-TTL: one account-scoped R2 API token signs PUT/GET URLs the
// client uses directly and the server-side multipart create/complete/abort calls — the narrowest
// credential that still lets the bytes bypass the Worker.
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
  // A query-signed GET URL the client downloads the object directly from — the download-path twin of
  // presignPut. No content-type is signed (a GET sends no body), so the signed header set is just host.
  presignGet(bucket: string, key: string, expiresSeconds: number): Promise<string>;
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

    async presignGet(bucket, key, expiresSeconds) {
      const url = `${objectUrl(bucket, key)}?X-Amz-Expires=${expiresSeconds}`;
      const signed = await client.sign(url, { method: "GET", aws: { signQuery: true } });
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

// A minimal view of the runtime env the development upload emulation needs: the R2 bucket the ingest
// consumer reads (env.R2 — the exact handle, so a dev-written object IS the object ingest loads) and
// the two files-ingest queues. Structural so this module stays free of the app's full Bindings type.
export interface DevUploadEnv {
  readonly R2: R2Bucket;
  readonly FILES_INGEST?: Queue;
  readonly FILES_INGEST_BULK?: Queue;
}

// The R2 key prefix multipart parts are staged under before completion assembles them into the final
// object. It is never a firm object key (never enqueued for ingest); complete and abort delete it.
const DEV_MULTIPART_STAGING_PREFIX = "__dev-multipart";

// Stands in for the R2 object-create event notification that local object storage does not emit:
// enqueues one files-ingest message so the ingest consumer runs against the just-written object,
// exactly as a real R2 event would. A bulk/ key routes to the bulk lane, mirroring the production
// queue topology. Shared by the single-shot PUT route and the multipart completion below.
export async function enqueueDevIngestEvent(
  env: DevUploadEnv,
  bucket: string,
  key: string,
  size: number,
): Promise<void> {
  const message: R2EventMessage = { bucket, object: { key, size }, action: "PutObject" };
  const queue = key.startsWith(`${BULK_PREFIX}/`)
    ? (env.FILES_INGEST_BULK ?? env.FILES_INGEST)
    : (env.FILES_INGEST ?? env.FILES_INGEST_BULK);
  if (queue === undefined) {
    throw new Error("dev upload: no files-ingest queue is bound to drive ingest");
  }
  await queue.send(message);
}

// The development/local presigner — the upload twin of the dev pool-claiming FirmResourceProvider,
// selected by presignerForEnv (presigner-wiring.ts) whenever the real R2 S3 credential set is absent
// (off production). The UPLOAD URLs point back at the Worker itself (a same-origin path the
// development upload route serves): `wrangler dev` resolves no presigned R2 host and R2 emits no
// object-create event locally, so the identical four-step client ceremony would otherwise land no
// bytes and never trigger ingest. Here the server-side multipart calls do the create/assemble/abort
// work against env.R2 that R2 would do remotely, then enqueue the ingest event the R2 notification
// would have fired. All object writes go through env.R2 — the exact handle the ingest consumer reads —
// so a dev-written object is unambiguously the one ingest loads.
//
// SAME-ORIGIN, so the upload path here exercises NO CORS: it cannot prove the production cross-origin
// browser upload (a bucket missing AllowedOrigins, or multipart unable to read the ETag response
// header). That gate is one real upload against a real bucket in a preview environment — see the R2
// bucket CORS runbook in docs/conventions/operations.md.
export function createDevR2Presigner(env: DevUploadEnv): R2Presigner {
  const stagingKey = (uploadId: string, partNumber: number): string =>
    `${DEV_MULTIPART_STAGING_PREFIX}/${uploadId}/${partNumber}`;
  return {
    presignPut(_bucket, key) {
      return Promise.resolve(`/api/__dev/r2/object?key=${encodeURIComponent(key)}`);
    },
    // Download/preview is out of scope for the development upload path (its player needs a bound
    // FILES_ORIGIN), so the GET presigner keeps the deterministic non-network stub the local download
    // and preview tests pin — it never resolves, and no dev route serves it. Only the UPLOAD leg is
    // rerouted to the Worker; a dev download degrades rather than reaching R2.
    presignGet(bucket, key) {
      return Promise.resolve(`https://r2.dev.local/${bucket}/${key}?dev-presigned=get`);
    },
    presignUploadPart(_bucket, key, uploadId, partNumber) {
      return Promise.resolve(
        `/api/__dev/r2/part?key=${encodeURIComponent(key)}` +
          `&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`,
      );
    },
    createMultipartUpload(_bucket, _key) {
      // No R2 state is created here — parts are staged lazily as they arrive and complete assembles
      // them, so a lost idempotency race can leave no orphaned upload. The synthetic id namespaces
      // this session's staged parts; it stands in for R2's UploadId.
      return Promise.resolve({ uploadId: `dev-multipart-${crypto.randomUUID()}` });
    },
    async completeMultipartUpload(bucket, key, uploadId, parts) {
      // Assemble the staged parts in ascending part-number order into the final object — written where
      // the ingest consumer reads it (env.R2 at key) — then drop the staging objects and enqueue the
      // ingest event (the R2 notification stand-in).
      const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (const part of ordered) {
        const staged = await env.R2.get(stagingKey(uploadId, part.partNumber));
        if (staged === null) {
          throw new Error(
            `dev upload: staged part missing (uploadId ${uploadId}, part ${part.partNumber})`,
          );
        }
        const bytes = new Uint8Array(await staged.arrayBuffer());
        chunks.push(bytes);
        total += bytes.byteLength;
      }
      const combined = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      await env.R2.put(key, combined);
      for (const part of ordered) {
        await env.R2.delete(stagingKey(uploadId, part.partNumber));
      }
      await enqueueDevIngestEvent(env, bucket, key, total);
    },
    async abortMultipartUpload(_bucket, _key, uploadId) {
      // Drop every staged part for the session (complete never ran). LIST is used because abort does
      // not carry the part manifest.
      const listed = await env.R2.list({ prefix: `${DEV_MULTIPART_STAGING_PREFIX}/${uploadId}/` });
      for (const object of listed.objects) {
        await env.R2.delete(object.key);
      }
    },
  };
}

import { AwsClient } from "aws4fetch";
import type { DataRegion } from "@magna-carta/database/data-region";
import { BULK_PREFIX } from "@magna-carta/file-manager/file-statements";
import {
  objectDimensionHeaders,
  type ObjectDimensions,
} from "@magna-carta/object-dimensions/dimensions";
import type { R2EventMessage } from "../background/files/ingest-consumer.ts";
import { r2S3Endpoint } from "./r2-s3-endpoint.ts";

// The R2 presigner: every byte of an upload or download flows DIRECTLY between the client and R2's
// S3-compatible endpoint, never through the Worker (the Worker only mints the credential). Each URL
// is single-key, single-method, short-TTL: one account-scoped R2 API token signs PUT/GET URLs the
// client uses directly and the server-side multipart create/complete/abort calls — the narrowest
// credential that still lets the bytes bypass the Worker.
//
// presignPut returns a query-signed URL plus the headers the client must send with it;
// presignUploadPart returns a query-signed URL string (the client uploads to it).
// createMultipartUpload/completeMultipartUpload/abortMultipartUpload are server-side S3 calls the
// Worker makes itself (header-signed), so they take an injectable fetch for testing.

// What a presigned PUT returns: the URL, and the headers the client MUST send with it. The metadata
// headers are part of the signature, so a client that drops one gets a rejected upload rather than an
// object nothing can scope — the stamp cannot be silently lost on the one write path the Worker does
// not perform itself.
export interface PresignedPut {
  readonly url: string;
  readonly headers: Record<string, string>;
}

export interface R2Presigner {
  presignPut(
    bucket: string,
    key: string,
    contentType: string,
    expiresSeconds: number,
    dimensions: ObjectDimensions,
  ): Promise<PresignedPut>;
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
    dimensions: ObjectDimensions,
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
  // The data region of the firm whose bucket these URLs address, which selects the S3 endpoint host
  // (r2-s3-endpoint.ts) — a jurisdiction-bound bucket exists at no other host. Defaults to the column
  // default; every firm is "us" today, and the per-firm-R2 ADR carries threading a firm's real region
  // to this presigner as a named remaining gap.
  readonly region?: DataRegion;
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
  const endpoint = r2S3Endpoint(options.accountId, options.region ?? "us");
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
    async presignPut(bucket, key, contentType, expiresSeconds, dimensions) {
      const url = `${objectUrl(bucket, key)}?X-Amz-Expires=${expiresSeconds}`;
      // The Content-Type header is signed (X-Amz-SignedHeaders), binding the upload to the declared
      // type — the client must send a matching Content-Type, and the ingest gate re-sniffs the bytes.
      // allHeaders is required because aws4fetch treats content-type as unsignable by default (a
      // browser-mutable header); the only headers signed here are the ones we set, so the signed set is
      // exactly content-type;host plus one entry per stamped dimension.
      //
      // Signing the metadata headers is what makes the stamp non-optional on the one write path whose
      // bytes never touch the Worker: an upload missing one of them fails the signature check at R2.
      const headers = { "content-type": contentType, ...objectDimensionHeaders(dimensions) };
      const signed = await client.sign(url, {
        method: "PUT",
        headers,
        aws: { signQuery: true, allHeaders: true },
      });
      return { url: signed.url, headers };
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

    async createMultipartUpload(bucket, key, contentType, dimensions) {
      // Object metadata is fixed at create for a multipart upload — the parts carry none and the
      // completion carries none — so the stamp rides this call or it never lands at all.
      const signed = await client.sign(`${objectUrl(bucket, key)}?uploads`, {
        method: "POST",
        headers: { "content-type": contentType, ...objectDimensionHeaders(dimensions) },
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
  // Where this session's object metadata waits between create and complete. R2 holds that state on its
  // own side of a real multipart upload; here the assembly is ours, so the state is ours too — and it
  // goes to storage rather than to an in-process map because create and complete are separate requests
  // with separate presigner instances. The staging prefix ends in a name no part number can take, so it
  // is skipped by the part loop and swept by the abort listing like everything else.
  const dimensionsKey = (uploadId: string): string =>
    `${DEV_MULTIPART_STAGING_PREFIX}/${uploadId}/dimensions`;
  return {
    presignPut(_bucket, key, contentType, _expiresSeconds, dimensions) {
      // The same headers the production presigner signs, spelled the same way — so the development
      // path exercises a client that sends the stamp rather than one that never had to, and the
      // route can pass the set through without adding to it (see the initiate handler).
      return Promise.resolve({
        url: `/api/__dev/r2/object?key=${encodeURIComponent(key)}`,
        headers: { "content-type": contentType, ...objectDimensionHeaders(dimensions) },
      });
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
    async createMultipartUpload(_bucket, _key, _contentType, dimensions) {
      // No object is created here — parts are staged lazily as they arrive and complete assembles
      // them, so a lost idempotency race can leave no orphaned upload. The synthetic id namespaces
      // this session's staged parts; it stands in for R2's UploadId. Only the session's own metadata is
      // parked, under that same id, so completion stamps what creation was told.
      const uploadId = `dev-multipart-${crypto.randomUUID()}`;
      // fitness:allow-no-dimensions — this object IS the parked stamp, not a firm object: it lives
      // under the development staging prefix, is never enqueued for ingest, and is deleted by the
      // completion or the abort that follows it.
      await env.R2.put(dimensionsKey(uploadId), JSON.stringify(dimensions));
      return { uploadId };
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
      const parked = await env.R2.get(dimensionsKey(uploadId));
      const dimensions = parked === null ? {} : ((await parked.json()) as Record<string, string>);
      await env.R2.put(key, combined, { customMetadata: dimensions });
      for (const part of ordered) {
        await env.R2.delete(stagingKey(uploadId, part.partNumber));
      }
      await env.R2.delete(dimensionsKey(uploadId));
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

import type { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { loadPendingVersionForIngest } from "@magna-carta/file-manager/file-service";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { objectDimensionsFromHeaders } from "@magna-carta/object-dimensions/dimensions";
import { problemJson } from "../../contracts/problem.ts";
import type { RouteMeta } from "../../contracts/route-meta.ts";
import { resolveFirmBucket } from "../../files/firm-bucket.ts";
import { enqueueDevIngestEvent } from "../../files/presign.ts";
import { devUploadEmulationActive } from "../../files/presigner-wiring.ts";

// The DEVELOPMENT-ONLY upload target. Production upload is a direct-to-R2 ceremony: the client PUTs
// bytes to a presigned R2 URL and an R2 object-create event feeds the files-ingest queue. Local
// object storage (Miniflare) resolves no such presigned host and emits no such event, so this route
// stands in for R2 during `wrangler dev`: it accepts the same client PUT (single-shot and multipart
// parts) that the worker-origin dev presigner (files/presign.ts) points at, writes the bytes to the
// firm's resolved bucket — the exact handle the ingest consumer reads — and enqueues the event R2 would have
// fired. The client performs the identical four-step ceremony against both environments; nothing is
// stubbed on the client.
//
// It writes bytes to object storage, so THREE guards hold, all of which must:
//   1. Real-credential absence. It serves its route ONLY when the real R2 S3 credential set is absent
//      — the same fail-closed signal (devUploadEmulationActive, presigner-wiring.ts) that makes
//      presignerForEnv return the dev presigner in the first place. A production deploy cannot sign a
//      real presigned upload without those credentials, so wherever this route could activate, the
//      real upload transport is already dead — there is no working production surface to expose. This
//      is not a togglable env var (which could be set in the wrong place); it is the credential state
//      the whole upload path already turns on. The guard answers a bare 404 before the chokepoint runs
//      wherever the credentials are present, so production reveals nothing (no auth challenge).
//   2. The normal chokepoint. When reachable it sits behind session -> files:upload (chokepoint.forRoute
//      below), so even then it is not an unauthenticated write.
//   3. Object-key validation. It writes ONLY a key the session firm's uploads.initiate minted: the key
//      must resolve to a still-pending version in THIS firm (loadPendingVersionForIngest). An arbitrary
//      or foreign key resolves to no pending version and is refused.
//
// SAME-ORIGIN, so it exercises NO CORS and cannot prove the production cross-origin path (a bucket
// with no AllowedOrigins, or multipart unable to read the ETag response header). The acceptance gate
// for upload is one real multipart upload against a real bucket in a preview environment — see the R2
// bucket CORS runbook in docs/conventions/operations.md. This route is not that gate.
//
// NOT a /api/v1 route and NOT an OpenAPI operation (a bare app.put under /api/__dev, so run_worker_first
// routes it to the Worker and it never enters the contract or the conformance sweep) — mirroring the
// throwaway dev-web-tools demo, but gated on real-credential absence rather than a flag.

type DevUploadApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// The chokepoint reads these fields: authenticated (401 without a session), permission (403 without
// files:upload), surface + idempotency + rateLimit (the app-surface gates). resource/audited/operationId
// round out the shape; this route mints no audit row and is not in the contract, so they are nominal.
const devUploadMeta: RouteMeta = {
  operationId: "dev.r2Upload",
  surface: "app",
  authenticated: true,
  permission: "files:upload",
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

// Guard 1: answer a bare 404 (route invisible, no auth challenge) whenever the real R2 S3 credential
// set is present — i.e. wherever presignerForEnv would sign real presigned uploads rather than reroute
// them here. Registered OUTSIDE the chokepoint so production never gets so far as a 401. Because it
// reads the same credential state that selects the presigner, the route is reachable exactly when the
// dev presigner minted the worker-origin URL that points at it, and never otherwise.
const requireDevUploadEmulation: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AppVariables;
}> = (c, next) => {
  if (!devUploadEmulationActive(c.env)) return Promise.resolve(c.notFound());
  return next();
};

export function registerDevR2UploadRoute(app: DevUploadApp, chokepoint: Chokepoint): void {
  // Single-shot PUT: the client uploads the whole object to the URL uploads.initiate returned for the
  // put mode. Write the bytes, then enqueue the ingest event (the single-shot object exists after this
  // PUT, exactly as it would after a direct-to-R2 PUT and its object-create event).
  app.put(
    "/api/__dev/r2/object",
    requireDevUploadEmulation,
    chokepoint.forRoute(devUploadMeta),
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const key = c.req.query("key");
      if (key === undefined || key === "") {
        return problemJson(c, {
          type: "validation",
          status: 400,
          title: "Missing object key",
          detail: "The dev upload PUT requires a key query parameter.",
        });
      }
      // Guard 3: only a key the firm's uploads.initiate minted (a still-pending version) is writable.
      const pending = await loadPendingVersionForIngest(firm.firmDatabase, key);
      if (pending === undefined) {
        return problemJson(c, {
          type: "not-found",
          status: 404,
          title: "Not found",
          detail: "No pending upload in this firm has that object key.",
        });
      }
      const bytes = await c.req.arrayBuffer();
      // Write through the firm's resolved bucket — the exact handle handleIngestMessage reads — so the
      // object lands where ingest loads it, and the event carries that same bucket's name. Buffered
      // because Miniflare's R2 put stores nothing for an unknown-length stream; a dev upload is small
      // and this is not a production write path.
      const { bucket, bucketName } = resolveFirmBucket(c.env, firm.bucketName);
      // The stamp travels the way it travels in production: as the metadata headers the presigner
      // signed and the client echoed back. Reading them off the request rather than rebuilding them
      // here is what makes this route exercise a client that sends them.
      await bucket.put(key, bytes, {
        customMetadata: objectDimensionsFromHeaders(c.req.raw.headers),
      });
      await enqueueDevIngestEvent(c.env, bucketName, key, bytes.byteLength);
      return c.body(null, 200);
    },
  );

  // Multipart part PUT: the client uploads one part to the URL uploads.signPart returned. Stage the
  // bytes under the session's synthetic upload id; the server-side completeMultipartUpload (the dev
  // presigner) assembles the staged parts into the final object and enqueues ingest. Respond with an
  // ETag header the client echoes back in the complete manifest, the way R2 does.
  app.put(
    "/api/__dev/r2/part",
    requireDevUploadEmulation,
    chokepoint.forRoute(devUploadMeta),
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const key = c.req.query("key");
      const uploadId = c.req.query("uploadId");
      const partNumberRaw = c.req.query("partNumber");
      if (
        key === undefined ||
        key === "" ||
        uploadId === undefined ||
        uploadId === "" ||
        partNumberRaw === undefined ||
        !/^[1-9][0-9]*$/.test(partNumberRaw)
      ) {
        return problemJson(c, {
          type: "validation",
          status: 400,
          title: "Malformed part upload",
          detail: "The dev part PUT requires key, uploadId, and a positive integer partNumber.",
        });
      }
      // Guard 3: the same pending-version check binds a part write to a key this firm minted.
      const pending = await loadPendingVersionForIngest(firm.firmDatabase, key);
      if (pending === undefined) {
        return problemJson(c, {
          type: "not-found",
          status: 404,
          title: "Not found",
          detail: "No pending upload in this firm has that object key.",
        });
      }
      const bytes = await c.req.arrayBuffer();
      // fitness:allow-no-dimensions — a staged part is not an object: it lives under the development
      // staging prefix, is never enqueued for ingest, and is deleted when the completion assembles the
      // real object (which carries the stamp its multipart create was given).
      const stored = await c.env.R2.put(`__dev-multipart/${uploadId}/${partNumberRaw}`, bytes);
      // The part ETag (R2 returns one; the client reads it to build the complete manifest). Same-origin,
      // so the header is readable with no CORS exposure — which is exactly why this route cannot prove
      // the production cross-origin ETag path.
      c.header("ETag", stored?.etag !== undefined ? `"${stored.etag}"` : '"dev-part"');
      return c.body(null, 200);
    },
  );
}

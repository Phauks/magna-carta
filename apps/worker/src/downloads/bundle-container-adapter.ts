import { z } from "@hono/zod-openapi";
import type { BundleManifest } from "@magna-carta/file-manager/bundle-manifest";

// The bundle service's HTTP surface, narrowed to the one call the adapter makes. The BUNDLE_SERVICE
// Fetcher binding satisfies it; tests pass a fake so the adapter is exercised without a real
// bundle worker running in the pool.
export interface BundleServiceFetcher {
  fetch(request: Request): Promise<Response>;
}

// A single volume (output artifact) produced by the bundle container. Non-split bundles produce
// exactly one volume; 7z-split bundles produce N volumes numbered by the container.
export interface BuildResultVolume {
  key: string;
  sizeBytes: number;
}

// The bundle container's JSON response for a non-streaming build. `ok:false` means the container
// attempted the build but encountered an error (e.g. I/O failure writing to R2 via outbound
// Workers); the `error` field carries a message safe to include in a thrown Error.
const buildResponseSchema = z.object({
  ok: z.boolean(),
  volumes: z.array(
    z.object({
      key: z.string(),
      sizeBytes: z.number(),
    }),
  ),
  error: z.string().nullable(),
});

// The worker-side ceiling on a single bundle build request. The container enforces its own per-leg
// deadlines on R2 reads and the archive write, so it should always answer; this is the backstop for
// a container that wedges entirely (a hung process the runtime has not yet recycled), turning it
// into a retryable throw rather than a request that hangs until the platform's own subrequest
// timeout. It sits well above the container's whole-build budget (worst-case large archive with
// many R2 fetch legs plus AES encryption headroom) so a slow but legitimate large-file bundle is
// never aborted as a false wedge.
const BUILD_REQUEST_TIMEOUT_MS = 8 * 60 * 1000;

// Builds an adapter over the BUNDLE_SERVICE Fetcher binding. Returns two methods:
//   build: POSTs the manifest as JSON to the container's /build, validates the BuildResponse, and
//          returns the volume list. Throws on non-200, ok:false, or a malformed body — callers
//          treat a throw as a retryable failure.
//   buildStream: POSTs the manifest as JSON to /build?stream=1 and returns the raw streaming
//                Response. The caller pipes its body directly to the client (encrypted lane). Throws
//                on non-200.
//
// `requestTimeoutMs` overrides the wedged-container backstop (tests inject a small value to drive
// the abort path without waiting out the production ceiling).
export function bundleContainerAdapter(
  service: BundleServiceFetcher,
  requestTimeoutMs: number = BUILD_REQUEST_TIMEOUT_MS,
): {
  build(manifest: BundleManifest): Promise<BuildResultVolume[]>;
  buildStream(manifest: BundleManifest): Promise<Response>;
} {
  return {
    async build(manifest) {
      const response = await service.fetch(
        new Request("http://bundle/build", {
          method: "POST",
          body: JSON.stringify(manifest),
          headers: { "content-type": "application/json" },
          // A wedged container becomes a retryable throw (AbortError) here rather than a hang;
          // the consumer re-queues, so a stuck build never resolves as a partial artifact.
          signal: AbortSignal.timeout(requestTimeoutMs),
        }),
      );
      if (response.status !== 200) {
        throw new Error(`bundle container returned status ${response.status}`);
      }
      const parsed = buildResponseSchema.parse(await response.json());
      if (!parsed.ok) {
        throw new Error(`bundle container build failed: ${parsed.error ?? "unknown error"}`);
      }
      return parsed.volumes;
    },

    async buildStream(manifest) {
      const response = await service.fetch(
        new Request("http://bundle/build?stream=1", {
          method: "POST",
          body: JSON.stringify(manifest),
          headers: { "content-type": "application/json" },
          // Same wedged-container backstop as build — the encrypted-lane caller streams the
          // response body to the client, so a hang here would stall the entire download.
          signal: AbortSignal.timeout(requestTimeoutMs),
        }),
      );
      if (response.status !== 200) {
        throw new Error(`bundle container (stream) returned status ${response.status}`);
      }
      return response;
    },
  };
}

import { z } from "@hono/zod-openapi";
import type { MalwareScanPort, ScanResult } from "@magna-carta/file-manager/scan-port";

// The scan Container's HTTP surface, narrowed to the one call the adapter makes. The container instance
// from `getContainer(env.SCAN_CONTAINER, ...)` satisfies it; tests pass a fake so the adapter is
// exercised without a real container (or Docker).
export interface ScanContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

// The Rust scan service's JSON contract — the SAME union as scan-port.ts (the Rust⇄TS boundary). The
// response is validated against it, so an unrecognized verdict is a fault, never a silent `clean`.
const scanResultSchema: z.ZodType<ScanResult> = z.union([
  z.object({
    verdict: z.literal("clean"),
    engineVersion: z.string(),
    activeContent: z.boolean().optional(),
  }),
  z.object({
    verdict: z.literal("infected"),
    engineVersion: z.string(),
    signature: z.string().nullable(),
  }),
  z.object({
    verdict: z.literal("unscanned"),
    reason: z.enum(["no-engine", "encrypted"]),
    engineVersion: z.string().nullable(),
  }),
  z.object({
    verdict: z.literal("suspicious"),
    reason: z.enum(["decompression-bomb", "archive-nesting", "archive-entry-count"]),
    engineVersion: z.string(),
  }),
]);

// The worker-side ceiling on a single scan request. The container enforces its own per-leg deadlines on
// the clamd exchange and isolates engine panics, so it should always answer; this is the backstop for a
// container that wedges entirely (a hung process the runtime has not yet recycled), turning it into a
// retryable throw rather than a request that hangs until the platform's own subrequest timeout. It sits
// above the container's whole-scan budget (clamd's worst-case full-cap scan plus headroom) so a slow but
// legitimate large-file scan is never aborted as a false wedge.
const SCAN_REQUEST_TIMEOUT_MS = 11 * 60 * 1000;

// Builds a MalwareScanPort over a scan Container. It POSTs the file body to the container's /scan, then
// maps the JSON to a ScanResult, THROWING on any non-200, malformed body, or timeout — the consumer
// retries the queue message on a throw, so a scan fault never commits as clean. `requestTimeoutMs`
// overrides the wedged-container backstop (a test passes a small value to drive the abort path).
export function containerScanAdapter(
  container: ScanContainerFetcher,
  requestTimeoutMs: number = SCAN_REQUEST_TIMEOUT_MS,
): MalwareScanPort {
  return {
    async scan(body, meta) {
      const query = new URLSearchParams({
        size: String(meta.sizeBytes),
        contentType: meta.sniffedContentType ?? "",
      });
      const response = await container.fetch(
        new Request(`http://scan/scan?${query.toString()}`, {
          method: "POST",
          body,
          // A streaming request body requires the half-duplex hint in the Workers runtime.
          duplex: "half",
          // A wedged container becomes a retryable throw (AbortError) here rather than a hang; the
          // consumer re-queues, so a stuck scan never resolves as clean.
          signal: AbortSignal.timeout(requestTimeoutMs),
        } as RequestInit & { duplex: "half" }),
      );
      if (response.status !== 200) {
        throw new Error(`scan container returned status ${response.status}`);
      }
      return scanResultSchema.parse(await response.json());
    },
  };
}

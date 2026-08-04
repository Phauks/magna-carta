import { z } from "@hono/zod-openapi";
import type { MalwareScanPort, RawScanResult } from "@magna-carta/file-manager/scan-port";

// The scan service's HTTP surface, narrowed to the one call the adapter makes. The SCAN_SERVICE
// Fetcher binding satisfies it; tests pass a fake so the adapter is exercised without a real
// scan worker running in the pool.
export interface ScanContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

// The Rust scan service's JSON contract — the RawScanResult facts that scan-port.ts defines (the
// Rust⇄TS boundary). The engine reports facts (clamd state, structural heuristic, YARA matches, per-leg
// timings); the app's verdict layer (packages/file-manager/src/verdict.ts) turns them into a file
// verdict. The response is validated against this schema, so a malformed body is a fault (a retryable
// throw), never a silently fabricated result. An engine that goes dark serializes `clam: unavailable`
// with HTTP 200 — the verdict layer raises that to a retryable fault, so unavailable is never clean.
const rawScanResultSchema: z.ZodType<RawScanResult> = z.object({
  engineVersion: z.string().nullable(),
  clam: z.discriminatedUnion("state", [
    z.object({ state: z.literal("clean") }),
    z.object({ state: z.literal("infected"), signature: z.string() }),
    z.object({ state: z.literal("unavailable") }),
  ]),
  heuristic: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({
      kind: z.literal("structural"),
      reason: z.enum(["decompression-bomb", "archive-nesting", "archive-entry-count"]),
    }),
    z.object({ kind: z.literal("encrypted") }),
    z.object({ kind: z.literal("active-content") }),
  ]),
  matches: z.array(
    z.object({
      ruleId: z.string(),
      tier: z.enum(["core", "extended", "full"]),
      score: z.number(),
      isSuspicious: z.boolean(),
    }),
  ),
  timings: z.object({ clamdMs: z.number(), yaraMs: z.number() }),
});

// The worker-side ceiling on a single scan request. The container enforces its own per-leg deadlines on
// the clamd exchange and isolates engine panics, so it should always answer; this is the backstop for a
// container that wedges entirely (a hung process the runtime has not yet recycled), turning it into a
// retryable throw rather than a request that hangs until the platform's own subrequest timeout. It sits
// above the container's whole-scan budget (clamd's worst-case full-cap scan plus headroom) so a slow but
// legitimate large-file scan is never aborted as a false wedge.
const SCAN_REQUEST_TIMEOUT_MS = 11 * 60 * 1000;

// Builds a MalwareScanPort over a scan Container. It POSTs the file body to the container's /scan, then
// maps the JSON to a RawScanResult, THROWING on any non-200, malformed body, or timeout — the consumer
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
      // Routes the request to one of the scan service's container instances (apps/scan-worker's
      // scan-shard.ts hashes it). Sent only when the caller has a stable key, so a retry of the same
      // file reaches the instance that already handled it; omitted otherwise rather than sent empty.
      if (meta.contentKey !== undefined) {
        query.set("shardKey", meta.contentKey);
      }
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
      return rawScanResultSchema.parse(await response.json());
    },
  };
}

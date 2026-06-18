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

// Builds a MalwareScanPort over a scan Container. It POSTs the file body to the container's /scan, then
// maps the JSON to a ScanResult, THROWING on any non-200 or malformed body — the consumer retries the
// queue message on a throw, so a scan fault never commits as clean.
export function containerScanAdapter(container: ScanContainerFetcher): MalwareScanPort {
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
        } as RequestInit & { duplex: "half" }),
      );
      if (response.status !== 200) {
        throw new Error(`scan container returned status ${response.status}`);
      }
      return scanResultSchema.parse(await response.json());
    },
  };
}

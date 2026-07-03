import type { ScanContainerFetcher } from "./forward-scan.ts";

// Forward the `_SUSP_` score-histogram read to the scan Container and return its response verbatim.
// A GET with no body — the histogram is static metadata derived from the baked rule corpus. The service
// binding from the app worker is the trust boundary; this worker has no public routes.
export async function forwardHistogram(container: ScanContainerFetcher): Promise<Response> {
  const containerResponse = await container.fetch(
    new Request("http://scan/rules/score-histogram", { method: "GET" }),
  );
  return new Response(containerResponse.body, {
    status: containerResponse.status,
    statusText: containerResponse.statusText,
    headers: containerResponse.headers,
  });
}

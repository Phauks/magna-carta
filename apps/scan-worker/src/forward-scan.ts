// The scan Container's HTTP surface, narrowed to the one call the proxy makes. The container
// instance from `getContainer(env.SCAN_CONTAINER, ...)` satisfies it; tests pass a fake so the
// proxy is exercised without a real container (or Docker).
export interface ScanContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

// Forward an incoming scan request to the scan Container and return its response verbatim.
// The route is `POST /scan?size=&contentType=` (returns JSON RawScanResult).
// The service binding from the app worker is the trust boundary — this worker has no public routes.
// Any network failure is surfaced as a thrown error, not a silent unscanned result.
export async function forwardScan(
  request: Request,
  container: ScanContainerFetcher,
): Promise<Response> {
  // Proxy the entire request body and query string to the container's /scan endpoint, preserving
  // duplex so the Workers runtime can stream the body without buffering it.
  const containerResponse = await container.fetch(
    new Request(`http://scan/scan${new URL(request.url).search}`, {
      method: "POST",
      body: request.body,
      duplex: "half",
      signal: request.signal,
    } as RequestInit & { duplex: "half" }),
  );
  // Return the container's response verbatim — status, headers, and body.
  return new Response(containerResponse.body, {
    status: containerResponse.status,
    statusText: containerResponse.statusText,
    headers: containerResponse.headers,
  });
}

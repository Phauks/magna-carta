// The OCR Container's HTTP surface, narrowed to the one call the proxy makes. The container from
// getContainer(env.OCR_ENGINE, ...) satisfies it; tests pass a fake so the proxy is exercised without
// a real container (or Docker).
export interface OcrContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

// Forward an incoming OCR request to the engine Container and return its response verbatim. The app
// worker calls POST `path` with the document bytes as the body; this proxy re-targets the same path at
// the container and streams the body through, passing the container's status and headers (including its
// content-type — JSON facts for /ocr, a PDF for /ocr/searchable) back unchanged. The service binding
// from the app worker is the trust boundary — this worker has no public routes. A network failure
// throws (surfaced via telemetry), never a silent empty result.
//
// The query string travels with the path. The engine reads its options from it (`force`, and the
// `firstPage` window a long document is read through), and a proxy that dropped it would turn every
// window request into a request for the whole document, which the engine refuses for a long one.
export async function forwardOcr(
  request: Request,
  container: OcrContainerFetcher,
  path = "/ocr",
): Promise<Response> {
  const containerResponse = await container.fetch(
    new Request(`http://ocr${path}${new URL(request.url).search}`, {
      method: "POST",
      body: request.body,
      headers: request.headers,
      duplex: "half",
      signal: request.signal,
    } as RequestInit & { duplex: "half" }),
  );
  return new Response(containerResponse.body, {
    status: containerResponse.status,
    statusText: containerResponse.statusText,
    headers: containerResponse.headers,
  });
}

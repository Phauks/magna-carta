// The OCR Container's HTTP surface, narrowed to the one call the proxy makes. The container from
// getContainer(env.OCR_ENGINE, ...) satisfies it; tests pass a fake so the proxy is exercised without
// a real container (or Docker).
export interface OcrContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

// Forward an incoming OCR request to the engine Container and return its response verbatim. The app
// worker calls POST /ocr with the document bytes as the body; this proxy re-targets the same path at
// the container and streams the body through. The service binding from the app worker is the trust
// boundary — this worker has no public routes. A network failure throws (surfaced via telemetry),
// never a silent empty result.
export async function forwardOcr(
  request: Request,
  container: OcrContainerFetcher,
): Promise<Response> {
  const containerResponse = await container.fetch(
    new Request("http://ocr/ocr", {
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

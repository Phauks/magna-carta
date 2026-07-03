// The convert Container's HTTP surface, narrowed to the one call the proxy makes. The container from
// getContainer(env.RASTER_ENGINE, ...) satisfies it; tests pass a fake so the proxy is exercised
// without a real container (or Docker).
export interface ConvertContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

// Forward an incoming conversion request to the engine Container and return its response verbatim.
// Route: POST /convert with the source bytes as the body and the target format + recipe as
// x-target-format / x-source-format / x-recipe headers; the container returns the converted bytes
// with a Content-Type, or a non-2xx status. The service binding from the app worker is the trust
// boundary — this worker has no public routes. A network failure throws (surfaced via telemetry),
// never a silent empty result.
export async function forwardConvert(
  request: Request,
  container: ConvertContainerFetcher,
): Promise<Response> {
  const containerResponse = await container.fetch(
    new Request("http://convert/convert", {
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

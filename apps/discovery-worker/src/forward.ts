// The discovery Container's HTTP surface, narrowed to the one call the proxy makes. The container
// from getContainer(env.DISCOVERY_ENGINE, ...) satisfies it; tests pass a fake so the proxy is
// exercised without a real container (or Docker).
export interface DiscoveryContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

// Forward an incoming discovery request to the engine Container and return its response verbatim.
// The app worker calls POST /identify | /read | /digest | /archive/enumerate | /archive/expand with
// the document bytes as the body; this proxy re-targets the same operation path at the container
// (http://discovery<path>) and streams the body through — the bytes are never buffered here, which
// is the only way a production-sized document crosses a Worker at all. The service binding from the
// app worker is the trust boundary; this worker has no public routes. A network failure throws
// (surfaced via telemetry), never a silent empty result.
export async function forwardDiscovery(
  request: Request,
  path: string,
  container: DiscoveryContainerFetcher,
): Promise<Response> {
  const containerResponse = await container.fetch(
    new Request(`http://discovery${path}`, {
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

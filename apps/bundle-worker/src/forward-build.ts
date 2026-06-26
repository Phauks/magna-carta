// The bundle Container's HTTP surface, narrowed to the calls the proxy makes. The container
// instance from `getContainer(env.BUNDLE_CONTAINER, ...)` satisfies it; tests pass a fake so the
// proxy is exercised without a real container (or Docker).
export interface BundleContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

// Maximum time the worker waits for a container build response. Archive assembly can take
// minutes for large multi-file inputs; 5 minutes is generous while still bounding the handler.
const BUILD_TIMEOUT_MS = 5 * 60 * 1_000;

// Forward an incoming build request to the bundle Container and return its response verbatim.
// The route is `POST /build` — returns JSON BuildResponse normally, or a streamed archive when
// `?stream=1` is set (encrypted lane). Any request that is not POST /build is rejected with 404.
// The service binding from the app worker is the trust boundary; this worker has no public routes.
export async function forwardBuild(
  request: Request,
  container: BundleContainerFetcher,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/build") {
    return new Response("Not Found", { status: 404 });
  }
  // Proxy the entire request body and query string to the container's /build endpoint, preserving
  // duplex so the Workers runtime can stream the manifest body without buffering it. The signal is the
  // caller's own signal raced against a timeout backstop: a caller disconnect (the app worker's
  // service-binding call being cancelled) aborts the container build immediately rather than letting it
  // run on and saturate the instance pool, while the timeout still bounds a genuinely hung container.
  const containerResponse = await container.fetch(
    new Request(`http://bundle/build${url.search}`, {
      method: "POST",
      body: request.body,
      duplex: "half",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(BUILD_TIMEOUT_MS)]),
    } as RequestInit & { duplex: "half" }),
  );
  // Return the container's response verbatim — status, headers, and body (the BuildResponse JSON
  // or the streamed archive for the encrypted lane).
  return new Response(containerResponse.body, {
    status: containerResponse.status,
    statusText: containerResponse.statusText,
    headers: containerResponse.headers,
  });
}

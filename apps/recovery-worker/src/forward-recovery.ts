// The recovery Container's HTTP surface, narrowed to the two calls the proxy makes. The container
// instance from `getContainer(env.RECOVERY_ENGINE, ...)` satisfies it; tests pass a fake so the
// proxy is exercised without a real container (or Docker).
export interface RecoveryEngineContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

// Forward an incoming shard request to the recovery Container and return its response verbatim.
// The route is `POST /recover-shard` (returns JSON ShardOutcome).
// The service binding from the app worker is the trust boundary — this worker has no public routes.
// Any network failure is surfaced as a thrown error, not a silent unchecked result.
export async function forwardRecoveryShard(
  request: Request,
  container: RecoveryEngineContainerFetcher,
): Promise<Response> {
  // Proxy the entire request body to the container's /recover-shard endpoint, preserving
  // duplex so the Workers runtime can stream the body without buffering it.
  const containerResponse = await container.fetch(
    new Request(`http://recovery/recover-shard`, {
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

// Forward an encryption-header read to the recovery Container and return its response verbatim.
// The route is `POST /extract-hash`: the raw file bytes go in, and either the recovery hash (200),
// a stable refusal code about the file (422), or a fault (5xx) comes back. The status codes are the
// contract the app worker branches on, so nothing here may collapse or rewrite one.
//
// The bytes stream through — a whole encrypted document is the request body, and buffering it here
// would put a member's file in this worker's memory for no gain.
export async function forwardExtractHash(
  request: Request,
  container: RecoveryEngineContainerFetcher,
): Promise<Response> {
  const containerResponse = await container.fetch(
    new Request("http://recovery/extract-hash", {
      method: "POST",
      body: request.body,
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

// Forward a health probe to the recovery Container's /ready endpoint and return its response verbatim.
export async function forwardReady(container: RecoveryEngineContainerFetcher): Promise<Response> {
  return container.fetch(new Request("http://recovery/ready"));
}

// Route an incoming request to the appropriate forwarding function, or return 404.
// Extracted from index.ts so that routing can be tested without importing @cloudflare/containers
// (which requires the cloudflare:workers runtime module unavailable in the node test pool).
//
// `resolveContainer` maps a container instance id to its Fetcher rather than taking a single fixed
// instance: the app worker sets the X-Recovery-Instance header per shard so shards fan out across
// distinct container instances instead of piling onto one.
export async function routeRequest(
  request: Request,
  resolveContainer: (instanceId: string) => RecoveryEngineContainerFetcher,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/recover-shard") {
    // Fall back to a fixed instance id when the header is absent, preserving single-instance
    // behavior for any direct/legacy caller that doesn't set it.
    const instanceId = request.headers.get("X-Recovery-Instance") ?? "recovery";
    return forwardRecoveryShard(request, resolveContainer(instanceId));
  }
  if (request.method === "POST" && url.pathname === "/extract-hash") {
    // A header read is a single short synchronous call, not a shard of a long search, so it has no
    // fan-out key of its own and rides the same fixed instance a shard falls back to. Honour the
    // header when the caller does set one, so a future caller can pin the read alongside its shards.
    const instanceId = request.headers.get("X-Recovery-Instance") ?? "recovery";
    return forwardExtractHash(request, resolveContainer(instanceId));
  }
  if (request.method === "GET" && url.pathname === "/ready") {
    return forwardReady(resolveContainer("recovery"));
  }
  return new Response("Not Found", { status: 404 });
}

// The search Container's HTTP surface, narrowed to the calls the proxy makes. The container instance
// from `getContainer(env.SEARCH_INDEX, ...)` satisfies it; tests pass a fake so the routing is exercised
// without a real container (or Docker).
export interface SearchContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

// The four engine operations the app Worker's SearchIndexPort adapter calls
// (apps/worker/src/search/search-engine.ts). Listed rather than pattern-matched so an unknown path is a
// 404 here instead of reaching the engine: the service binding is the trust boundary, but a boundary
// that forwards anything is not one.
export const ENGINE_OPERATIONS = ["index", "query", "remove", "compact"] as const;

export type EngineOperation = (typeof ENGINE_OPERATIONS)[number];

export function engineOperationOf(pathname: string): EngineOperation | null {
  const candidate = pathname.replace(/^\//, "");
  return (ENGINE_OPERATIONS as readonly string[]).includes(candidate)
    ? (candidate as EngineOperation)
    : null;
}

// Forward one engine operation to the search Container and return its response verbatim. The body is
// streamed rather than buffered — an index call carries a document's passages and a compaction call
// carries a source list, neither of which this worker has any reason to hold.
//
// No authentication is performed here: only the app Worker can reach this worker (service binding, no
// public routes), and the per-operation capability the engine needs to touch R2 rides inside the body
// as a token the app Worker itself verifies when the engine calls back.
export async function forwardEngineOperation(
  request: Request,
  operation: EngineOperation,
  container: SearchContainerFetcher,
): Promise<Response> {
  const response = await container.fetch(
    new Request(`http://search/${operation}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: request.body,
      duplex: "half",
      signal: request.signal,
    } as RequestInit & { duplex: "half" }),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// Poke the container's health endpoint to keep the resident engine — and the split searchers it is
// holding open — alive between queries. A warm engine is the design's latency story, so this is not
// housekeeping: it is the difference between the steady state the target is stated against and paying
// the open cost on every query.
export async function pokeContainer(container: SearchContainerFetcher): Promise<void> {
  await container.fetch(new Request("http://search/ready"));
}

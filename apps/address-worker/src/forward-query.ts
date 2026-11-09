// The address engine's HTTP surface, narrowed to the calls this worker makes. The container instance
// from `getContainer(...)` satisfies it; tests pass a fake so the routing is exercised without a real
// container (or Docker).
export interface AddressContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

// The one query instance every lookup goes to. One name, not a spread: the index is public reference
// data, identical for every firm, and an instance's value is the partitions it holds open and the byte
// ranges it has cached. A second name would be a second cold cache paying the first-open reads again,
// with no isolation to gain — no firm's data is in it.
export const ADDRESS_INDEX_INSTANCE_NAME = "address-index";

// The one build instance. One, because two builds running at once would race to publish the pointer.
export const ADDRESS_BUILD_INSTANCE_NAME = "address-build";

// The two operations the app worker's address-lookup adapter calls
// (packages/address-lookup/src/self-hosted.ts). Listed rather than pattern-matched so an unknown path
// is a 404 here instead of reaching the engine: the service binding is the trust boundary, but a
// boundary that forwards anything is not one. The engine's build surface is deliberately absent — a
// build is started by this worker's cron, never by a caller.
export const QUERY_OPERATIONS = ["suggestions", "units"] as const;

export type QueryOperation = (typeof QUERY_OPERATIONS)[number];

export function queryOperationOf(pathname: string): QueryOperation | null {
  const candidate = pathname.replace(/^\//, "");
  return (QUERY_OPERATIONS as readonly string[]).includes(candidate)
    ? (candidate as QueryOperation)
    : null;
}

// Forward one query operation to the query container and return its response verbatim. The body is
// streamed rather than buffered, and nothing is added, stripped, retried or cached: the engine's
// answer, including `no-coverage` and `unavailable`, is the adapter's to interpret.
export async function forwardQueryOperation(
  request: Request,
  operation: QueryOperation,
  container: AddressContainerFetcher,
): Promise<Response> {
  const response = await container.fetch(
    new Request(`http://address/${operation}`, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "application/json" },
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

// Ask the query container whether it is up. Waking it is the point: the app worker's readiness probe
// lands here, and an engine that is already up has its partitions open for the first keystroke.
export async function pokeContainer(container: AddressContainerFetcher): Promise<boolean> {
  const response = await container.fetch(new Request("http://address/ready"));
  await response.body?.cancel();
  return response.ok;
}

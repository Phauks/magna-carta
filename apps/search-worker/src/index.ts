import { getContainer } from "@cloudflare/containers";
import { engineOperationOf, forwardEngineOperation, pokeContainer } from "./forward-search.ts";
import { searchShardNameForFirm } from "./search-shard.ts";

// The dedicated discovery search-index worker. Stateless in itself: no D1, no R2, no Queues. It owns the
// Tantivy Container Durable Object and is reached only over a service binding from the app Worker.
//
// The state the index IS lives in the firm's own R2 bucket (the splits) and the firm's own database (the
// catalog) — the container is a warm compute-and-cache layer over both, which is what lets it restart or
// scale without losing anything.
export type Bindings = {
  // The keyword-index Container (Container-backed Durable Object). Named in wrangler.jsonc's
  // durable_objects.bindings and migrations. The SearchIndexContainer class must be exported here so the
  // runtime can instantiate the class named in the binding.
  SEARCH_INDEX: DurableObjectNamespace<import("./search-index-container.ts").SearchIndexContainer>;
  // Service binding to the main app worker. The target of the engine's intercepted split-object calls —
  // it mounts the token-guarded /search-objects/* host. This worker holds no R2, D1, or secret bindings
  // of its own; all object I/O flows through that host.
  APP_WORKER: Fetcher;
};

// The container class must be re-exported from the worker's entrypoint so the Cloudflare runtime can
// instantiate the class named in wrangler.jsonc's durable_objects binding.
export { SearchIndexContainer } from "./search-index-container.ts";

// Required by @cloudflare/containers: the runtime resolves the container's outbound-interception proxy
// via `ctx.exports.ContainerProxy`, so a worker whose container uses `outboundByHost` MUST re-export it.
// Without it, starting the container throws "ctx.exports.ContainerProxy is undefined". It is a
// WorkerEntrypoint, not a Durable Object — no wrangler binding or migration is needed.
export { ContainerProxy } from "@cloudflare/containers";

// The warm-poke cron. Its whole purpose is to keep the engine resident: a searcher held open over a
// split answers from state it already paid for, and the sub-second target is stated against that steady
// state. Currently OFF in wrangler.jsonc — with no firm indexing yet, pinning an instance bills memory
// continuously for no query. Re-arm it at first onboarding; this handler stays wired so that is one line.
const SEARCH_WARM_CRON = "*/20 * * * *";

export default {
  // The engine proxy: receives one of the four operations from the app worker over the service binding,
  // forwards it to the container that holds the firm's working set, and returns the JSON verbatim.
  // No authentication here — the service binding is the trust boundary (this worker is not reachable
  // from the public internet), and the engine's own reach into R2 is bounded by the capability token the
  // app worker minted for that single operation.
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/ready") {
      await pokeContainer(getContainer(env.SEARCH_INDEX, searchShardNameForFirm(null)));
      return new Response(null, { status: 204 });
    }
    if (request.method !== "POST") return new Response("Not Found", { status: 404 });
    const operation = engineOperationOf(url.pathname);
    if (operation === null) return new Response("Not Found", { status: 404 });

    // Which instance serves the call is decided by the firm, not by the operation: a firm's splits are
    // what an instance holds open, so routing a firm's queries to one instance is what makes the warm
    // cache mean anything. Reading the firm from the body is why the body is buffered for this hop only.
    const body = await request.text();
    const firmId = firmIdOf(body);
    return forwardEngineOperation(
      new Request(request.url, { method: "POST", body, signal: request.signal }),
      operation,
      getContainer(env.SEARCH_INDEX, searchShardNameForFirm(firmId)),
    );
  },

  scheduled(controller: ScheduledController, env: Bindings, executionContext: ExecutionContext) {
    if (controller.cron === SEARCH_WARM_CRON) {
      executionContext.waitUntil(
        pokeContainer(getContainer(env.SEARCH_INDEX, searchShardNameForFirm(null))),
      );
    }
  },
} satisfies ExportedHandler<Bindings>;

// The firm the call is for, read from the operation body. Null for a body that does not carry one — the
// shard resolver answers that with the default instance rather than throwing, because a malformed body
// is the engine's error to report, not a reason for the proxy to decide the request has no home.
function firmIdOf(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { firmId?: unknown };
    return typeof parsed.firmId === "string" && parsed.firmId !== "" ? parsed.firmId : null;
  } catch {
    return null;
  }
}

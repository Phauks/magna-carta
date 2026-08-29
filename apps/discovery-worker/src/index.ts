import { getContainer } from "@cloudflare/containers";
import { isVersionRequest, versionResponse } from "@magna-carta/build-identity/version-route";
import { forwardDiscovery } from "./forward.ts";

// The discovery worker's runtime bindings. Stateless: no D1, R2, or Queues. The only binding is the
// engine Container Durable Object. Reached only via a service binding from the app worker — no public
// routes, so the service binding is the trust boundary.
export type Bindings = {
  // The pure-Rust discovery engine Container (Container-backed Durable Object). Named in
  // wrangler.jsonc's durable_objects.bindings + migrations; the class is re-exported below so the
  // runtime can instantiate it.
  DISCOVERY_ENGINE: DurableObjectNamespace<
    import("./discovery-engine-container.ts").DiscoveryEngineContainer
  >;
};

export { DiscoveryEngineContainer } from "./discovery-engine-container.ts";

// The five engine operations this worker proxies to the Container. Anything else is a 404 — the
// allow-list is the surface, so a route the engine grows is a deliberate addition here rather than
// something a path can reach on its own.
const OPERATIONS = new Set([
  "/identify",
  "/read",
  "/digest",
  "/archive/enumerate",
  "/archive/expand",
]);

// No warm cron: the engine Container scales to zero after its sleepAfter, so it bills only while
// documents are actually being read. A bulk load arrives through a queue and never notices a cold
// start on its first message.
export default {
  // POST one of the engine operations — receives the streamed document body from the app worker (via
  // service binding) and forwards it to the engine Container, returning its JSON response verbatim.
  // No auth: the service binding is the trust boundary (not reachable from the public internet).
  async fetch(request: Request, env: Bindings): Promise<Response> {
    // The build-identity read the app worker's aggregate version endpoint probes over this binding.
    if (isVersionRequest(request)) return versionResponse();
    const url = new URL(request.url);
    if (request.method === "POST" && OPERATIONS.has(url.pathname)) {
      return forwardDiscovery(
        request,
        url.pathname,
        getContainer(env.DISCOVERY_ENGINE, "discovery"),
      );
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Bindings>;

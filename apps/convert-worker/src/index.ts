import { getContainer } from "@cloudflare/containers";
import { engineTargetFor } from "./engine-dispatch.ts";
import { forwardConvert } from "./forward-convert.ts";

// The convert worker's runtime bindings. Stateless: no D1, R2, or Queues. The only binding is the
// engine Container Durable Object. Reached only via a service binding from the app worker — no public
// routes, so the service binding is the trust boundary.
export type Bindings = {
  // The pure-Rust raster engine Container (Container-backed Durable Object). Named in
  // wrangler.jsonc's durable_objects.bindings + migrations; the class is re-exported below so the
  // runtime can instantiate it.
  RASTER_ENGINE: DurableObjectNamespace<
    import("./raster-engine-container.ts").RasterEngineContainer
  >;
};

export { RasterEngineContainer } from "./raster-engine-container.ts";

// No warm cron: the engine Container scales to zero after its sleepAfter, so it bills only while a
// conversion is actually running. Conversions are bursty/on-demand, so the cold-start on the first
// request after an idle period is the right trade against paying for an always-on instance. (Warming
// on demand — booting when a job is enqueued — is the lever to add if cold-start latency ever bites.)
export default {
  // POST /convert — receives the streamed source body + engine-id/format/recipe headers from the app
  // worker (via service binding), dispatches by x-engine-id to the engine Container, and returns its
  // bytes verbatim. No auth: the service binding is the trust boundary (not reachable from the
  // public internet). An engine id with no Container here is 501 — the app worker's resolver keeps
  // unbuilt engines deferred, so this is a guard, not a working path.
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/convert") {
      const target = engineTargetFor(request.headers.get("x-engine-id"));
      if (target === undefined) return new Response("unknown engine", { status: 501 });
      return forwardConvert(request, getContainer(env.RASTER_ENGINE, target));
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Bindings>;

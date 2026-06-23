import { getContainer } from "@cloudflare/containers";
import { forwardConvert } from "./forward-convert.ts";

// The convert worker's runtime bindings. Stateless: no D1, R2, or Queues. The only binding is the
// engine Container Durable Object. Reached only via a service binding from the app worker — no public
// routes, so the service binding is the trust boundary.
export type Bindings = {
  // The native-libvips conversion engine Container (Container-backed Durable Object). Named in
  // wrangler.jsonc's durable_objects.bindings + migrations; the class is re-exported below so the
  // runtime can instantiate it.
  LIBVIPS_CONTAINER: DurableObjectNamespace<import("./libvips-container.ts").LibvipsContainer>;
};

export { LibvipsContainer } from "./libvips-container.ts";

// No warm cron: the engine Container scales to zero after its sleepAfter, so it bills only while a
// conversion is actually running. Conversions are bursty/on-demand, so the cold-start on the first
// request after an idle period is the right trade against paying for an always-on instance. (Warming
// on demand — booting when a job is enqueued — is the lever to add if cold-start latency ever bites.)
export default {
  // POST /convert — receives the streamed source body + target-format/recipe headers from the app
  // worker (via service binding) and forwards to the engine Container, returning its bytes verbatim.
  // No auth: the service binding is the trust boundary (not reachable from the public internet).
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/convert") {
      // Only libvips is wired today; engineId-based routing to additional engine Containers
      // (LibreOffice, FFmpeg) is added when those edges land.
      return forwardConvert(request, getContainer(env.LIBVIPS_CONTAINER, "libvips"));
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Bindings>;

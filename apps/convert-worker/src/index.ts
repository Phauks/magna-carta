import { getContainer } from "@cloudflare/containers";
import { forwardConvert } from "./forward-convert.ts";
import { pokeContainer } from "./convert-warm.ts";

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

// Keep one engine instance warm within the container's 30-minute sleepAfter.
const CONVERT_WARM_CRON = "*/20 * * * *";

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

  scheduled(controller: ScheduledController, env: Bindings, executionContext: ExecutionContext) {
    if (controller.cron === CONVERT_WARM_CRON) {
      executionContext.waitUntil(pokeContainer(getContainer(env.LIBVIPS_CONTAINER, "libvips")));
    }
  },
} satisfies ExportedHandler<Bindings>;

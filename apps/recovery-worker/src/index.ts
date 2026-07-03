import { getContainer } from "@cloudflare/containers";
import { forwardRecovery } from "./forward.ts";

// The recovery worker's runtime bindings. Stateless: no D1, R2, or Queues. The only binding is the
// engine Container Durable Object. Reached only via a service binding from the app worker — no public
// routes, so the service binding is the trust boundary.
export type Bindings = {
  // The pure-Rust recovery engine Container (Container-backed Durable Object). Named in
  // wrangler.jsonc's durable_objects.bindings + migrations; the class is re-exported below so the
  // runtime can instantiate it.
  RECOVERY_ENGINE: DurableObjectNamespace<
    import("./recovery-engine-container.ts").RecoveryEngineContainer
  >;
};

export { RecoveryEngineContainer } from "./recovery-engine-container.ts";

// The three engine operations this worker proxies to the Container. Anything else is a 404.
const OPERATIONS = new Set(["/diagnose", "/repair", "/carve"]);

// No warm cron: the engine Container scales to zero after its sleepAfter, so it bills only while a
// diagnose/repair/carve is actually running. Requests are bursty/on-demand, so the cold-start on the
// first request after an idle period is the right trade against paying for an always-on instance.
export default {
  // POST /diagnose | /repair | /carve — receives the streamed file body from the app worker (via
  // service binding) and forwards it to the engine Container, returning its JSON response verbatim.
  // No auth: the service binding is the trust boundary (not reachable from the public internet).
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && OPERATIONS.has(url.pathname)) {
      return forwardRecovery(request, url.pathname, getContainer(env.RECOVERY_ENGINE, "recovery"));
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Bindings>;

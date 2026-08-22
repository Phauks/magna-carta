import { getContainer } from "@cloudflare/containers";
import { routeRequest } from "./forward-recovery.ts";

// The recovery worker's runtime bindings. Stateless: no D1, R2, or Queues.
// The only binding is the recovery Container Durable Object (Container-backed, sqlite-class).
export type Bindings = {
  // The password-recovery Container (Container-backed Durable Object). Named in wrangler.jsonc's
  // durable_objects.bindings and migrations. The RecoveryEngineContainer class must be exported
  // here so the runtime can instantiate the class named in the binding.
  RECOVERY_ENGINE: DurableObjectNamespace<
    import("./recovery-engine-container.ts").RecoveryEngineContainer
  >;
};

// The recovery Container class must be re-exported from the worker's main entrypoint so the
// Cloudflare runtime can instantiate the class named in wrangler.jsonc's durable_objects binding.
export { RecoveryEngineContainer } from "./recovery-engine-container.ts";

export default {
  // The /recover-shard proxy: receives a JSON shard body from the app worker (via service binding),
  // forwards it to the recovery Container, and returns the JSON ShardOutcome verbatim.
  // POST /extract-hash forwards raw file bytes for an encryption-header read and returns the
  // recovery hash (200), a refusal code about the file (422), or a fault (5xx) verbatim.
  // POST /unlock forwards a framed password-plus-file body for a decrypt and returns the plaintext
  // (200), a refusal code about the file or the password (422), or a fault (5xx) verbatim.
  // GET /ready is forwarded to the Container's health endpoint.
  // No authentication is performed here — the service binding provides the trust boundary
  // (only the app worker can reach this worker; it is not reachable from the public internet).
  async fetch(request: Request, env: Bindings): Promise<Response> {
    return routeRequest(request, (id) => getContainer(env.RECOVERY_ENGINE, id));
  },
} satisfies ExportedHandler<Bindings>;

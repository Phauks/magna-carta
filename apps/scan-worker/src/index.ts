import { getContainer } from "@cloudflare/containers";
import { isVersionRequest, versionResponse } from "@magna-carta/build-identity/version-route";
import { resolveStoredSecrets } from "@magna-carta/worker-secrets/stored-secrets";
import { forwardIdentify } from "./forward-identify.ts";
import { forwardScan } from "./forward-scan.ts";
import { forwardHistogram } from "./forward-histogram.ts";
import { pokeContainer } from "./scan-warm.ts";
import { SCAN_PRIMARY_SHARD_NAME, scanShardNameForRequest } from "./scan-shard.ts";
import { triggerSignatureRefresh } from "./sig-refresh.ts";

// The scan worker's runtime bindings. Stateless: no D1, R2, or Queues.
// The only binding is the scan Container Durable Object (Container-backed, sqlite-class).
// SCAN_BUILD_DEPLOY_HOOK_URL is an optional secret — absent until production wiring; when set it
// is a Cloudflare Workers deploy hook URL that triggers a container rebuild to refresh signatures.
export type Bindings = {
  // The malware-scan Container (Container-backed Durable Object). Named in wrangler.jsonc's
  // durable_objects.bindings and migrations. The ScanContainer class must be exported here so
  // the runtime can instantiate the class named in the binding.
  SCAN_CONTAINER: DurableObjectNamespace<import("./scan-container.ts").ScanContainer>;
  // Deploy hook URL for the daily container-image rebuild (ClamAV signature refresh). Optional:
  // no rebuild is triggered when unset, and the deploy gate does NOT require it.
  SCAN_BUILD_DEPLOY_HOOK_URL?: string;
};

// The scan Container class must be re-exported from the worker's main entrypoint so the
// Cloudflare runtime can instantiate the class named in wrangler.jsonc's durable_objects binding.
export { ScanContainer } from "./scan-container.ts";

// The daily signature-refresh cron (0 7 * * *) triggers a deploy hook rebuild so the container
// image (and therefore ClamAV signatures) is refreshed daily.
const SIG_REFRESH_CRON = "0 7 * * *";

// The scan-container warm-poke cron (*/20 * * * *) hits /ready inside the container's 30-minute
// sleepAfter to keep the primary shard — and clamd's resident signature DB — alive between scans. One
// shard only: warming all of them would bill every instance's memory continuously for a fleet that
// scales to zero on its own, so the other shards cold-start under real load and stay warm while it
// lasts. The trigger is currently OFF in wrangler.jsonc (no scan traffic pre-onboarding — see the cron
// comment there); this handler stays wired so re-arming it at first-firm onboarding is a one-line add.
const SCAN_WARM_CRON = "*/20 * * * *";

export default {
  // The /scan proxy: receives the streamed file body + query string from the app worker (via service
  // binding), forwards it to the scan Container, and returns the JSON RawScanResult verbatim.
  // No authentication is performed here — the service binding provides the trust boundary
  // (only the app worker can reach this worker; it is not reachable from the public internet).
  // Which container instance serves the request is decided by scan-shard.ts: a scan spreads over the
  // shards so concurrent scans run in parallel instead of queueing behind one instance, while the two
  // instance-agnostic reads stay on the warm primary shard.
  async fetch(request: Request, env: Bindings): Promise<Response> {
    // The build-identity read the app worker's aggregate version endpoint probes over this binding.
    if (isVersionRequest(request)) return versionResponse();
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/scan") {
      return forwardScan(request, getContainer(env.SCAN_CONTAINER, scanShardNameForRequest(url)));
    }
    if (request.method === "GET" && url.pathname === "/rules/score-histogram") {
      return forwardHistogram(getContainer(env.SCAN_CONTAINER, SCAN_PRIMARY_SHARD_NAME));
    }
    if (request.method === "POST" && url.pathname === "/identify") {
      return forwardIdentify(request, getContainer(env.SCAN_CONTAINER, SCAN_PRIMARY_SHARD_NAME));
    }
    return new Response("Not Found", { status: 404 });
  },

  scheduled(controller: ScheduledController, env: Bindings, executionContext: ExecutionContext) {
    if (controller.cron === SIG_REFRESH_CRON) {
      // May be bound from the account's Secrets Store (SECRETS_STORE_SCAN_BUILD_DEPLOY_HOOK_URL).
      executionContext.waitUntil(
        resolveStoredSecrets(env, ["SCAN_BUILD_DEPLOY_HOOK_URL"]).then((resolved) =>
          triggerSignatureRefresh(resolved.SCAN_BUILD_DEPLOY_HOOK_URL),
        ),
      );
    } else if (controller.cron === SCAN_WARM_CRON) {
      executionContext.waitUntil(
        pokeContainer(getContainer(env.SCAN_CONTAINER, SCAN_PRIMARY_SHARD_NAME)),
      );
    }
  },
} satisfies ExportedHandler<Bindings>;

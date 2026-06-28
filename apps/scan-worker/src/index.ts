import { getContainer } from "@cloudflare/containers";
import { forwardIdentify } from "./forward-identify.ts";
import { forwardScan } from "./forward-scan.ts";
import { pokeContainer } from "./scan-warm.ts";
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
// sleepAfter to keep one instance — and clamd's resident signature DB — alive between scans.
const SCAN_WARM_CRON = "*/20 * * * *";

export default {
  // The /scan proxy: receives the streamed file body + query string from the app worker (via service
  // binding), forwards it to the scan Container, and returns the JSON RawScanResult verbatim.
  // No authentication is performed here — the service binding provides the trust boundary
  // (only the app worker can reach this worker; it is not reachable from the public internet).
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/scan") {
      return forwardScan(request, getContainer(env.SCAN_CONTAINER, "scan"));
    }
    if (request.method === "POST" && url.pathname === "/identify") {
      return forwardIdentify(request, getContainer(env.SCAN_CONTAINER, "scan"));
    }
    return new Response("Not Found", { status: 404 });
  },

  scheduled(controller: ScheduledController, env: Bindings, executionContext: ExecutionContext) {
    if (controller.cron === SIG_REFRESH_CRON) {
      executionContext.waitUntil(triggerSignatureRefresh(env.SCAN_BUILD_DEPLOY_HOOK_URL));
    } else if (controller.cron === SCAN_WARM_CRON) {
      executionContext.waitUntil(pokeContainer(getContainer(env.SCAN_CONTAINER, "scan")));
    }
  },
} satisfies ExportedHandler<Bindings>;

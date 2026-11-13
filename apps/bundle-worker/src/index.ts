import { getContainer } from "@cloudflare/containers";
import { isVersionRequest, versionResponse } from "@magna-carta/build-identity/version-route";
import { resolveStoredSecrets } from "@magna-carta/worker-secrets/stored-secrets";
import { BundleContainer } from "./bundle-container.ts";
import { forwardBuild } from "./forward-build.ts";
import { handleBundleR2 } from "./outbound-r2.ts";
import { runSelfTest, selfTestAuthorized } from "./self-test.ts";

// The bundle worker's runtime bindings. It owns the BundleContainer Durable Object and the R2
// bucket the container reads source files from and writes assembled archives to.
export type Bindings = {
  // The bundle Container Durable Object (Container-backed, sqlite-class). Named in wrangler.jsonc's
  // durable_objects.bindings and migrations. BundleContainer must be re-exported from this entrypoint
  // so the runtime can instantiate the class named in the binding.
  BUNDLE_CONTAINER: DurableObjectNamespace<BundleContainer>;
  // The R2 bucket storing source files (at their ingest keys) and receiving assembled archives.
  // The container accesses R2 via the outbound handler below — never via real internet egress.
  R2: R2Bucket;
  // Optional secret that gates the post-deploy self-test (POST /self-test). Unset on every environment
  // by default → the route 404s. Set it (and present it as the x-self-test-key header) to run the test
  // against a live deploy. Set via `wrangler secret put BUNDLE_SELF_TEST_KEY`, never as a plaintext var.
  BUNDLE_SELF_TEST_KEY?: string;
};

// The BundleContainer class must be re-exported from the worker's main entrypoint so the
// Cloudflare runtime can instantiate the class named in wrangler.jsonc's durable_objects binding.
export { BundleContainer } from "./bundle-container.ts";

// Outbound host handler: when the container issues any HTTP request to the hostname "bundle-r2",
// this worker intercepts it and calls handleBundleR2, routing the request to the R2 binding.
// The handler signature is (request, env, ctx) where env is the worker's Bindings at deploy time;
// env is cast here because the static setter's generic defaults to Cloudflare.Env.
BundleContainer.outboundByHost = {
  "bundle-r2": (request: Request, env: Cloudflare.Env): Promise<Response> =>
    handleBundleR2(request, (env as unknown as Bindings).R2),
};

// The warm-poke cron (*/8 * * * *) hits /ready inside the container's 10-minute sleepAfter
// window to keep one instance alive between build requests.
const BUNDLE_WARM_CRON = "*/8 * * * *";

export default {
  // The /build proxy: receives the manifest POST from the app worker (via service binding) and
  // forwards it to the bundle Container, returning the BuildResponse JSON (or a streamed archive
  // for ?stream=1). No authentication is performed here — the service binding is the trust boundary
  // (only the app worker can reach this worker; it is not reachable from the public internet).
  async fetch(request: Request, env: Bindings): Promise<Response> {
    // The build-identity read the app worker's aggregate version endpoint probes over this binding.
    if (isVersionRequest(request)) return versionResponse();
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/build") {
      return forwardBuild(request, getContainer(env.BUNDLE_CONTAINER, "bundle"));
    }
    // The guarded post-deploy self-test. 404 (indistinguishable from no route) unless the secret is set
    // AND the request presents it, so this is safe to ship on every environment, including production.
    if (request.method === "POST" && url.pathname === "/self-test") {
      if (
        !(await selfTestAuthorized(
          // May be bound from the account's Secrets Store (SECRETS_STORE_BUNDLE_SELF_TEST_KEY).
          (await resolveStoredSecrets(env, ["BUNDLE_SELF_TEST_KEY"])).BUNDLE_SELF_TEST_KEY,
          request.headers.get("x-self-test-key"),
        ))
      ) {
        return new Response("Not Found", { status: 404 });
      }
      // A dedicated container instance, isolated from the "bundle" instance that serves live firm builds,
      // so a self-test never contends with (or is degraded by) customer work.
      const report = await runSelfTest(getContainer(env.BUNDLE_CONTAINER, "selftest"), env.R2);
      return Response.json(report, { status: report.ok ? 200 : 500 });
    }
    return new Response("Not Found", { status: 404 });
  },

  scheduled(controller: ScheduledController, env: Bindings, executionContext: ExecutionContext) {
    if (controller.cron === BUNDLE_WARM_CRON) {
      executionContext.waitUntil(
        getContainer(env.BUNDLE_CONTAINER, "bundle").fetch(new Request("http://bundle/ready")),
      );
    }
  },
} satisfies ExportedHandler<Bindings>;

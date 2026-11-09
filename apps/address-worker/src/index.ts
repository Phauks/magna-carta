import { getContainer } from "@cloudflare/containers";
import { isVersionRequest, versionResponse } from "@magna-carta/build-identity/version-route";
import {
  ADDRESS_BUILD_INSTANCE_NAME,
  ADDRESS_INDEX_INSTANCE_NAME,
  forwardQueryOperation,
  pokeContainer,
  queryOperationOf,
} from "./forward-query.ts";
import { ADDRESS_POINTER_KEY, refreshAddressIndex } from "./refresh-decision.ts";

// The dedicated address-autocomplete worker. It owns the address engine's two Container classes and
// the R2 bucket its index lives in, and is reached only over a service binding from the app worker.
// The index is public reference data — it belongs to no firm — which is why the bucket is bound here
// rather than reached through the app worker (wrangler.jsonc says so beside the binding).
export type Bindings = {
  // The query instance (Container-backed Durable Object). Named in wrangler.jsonc's
  // durable_objects.bindings and migrations; the class is re-exported below so the runtime can
  // instantiate it.
  ADDRESS_INDEX_CONTAINER: DurableObjectNamespace<
    import("./address-index-container.ts").AddressIndexContainer
  >;
  // The build instance, same image, larger, awake only during a build.
  ADDRESS_BUILD_CONTAINER: DurableObjectNamespace<
    import("./address-build-container.ts").AddressBuildContainer
  >;
  // The address index: the pointer, each build's partitions, and each build's attribution manifest.
  // The engine reaches it only through the intercepted object host (src/object-host.ts).
  ADDRESS_INDEX: R2Bucket;
};

// The container classes must be re-exported from the worker's entrypoint so the Cloudflare runtime can
// instantiate the classes named in wrangler.jsonc's durable_objects bindings.
export { AddressIndexContainer } from "./address-index-container.ts";
export { AddressBuildContainer } from "./address-build-container.ts";

// Required by @cloudflare/containers: the runtime resolves the containers' outbound-interception proxy
// via `ctx.exports.ContainerProxy`, so a worker whose containers use `outboundByHost` MUST re-export
// it. Without it, starting a container throws "ctx.exports.ContainerProxy is undefined". It is a
// WorkerEntrypoint, not a Durable Object — no wrangler binding or migration is needed.
export { ContainerProxy } from "@cloudflare/containers";

// The daily refresh check. MUST match the one entry in wrangler.jsonc's triggers.crons.
export const ADDRESS_REFRESH_CRON = "17 7 * * *";

export default {
  // The query proxy: one of the two lookup operations from the app worker, forwarded verbatim to the
  // one query instance. No authentication here — the service binding is the trust boundary (this
  // worker has no public route), and an unknown path stops here rather than reaching the engine.
  async fetch(request: Request, env: Bindings): Promise<Response> {
    // The build-identity read the app worker's aggregate version endpoint probes over this binding.
    if (isVersionRequest(request)) return versionResponse();
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/ready") {
      const ready = await pokeContainer(
        getContainer(env.ADDRESS_INDEX_CONTAINER, ADDRESS_INDEX_INSTANCE_NAME),
      );
      return new Response(null, { status: ready ? 204 : 503 });
    }
    if (request.method !== "POST") return new Response("Not Found", { status: 404 });
    const operation = queryOperationOf(url.pathname);
    if (operation === null) return new Response("Not Found", { status: 404 });
    return forwardQueryOperation(
      request,
      operation,
      getContainer(env.ADDRESS_INDEX_CONTAINER, ADDRESS_INDEX_INSTANCE_NAME),
    );
  },

  scheduled(controller: ScheduledController, env: Bindings, executionContext: ExecutionContext) {
    if (controller.cron !== ADDRESS_REFRESH_CRON) return;
    executionContext.waitUntil(
      refreshAddressIndex({
        readPointer: async () => {
          const pointer = await env.ADDRESS_INDEX.get(ADDRESS_POINTER_KEY);
          return pointer === null ? null : pointer.text();
        },
        buildContainer: getContainer(env.ADDRESS_BUILD_CONTAINER, ADDRESS_BUILD_INSTANCE_NAME),
        now: controller.scheduledTime,
      }),
    );
  },
} satisfies ExportedHandler<Bindings>;

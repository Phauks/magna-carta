import { getContainer } from "@cloudflare/containers";
import { isVersionRequest, versionResponse } from "@magna-carta/build-identity/version-route";
import { type EngineTarget, engineTargetFor } from "./engine-dispatch.ts";
import { forwardConvert } from "./forward-convert.ts";

// The convert worker's runtime bindings. Stateless: no D1, R2, or Queues. The only bindings are the
// engine Container Durable Objects. Reached only via a service binding from the app worker — no
// public routes, so the service binding is the trust boundary.
export type Bindings = {
  // The pure-Rust raster engine Container (Container-backed Durable Object). Named in
  // wrangler.jsonc's durable_objects.bindings + migrations; the class is re-exported below so the
  // runtime can instantiate it.
  RASTER_ENGINE: DurableObjectNamespace<
    import("./raster-engine-container.ts").RasterEngineContainer
  >;
  // The LibreOffice office-conversion engine Container, registered the same way.
  LIBREOFFICE_ENGINE: DurableObjectNamespace<
    import("./libreoffice-engine-container.ts").LibreOfficeEngineContainer
  >;
  // The pure-Rust audio/video transcode engine Container, registered the same way.
  TRANSCODE_ENGINE: DurableObjectNamespace<
    import("./transcode-engine-container.ts").TranscodeEngineContainer
  >;
};

export { RasterEngineContainer } from "./raster-engine-container.ts";
export { LibreOfficeEngineContainer } from "./libreoffice-engine-container.ts";
export { TranscodeEngineContainer } from "./transcode-engine-container.ts";

// Which binding runs each target. A target with no binding yet is a 503 rather than a crash: the
// convert worker can be deployed before every Container it knows about has been created, and a
// missing namespace must not take down the engines that ARE bound.
function namespaceFor(
  environment: Bindings,
  target: EngineTarget,
): DurableObjectNamespace<never> | undefined {
  // A record rather than a switch, so adding an EngineTarget without giving it a binding is a
  // type error here rather than a runtime 503 nobody notices until a conversion fails.
  const namespaces: Record<EngineTarget, DurableObjectNamespace<never> | undefined> = {
    raster: environment.RASTER_ENGINE as unknown as DurableObjectNamespace<never>,
    libreoffice: environment.LIBREOFFICE_ENGINE as unknown as DurableObjectNamespace<never>,
    transcode: environment.TRANSCODE_ENGINE as unknown as DurableObjectNamespace<never>,
  };
  return namespaces[target];
}

// No warm cron: the engine Containers scale to zero after their sleepAfter, so they bill only while
// a conversion is actually running. Conversions are bursty/on-demand, so the cold-start on the first
// request after an idle period is the right trade against paying for an always-on instance. (Warming
// on demand — booting when a job is enqueued — is the lever to add if cold-start latency ever bites;
// it bites harder for the LibreOffice engine, whose boot is twenty to thirty seconds rather than
// one, which is why that container's sleepAfter is the longer of the two.)
export default {
  // POST /convert — receives the streamed source body + engine-id/format/recipe headers from the app
  // worker (via service binding), dispatches by x-engine-id to the engine Container, and returns its
  // bytes verbatim. No auth: the service binding is the trust boundary (not reachable from the
  // public internet). An engine id with no Container here is 501 — the app worker's resolver keeps
  // unbuilt engines deferred, so this is a guard, not a working path.
  async fetch(request: Request, env: Bindings): Promise<Response> {
    // The build-identity read the app worker's aggregate version endpoint probes over this binding.
    if (isVersionRequest(request)) return versionResponse();
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/convert") {
      const target = engineTargetFor(request.headers.get("x-engine-id"));
      if (target === undefined) return new Response("unknown engine", { status: 501 });
      const namespace = namespaceFor(env, target);
      if (namespace === undefined) return new Response("engine unbound", { status: 503 });
      return forwardConvert(request, getContainer(namespace, target));
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Bindings>;

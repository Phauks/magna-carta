import { getContainer } from "@cloudflare/containers";
import { isVersionRequest, versionResponse } from "@magna-carta/build-identity/version-route";
import { forwardOcr } from "./forward.ts";

// The OCR worker's runtime bindings. Stateless: no D1, R2, or Queues. The only binding is the engine
// Container Durable Object. Reached only via a service binding from the app worker — no public routes,
// so the service binding is the trust boundary.
export type Bindings = {
  OCR_ENGINE: DurableObjectNamespace<import("./ocr-engine-container.ts").OcrEngineContainer>;
};

export { OcrEngineContainer } from "./ocr-engine-container.ts";

export default {
  // POST /ocr and POST /ocr/searchable — receive the streamed document body from the app worker (via
  // service binding) and forward it to the engine Container, returning its response verbatim: recognized
  // facts as JSON for /ocr, a searchable PDF for /ocr/searchable. Both share one container instance. No
  // auth: the service binding is the trust boundary (not reachable from the public internet).
  async fetch(request: Request, env: Bindings): Promise<Response> {
    // The build-identity read the app worker's aggregate version endpoint probes over this binding.
    if (isVersionRequest(request)) return versionResponse();
    const url = new URL(request.url);
    if (
      request.method === "POST" &&
      (url.pathname === "/ocr" || url.pathname === "/ocr/searchable")
    ) {
      return forwardOcr(request, getContainer(env.OCR_ENGINE, "ocr"), url.pathname);
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Bindings>;

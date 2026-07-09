import { getContainer } from "@cloudflare/containers";
import { forwardOcr } from "./forward.ts";

// The OCR worker's runtime bindings. Stateless: no D1, R2, or Queues. The only binding is the engine
// Container Durable Object. Reached only via a service binding from the app worker — no public routes,
// so the service binding is the trust boundary.
export type Bindings = {
  OCR_ENGINE: DurableObjectNamespace<
    import("./ocr-engine-container.ts").OcrEngineContainer
  >;
};

export { OcrEngineContainer } from "./ocr-engine-container.ts";

export default {
  // POST /ocr — receives the streamed document body from the app worker (via service binding) and
  // forwards it to the engine Container, returning its JSON response verbatim. No auth: the service
  // binding is the trust boundary (not reachable from the public internet).
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/ocr") {
      return forwardOcr(request, getContainer(env.OCR_ENGINE, "ocr"));
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Bindings>;

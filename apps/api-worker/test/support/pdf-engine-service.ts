import { handlePdfServiceRequest } from "@magna-carta/pdf/service";
import pdfWasmModule from "@magna-carta/pdf/src/pkg/pdf_core_bg.wasm";

// The real PDF engine, standing in for the sign worker, in this process.
//
// The engine runs in a dedicated worker (apps/sign-worker) that the local pool cannot start — the
// vitest.config.ts stub bound as SIGN_SERVICE answers only the seal path. So the suites that need a
// real PDF operation bind this instead: the SAME handler the sign worker serves, over the SAME engine,
// reached through the same adapter. Nothing here re-implements the wire, which is the point — a stub
// that answered the endpoints its own way would let the two sides drift and no test would notice.
export function pdfEngineService(): Pick<Fetcher, "fetch"> {
  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input as string, init);
      const response = await handlePdfServiceRequest(request, pdfWasmModule);
      return response ?? new Response("not found", { status: 404 });
    },
  } as Pick<Fetcher, "fetch">;
}

/**
 * A SIGN_SERVICE that is bound and will not answer — the third state, where a caller must never read a
 * 5xx as a verdict about the document.
 */
export function unreachablePdfEngineService(): Pick<Fetcher, "fetch"> {
  return {
    fetch: async () => new Response("engine down", { status: 503 }),
  } as Pick<Fetcher, "fetch">;
}

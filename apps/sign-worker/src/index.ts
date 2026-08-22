import { handlePdfServiceRequest } from "@magna-carta/pdf/service";
import pdfWasmModule from "@magna-carta/pdf/src/pkg/pdf_core_bg.wasm";
import { decodeSealRequest, encodeSealResponse } from "@magna-carta/signing";

import { resolvePlatformIdentity, type SignWorkerEnv } from "./platform-identity.ts";
import { performSeal } from "./seal-service.ts";

// Wrangler bundles the `.wasm` import as a WebAssembly.Module (typed by src/wasm-modules.d.ts).
const pdfWasm = pdfWasmModule as unknown as WebAssembly.Module;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// The sign worker's surface, reached over the SIGN_SERVICE binding from the app worker. No public
// routes, no auth of its own — the app worker's chokepoint has already authorized the caller before it
// forwards here.
//
//   POST /seal   — apply the platform seal. The response is the SealPort wire shape.
//   POST /pdf/*  — the raw PDF engine (read a form, scrub one, fill one, read a text layer), served by
//                  @magna-carta/pdf/service.
//
// The two share a worker because they share the ENGINE: this worker already bundles the pinned
// WebAssembly, and the alternative was every caller bundling it too, which is what makes a worker's
// build need the toolchain that produces it. Nothing about the PDF surface is signing-specific and
// nothing on it decides anything about a document — it fills what it is told to fill.
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    const pdfResponse = await handlePdfServiceRequest(request, pdfWasm);
    if (pdfResponse !== undefined) return pdfResponse;

    if (request.method !== "POST" || url.pathname !== "/seal") {
      return json({ error: "not-found" }, 404);
    }

    const identity = await resolvePlatformIdentity(env);
    if (identity === null) {
      // Deferred activation: the platform-seal secrets are not set yet.
      return json({ error: "seal-not-configured" }, 503);
    }

    let sealRequest;
    try {
      sealRequest = decodeSealRequest(await request.text());
    } catch {
      return json({ error: "bad-request" }, 400);
    }

    try {
      const response = await performSeal(sealRequest, identity, pdfWasm);
      return new Response(encodeSealResponse(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch {
      // A malformed PDF, an over-capacity CMS, or a request with no signers. The detail is withheld
      // (redact-by-default) — the app worker surfaces a standard Problem to the client.
      return json({ error: "seal-failed" }, 422);
    }
  },
} satisfies ExportedHandler<SignWorkerEnv>;

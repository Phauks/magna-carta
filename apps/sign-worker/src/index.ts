import { isVersionRequest, versionResponse } from "@magna-carta/build-identity/version-route";
import composeWasmModule from "@magna-carta/pdf-compose/src/pkg/pdf_compose_core_bg.wasm";
import pdfWasmModule from "@magna-carta/pdf/src/pkg/pdf_core_bg.wasm";
import { decodeSealRequest, encodeSealResponse } from "@magna-carta/signing";
import { resolveStoredSecrets } from "@magna-carta/worker-secrets/stored-secrets";

import { resolvePlatformIdentity, type SignWorkerEnv } from "./platform-identity.ts";
import { performSeal } from "./seal-service.ts";

// Wrangler bundles each `.wasm` import as a WebAssembly.Module (typed by src/wasm-modules.d.ts).
const engines = {
  pdf: pdfWasmModule,
  compose: composeWasmModule,
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// The sign worker's only surface: POST /seal, reached over the SIGN_SERVICE binding from the app
// worker. No public routes, no auth of its own — the app worker's chokepoint has already authorized
// the caller before it forwards here. The response is the SealPort wire shape.
export default {
  async fetch(request, env): Promise<Response> {
    // The build-identity read the app worker's aggregate version endpoint probes over this binding.
    if (isVersionRequest(request)) return versionResponse();
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/seal") {
      return json({ error: "not-found" }, 404);
    }

    // The seal key and certificate may be bound from the account's Secrets Store
    // (SECRETS_STORE_PLATFORM_SEAL_KEY / SECRETS_STORE_PLATFORM_SEAL_CERT) or set on this Worker.
    const identity = await resolvePlatformIdentity(
      await resolveStoredSecrets(env, ["PLATFORM_SEAL_KEY", "PLATFORM_SEAL_CERT"]),
    );
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
      const response = await performSeal(
        sealRequest,
        identity,
        engines,
        env.CERTIFICATE_SUPPORT_EMAIL,
      );
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

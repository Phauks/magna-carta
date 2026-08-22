import { DEFAULT_CAPTURE_ROOT_DOMAIN } from "@magna-carta/email-filing/capture-address";
import { MAX_CAPTURED_MESSAGE_BYTES } from "@magna-carta/email-filing/message-format";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import emailWasmModule from "@magna-carta/email/src/pkg/email_core_bg.wasm";
import { routeEngineRequest } from "./parse-service.ts";
import { resolveCaptureRouting, type FirmResolver } from "./routing.ts";

// The Cloudflare Email Worker forward/CC capture entrance. Cloudflare Email Routing delivers a forwarded
// or CC'd message to `email()`; this worker resolves the destination to a firm, stages the raw MIME to
// that firm's R2, and enqueues the same emails-capture job the authenticated API entrance uses — both
// converge on one capture pipeline and one record. It holds no per-firm database handle: firm
// resolution is a control-plane query, and the capture token is resolved to a matter later, in the
// consumer. DNS for the capture zone (the `in.magnacarta.esq` subdomain and one DMARC) is a deploy-time
// step documented in the operations runbook, not code.
//
// It is also the home of the PARSE ENGINE (parse-service.ts) — the WebAssembly build that reads a
// message and materialises one of its parts. Mail's entrance is where the thing that reads mail
// belongs, and putting it here is what lets the app worker call it over a service binding instead
// of carrying a second copy of the build in its own deploy. The engine has no public route; the
// binding is the only way in.

// Email Routing caps a message near ~25–40 MiB; over the shared capture ceiling the message is not
// staged (the add-in path handles larger messages), and the sender is told rather than the message
// being silently dropped. The ceiling is shared with the authenticated API entrance so the two doors
// cannot disagree about what "too large to file" means.
const OVERSIZE_CEILING_BYTES = MAX_CAPTURED_MESSAGE_BYTES;

// Wrangler bundles the .wasm import as a WebAssembly.Module — typed by the ambient declaration in
// wasm-modules.d.ts and handed to the parse engine so it initialises from the compiled module
// rather than attempting a network fetch at runtime. Cast through unknown because the ambient
// declaration must satisfy the compiler in all contexts, not just this assignment.
//
// The import lives HERE, in the composition root, and not in parse-service.ts: a bare .wasm import
// is a bundler feature that Vite's node pool refuses, so a module that names it cannot be loaded by
// its own unit tests. See the note on EngineWasmInput.
const emailWasm = emailWasmModule as unknown as WebAssembly.Module;

// The emails-capture job shape — matches @magna-carta/api-worker's capture consumer (the queue is the
// contract boundary; the JSON message is the shared shape).
interface EmailsCaptureMessage {
  readonly firmId: string;
  readonly bucketName: string | null;
  readonly stagedR2Key: string;
  readonly capturedVia: "forward" | "api" | "addin";
  readonly matterId: string | null;
  readonly captureToken: string | null;
  readonly linkedBy: string | null;
  readonly acceptOnCapture: boolean;
  readonly jobId: string;
}

export interface Bindings {
  DB_CONTROL: D1Database;
  R2: R2Bucket;
  EMAILS_CAPTURE: Queue<EmailsCaptureMessage>;
  CAPTURE_ROOT_DOMAIN?: string;
}

// Resolve a capture token to its firm via the control-plane token->firm routing index. One JOIN to the
// firm row carries the bucket the raw MIME stages into, so a routable token costs a single read. A token
// that was never minted, or whose route has been revoked (`active` = 0), does not route.
function makeFirmResolver(env: Bindings): FirmResolver {
  return async (token) => {
    const row = await env.DB_CONTROL.prepare(
      "SELECT f.id AS firm_id, f.bucket_name AS bucket_name " +
        "FROM email_capture_route r JOIN firm f ON f.id = r.firm_id " +
        "WHERE r.token = ?1 AND r.active = 1",
    )
      .bind(token)
      .first<{ firm_id: string; bucket_name: string | null }>();
    return row === null ? null : { firmId: row.firm_id, bucketName: row.bucket_name };
  };
}

export default {
  // The parse engine's service-binding surface: POST /parse, POST /extract-part?index=N, GET /ready.
  // Unreachable from the public internet — this worker declares no routes and no workers.dev
  // subdomain, so the app worker's binding is the only caller.
  fetch(request: Request): Promise<Response> {
    return routeEngineRequest(request, emailWasm);
  },

  async email(message: ForwardableEmailMessage, env: Bindings): Promise<void> {
    const rootDomain = env.CAPTURE_ROOT_DOMAIN ?? DEFAULT_CAPTURE_ROOT_DOMAIN;
    const routing = await resolveCaptureRouting(message.to, rootDomain, makeFirmResolver(env));
    if (routing === null) {
      // Not a capture address for this zone, or an unknown firm — bounce so the sender is told.
      message.setReject("This address does not accept mail.");
      return;
    }

    if (message.rawSize > OVERSIZE_CEILING_BYTES) {
      // Not silently dropped: the sender is told the message is too large for the forward path.
      message.setReject(
        "Message exceeds the capture size ceiling; file it from the add-in instead.",
      );
      return;
    }

    const jobId = crypto.randomUUID();
    const stagedR2Key = `emails/staging/${jobId}`;
    // Mail arriving on a forward address has not been parsed, let alone filed: it may end up on a
    // matter, on several, or on none. Staged mail therefore carries its class and no matter.
    await env.R2.put(stagedR2Key, message.raw, {
      customMetadata: firmScopedObjectDimensions("email-staging"),
    });

    const job: EmailsCaptureMessage = {
      firmId: routing.firmId,
      bucketName: routing.bucketName,
      stagedR2Key,
      capturedVia: "forward",
      matterId: null,
      captureToken: routing.captureToken,
      linkedBy: null,
      // The forward/CC entrance always lands staged; staff confirm onto the matter.
      acceptOnCapture: false,
      jobId,
    };
    await env.EMAILS_CAPTURE.send(job);
  },
} satisfies ExportedHandler<Bindings>;

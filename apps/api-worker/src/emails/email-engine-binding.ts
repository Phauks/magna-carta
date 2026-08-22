import type { Bindings } from "../app.ts";
import { containerEmailAdapter } from "./container-email-adapter.ts";
import { engineUnavailablePort, type EmailEnginePort } from "./email-engine-port.ts";

// Resolve the active email parse engine. The engine lives in the standalone email worker
// (magna-carta-email), which is already the inbound mail entrance and now also owns the email-core
// WebAssembly build; it is reached over the EMAIL_SERVICE binding and selected here when the
// binding is present.
//
// ABSENT IS THE EXPECTED STATE TODAY, not a theoretical one: magna-carta-email is not connected in
// Cloudflare, so this returns the no-engine port in production until an operator adds the service
// binding — see docs/conventions/operations.md. That is exactly why the absent case is honest
// rather than degraded: the inspector route answers 503, and the capture consumer records an
// engine-unavailable outcome and acks instead of retrying mail that nothing can read yet.
export function resolveEmailEnginePort(env: Bindings): EmailEnginePort {
  return env.EMAIL_SERVICE !== undefined
    ? containerEmailAdapter(env.EMAIL_SERVICE)
    : engineUnavailablePort;
}

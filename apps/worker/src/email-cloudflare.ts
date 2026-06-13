// The Cloudflare Email Service adapter (slice 0·6 spec §5; ADR-0074) — implements the slice 0·4
// sendEmail port over the native `send_email` binding (env.SEND_EMAIL.send({...}); public beta,
// verified against developers.cloudflare.com/email-service/api/send-emails/workers-api at build).
// No API keys: same-vendor custody, binding-not-secrets. Every send logs email.sent (message class +
// outcome — NEVER body content; the allowlist event has no body slot). A send failure logs the
// failure outcome and RETHROWS: silent email loss is the one unacceptable outcome — the caller
// (password-reset, invite) decides its own recovery (a fresh link), as it already does today.
import { emailSent } from "@magna-carta/telemetry/events";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { SendEmail } from "./email-port.ts";

// Minimal structural type for the send_email binding (the beta's simplified send object). Defined
// locally so the worker need not depend on a beta type that may not yet be in @cloudflare/workers-
// types; the real binding is structurally compatible.
export interface CloudflareEmailBinding {
  send(message: {
    to: string;
    from: string;
    subject: string;
    text?: string;
    html?: string;
  }): Promise<unknown>;
}

export function createCloudflareEmailAdapter(
  binding: CloudflareEmailBinding,
  from: string,
  logger: Logger,
): SendEmail {
  return async (message) => {
    const messageClass = message.messageClass ?? "unspecified";
    const context = () => ({ correlationId: newCorrelationId(), now: new Date().toISOString() });
    try {
      await binding.send({ to: message.to, from, subject: message.subject, text: message.text });
    } catch (caught) {
      logger.log(emailSent(context(), { messageClass, outcome: "failed" }));
      throw caught;
    }
    logger.log(emailSent(context(), { messageClass, outcome: "sent" }));
  };
}

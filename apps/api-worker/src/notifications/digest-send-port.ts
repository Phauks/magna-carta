import type { Logger } from "@magna-carta/telemetry/logger";
import { createCloudflareEmailAdapter } from "../email-cloudflare.ts";
import type { SendEmail } from "../email-port.ts";
import type { Bindings } from "../bindings.ts";

// THE DIGEST'S SEND SEAM, and why it does NOT reuse `emailAdapterForEnv`.
//
// That resolver falls back to the dev logging adapter when the Cloudflare Email Service binding is
// absent, which is exactly right for a password reset: a developer needs the link in their terminal,
// and the alternative is a sign-in flow that cannot be exercised locally. It is exactly wrong here.
// A summary resolved through that fallback would return successfully having written nothing to
// anybody, and the run would then record a `sent` delivery row and advance the member's watermark —
// a durable claim that a mail was delivered, made about a mail that was printed to a log. The
// member never hears about those notifications again, and nothing anywhere says why.
//
// So this resolver answers with an honest third state instead, the same shape the malware-scan
// engine, the conversion engines, and the human-verification verifier each answer with when their
// credential is absent: not a throw at construction (which would take the whole cron pass down in
// every environment that has not provisioned mail), and not a silent success, but a typed reason the
// caller counts and reports. Activation steps live in `docs/deploy-queue.md`.

export const DIGEST_UNAVAILABLE_REASONS = Object.freeze([
  // No Cloudflare Email Service binding on this deployment.
  "send-binding-not-configured",
  // Bound, but no verified sending address to send FROM.
  "sender-address-not-configured",
  // No public origin to build the one link in the mail against. A summary whose link goes nowhere is
  // worse than no summary: it says a member has work waiting and gives them no way to reach it.
  "app-base-url-not-configured",
] as const);
export type DigestUnavailableReason = (typeof DIGEST_UNAVAILABLE_REASONS)[number];

export type NotificationDigestSendPort =
  | { readonly status: "configured"; readonly send: SendEmail; readonly appBaseUrl: string }
  | { readonly status: "unavailable"; readonly reason: DigestUnavailableReason };

// The message class the send port tags this traffic with. A non-content label the `email.sent`
// telemetry event records beside the outcome; the port has no slot for a body, which is the
// redaction property this subsystem wanted and did not have to build.
export const DIGEST_MESSAGE_CLASS = "notification-digest";

// The logger is an argument rather than derived here: the cron pass already builds one per pass with
// its own correlation id, and a second one would put this seam's `email.sent` events on a different
// thread from the pass that caused them.
export function resolveNotificationDigestSendPort(
  env: Bindings,
  logger: Logger,
): NotificationDigestSendPort {
  if (env.SEND_EMAIL === undefined) {
    return { status: "unavailable", reason: "send-binding-not-configured" };
  }
  if (env.EMAIL_FROM === undefined || env.EMAIL_FROM === "") {
    return { status: "unavailable", reason: "sender-address-not-configured" };
  }
  if (env.APP_BASE_URL === undefined || env.APP_BASE_URL === "") {
    return { status: "unavailable", reason: "app-base-url-not-configured" };
  }
  return {
    status: "configured",
    send: createCloudflareEmailAdapter(env.SEND_EMAIL, env.EMAIL_FROM, logger),
    appBaseUrl: env.APP_BASE_URL,
  };
}

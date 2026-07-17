import { resolveCaptureRouting, type FirmResolver } from "./routing.ts";

// The Cloudflare Email Worker forward/CC capture entrance. Cloudflare Email Routing delivers a forwarded
// or CC'd message to `email()`; this worker resolves the destination to a firm, stages the raw MIME to
// that firm's R2, and enqueues the same emails-capture job the authenticated API entrance uses — both
// converge on one capture pipeline and one record. It holds no per-firm database handle: firm
// resolution is a control-plane query, and the capture token is resolved to a matter later, in the
// consumer. DNS for the capture zone (the `in.magnacarta.esq` subdomain and one DMARC) is a deploy-time
// step documented in the operations runbook, not code.

// Email Routing caps a message near ~25–40 MiB; over this ceiling the message is not staged (the
// add-in path handles larger messages), and the sender is told rather than the message being silently
// dropped.
const OVERSIZE_CEILING_BYTES = 40 * 1024 * 1024;

const DEFAULT_CAPTURE_ROOT_DOMAIN = "in.magnacarta.esq";

// The emails-capture job shape — matches @magna-carta/worker's capture consumer (the queue is the
// contract boundary; the JSON message is the shared shape).
interface EmailsCaptureMessage {
  readonly firmId: string;
  readonly bucketName: string | null;
  readonly stagedR2Key: string;
  readonly capturedVia: "forward" | "api";
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

// Resolve a firm subdomain to its control-plane firm row. The subdomain is the firm id — a trusted
// control-plane fact once it matches a real firm; an address for an unknown firm does not route.
function makeFirmResolver(env: Bindings): FirmResolver {
  return async (firmSubdomain) => {
    const firm = await env.DB_CONTROL.prepare("SELECT id, bucket_name FROM firm WHERE id = ?1")
      .bind(firmSubdomain)
      .first<{ id: string; bucket_name: string | null }>();
    return firm === null ? null : { firmId: firm.id, bucketName: firm.bucket_name };
  };
}

export default {
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
    await env.R2.put(stagedR2Key, message.raw);

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

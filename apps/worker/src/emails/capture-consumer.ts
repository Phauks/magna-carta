import { ensureReady, parseMessage } from "@magna-carta/email";
import emailWasmModule from "@magna-carta/email/src/pkg/email_core_bg.wasm";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  findByDedupKey,
  findCaptureAddressByToken,
  findThreadIdsByMessageIds,
  insertEmailMatterLinkStatement,
  insertEmailMessageStatement,
  insertEmailParticipantStatement,
  insertEmailThreadStatement,
  touchEmailMessageStatement,
} from "@magna-carta/data-access/email-filing-statements";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  captureEmail,
  type CapturePorts,
  type CaptureWritePlan,
} from "@magna-carta/email-filing/capture";
import { findEntitiesByEmailAddress } from "@magna-carta/directory/contact-email";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  EmailMessageId,
  EmailThreadId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../app.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { extractAndFileAttachments } from "./attachment-extraction.ts";
import { raiseEmailFiledNotification } from "@magna-carta/email-filing/seams";

const emailWasm = emailWasmModule as unknown as WebAssembly.Module;

// The capture-address token store lives per-firm; this consumer is the one convergence point both
// entrances (the forward/CC Email Worker and the authenticated file-to-matter API) enqueue into. The
// entrance stages the raw MIME to R2 and posts this pointer; the heavy work — parse, hash, dedup,
// thread-link, attachment extraction — runs here, off the request hot path.
export interface EmailsCaptureMessage {
  readonly firmId: string;
  readonly bucketName: string | null;
  readonly stagedR2Key: string; // where the entrance staged the raw MIME
  readonly capturedVia: "forward" | "api";
  readonly matterId: string | null; // a candidate matter already resolved by the entrance (the API path)
  // The forward/CC token, when the entrance could not resolve a matter itself (the Email Worker has no
  // per-firm database handle). The consumer resolves it against the firm's capture-address store.
  readonly captureToken: string | null;
  readonly linkedBy: string | null;
  readonly acceptOnCapture: boolean;
  readonly jobId: string; // idempotency key: capture:<jobId>
}

// Process one capture job. Acks (returns) on every terminal outcome; THROWS only on a transient
// condition (the staged object not yet readable) so the queue retries and, at max attempts,
// dead-letters — mirroring the files-ingest consumer.
export async function handleCaptureMessage(
  env: Bindings,
  message: EmailsCaptureMessage,
  logger: Logger = createWorkersLogger(env.TELEMETRY),
  correlationId: string = newCorrelationId(),
): Promise<void> {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, message.firmId);

  const staged = await env.R2.get(message.stagedR2Key);
  if (staged === null) {
    // Not yet readable — a transient window between the entrance's PUT and this delivery. Retry.
    throw new Error(`emails-capture: staged object not readable: ${message.stagedR2Key}`);
  }
  const bytes = new Uint8Array(await staged.arrayBuffer());

  // Resolve the forward/CC token to a candidate matter here, where the firm database handle exists. A
  // per-matter token proposes its matter; a firm catch-all (or an unknown token) lands unrouted — the
  // message is captured to the firm with no matter link, for staff to route.
  let candidateMatterId = message.matterId;
  if (candidateMatterId === null && message.captureToken !== null) {
    const resolution = await findCaptureAddressByToken(firmDatabase, message.captureToken);
    candidateMatterId = resolution?.matterId ?? null;
  }

  const now = (): string => new Date().toISOString();

  const ports: CapturePorts = {
    parse: async (input) => {
      await ensureReady(emailWasm);
      return parseMessage(input);
    },
    persistOriginal: async (input) => {
      const digest = await crypto.subtle.digest("SHA-256", input);
      const contentSha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      // Content-addressed key: re-capturing the same bytes overwrites the identical object, so the
      // verbatim-original write is idempotent at the blob layer.
      const originalR2Key = `emails/${contentSha256}/original`;
      await env.R2.put(originalR2Key, input);
      return { originalR2Key, contentSha256 };
    },
    findByDedupKey: (key) => findByDedupKey(firmDatabase, key),
    findThreadIdsByMessageIds: (values) => findThreadIdsByMessageIds(firmDatabase, values),
    resolveDirectoryEntities: async (addresses) => {
      const resolved = new Map<string, string>();
      for (const address of addresses) {
        const matches = await findEntitiesByEmailAddress(firmDatabase, address);
        const first = matches[0];
        if (first !== undefined) resolved.set(address, first.entityId);
      }
      return resolved;
    },
    newEmailMessageId: () => newIdentifier("emailMessage"),
    newEmailThreadId: () => newIdentifier("emailThread"),
    newEmailParticipantId: () => newIdentifier("emailParticipant"),
    newEmailMatterLinkId: () => newIdentifier("emailMatterLink"),
    now,
    writeCapture: async (plan: CaptureWritePlan) => {
      const timestamp = now();
      const statements: SqlStatement[] = [];
      if (plan.thread !== null) {
        statements.push(
          insertEmailThreadStatement(
            firmDatabase,
            {
              id: plan.thread.id as EmailThreadId,
              subjectNormalized: plan.thread.subjectNormalized,
              firstSeenAt: plan.thread.firstSeenAt,
            },
            timestamp,
          ),
        );
      }
      if (plan.message !== null) {
        statements.push(insertEmailMessageStatement(firmDatabase, plan.message, timestamp));
        for (const participant of plan.participants) {
          statements.push(insertEmailParticipantStatement(firmDatabase, participant, timestamp));
        }
      }
      if (plan.touchMessageId !== null) {
        statements.push(
          touchEmailMessageStatement(
            firmDatabase,
            plan.touchMessageId as EmailMessageId,
            timestamp,
          ),
        );
      }
      if (plan.link !== null) {
        statements.push(insertEmailMatterLinkStatement(firmDatabase, plan.link, timestamp));
      }
      // One atomic batch: the capture writes + the idempotency record, keyed on the capture job id.
      // A redelivery replays without re-writing; a concurrent same-message capture that loses the
      // dedup_key race rolls back wholesale and re-runs, converging on the one record.
      const outcome = await runIdempotentEffect({
        database: firmDatabase,
        key: `capture:${message.jobId}`,
        fingerprint: message.jobId,
        effect: async () => ({
          write: { statements, outboxMessages: [] },
          responseCode: 200,
          responseBody: null,
        }),
      });
      if (outcome.kind === "fingerprint-mismatch") {
        throw new Error(
          `emails-capture: idempotency fingerprint mismatch for job ${message.jobId}`,
        );
      }
    },
  };

  let result;
  try {
    result = await captureEmail(
      {
        bytes,
        firmId: message.firmId,
        capturedVia: message.capturedVia,
        matterId: candidateMatterId === null ? null : (candidateMatterId as MatterId),
        linkedBy: message.linkedBy === null ? null : (message.linkedBy as UserId),
        acceptOnCapture: message.acceptOnCapture,
      },
      ports,
    );
  } catch (caught) {
    logOperationFailed(logger, "emails.capture", caught, correlationId);
    throw caught; // transient/unknown → retry; a poison message dead-letters at max attempts
  }

  // Extract real attachments into the File Manager (self-guards on existing rows so a redelivery or a
  // second filer never double-files). Bytes ride the existing ingest/quarantine chokepoint.
  await extractAndFileAttachments(env, firmDatabase, {
    emailMessageId: result.emailMessageId,
    matterId: candidateMatterId === null ? null : (candidateMatterId as MatterId),
    bucketName: message.bucketName,
    parsed: result.parsed,
    rawBytes: bytes,
    uploadedBy: message.linkedBy === null ? null : (message.linkedBy as UserId),
    correlationId,
    logger,
  });

  // "email filed to matter" is raised off the hot path, carrying a deep link and never body content.
  // A no-op until the Notifications subsystem ships; the raise site is placed now.
  if (result.linkState === "filed" && candidateMatterId !== null) {
    raiseEmailFiledNotification({
      firmId: message.firmId,
      matterId: candidateMatterId,
      emailMessageId: result.emailMessageId,
    });
  }

  // The staged pointer is transient — the verbatim original now lives under its content-addressed key.
  await env.R2.delete(message.stagedR2Key);
}

// The emails-capture queue consumer: one job per message. Ack on success, retry on throw.
export async function emailsCaptureQueue(
  batch: MessageBatch<EmailsCaptureMessage>,
  env: Bindings,
): Promise<void> {
  const logger = createWorkersLogger(env.TELEMETRY);
  for (const message of batch.messages) {
    try {
      await handleCaptureMessage(env, message.body, logger);
      message.ack();
    } catch {
      message.retry();
    }
  }
}

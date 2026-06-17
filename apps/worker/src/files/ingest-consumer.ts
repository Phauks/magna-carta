import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  commitVersion,
  loadPendingVersionForIngest,
  quarantineVersion,
} from "@magna-carta/file-manager/file-service";
import { runIngest } from "@magna-carta/file-manager/ingest-core";
import { readInspectableSizeCap, readUploadPolicy } from "@magna-carta/file-manager/upload-policy";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../app.ts";
import { resolveFirmDatabase } from "../firm-binding-resolver.ts";
import { resolveScanPort } from "./scan-port-binding.ts";

// The files-ingest queue consumer: one R2 object-create event drives the single-read ingest pipeline
// (gates + streaming SHA-256 + scan port) to a clean commit or a quarantine. A thin shell around the
// pure runIngest (ingest-core.ts) plus the file-manager commit/quarantine effects.
//
// IDEMPOTENCY has two layers. The cheap common-case guard is by version status, read FIRST: only a
// still-`pending` version is processed, so a redelivered event (queue at-least-once) finds the
// now-clean/quarantined version absent and no-ops. The correctness backstop for the CONCURRENT window
// — two deliveries that both read pending before either commits — is a per-version idempotency record
// committed in the SAME atomic batch as the commit/quarantine writes (key `ingest:<versionId>`): the
// loser hits the UNIQUE(key) insert, its whole batch rolls back, and the meter increment / current-
// version bump / audit row / outbox message all apply exactly once.
//
// PER-FIRM BUCKET SEAM: the object is read from the single bound R2 bucket (env.R2). In production a
// firm's bytes live in its own bucket; binding that per-firm bucket to the Worker is the same
// config-commit + deploy step per-firm D1 bindings need (firm-binding-resolver.ts), and the read
// resolves through the same seam when it lands. Locally and in the dev pool every firm shares env.R2.

// The R2 event-notification message shape this consumer needs (the documented payload — full message
// also carries account/eventTime; only these fields are read).
export interface R2EventMessage {
  readonly bucket: string;
  readonly object: { readonly key: string; readonly size: number };
  readonly action: string;
  readonly eventTime?: string;
}

// Process one event. Returns (acks) for every terminal outcome — commit, quarantine, or a no-op
// (unknown bucket / unbound firm / no pending version). THROWS only on a transient condition (the
// object not yet readable) so the queue retries and, at max attempts, dead-letters.
export async function handleIngestMessage(env: Bindings, message: R2EventMessage): Promise<void> {
  // bucket → firm (the control-plane registry). An unknown bucket or a firm this deployment cannot
  // reach is acked: there is no work this Worker can do, and retrying cannot make the binding exist.
  const firm = await env.DB_CONTROL.prepare(
    "SELECT database_identifier FROM firm WHERE bucket_name = ?1",
  )
    .bind(message.bucket)
    .first<{ database_identifier: string | null }>();
  if (firm === null || firm.database_identifier === null) return;
  const firmDatabase = resolveFirmDatabase(env, firm.database_identifier);
  if (firmDatabase === null) return;

  // Status-first: only a pending version is ingested (the replay guard).
  const pending = await loadPendingVersionForIngest(firmDatabase, message.object.key);
  if (pending === undefined) return;

  const object = await env.R2.get(message.object.key);
  if (object === null) {
    // The notification beat the object's durability (or it was reaped) — transient; retry.
    throw new Error(`R2 object not readable for a pending version: ${message.object.key}`);
  }

  const [policy, inspectableSizeCap] = await Promise.all([
    readUploadPolicy(firmDatabase),
    readInspectableSizeCap(firmDatabase),
  ]);
  const outcome = await runIngest({
    objectBody: object.body,
    objectSize: object.size,
    version: {
      declaredSize: pending.declaredSize,
      declaredContentType: pending.declaredContentType,
      r2Key: pending.r2Key,
      fileName: pending.name,
    },
    policy,
    scanPort: resolveScanPort(env),
    inspectableSizeCap,
  });

  const now = () => new Date().toISOString();
  const options = { clock: { now }, actorUserId: null };
  // The commit/quarantine writes ride a per-version idempotency record in one atomic batch: a second
  // concurrent delivery that also read pending loses the UNIQUE(key) race and its whole batch rolls
  // back, so the meter/current-version/audit/outbox effects apply exactly once. The fingerprint is the
  // version id — the only delivery for this key is this version's ingest, and it carries no request
  // payload to vary on. The response is trivial (the consumer returns nothing to a caller).
  const fingerprint = pending.id;
  await runIdempotentEffect({
    database: firmDatabase,
    key: `ingest:${pending.id}`,
    fingerprint,
    now,
    effect: async () => {
      if (outcome.kind === "commit") {
        const result = await commitVersion(
          firmDatabase,
          {
            versionId: pending.id,
            sizeBytes: outcome.sizeBytes,
            sniffedContentType: outcome.sniffedContentType,
            contentSha256: outcome.contentSha256,
            scanVerdict: outcome.scanVerdict,
            scanEngineVersion: outcome.scanEngineVersion,
            scanDetail: outcome.scanDetail,
            now: now(),
          },
          options,
        );
        return {
          write: result.effect,
          responseCode: 200,
          responseBody: JSON.stringify({ versionId: pending.id }),
        };
      }
      const result = await quarantineVersion(
        firmDatabase,
        { versionId: pending.id, reason: outcome.reason, scanDetail: outcome.scanDetail },
        options,
      );
      return {
        write: result.effect,
        responseCode: 200,
        responseBody: JSON.stringify({ versionId: pending.id }),
      };
    },
  });
}

// The queue() handler: one message at a time, ack on success, retry on a transient throw. A retried
// message is redelivered (at-least-once) and dead-lettered once it exhausts its attempts — the
// standard relay retry discipline. Per-message ack so a single bad message never re-runs an
// already-committed sibling.
export async function ingestQueue(
  batch: MessageBatch<R2EventMessage>,
  env: Bindings,
): Promise<void> {
  // One logger per batch; a failed message routes through the one telemetry pipeline (golden rule 4
  // — the console ban is structural) and is retried, dead-lettering at max attempts.
  const logger = createWorkersLogger(env.TELEMETRY);
  for (const message of batch.messages) {
    try {
      await handleIngestMessage(env, message.body);
      message.ack();
    } catch (error) {
      logOperationFailed(logger, `queue:files-ingest:${message.id}`, error, newCorrelationId());
      message.retry();
    }
  }
}

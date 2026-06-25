import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  commitVersion,
  loadPendingVersionForIngest,
  quarantineVersion,
  recordRescanVerdict,
} from "@magna-carta/file-manager/file-service";
import { runIngest } from "@magna-carta/file-manager/ingest-core";
import { loadCommittedVersionByR2Key } from "@magna-carta/file-manager/queries";
import { lookupScanCache } from "@magna-carta/file-manager/scan-cache";
import type { MalwareScanPort, RawScanResult } from "@magna-carta/file-manager/scan-port";
import { computeVerdict, DEFAULT_SCAN_POLICY } from "@magna-carta/file-manager/verdict";
import {
  readInspectableSizeCap,
  readScanEngineVersion,
  readUploadPolicy,
} from "@magna-carta/file-manager/upload-policy";
import { ingestVerdict } from "@magna-carta/telemetry/events";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
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
export async function handleIngestMessage(
  env: Bindings,
  message: R2EventMessage,
  scanPort: MalwareScanPort = resolveScanPort(env),
  logger?: Logger,
  correlationId: string = newCorrelationId(),
): Promise<void> {
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
  if (pending === undefined) {
    // No pending version → this may be an access-triggered re-scan of an ALREADY-COMMITTED version
    // (the dispatch's second branch). It acks as a no-op unless it finds a committed version whose
    // recorded engine version is stale relative to the firm's current scan engine.
    await handleRescanMessage(env, message, firmDatabase, scanPort);
    return;
  }

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
    scanPort,
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
  const idempotentResult = await runIdempotentEffect({
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
            // Carry the raw scan result into the commit so a clean commit repopulates the content-dedup
            // cache atomically — the cache key derives from this result's engineVersion, the same source
            // as scanEngineVersion above, so the scan-once dedup is keyed by the engine that just ran.
            rawScanResult: outcome.rawScanResult,
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

  // One verdict event per terminal outcome — rates are observable without any file-identifying
  // field (structural redaction: the allowlist has no slot for id, name, key, or content).
  // Only the delivery that won the idempotency race emits the event: a replayed result means the
  // effect was already applied by a concurrent delivery, so the event was already emitted once.
  if (idempotentResult.kind === "executed") {
    logger?.log(
      ingestVerdict(
        { correlationId, now: new Date().toISOString() },
        outcome.kind === "commit"
          ? {
              outcome: "commit",
              scanVerdict: outcome.scanVerdict,
              scanDetail: outcome.scanDetail,
              quarantineReason: null,
            }
          : {
              outcome: "quarantine",
              scanVerdict: null,
              scanDetail: outcome.scanDetail,
              quarantineReason: outcome.reason,
            },
      ),
    );
  }
}

// The access-triggered re-scan path for an ALREADY-COMMITTED version (dispatched when a queued event
// has no pending version). Only a committed version whose recorded engine version is STALE relative to
// the firm's CURRENT engine is re-scanned; cache-first, so identical content already scanned under the
// current engine reuses the raw facts with no engine call. The verdict is computed app-side from those
// facts and stamped in place — no pointer move, and a flagged finding stays visible (informed access).
// NEVER-SILENT-CLEAN: a null current engine (unset setting) is a no-op (never fabricate a key); an
// `unscanned` verdict leaves the version's prior verdict untouched (never downgraded without a definitive
// scan), and a deployed engine reporting unavailable throws ScanFaultError → the queue retries. Idempotent
// on `rescan:<versionId>:<engineVersion>` so a redelivery under the same engine no-ops, while a later
// engine version legitimately re-scans.
async function handleRescanMessage(
  env: Bindings,
  message: R2EventMessage,
  firmDatabase: D1Database,
  scanPort: MalwareScanPort,
): Promise<void> {
  const committed = await loadCommittedVersionByR2Key(firmDatabase, message.object.key);
  if (committed === undefined) return; // not a committed version → nothing to re-scan
  if (committed.contentSha256 === null) return; // no content hash (legacy) → cannot dedup/cache; skip

  const currentEngineVersion = await readScanEngineVersion(firmDatabase);
  if (currentEngineVersion === null) return; // no current engine recorded yet → never fabricate a key
  if (committed.scanEngineVersion === currentEngineVersion) return; // already current → not stale

  const contentSha256 = committed.contentSha256;
  const now = () => new Date().toISOString();
  const options = { clock: { now }, actorUserId: null };

  await runIdempotentEffect({
    database: firmDatabase,
    key: `rescan:${committed.id}:${currentEngineVersion}`,
    fingerprint: `${committed.id}:${currentEngineVersion}`,
    now,
    effect: async () => {
      // Cache-first: identical content already scanned under THIS engine reuses the raw facts (no scan).
      let raw: RawScanResult;
      let fromCache: boolean;
      const cached = await lookupScanCache(firmDatabase, contentSha256, currentEngineVersion);
      if (cached !== undefined) {
        raw = cached;
        fromCache = true;
      } else {
        // Cache miss → scan the bytes. A not-yet-readable object is transient (throw → retry).
        const object = await env.R2.get(message.object.key);
        if (object === null) {
          throw new Error(`R2 object not readable for a re-scan: ${message.object.key}`);
        }
        raw = await scanPort.scan(object.body, {
          sizeBytes: object.size,
          sniffedContentType: null,
        });
        fromCache = false;
      }

      // Decide the verdict app-side from the raw facts. A deployed engine reporting unavailable throws
      // ScanFaultError, which propagates out of the effect → the queue retries; the version's prior
      // verdict is never touched on a fault.
      const fileVerdict = computeVerdict(raw, DEFAULT_SCAN_POLICY);

      // Only a DEFINITIVE verdict restamps the version. An `unscanned` result (encrypted / no-engine) is
      // not definitive — leave the version's prior verdict untouched (never downgrade without a real
      // scan). The idempotency record still lands, so a redelivery under this engine does not re-scan; a
      // future engine version will try again.
      if (fileVerdict.verdict === "unscanned") {
        return {
          write: { statements: [], outboxMessages: [] },
          responseCode: 200,
          responseBody: "{}",
        };
      }

      // A `flagged` verdict (clamd signature, a counting YARA match, or a structural heuristic) stamps as
      // `infected` so the already-committed version stays visible behind the download gate (informed
      // access); `clean` clears it. The reason text is the recorded signature/detail.
      const isClean = fileVerdict.verdict === "clean";
      const signature = isClean ? null : fileVerdict.reason;
      const rescan = recordRescanVerdict(
        firmDatabase,
        {
          fileId: committed.fileId,
          versionId: committed.id,
          scanVerdict: isClean ? "clean" : "infected",
          scanEngineVersion: currentEngineVersion,
          scanDetail: signature,
          signature,
          contentSha256,
          now: now(),
          // Populate the dedup cache only on a FRESH scan — a cache hit already has the row. The raw
          // result is a real-engine one here (a definitive verdict means the engine ran), so its
          // engineVersion is non-null and the cache write is sound.
          rawScanResult: fromCache ? null : raw,
        },
        options,
      );
      return {
        write: rescan.effect,
        responseCode: 200,
        responseBody: JSON.stringify({ versionId: committed.id }),
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
    const correlationId = newCorrelationId();
    try {
      await handleIngestMessage(env, message.body, undefined, logger, correlationId);
      message.ack();
    } catch (error) {
      logOperationFailed(logger, `queue:files-ingest:${message.id}`, error, correlationId);
      message.retry();
    }
  }
}

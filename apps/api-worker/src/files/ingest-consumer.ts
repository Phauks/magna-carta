import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  commitCheckinVersion,
  commitVersion,
  loadPendingVersionForIngest,
  quarantineCommittedVersion,
  quarantineVersion,
  recordRescanVerdict,
} from "@magna-carta/file-manager/file-service";
import { measureContent, runIngest } from "@magna-carta/file-manager/ingest-core";
import {
  loadCommittedVersionByR2Key,
  type CommittedVersionForRescan,
} from "@magna-carta/file-manager/queries";
import { lookupScanCache } from "@magna-carta/file-manager/scan-cache";
import type { MalwareScanPort, RawScanResult } from "@magna-carta/file-manager/scan-port";
import { computeVerdict, ScanFaultError, scanDetailFor } from "@magna-carta/file-manager/verdict";
import {
  readInspectableSizeCap,
  readScanEngineVersion,
  readUploadPolicy,
} from "@magna-carta/file-manager/upload-policy";
import {
  readFlaggedTreatment,
  readFirmScanPolicy,
} from "@magna-carta/file-manager/scan-policy-settings";
import { ingestVerdict } from "@magna-carta/telemetry/events";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../bindings.ts";
import { firmDatabaseFor, type ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { enqueueVersionForIndexing } from "../search/enqueue-index.ts";
import { resolveFirmBucket } from "./firm-bucket.ts";
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
// PER-FIRM BUCKET SEAM: the object is read through resolveFirmBucket (firm-bucket.ts) — the same
// resolver the upload routes presign against — so the bucket the bytes were written to and the
// bucket they are read back from can never be two different buckets. Today that resolves to the
// single bound binding for every firm; binding a firm's own bucket is a config-commit + deploy step
// the resolver absorbs without changing this consumer.
//
// CUSTODY: a verdict binds to BYTES, not to a key. The presigned PUT that delivered an upload stays
// valid for the rest of its TTL, so the same URL can overwrite the object minutes after this consumer
// committed the version clean — and the object-create event for that overwrite arrives here with the
// version no longer pending. Such an event is therefore treated as an overwrite signal: the stored
// bytes are re-measured against the hash recorded at commit, and a mismatch withdraws the version
// behind the status gate (handleCommittedObjectEvent below). A clean verdict is NEVER left standing
// over bytes it did not describe.

// The R2 event-notification message shape this consumer needs (the documented payload — full message
// also carries account/eventTime; only these fields are read).
export interface R2EventMessage {
  readonly bucket: string;
  readonly object: { readonly key: string; readonly size: number };
  readonly action: string;
  readonly eventTime?: string;
  // Set on a member's own re-scan request (FILE_RESCAN_ACTION): the audit id of the request, which
  // keys the re-scan so each request runs once and its result row can be paired with it.
  readonly requestId?: string;
}

// The action a member's "re-run the safety check" request enqueues. Unlike the access-triggered and
// per-matter re-scans, it is not gated on engine staleness and does not reuse the dedup cache: the
// member asked for the engine to look at these bytes again, so the engine looks at these bytes again.
export const FILE_RESCAN_ACTION = "FileRescan";

// The actions R2 reports when somebody WROTE bytes at a key — exactly the set the provisioner
// registers each firm bucket's object-create notification for (firm-resource-provider.ts). An event
// carrying one of these is a real write; every other action reaching this consumer is a message the
// platform enqueued itself (the access-triggered and per-matter re-scans), which moves no bytes.
// Registering a further action there means adding it here, or its writes go unverified.
const OBJECT_WRITE_ACTIONS: ReadonlySet<string> = new Set(["PutObject", "CompleteMultipartUpload"]);

// Process one event. Returns (acks) for every terminal outcome — commit, quarantine, or a no-op
// (unknown bucket / unbound firm / no pending version). THROWS only on a transient condition (the
// object not yet readable) so the queue retries and, at max attempts, dead-letters.
/**
 * Which queue a message arrived on, and therefore which scan instance it goes to. The interactive
 * lane sends NO shard key, so the scan worker routes it to the one shard the warm-poke keeps
 * resident (apps/scan-worker/src/scan-shard.ts) — a member is watching, and a cold shard is a cold
 * start they wait through. The bulk lane keeps the per-file key: there the fan-out over every
 * instance is the throughput, and a cold start amortises over a migration.
 */
export type IngestLane = "interactive" | "bulk";

function scanContentKeyFor(lane: IngestLane, key: string): string | undefined {
  return lane === "bulk" ? key : undefined;
}

export async function handleIngestMessage(
  env: Bindings,
  message: R2EventMessage,
  scanPort: MalwareScanPort = resolveScanPort(env),
  logger?: Logger,
  correlationId: string = newCorrelationId(),
  lane: IngestLane = "interactive",
): Promise<void> {
  // bucket → firm (the control-plane registry). An unknown bucket is acked: there is no work this
  // Worker can do, and retrying cannot make the firm exist. The firm's per-firm FirmDatabase Durable
  // Object is addressed by its firmId and self-migrates the per-firm lineage on first access.
  const firm = await env.DB_CONTROL.prepare("SELECT id FROM firm WHERE bucket_name = ?1")
    .bind(message.bucket)
    .first<{ id: string }>();
  if (firm === null) return;
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firm.id);
  // The event names the bucket the object was written to; resolving it here (rather than reaching
  // for a binding directly) is what keeps this read on the same bucket the presign side wrote to.
  const { bucket } = resolveFirmBucket(env, message.bucket);

  // Status-first: only a pending version is ingested (the replay guard).
  const pending = await loadPendingVersionForIngest(firmDatabase, message.object.key);
  if (pending === undefined) {
    // No pending version → the key belongs to an ALREADY-COMMITTED version (or to nothing at all).
    // Two things can bring an event here: somebody overwrote the committed object, or the platform
    // enqueued a re-scan of it. Both are handled below; neither ever leaves a stale clean verdict.
    await handleCommittedObjectEvent(
      message,
      firmDatabase,
      scanPort,
      bucket,
      logger,
      correlationId,
      lane,
    );
    return;
  }

  const object = await bucket.get(message.object.key);
  if (object === null) {
    // The notification beat the object's durability (or it was reaped) — transient; retry.
    throw new Error(`R2 object not readable for a pending version: ${message.object.key}`);
  }

  const [policy, inspectableSizeCap, scanPolicy, flaggedTreatment] = await Promise.all([
    readUploadPolicy(firmDatabase),
    readInspectableSizeCap(firmDatabase),
    readFirmScanPolicy(firmDatabase),
    readFlaggedTreatment(firmDatabase),
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
    scanPolicy,
    flaggedTreatment,
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
        const commitInput = {
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
        };
        // The return leg of an offline checkout (checkout_id set) reconciles against current —
        // fast-forward or a flagged conflicting copy. A plain upload commits straight through.
        const result =
          pending.checkoutId !== null
            ? await commitCheckinVersion(
                firmDatabase,
                { ...commitInput, checkoutId: pending.checkoutId },
                options,
              )
            : await commitVersion(firmDatabase, commitInput, options);
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
  // A version that just committed clean joins the matter's searchable corpus. Only the delivery that
  // won the idempotency race enqueues, for the same reason it is the only one that emits the verdict
  // event: the other delivery's effect was already applied by this one. Gated per firm and best-effort
  // — see enqueue-index.ts for why a failure here must not unwind an ingest that already succeeded.
  if (idempotentResult.kind === "executed" && outcome.kind === "commit") {
    try {
      await enqueueVersionForIndexing(env, firm.id, pending.id, firmDatabase);
    } catch (error) {
      logOperationFailed(
        logger ?? createWorkersLogger(env.TELEMETRY),
        `search-index-enqueue:${pending.id}`,
        error,
        correlationId,
      );
    }
  }

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

// The dispatch for an event whose key has no pending version. An unknown key acks as a no-op; a
// committed one takes the custody check first (an event from a real write means the object was
// written AGAIN, since the write that created it was consumed while the version was still pending),
// and only bytes that still match the committed hash go on to the staleness-driven re-scan.
async function handleCommittedObjectEvent(
  message: R2EventMessage,
  firmDatabase: ProxyBatchDatabase,
  scanPort: MalwareScanPort,
  bucket: R2Bucket,
  logger: Logger | undefined,
  correlationId: string,
  lane: IngestLane,
): Promise<void> {
  const committed = await loadCommittedVersionByR2Key(firmDatabase, message.object.key);
  if (committed === undefined) return; // not a committed version → nothing to verify or re-scan
  if (OBJECT_WRITE_ACTIONS.has(message.action)) {
    const withdrawn = await withdrawOnContentDrift(
      message,
      firmDatabase,
      scanPort,
      bucket,
      committed,
      logger,
      correlationId,
      lane,
    );
    if (withdrawn) return; // the version is quarantined — there is nothing left to re-scan in place
  }
  await rescanCommittedVersion(message, firmDatabase, scanPort, bucket, committed, lane);
}

// THE CUSTODY GATE. An object-create event for an already-committed version means the stored bytes
// were written after this consumer measured them, so the committed row's hash, size, sniffed type and
// scan verdict may all now describe content that no longer exists. Re-measure and compare against the
// recorded hash:
//
//   - Identical hash → the write landed the same bytes (a queue redelivery of the original create
//     event, or a client re-PUTting what it already sent). Nothing changed; the verdict still holds.
//   - Different hash → the bytes were swapped. The version is withdrawn behind the status gate and
//     the replacement bytes are scanned so the record says what arrived, never re-committed: a
//     committed version is immutable, and new content belongs to a new version.
//
// The comparison is the recorded SHA-256 rather than the ETag the event payload also reports. R2
// gives a multipart object an ETag that is a digest OF ITS PART DIGESTS with a part-count suffix, not
// a hash of the content — so an ETag comparison would be meaningless exactly where the large evidence
// files live, and would read a reassembly of identical bytes under a different part layout as a
// change. The SHA-256 this pipeline already computes is format-independent and is the fact the
// committed row actually asserts.
//
// Returns true when the version was withdrawn.
async function withdrawOnContentDrift(
  message: R2EventMessage,
  firmDatabase: ProxyBatchDatabase,
  scanPort: MalwareScanPort,
  bucket: R2Bucket,
  committed: CommittedVersionForRescan,
  logger: Logger | undefined,
  correlationId: string,
  lane: IngestLane,
): Promise<boolean> {
  const object = await bucket.get(message.object.key);
  if (object === null) {
    // The write's notification beat the object's durability — transient; retry rather than judge.
    throw new Error(
      `R2 object not readable for a committed-version overwrite check: ${message.object.key}`,
    );
  }
  const measured = await measureContent(object.body);
  if (committed.contentSha256 !== null && measured.contentSha256 === committed.contentSha256) {
    return false; // same bytes as the ones that were scanned — the committed verdict still describes them
  }

  // A committed version with no recorded hash cannot be verified at all. Fail closed: an unverifiable
  // version whose object was just rewritten is exactly the case this gate exists for, and every path
  // that commits a version records a hash, so this is a guard against rows no live code produces.
  const reason = committed.contentSha256 === null ? "content-unverifiable" : "content-drift";
  const scanDetail = await describeReplacementBytes(
    message,
    firmDatabase,
    scanPort,
    bucket,
    reason,
    logger,
    correlationId,
    lane,
  );

  const now = () => new Date().toISOString();
  // Keyed by the version AND the hash of what replaced its bytes, so a redelivery of the same
  // overwrite event no-ops while a second, different overwrite is judged on its own.
  await runIdempotentEffect({
    database: firmDatabase,
    key: `content-drift:${committed.id}:${measured.contentSha256}`,
    fingerprint: `${committed.id}:${measured.contentSha256}`,
    now,
    effect: () => {
      const withdrawal = quarantineCommittedVersion(
        firmDatabase,
        { fileId: committed.fileId, versionId: committed.id, reason, scanDetail },
        { clock: { now }, actorUserId: null },
      );
      return Promise.resolve({
        write: withdrawal.effect,
        responseCode: 200,
        responseBody: JSON.stringify({ versionId: committed.id }),
      });
    },
  });

  // The withdrawal is a terminal outcome, so it emits the same one verdict event a gate quarantine
  // does — rates stay observable, and the allowlist still has no slot for anything identifying.
  logger?.log(
    ingestVerdict(
      { correlationId, now: new Date().toISOString() },
      { outcome: "quarantine", scanVerdict: null, scanDetail, quarantineReason: reason },
    ),
  );
  return true;
}

// What replaced the committed bytes: scan them so the quarantined row records whether the swap
// carried malware or was merely different content. The scan is ENRICHMENT ONLY — the withdrawal
// happens either way. A scan that cannot run (no engine, an engine fault, a read that now fails) must
// never be a reason to leave compromised bytes servable, so every failure resolves to a detail string
// and is reported through the telemetry pipeline rather than thrown.
async function describeReplacementBytes(
  message: R2EventMessage,
  firmDatabase: ProxyBatchDatabase,
  scanPort: MalwareScanPort,
  bucket: R2Bucket,
  reason: string,
  logger: Logger | undefined,
  correlationId: string,
  lane: IngestLane,
): Promise<string> {
  try {
    const object = await bucket.get(message.object.key);
    if (object === null) return `${reason}: replacement bytes unreadable`;
    const scanPolicy = await readFirmScanPolicy(firmDatabase);
    const raw = await scanPort.scan(object.body, {
      sizeBytes: object.size,
      sniffedContentType: null,
      contentKey: scanContentKeyFor(lane, message.object.key),
    });
    const fileVerdict = computeVerdict(raw, scanPolicy);
    if (fileVerdict.verdict === "clean") return reason;
    return `${reason}: ${fileVerdict.reason}`;
  } catch (error) {
    if (logger !== undefined && !(error instanceof ScanFaultError)) {
      logOperationFailed(logger, `ingest:content-drift-rescan:${reason}`, error, correlationId);
    }
    return `${reason}: replacement bytes not scanned`;
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
async function rescanCommittedVersion(
  message: R2EventMessage,
  firmDatabase: ProxyBatchDatabase,
  scanPort: MalwareScanPort,
  // The firm's bucket, already resolved by the caller — the re-scan reads the very object the
  // ingest read would have.
  bucket: R2Bucket,
  // The committed version behind this key, loaded once by the dispatch above. Its bytes have already
  // passed the custody gate when the event came from a write, so re-scanning them re-judges exactly
  // the content the committed hash describes.
  committed: CommittedVersionForRescan,
  lane: IngestLane,
): Promise<void> {
  if (committed.contentSha256 === null) return; // no content hash (legacy) → cannot dedup/cache; skip

  const currentEngineVersion = await readScanEngineVersion(firmDatabase);
  if (currentEngineVersion === null) return; // no current engine recorded yet → never fabricate a key
  // A member's own request runs whether or not the verdict is current; the platform's re-scans run
  // only when the recorded engine is stale.
  const requested = message.action === FILE_RESCAN_ACTION && message.requestId !== undefined;
  if (!requested && committed.scanEngineVersion === currentEngineVersion) return; // already current

  // Resolve the firm's scan policy here (outside the idempotency effect) so the verdict computation
  // uses the firm's configured tier and threshold rather than the hardcoded default. The rescan does
  // NOT apply flaggedTreatment — the version is already committed; a re-flagged finding stays
  // committed and visible; the download gate (a later task) enforces treatment at access time.
  const firmScanPolicy = await readFirmScanPolicy(firmDatabase);

  const contentSha256 = committed.contentSha256;
  const now = () => new Date().toISOString();
  const options = { clock: { now }, actorUserId: null };

  // A request keys on its own id (each request runs once); the platform's re-scan keys on the engine
  // (once per version per engine).
  const scope = requested ? `${currentEngineVersion}:${message.requestId}` : currentEngineVersion;
  await runIdempotentEffect({
    database: firmDatabase,
    key: `rescan:${committed.id}:${scope}`,
    fingerprint: `${committed.id}:${scope}`,
    now,
    effect: async () => {
      // Cache-first: identical content already scanned under THIS engine reuses the raw facts (no scan).
      // A member's request skips the cache — the point of asking is a fresh look — and its fresh
      // result replaces the cached one.
      let raw: RawScanResult;
      let fromCache: boolean;
      const cached = requested
        ? undefined
        : await lookupScanCache(firmDatabase, contentSha256, currentEngineVersion);
      if (cached !== undefined) {
        raw = cached;
        fromCache = true;
      } else {
        // Cache miss → scan the bytes. A not-yet-readable object is transient (throw → retry).
        const object = await bucket.get(message.object.key);
        if (object === null) {
          throw new Error(`R2 object not readable for a re-scan: ${message.object.key}`);
        }
        raw = await scanPort.scan(object.body, {
          sizeBytes: object.size,
          sniffedContentType: null,
          // The lane decides the instance, as it did for the first scan of these bytes.
          contentKey: scanContentKeyFor(lane, message.object.key),
        });
        fromCache = false;
      }

      // Decide the verdict app-side from the raw facts using the firm's configured scan policy.
      // A deployed engine reporting unavailable throws ScanFaultError, which propagates out of the
      // effect → the queue retries; the version's prior verdict is never touched on a fault.
      const fileVerdict = computeVerdict(raw, firmScanPolicy);

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
      // `flagged` so the already-committed version stays visible behind the download gate (informed
      // access); `clean` clears it. The reason text is the recorded signature/detail.
      const isClean = fileVerdict.verdict === "clean";
      const signature = isClean ? null : fileVerdict.reason;
      const rescan = recordRescanVerdict(
        firmDatabase,
        {
          fileId: committed.fileId,
          versionId: committed.id,
          scanVerdict: isClean ? "clean" : "flagged",
          // Stamp the version with currentEngineVersion (the firm-setting staleness reference), NOT
          // raw.engineVersion (which keys the dedup cache below). These are equal in steady state; they
          // diverge only in the transient window where a newer engine is deployed but the firm setting
          // has not yet advanced. Stamping the staleness reference is deliberate: the staleness gate
          // above ("scanEngineVersion === currentEngineVersion → not stale") would otherwise re-trigger
          // a re-scan on every access until the setting catches up. The verdict itself is computed from
          // the real raw facts, so it is never wrong — only the recorded engine label trails by one
          // deploy window, and self-heals on the next ingest that advances the setting. Do not "fix"
          // this to raw.engineVersion without making the staleness gate engine-monotonic first.
          scanEngineVersion: currentEngineVersion,
          // The badge, not just the flagged reason. `signature` is null for a clean verdict, and
          // this statement sets the column unconditionally — so a version already badged
          // `active-content` had that badge erased the first time an engine-version bump re-scanned
          // it. Same function the ingest and template paths use, which is what makes it one home.
          scanDetail: scanDetailFor(fileVerdict),
          signature,
          contentSha256,
          now: now(),
          // Populate the dedup cache only on a FRESH scan — a cache hit already has the row. The raw
          // result is a real-engine one here (a definitive verdict means the engine ran), so its
          // engineVersion is non-null and the cache write is sound.
          rawScanResult: fromCache ? null : raw,
          ...(requested ? { requestId: message.requestId } : {}),
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
  const lane: IngestLane = batch.queue.endsWith("-bulk") ? "bulk" : "interactive";
  for (const message of batch.messages) {
    const correlationId = newCorrelationId();
    try {
      await handleIngestMessage(env, message.body, undefined, logger, correlationId, lane);
      message.ack();
    } catch (error) {
      logOperationFailed(logger, `queue:files-ingest:${message.id}`, error, correlationId);
      // Backed off, not immediate: the usual transient here is a scan engine still coming up — a
      // cold container, or one mid-deploy — which an immediate retry only meets sooner. Ten
      // seconds per attempt so far, capped at a minute, outlasts a cold start well inside the
      // queue's retry budget (wrangler.jsonc), where three immediate retries used to burn through
      // it and dead-letter a file the member was watching.
      message.retry({ delaySeconds: Math.min(60, 10 * Math.max(1, message.attempts)) });
    }
  }
}

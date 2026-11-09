import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { purgeExpiredIdempotencyRecordsStatement } from "@magna-carta/data-access/idempotency-statements";
import { incidentDescription } from "@magna-carta/data-access/protected-field-registry";
import { composeProtectedWrite } from "@magna-carta/data-access/protected-fields";
import {
  sweepOutbox,
  type OutboxRow,
  type OutboxSweepReport,
} from "@magna-carta/data-access/outbox-relay";
import { readUsageAnalyticsEnabled } from "@magna-carta/data-access/usage-consent-statements";
import {
  abandonVersionStatement,
  FILES_PREFIX,
  selectExpiredOpenSessionsStatement,
  selectStrandedPendingVersionsStatement,
  setUploadSessionStatusByIdStatement,
  STRANDED_PENDING_DEADLINE_MILLISECONDS,
} from "@magna-carta/file-manager/file-statements";
import {
  meterCorrectionStatements,
  normalizeR2StorageClass,
  reconciliationDiff,
  type ListedObject,
  type MeterRow,
} from "@magna-carta/file-manager/metering-statements";
import { listCleanVersionR2Keys } from "@magna-carta/file-manager/queries";
import {
  recordSweptUnreadStatement,
  retentionCutoff,
  retentionSweepDeleteStatements,
  retentionSweepSuppressionDeleteStatement,
  selectSweepableUnreadTallyStatement,
} from "@magna-carta/notifications/retention";
import {
  readNotificationDigestLocalHour,
  readNotificationRetentionDays,
  resolveEmailDetailLevel,
  resolveFirmDigestZone,
} from "@magna-carta/notifications/settings";
import {
  composeDigest,
  newNotificationDigestId,
  readDigestCandidates,
  readDigestWindow,
  settleDigestStatements,
} from "@magna-carta/notifications/digest";
import { renderNotificationDigest } from "@magna-carta/notifications/digest-render";
import {
  createNotificationPolicyReader,
  type NotificationPolicyReader,
} from "@magna-carta/notifications/preferences";
import {
  defaultEmailCadenceFor,
  DIGEST_WEEKLY_LOCAL_WEEKDAY,
  type NotificationDigestCadence,
  type NotificationSuppressedReason,
} from "@magna-carta/notifications/types";
import { sweepFirmComparisonNotifications } from "@magna-carta/notifications/sweep";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { zonedReading } from "@magna-carta/civil-time/time-zone";
import {
  DIGEST_MESSAGE_CLASS,
  resolveNotificationDigestSendPort,
  type NotificationDigestSendPort,
} from "../notifications/digest-send-port.ts";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import type {
  FileVersionId,
  FirmId,
  NotificationDigestId,
  UploadSessionId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  migrationArrivedOutOfOrder,
  outboxDeadLettered,
  outboxSwept,
} from "@magna-carta/telemetry/events";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import { d1MigrationTarget } from "@magna-carta/database/d1-migration-target";
import type { Bindings } from "../bindings.ts";
import { controlPlaneMigrations } from "../control-plane-migrations.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { presignerForEnv } from "../files/presigner-wiring.ts";
import { firmDatabaseFor, type ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { firmKeyProviderForEnv } from "../firm-key-provider-wiring.ts";
import { consumeFirmProvision } from "./firm-provision-consumer.ts";
import { consumeMemberProvision } from "./member-provision-consumer.ts";
import { runNameIndexBackfillPass } from "@magna-carta/directory/name-index-backfill";
import { drainRecheckLedger } from "./conflicts/recheck-run-consumer.ts";
import { runPeriodicRescan } from "../conflicts/periodic-rescan.ts";
import { buildAndStoreDerivedSnapshot } from "../status/derived-snapshot.ts";
import { maybeEmitCompleted } from "../usage/completed.ts";

// All background logging in this file goes through the slice 0·6 telemetry pipeline (golden rule 4 —
// the one logging path, the console ban makes it structural): a cron pass builds one Workers logger
// + correlation id and emits allowlist events, never console.*.

// Idempotency records are ephemeral dedup state with a ~24h TTL; the purge cutoff is
// everything older than this.
const IDEMPOTENCY_RECORD_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

// Control-plane outbox topics are consumed DIRECTLY in the sweep — no Queue hop:
// the consumers are local to this worker and idempotent, so a Queue round trip
// would only add latency and a second at-least-once layer. An unregistered topic throws, which
// the relay turns into attempts → dead-letter — a producer/consumer drift fails loud.
const CONTROL_PLANE_CONSUMERS: Readonly<
  Record<string, (env: Bindings, row: OutboxRow) => Promise<void>>
> = {
  "member.provision": consumeMemberProvision,
  // A confirmed self-serve registration becomes a firm here rather than in the request that
  // confirmed it — bucket creation, notification configuration and the key mint are external calls
  // against an account-wide budget, and the provisioner is already resume-safe, which is exactly
  // the contract an at-least-once consumer needs.
  "firm.provision": consumeFirmProvision,
};

// WHY THE CONTROL-PLANE SWEEP RE-READS ITS OWN TABLE, and the per-firm ones do not. These consumers
// run INSIDE the pass and commit back into the same outbox: activating a firm queues the
// member.provision row that mirrors its owner into the firm's own database, and a single-batch
// sweep reads the pending set before that row exists. The firm went active, the person was let as
// far as a workspace nothing had admitted them to, and the mirror waited for the next fire — the
// gap the joining screen's last step and the database-health panel's "Not in the database yet" both
// report. One more round carries it. The per-firm sweeps publish to a Queue instead, so nothing
// they dispatch can land back in the table they are reading, and they stay at one batch.
//
// Two is the deepest chain the map above can make (firm.provision -> member.provision, whose own
// message goes to the FIRM's outbox). This is the safety stop, not the terminator: the sweep ends
// the moment a round finds no row it has not already tried, so the extra headroom costs nothing
// today and a topic that grows the chain does not silently lose its tail.
const CONTROL_PLANE_SWEEP_ROUNDS = 4;

// A control-plane user whose firm database carries no member row — the reconciliation backstop's
// finding.
export interface UnprovisionedMember {
  readonly userId: string;
  readonly firmId: string;
}

export interface ScheduledSweepReport {
  readonly controlPlane: OutboxSweepReport;
  // Reachable active firms whose outbox sweep AND idempotency TTL purge BOTH succeeded this pass.
  readonly firmSweeps: number;
  readonly unprovisionedMembers: readonly UnprovisionedMember[];
  // The one-off protected-module backfills run this pass (idempotent; permanent no-ops once the
  // fleet is fully backfilled).
  readonly keyMint: FirmBackfillReport;
  readonly incidentEncrypt: FirmBackfillReport;
  readonly nameIndex: FirmBackfillReport;
}

// Dead-letter surfacing: ids + topic + attempts only — payloads are never logged (redaction; the
// allowlist event has no payload slot). The outboxId is opaque and the diagnostics agent
// investigates the parked row by it.
function logDeadLetter(
  logger: Logger,
  correlationId: string,
  scope: string,
): (row: OutboxRow) => Promise<void> {
  return (row) => {
    logger.log(
      outboxDeadLettered(
        { correlationId, now: new Date().toISOString() },
        { scope, outboxId: row.id, topic: row.topic, attempts: row.attempts + 1 },
      ),
    );
    return Promise.resolve();
  };
}

// An active firm this deployment can reach: addressed by firmId through its per-firm FirmDatabase
// Durable Object, self-migrating on first access. Every active firm is reachable by name.
// bucketName is the firm's R2 bucket (null until provisioning records it) — the stale-pending sweep
// needs it to abort a multipart upload at R2.
export interface ReachableActiveFirm {
  readonly firmId: string;
  readonly database: ProxyBatchDatabase;
  readonly bucketName: string | null;
}

// The ONE active-firm enumeration per cron pass — the per-firm sweep, the stale-pending sweep, and the
// reconciliation backstop all consume the same list. Every active firm is reachable by firmId through
// its FirmDatabase Durable Object, so no firm is ever skipped for an unreachable database.
export async function listReachableActiveFirms(env: Bindings): Promise<ReachableActiveFirm[]> {
  const firms = await env.DB_CONTROL.prepare(
    "SELECT id, bucket_name FROM firm WHERE status = 'active'",
  ).all<{ id: string; bucket_name: string | null }>();

  return firms.results.map((firm) => ({
    firmId: firm.id,
    database: firmDatabaseFor(env.FIRM_DATABASE, firm.id),
    bucketName: firm.bucket_name,
  }));
}

// The reconciliation backstop: control-plane users with no member row
// in their firm's per-firm database. Detection only — repair runs through the relay: a PENDING
// member.provision row is dispatched by the next sweep, and a DEAD-LETTERED one is revived by
// requeueDeadLetteredMessageStatement (the documented operator seam — see sweepOutbox); the
// backstop never writes a member row from here. Takes the pass's listReachableActiveFirms result,
// so unreachable firms are skipped the same way the sweep skips them.
//
// The control-plane users are read in ONE grouped query (not per firm — that was an N+1 across the
// fleet), bucketed by firm_id in JS; the per-firm member reads stay per firm (irreducible — each
// firm's members live in its own firmId-addressed FirmDatabase Durable Object).
//
// One sick firm DO must never abort the whole pass: every firm is addressable, so an unguarded read
// here would throw out of the entire cron pass — skipping the control-plane idempotency purge and
// both security backfills fleet-wide. The per-firm member read is quarantined the same way the
// outbox sweep quarantines a throwing firm (logged through the one pipeline, then `continue`). The
// logger + correlation id default to a fresh pair so a standalone caller (a test) needs neither; the
// scheduled pass passes its own so the failure correlates with the rest of the pass.
export async function findUnprovisionedMembers(
  env: Bindings,
  firms: readonly ReachableActiveFirm[],
  logger: Logger = createWorkersLogger(env.TELEMETRY),
  correlationId: string = newCorrelationId(),
): Promise<UnprovisionedMember[]> {
  const allUsers = await env.DB_CONTROL.prepare('SELECT id, firm_id FROM "user"').all<{
    id: string;
    firm_id: string;
  }>();
  const userIdsByFirm = new Map<string, string[]>();
  for (const user of allUsers.results) {
    const bucket = userIdsByFirm.get(user.firm_id);
    if (bucket === undefined) {
      userIdsByFirm.set(user.firm_id, [user.id]);
    } else {
      bucket.push(user.id);
    }
  }

  const unprovisioned: UnprovisionedMember[] = [];
  for (const firm of firms) {
    const firmUserIds = userIdsByFirm.get(firm.firmId);
    if (firmUserIds === undefined || firmUserIds.length === 0) continue;

    let members: { results: { user_id: string }[] };
    try {
      members = await firm.database.prepare("SELECT user_id FROM member").all<{
        user_id: string;
      }>();
    } catch (caught) {
      // This firm's database threw (a sick DO: migration failure, transient overload, eviction
      // mid-flight). Quarantine it the same way the per-firm outbox sweep does — log through the one
      // pipeline and skip — so one firm can never abort the reconciliation backstop or the security
      // backfills that run after it; the next Cron fire retries.
      logOperationFailed(
        logger,
        `cron:reconciliation-backstop:${firm.firmId}`,
        caught,
        correlationId,
      );
      continue;
    }
    const memberUserIds = new Set(members.results.map((row) => row.user_id));
    for (const userId of firmUserIds) {
      if (!memberUserIds.has(userId)) {
        unprovisioned.push({ userId, firmId: firm.firmId });
      }
    }
  }
  return unprovisioned;
}

// The Cron entry point: one pass =
//   1. control-plane outbox sweep — the consumer map applies member mirrors directly;
//   2. per-firm outbox sweep over active firms — rows publish to env.QUEUE, whose consumer routes
//      each message to the handler owning its topic — plus that firm's idempotency TTL purge;
//   3. control-plane idempotency TTL purge;
//   4. the reconciliation backstop — logged (ids only) when non-empty; the finding heals through
//      the relay (a fresh invite's row may appear for one pass mid-flight — the next pass clears it).
// Sweeps are at-least-once and every consumer dedups, so overlapping Cron fires are safe
// (sweepOutbox's status guards) — no run lock needed.
export async function runScheduledSweep(env: Bindings): Promise<ScheduledSweepReport> {
  // One logger + correlation id per cron pass: every event this pass emits shares the correlation id
  // (no request context here — the pass is the unit of work).
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();

  // The control plane has no provision-time migration gate (unlike per-firm databases, which migrate
  // when a firm is provisioned), so the scheduled pass is the single-flighted applier that brings
  // the control-plane schema to head. Idempotent: a no-op once at head. Error-isolated: a migration
  // failure is logged and the rest of the pass still runs.
  try {
    const report = await runPendingMigrations(
      d1MigrationTarget(env.DB_CONTROL),
      controlPlaneMigrations(),
    );
    // A migration that reached this database behind its own ledger head: two branches merged and
    // seated it behind one already applied here, so this database met the pair in a different order
    // than a fresh one will. It is applied and the schema is at head either way, so this is not a
    // failure — but it is the only moment the fact is visible, because the ledger it lands in is a
    // set of tags with no record of which arrived late.
    for (const tag of report.outOfOrderTags) {
      logger.log(
        migrationArrivedOutOfOrder(
          { correlationId, now: new Date().toISOString() },
          { database: "control-plane", tag, ledgerHead: report.ledgerHead },
        ),
      );
    }
  } catch (caught) {
    logOperationFailed(logger, "cron:control-plane-migrations", caught, correlationId);
  }

  const controlPlane = await sweepOutbox({
    database: env.DB_CONTROL,
    maxRounds: CONTROL_PLANE_SWEEP_ROUNDS,
    publish: async (row) => {
      const consume = CONTROL_PLANE_CONSUMERS[row.topic];
      if (consume === undefined) {
        throw new Error(`no consumer registered for control-plane outbox topic "${row.topic}"`);
      }
      await consume(env, row);
    },
    deadLetter: logDeadLetter(logger, correlationId, "control-plane"),
  });
  // A successful sweep is observable, not just its failures (outbox.swept, one per sweep).
  logger.log(
    outboxSwept(
      { correlationId, now: new Date().toISOString() },
      {
        database: "control-plane",
        dispatched: controlPlane.dispatched,
        failed: controlPlane.failed,
        deadLettered: controlPlane.deadLettered,
      },
    ),
  );

  const firms = await listReachableActiveFirms(env);
  const idempotencyCutoff = new Date(
    Date.now() - IDEMPOTENCY_RECORD_TTL_MILLISECONDS,
  ).toISOString();

  let firmSweeps = 0;
  for (const firm of firms) {
    try {
      const usageAnalyticsEnabled = await readUsageAnalyticsEnabled(firm.database);
      const firmReport = await sweepOutbox({
        database: firm.database,
        publish: async (row) => {
          // The Queue message mirrors the outbox row (consumers dedup on id, order by
          // (aggregateKey, seq)); the payload is already redacted canonical JSON.
          // firmId tags the originating tenant: per-firm messages cross the single SHARED env.QUEUE,
          // so the consumer resolves the firm from the message — it has no other handle on which
          // physical database the row came from. (Control-plane outbox topics are consumed DIRECTLY
          // in this worker, never over the queue, so they need no such tag.)
          await env.QUEUE.send({
            id: row.id,
            firmId: firm.firmId,
            topic: row.topic,
            payload: row.payload,
            aggregateKey: row.aggregate_key,
            seq: row.seq,
            // When the business write COMMITTED, carried through so a consumer that reports an
            // interval reports the firm's, not the queue's.
            causeOccurredAt: row.created_at,
          });
          await maybeEmitCompleted({
            logger,
            consented: usageAnalyticsEnabled,
            pepper: env.USAGE_ANALYTICS_PEPPER,
            correlationId,
            now: new Date().toISOString(),
            firmId: firm.firmId,
            topic: row.topic,
          });
        },
        deadLetter: logDeadLetter(logger, correlationId, `firm ${firm.firmId}`),
      });
      await purgeExpiredIdempotencyRecordsStatement(firm.database, idempotencyCutoff).run();
      await sweepStalePendingUploads(env, firm);
      const redriven = await redriveStrandedPendingVersions(env, firm);
      if (redriven > 0) {
        // A counter, not an event: the rate is the alertable signal (a persistently non-zero count
        // means ingest is failing for real, not that one message was slow), and the per-version detail
        // — keys, ids — has no place in a structured log.
        logger.count("ingest.stranded_pending_redriven", {}, redriven);
      }
      firmSweeps++;
      logger.log(
        outboxSwept(
          { correlationId, now: new Date().toISOString() },
          {
            database: firm.firmId,
            dispatched: firmReport.dispatched,
            failed: firmReport.failed,
            deadLettered: firmReport.deadLettered,
          },
        ),
      );
    } catch (caught) {
      // One firm's broken database must not starve the rest of the fleet; the failure is logged
      // through the one pipeline (firm handle in the operation label) and the next Cron fire retries.
      logOperationFailed(logger, `cron:per-firm-sweep:${firm.firmId}`, caught, correlationId);
    }
  }

  await purgeExpiredIdempotencyRecordsStatement(env.DB_CONTROL, idempotencyCutoff).run();

  const unprovisionedMembers = await findUnprovisionedMembers(env, firms, logger, correlationId);
  if (unprovisionedMembers.length > 0) {
    // The backstop finding is a self-healing operational signal (the relay clears it next pass), so
    // it rides a counter, not an event: the count is the alertable signal, and the per-user detail
    // (a usr_@firm_ list) stays out of the structured log. The report still carries the full list
    // for the caller.
    logger.count("reconciliation.unprovisioned", {}, unprovisionedMembers.length);
  }

  // The protected-module one-off backfills, run on the same pass that already enumerated the
  // reachable active firms: mint keys for firms provisioned before the mint step existed, then seal
  // any pre-slice plaintext incident descriptions. Both are idempotent and become permanent no-ops
  // once the fleet is fully backfilled. A backfill is its own try/catch per firm inside the helper,
  // so a single firm's failure never aborts the pass.
  const keyMint = await runProtectedKeyMintBackfill(env, logger, correlationId);
  const incidentEncrypt = await runIncidentDescriptionEncryptBackfill(
    env,
    firms,
    logger,
    correlationId,
  );

  const nameIndex = await runDirectoryNameIndexBackfill(firms, logger, correlationId);

  return { controlPlane, firmSweeps, unprovisionedMembers, keyMint, incidentEncrypt, nameIndex };
}

// `directory-name-index`: fill the two match keys on names written before the columns existed. Until
// a firm's corpus is swept, every one of those names is invisible to the match-key blocking channels
// its conflicts checks will nonetheless report as having run — which is the platform saying it looked
// somewhere it did not look, and the one thing this subsystem may never do.
//
// One BOUNDED pass per firm per day rather than one sweep that finishes, so a firm with a large
// Directory never puts an unbounded walk inside a scheduled invocation. It is resumable with no
// stored cursor because the selection predicate is the outstanding work itself, and it becomes a
// permanent no-op once the fleet is filled.
async function runDirectoryNameIndexBackfill(
  firms: readonly ReachableActiveFirm[],
  logger: Logger,
  correlationId: string,
): Promise<FirmBackfillReport> {
  return runFirmBackfill("directory-name-index", logger, correlationId, firms, async (firm) => {
    const pass = await runNameIndexBackfillPass(firm.database);
    return pass.matchKeysFilled;
  });
}

// THE CONFLICTS BACKSTOP, per firm: drain the re-check requests the queue did not, then enqueue the
// next slice of the scheduled re-scan if the firm's cadence says one is due.
//
// It rides the DAILY pass rather than the */5 sweep, deliberately, and the reason is which of the two
// a request can start. `scheduleRequestPathSweep` runs the whole */5 sweep on `waitUntil` after a
// provisioning route commits, purely to shorten a new member's permission latency; anything added to
// that sweep therefore executes on the tail of an HTTP request. Draining a re-check runs full
// conflicts checks and the scheduled re-scan writes across a caseload, and neither belongs there.
//
// Putting it daily costs nothing in the ordinary case, because the cron pass is NOT the primary path:
// a cause commits its outbox row, the */5 relay publishes it, and the queue consumers record and
// answer it within one relay cycle. What this pass catches is only what the queue structurally
// cannot — a fan-out larger than one cycle takes onto the queue, a message that dead-lettered, a
// producer nobody wired, a matter that predates a trigger. Each of those is invisible from inside the
// event path, and a procedure whose gaps are invisible is a procedure that fails silently.
//
// The drain comes first: answering what is already owed matters more than adding to the queue, and a
// firm that is falling behind must not have the scheduled re-scan pile on top of it. Isolated per
// firm, so one firm's broken database never starves the rest of the fleet.
export async function runConflictsRecheckSweep(env: Bindings): Promise<number> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const firms = await listReachableActiveFirms(env);
  let firmsSwept = 0;
  for (const firm of firms) {
    try {
      await drainRecheckLedger(env, firm.firmId, firm.database, logger);
      await runPeriodicRescan(firm.database, logger);
      firmsSwept++;
    } catch (caught) {
      logOperationFailed(logger, `cron:conflicts-recheck:${firm.firmId}`, caught, correlationId);
    }
  }
  return firmsSwept;
}

// The stale-pending upload sweep: an upload session left open past its expiry (the client started an
// upload and never completed it) is aborted at R2 and its pending version abandoned, reclaiming the
// reserved version slot. Run every */5 pass inside the per-firm loop. Each transition is guarded
// (session status = 'open', version status = 'pending'), so a redelivery/overlap is a no-op. Returns
// the count swept (for tests/observability).
export async function sweepStalePendingUploads(
  env: Bindings,
  firm: ReachableActiveFirm,
): Promise<number> {
  const now = () => new Date().toISOString();
  const { results } = await selectExpiredOpenSessionsStatement(firm.database, now()).all<{
    id: UploadSessionId;
    file_version_id: FileVersionId;
    mode: "put" | "multipart";
    r2_upload_id: string | null;
    r2_key: string;
  }>();
  if (results.length === 0) return 0;
  const presigner = presignerForEnv(env);
  for (const session of results) {
    // Abort the multipart upload at R2 first (idempotent; a 404 there is success), then commit the
    // status flip — a thrown abort leaves the session open so the next pass retries it.
    if (session.mode === "multipart" && session.r2_upload_id !== null && firm.bucketName !== null) {
      // Abort against the same bucket the session's parts were presigned into.
      const { bucketName } = resolveFirmBucket(env, firm.bucketName);
      await presigner.abortMultipartUpload(bucketName, session.r2_key, session.r2_upload_id);
    }
    await commitEffectBatch(
      firm.database,
      {
        statements: [
          setUploadSessionStatusByIdStatement(firm.database, session.id, "expired"),
          abandonVersionStatement(firm.database, session.file_version_id),
        ],
        outboxMessages: [],
      },
      { now },
    );
  }
  return results.length;
}

// The stranded-pending re-drive: the counterpart sweep for an ingest that FAILED rather than an upload
// that was abandoned. The sweep above reclaims sessions the client never finished; this one finds
// sessions the client DID finish whose version never left `pending` — the shape a dead-lettered ingest
// leaves behind, where the bytes are in R2, the user was told the upload succeeded, and nothing is left
// to move the version. Each one is re-enqueued as the same R2-event message the object's original
// create notification carried, so it re-enters the one ingest path rather than a second, divergent
// commit path here.
//
// Re-driving is safe to repeat. A version still pending is picked up by the status-first guard and
// ingested normally; one that has since committed takes the custody branch instead, which re-measures
// the stored bytes against the hash the committed row asserts and withdraws the version if they no
// longer match — so a redundant re-drive re-verifies custody rather than double-committing. Returns the
// count re-driven (for tests and the operator counter).
export async function redriveStrandedPendingVersions(
  env: Bindings,
  firm: ReachableActiveFirm,
): Promise<number> {
  const queue = env.FILES_INGEST;
  // No producer binding (or no bucket registered for the firm) means there is nothing to re-drive
  // onto; the rows stay put for the next pass rather than being silently dropped.
  if (queue === undefined || firm.bucketName === null) return 0;
  const mintedBefore = new Date(Date.now() - STRANDED_PENDING_DEADLINE_MILLISECONDS).toISOString();
  const { results } = await selectStrandedPendingVersionsStatement(
    firm.database,
    mintedBefore,
  ).all<{ id: FileVersionId; r2_key: string; declared_size: number | null }>();
  if (results.length === 0) return 0;
  const bucket = firm.bucketName;
  await queue.sendBatch(
    results.map((version) => ({
      body: {
        bucket,
        // The consumer reads the key; the size is informational (it measures the real object itself).
        object: { key: version.r2_key, size: version.declared_size ?? 0 },
        // The action an object-create notification carries, because that is what this message stands
        // in for — and it is what makes the custody re-verification run if the version has committed
        // since this batch was read.
        action: "PutObject",
      },
    })),
  );
  return results.length;
}

export interface ReconciliationReport {
  readonly firmsReconciled: number;
  readonly corrections: number;
}

// Reads a firm's authoritative storage rollup for the reconciliation diff.
async function readMeterRows(database: ProxyBatchDatabase): Promise<MeterRow[]> {
  const { results } = await database
    .prepare("SELECT storage_class, artifact_role, prefix, bytes, object_count FROM storage_meter")
    .all<{
      storage_class: string;
      artifact_role: string;
      prefix: string;
      bytes: number;
      object_count: number;
    }>();
  return results.map((row) => ({
    storageClass: row.storage_class,
    artifactRole: row.artifact_role,
    prefix: row.prefix,
    bytes: row.bytes,
    objectCount: row.object_count,
  }));
}

// The storage-metering reconciliation pass (its own daily Cron, not the */5 sweep — a full R2 LIST per
// firm is too heavy for every five minutes). For each reachable firm it LISTs the firm's objects under
// the files/ prefix, FILTERS them to only the objects backing a clean committed version in THIS firm's
// D1, diffs that filtered aggregate against the authoritative storage_meter, and commits the delta
// corrections; drift is logged (totals only — never object contents) for operator visibility.
//
// The clean-key filter is load-bearing: the meter counts clean commits only, so a pending/quarantined/
// abandoned object (its bytes never metered, never deleted from R2) must not inflate the meter; and a
// bucket shared across firms carries other firms' objects — whose keys are not in this firm's clean
// set — which must not be counted against this firm. Both are excluded by keeping only the listed
// objects whose key is in this firm's clean-version set.
//
// PER-FIRM BUCKET SEAM: the LIST runs against the bucket resolveFirmBucket (files/firm-bucket.ts)
// gives for this firm — the same resolver the upload and ingest paths use, so the pass counts the
// bytes those paths actually wrote. D1 stays authoritative and is the only reader of the corrected
// meter — no analytics store holds a copy of it, and packages/file-manager/src/metering-statements.ts
// records why a per-firm storage trend is declined rather than deferred.
export async function runStorageReconciliation(env: Bindings): Promise<ReconciliationReport> {
  // One logger + correlation id per pass — the same one-pipeline discipline as runScheduledSweep
  // (golden rule 4; the console ban is structural).
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const firms = await listReachableActiveFirms(env);
  let firmsReconciled = 0;
  let corrections = 0;
  for (const firm of firms) {
    try {
      // A firm still mid-provisioning has no bucket recorded and therefore no objects to count;
      // resolving throws, which the per-firm catch below turns into a skip plus a logged failure.
      const { bucket } = resolveFirmBucket(env, firm.bucketName);
      // This firm's authoritative clean-version set: only these keys count toward its meter.
      const cleanKeys = new Set(
        (await listCleanVersionR2Keys(firm.database)).map((version) => version.r2Key),
      );
      const listed: ListedObject[] = [];
      let cursor: string | undefined;
      for (;;) {
        // Build options without a cursor key on the first page — passing an explicit `cursor:
        // undefined` makes Miniflare's R2 return an empty page.
        const page = await bucket.list(
          cursor === undefined ? { prefix: "files/" } : { prefix: "files/", cursor },
        );
        for (const object of page.objects) {
          // Keep only objects backing a clean version in this firm's D1: pending/quarantined/abandoned
          // objects (never metered) and other dev-pool firms' objects (not in this set) are ignored.
          if (!cleanKeys.has(object.key)) continue;
          const reported = (object as { storageClass?: string }).storageClass ?? "";
          listed.push({
            key: object.key,
            size: object.size,
            storageClass: normalizeR2StorageClass(reported),
          });
        }
        if (!page.truncated) break;
        cursor = page.cursor;
      }

      // Also list bulk/ prefix objects; they meter under the files/ dimension, so remap their keys
      // to appear as files/ for the reconciliation diff.
      let bulkCursor: string | undefined;
      for (;;) {
        const page = await bucket.list(
          bulkCursor === undefined ? { prefix: "bulk/" } : { prefix: "bulk/", cursor: bulkCursor },
        );
        for (const object of page.objects) {
          if (!cleanKeys.has(object.key)) continue;
          const reported = (object as { storageClass?: string }).storageClass ?? "";
          // Remap bulk/ key to files/ so the diff compares against the files/ meter dimension.
          const remappedKey = FILES_PREFIX + "/" + object.key.slice("bulk/".length);
          listed.push({
            key: remappedKey,
            size: object.size,
            storageClass: normalizeR2StorageClass(reported),
          });
        }
        if (!page.truncated) break;
        bulkCursor = page.cursor;
      }

      const meterRows = await readMeterRows(firm.database);
      const result = reconciliationDiff(listed, meterRows);
      if (result.corrections.length > 0) {
        await commitEffectBatch(
          firm.database,
          {
            statements: meterCorrectionStatements(firm.database, result.corrections),
            outboxMessages: [],
          },
          { now: () => new Date().toISOString() },
        );
        corrections += result.corrections.length;
        // Drift correction is a self-healing operational signal: the count is the alertable metric
        // (the meter is authoritative regardless), so it rides a counter, not a content-bearing event.
        logger.count("storage.reconciliation.corrected", {}, result.corrections.length);
      }
      firmsReconciled++;
    } catch (caught) {
      // One firm's failure must not starve the rest; logged through the one pipeline, next pass retries.
      logOperationFailed(
        logger,
        `cron:storage-reconciliation:${firm.firmId}`,
        caught,
        correlationId,
      );
    }
  }
  return { firmsReconciled, corrections };
}

// THE COMPARISON-DRIVEN NOTIFICATION PASS, on the daily cron over the SAME reachable-active-firm
// enumeration every other per-firm sweep uses.
//
// Most of what a firm gets told about already happened: a write committed, an outbox row committed
// beside it, and the queue carries it. Some of the most consequential things did not happen at all.
// Nothing writes "this deadline is overdue" — the calendar refuses to keep that as a column, because
// a stored flag needs machinery to maintain a fact that is a subtraction, can be stale where a
// comparison cannot, and would have the platform assert something about a firm's conduct it is not
// in a position to assert. Nothing in the custody register schedules anything either. Those are
// comparisons, and a comparison needs somebody to perform it.
//
// This pass performs the ones the owning packages already ship and materializes what they return. It
// does not restate what is due; a second definition would eventually disagree with the first.
//
// WHY DAILY. The dedupe key buckets by civil date, so a continuously-true comparison raises once per
// day however often this runs — which makes the cadence a free variable and makes re-running safe.
// Given that, the daily pass produces exactly the one row per day the bucket describes, where the
// five-minute pass would perform 288 firm-wide deadline reads to produce the same single row. What
// the cadence does decide is WHEN in a member's day the row appears, and a single daily pass lands
// in the evening for the western time zones; a second daily pass is the fix if that matters, and it
// costs a cron expression and no code.
//
// One firm's failure is quarantined and logged exactly as the outbox sweep quarantines a sick firm
// database: every firm is addressable, so an unguarded throw here would abort the pass fleet-wide.
export async function runNotificationComparisonSweep(env: Bindings): Promise<number> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const firms = await listReachableActiveFirms(env);
  let firmsSwept = 0;
  for (const firm of firms) {
    try {
      const result = await sweepFirmComparisonNotifications({
        database: firm.database,
        now: new Date().toISOString(),
      });
      firmsSwept++;
      // Counters and nothing else, on the SAME metrics the queue-driven path reports — a
      // notification that was materialized is the same fact however it was raised, and two parallel
      // metric families would mean every dashboard asking the question twice. The emission point
      // rides the `topic` dimension because that is exactly what it is: a low-cardinality label
      // naming what produced the row.
      //
      // Per emission point rather than per firm, because a kind that silently stops producing looks
      // exactly like a kind nobody registered, and a sum over every kind hides it. No subject,
      // matter, or recipient handle appears anywhere here.
      for (const [emissionPoint, counts] of result.byEmissionPoint) {
        const topic = { topic: emissionPoint };
        if (counts.materializedEvents > 0) {
          logger.count("notifications.materialized", topic, counts.materializedEvents);
          logger.count("notifications.recipients", topic, counts.recipientRows);
        }
        if (counts.emptyAudiences > 0) {
          logger.count("notifications.empty_audience", topic, counts.emptyAudiences);
        }
        if (counts.clampedRecipients > 0) {
          logger.count("notifications.recipients_clamped", topic, counts.clampedRecipients);
        }
        if (counts.refusedFacts > 0) {
          logger.count("notifications.refused_facts", topic, counts.refusedFacts);
        }
        if (counts.clampedFindings > 0) {
          logger.count("notifications.comparison_clamped", topic, counts.clampedFindings);
        }
        // Its own metric rather than a second contribution to `comparison_clamped`, because the two
        // say different things and only one of them bounds what was missed. A clamp says the pass
        // found more than it carried; this says the pass never asked about a whole time zone, so the
        // findings it does report for this kind are of unknown completeness and the zero beside them
        // is not evidence of anything.
        if (counts.truncatedZoneDiscovery > 0) {
          logger.count(
            "notifications.comparison_zone_discovery_truncated",
            topic,
            counts.truncatedZoneDiscovery,
          );
        }
      }
      // Reported by category and by whose choice it was rather than by emission point, because that
      // is the grain a preference is set at and the grain somebody investigating "nobody was told"
      // asks about. A suppression that went uncounted is indistinguishable afterwards from a
      // notification that was never raised, which is the whole failure mode of a preference system.
      for (const suppression of result.suppressedInApp) {
        logger.count(
          "notifications.suppressed_by_preference",
          { category: suppression.category, reason: suppression.reason },
          suppression.count,
        );
      }
    } catch (caught) {
      logOperationFailed(
        logger,
        `cron:notification-comparison:${firm.firmId}`,
        caught,
        correlationId,
      );
    }
  }
  return firmsSwept;
}

// The nightly notification-retention sweep, on the daily pass over the SAME reachable-active-firm
// enumeration every other per-firm sweep uses.
//
// A notification is a POINTER and never a record: the ledger entry, the invoice, the quarantined
// version, the deadline, and the audit_log row beside each of them are the record, keep their own
// retention posture, and are untouched by anything here. Sweeping a pointer destroys no evidence.
// That is what makes a retention window defensible in this subsystem where the custody register
// refuses one outright — the custodian rule is about a client's irreplaceable property, and this is
// about a badge.
//
// Unread rows age on the same clock as read ones, and the sweep does NOT simply drop them: it first
// tallies, per member, how many it is about to take that were still unread and how far back they
// reach, and the member's unread count reports that beside the live count. Returning a silent zero
// to somebody back from three weeks' leave would be the platform making a claim — "there is nothing
// you missed" — that it is not in a position to make.
//
// Bounded and resumable: one pass takes at most RETENTION_SWEEP_BATCH_SIZE events per firm, so a
// firm that has gone unswept for a month does not present the nightly pass with an unbounded
// DELETE; the next pass continues where this one stopped. One firm's failure is quarantined exactly
// as the outbox sweep quarantines a sick firm database.
export async function runNotificationRetentionSweep(env: Bindings): Promise<number> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const firms = await listReachableActiveFirms(env);
  let firmsSwept = 0;
  for (const firm of firms) {
    try {
      const now = new Date().toISOString();
      const retentionDays = await readNotificationRetentionDays(firm.database);
      const cutoff = retentionCutoff(now, retentionDays);

      // The tally is read BEFORE the delete, in the same pass, because afterwards the answer is
      // gone — and the answer is exactly the fact this mechanism exists to keep.
      const { results: tally } = await selectSweepableUnreadTallyStatement(
        firm.database,
        cutoff,
      ).all<{ recipient_user_id: string; unread_count: number; oldest_occurred_at: string }>();

      const statements = [
        ...tally.map((row) =>
          recordSweptUnreadStatement(firm.database, {
            recipientUserId: row.recipient_user_id,
            unreadCount: row.unread_count,
            oldestOccurredAt: row.oldest_occurred_at,
            now,
          }),
        ),
        ...retentionSweepDeleteStatements(firm.database, cutoff),
        // The suppression tally ages on the SAME window as the notifications it explains. Left
        // standing it would become a growing record of one member's settings with nothing left to
        // compare it against, since the feed rows it accounts for are gone.
        retentionSweepSuppressionDeleteStatement(firm.database, cutoff),
      ];
      // One batch: recording what was taken and taking it must not be separable, or a crash between
      // them loses the tally and leaves the member with nothing but a zero.
      await commitEffectBatch(
        firm.database,
        { statements, outboxMessages: [] },
        { now: () => now },
      );

      firmsSwept++;
      if (tally.length > 0) {
        // Counters, not events: the member handles have no place in a structured log, and the rate
        // is the alertable signal.
        logger.count(
          "notifications.swept_unread",
          {},
          tally.reduce((total, row) => total + row.unread_count, 0),
        );
      }
    } catch (caught) {
      logOperationFailed(
        logger,
        `cron:notification-retention:${firm.firmId}`,
        caught,
        correlationId,
      );
    }
  }
  return firmsSwept;
}

// THE EMAIL DIGEST PASS — the first time anything in this subsystem leaves the platform.
//
// Every other notification surface is a row a member reads inside the product, behind their session
// and the visible-matter predicate. This one hands a copy to a mailbox the firm may not administer,
// cannot recall, and cannot re-filter when access changes. That is why the mail says only how many
// items are waiting in which categories and gives one link back in — the boundary is decided and
// enforced in `@magna-carta/notifications/digest-render`, and nothing here composes a line of it.
//
// WHY HOURLY. A summary is anchored to the FIRM's own morning rather than to UTC's, so the pass has
// to wake every hour and ask each firm whether its local hour has come round. Firms whose hour it is
// not are two small setting reads and nothing else; only the firm whose morning it is does work.
//
// WHY THE WHOLE PASS CAN BE A NO-OP. Outbound mail is an unprovisioned seam on a deployment with no
// Email Service binding, no verified sender, or no public origin. The port answers with a typed
// reason rather than throwing or, worse, resolving to the dev logging adapter — which would return
// successfully having mailed nobody while this pass recorded `sent` rows and advanced watermarks
// nobody could get back. The reason is counted every pass, because a channel that has never been
// provisioned must not look like a channel with nothing to say.
export async function runNotificationDigestPass(
  env: Bindings,
  // The port is injectable on the same terms the conversion engine resolver is: the real one is
  // built over a Cloudflare binding the local test pool cannot exercise, and a channel whose only
  // coverage is "it correctly refuses to run" is a channel nobody has watched compose a message.
  options: {
    readonly now?: Date;
    readonly port?: NotificationDigestSendPort;
  } = {},
): Promise<number> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();

  const port = options.port ?? resolveNotificationDigestSendPort(env, logger);
  if (port.status === "unavailable") {
    logger.count("notifications.digest_unavailable", { reason: port.reason }, 1);
    return 0;
  }

  const now = options.now ?? new Date();
  const nowInstant = now.toISOString();
  const firms = await listReachableActiveFirms(env);
  let firmsMailed = 0;

  for (const firm of firms) {
    try {
      const anchorHour = await readNotificationDigestLocalHour(firm.database);
      const zone = await resolveFirmDigestZone(firm.database);
      const local = firmLocalReading(now, zone);
      if (local.hour !== anchorHour) continue;

      const cadences: NotificationDigestCadence[] =
        local.weekday === DIGEST_WEEKLY_LOCAL_WEEKDAY ? ["daily", "weekly"] : ["daily"];

      // One policy reader for the whole firm's pass: a firm's members resolve the same preference
      // matrix for every cadence and every candidate, and re-reading it per member per cadence would
      // double the pass's query count for an answer that cannot change inside it.
      const policy = createNotificationPolicyReader(firm.database);
      for (const cadence of cadences) {
        await runFirmDigestCadence({
          firm,
          cadence,
          policy,
          port,
          logger,
          correlationId,
          now: nowInstant,
          controlPlane: env.DB_CONTROL,
        });
      }
      firmsMailed++;
    } catch (caught) {
      // One firm's failure is quarantined exactly as the outbox sweep quarantines a sick firm
      // database: every firm is addressable, so an unguarded throw would abort the pass fleet-wide.
      logOperationFailed(logger, `cron:notification-digest:${firm.firmId}`, caught, correlationId);
    }
  }
  return firmsMailed;
}

// The firm's wall-clock hour and weekday. Where the firm has told the platform where it is — through
// the default office the calendar already books against — that zone decides; where it has not, the
// platform's own clock does, which is stated rather than guessed at, because a firm that has set no
// default location has not been promised a local morning.
function firmLocalReading(now: Date, zone: string | null): { hour: number; weekday: number } {
  if (zone === null) return { hour: now.getUTCHours(), weekday: now.getUTCDay() };
  const reading = zonedReading(now.getTime(), zone);
  return {
    hour: Number.parseInt(reading.wallClockTime.slice(0, 2), 10),
    // The weekday of the firm's own civil date, read as a plain calendar date rather than as an
    // instant — the zone has already been applied, and re-applying it here would shift the day.
    weekday: new Date(`${reading.civilDate}T00:00:00.000Z`).getUTCDay(),
  };
}

async function runFirmDigestCadence(options: {
  readonly firm: ReachableActiveFirm;
  readonly cadence: NotificationDigestCadence;
  readonly policy: NotificationPolicyReader;
  readonly port: Extract<NotificationDigestSendPort, { status: "configured" }>;
  readonly logger: Logger;
  readonly correlationId: string;
  readonly now: string;
  readonly controlPlane: D1Database;
}): Promise<void> {
  const { firm, cadence, logger, now } = options;
  const { candidates, clamped } = await readDigestCandidates(firm.database, cadence);
  if (clamped > 0) {
    logger.count("notifications.digest_recipients_clamped", { cadence }, clamped);
  }
  if (candidates.length === 0) return;

  // The wall, composed in SQL before the LIMIT, on the same predicate the feed and the unread count
  // compose. The digest is the dangerous read — it runs with no request context, on a member's
  // behalf — which is exactly why it resolves through the shared read rather than a second one.
  const visibility = visibleMatterPredicate();
  // Addresses come from the control plane in ONE bounded read, keyed by exactly the members this
  // firm's own database resolved as recipients. No address is ever logged, counted, or stored.
  const addresses = await readMemberEmailAddresses(
    options.controlPlane,
    candidates.map((candidate) => candidate.recipientUserId),
  );

  let sent = 0;
  let items = 0;
  const suppressedByReason = new Map<string, number>();
  let refusedEscalation = 0;

  for (const candidate of candidates) {
    const window = await readDigestWindow(
      firm.database,
      { recipientUserId: candidate.recipientUserId, visibility },
      candidate.watermark,
    );
    const preferences = (
      await options.policy.preferencesFor([candidate.recipientUserId as UserId])
    ).get(candidate.recipientUserId as UserId);
    const composition = composeDigest({
      cadence,
      window,
      cadenceForCategory: (category) =>
        preferences?.get(category)?.email ?? defaultEmailCadenceFor(category),
    });
    refusedEscalation += composition.refusedEscalation;

    const detailLevel = await resolveEmailDetailLevel(firm.database, candidate.recipientUserId);
    const address = addresses.get(candidate.recipientUserId);

    // A member with nothing visible in the window gets NO email. A "you have nothing" message trains
    // people to ignore the channel, and a channel people ignore has stopped working for the
    // categories that matter.
    let digestId: NotificationDigestId | null = null;
    let withholdAllReason: NotificationSuppressedReason | undefined;
    if (composition.carriedRecipientIds.length === 0) {
      // Nothing to send. Any rows the member's own cadence withheld are still settled below.
    } else if (detailLevel.effective === "off") {
      // The member, or their firm's ceiling, said the mail should carry nothing at all. That is a
      // preference, and it is recorded as one against every row it stopped.
      withholdAllReason = "preference";
    } else if (address === undefined) {
      withholdAllReason = "no-address";
    } else {
      const rendered = renderNotificationDigest({
        composition,
        detailLevel: detailLevel.effective,
        appBaseUrl: options.port.appBaseUrl,
      });
      digestId = newNotificationDigestId();
      // SEND FIRST, THEN MARK. A crash between the two re-sends a summary next run, which is an
      // annoyance; marking first risks losing one, which is a missed deadline.
      try {
        await options.port.send({
          to: address,
          subject: rendered.subject,
          text: rendered.text,
          messageClass: DIGEST_MESSAGE_CLASS,
        });
        sent++;
        items += composition.totalCount;
      } catch (caught) {
        // One member's transport failure must not starve the rest of the firm's mail — the same
        // quarantine every per-firm pass applies to one sick database, one member down. NOTHING is
        // settled and the mark stays where it was, so the next run reads the same window: writing a
        // `failed` delivery row would settle it against the one-row-per-channel constraint and the
        // member would never be told at all. The failure is already an `email.sent` event with a
        // failed outcome from the port itself; this records which pass it happened in.
        digestId = null;
        logOperationFailed(
          options.logger,
          `cron:notification-digest-send:${firm.firmId}`,
          caught,
          options.correlationId,
        );
      }
    }

    for (const withheld of composition.withheld) {
      suppressedByReason.set(withheld.reason, (suppressedByReason.get(withheld.reason) ?? 0) + 1);
    }
    if (withholdAllReason !== undefined) {
      suppressedByReason.set(
        withholdAllReason,
        (suppressedByReason.get(withholdAllReason) ?? 0) + composition.carriedRecipientIds.length,
      );
    }

    // The delivery rows and the watermark commit together: a crash between them would advance past
    // rows nothing recorded.
    await commitEffectBatch(
      firm.database,
      {
        statements: [
          ...settleDigestStatements(firm.database, {
            recipientUserId: candidate.recipientUserId,
            cadence,
            composition,
            digestId,
            withholdAllReason,
            now,
          }),
        ],
        outboxMessages: [],
      },
      { now: () => now },
    );
  }

  if (sent > 0) {
    logger.count("notifications.digest_sent", { cadence }, sent);
    logger.count("notifications.digest_items", { cadence }, items);
  }
  for (const [reason, count] of suppressedByReason) {
    logger.count("notifications.digest_suppressed", { reason }, count);
  }
  if (refusedEscalation > 0) {
    logger.count("notifications.digest_refused_escalation", { cadence }, refusedEscalation);
  }
}

// Addresses for exactly the members this firm resolved as recipients, in one bounded read against
// the control plane where Better Auth keeps them. The addresses are held for the length of one
// cadence's pass and reach nothing but the send port: no log, no counter dimension, no stored row.
async function readMemberEmailAddresses(
  controlPlane: D1Database,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (userIds.length === 0) return new Map();
  const placeholders = userIds.map((_userId, index) => `?${index + 1}`).join(", ");
  const { results } = await controlPlane
    .prepare(`SELECT id, email FROM "user" WHERE id IN (${placeholders}) ORDER BY id`)
    .bind(...userIds)
    .all<{ id: string; email: string | null }>();
  const byUserId = new Map<string, string>();
  for (const row of results) {
    if (row.email !== null && row.email !== "") byUserId.set(row.id, row.email);
  }
  return byUserId;
}

// The status-snapshot Cron pass (its own */10 Cron, separate from both the */5 sweep and the daily
// reconciliation pass): probes the cheap core primitives, polls the upstream provider feeds, derives
// every component's status, and writes status:derived — the one writer of that KV key (the operator
// UI owns the sibling status:authored key through the mutateAuthored helper). A probe or provider
// failure never aborts the pass (buildAndStoreDerivedSnapshot's internals swallow their own errors
// into a status value), so the only throw this catches is something writing to STATUS_KV itself.
export async function runStatusSnapshot(env: Bindings): Promise<void> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  try {
    const snapshot = await buildAndStoreDerivedSnapshot(env, new Date().toISOString());
    logger.count("status.snapshot.components", {}, snapshot.components.length);
  } catch (caught) {
    logOperationFailed(logger, "cron:status-snapshot", caught, correlationId);
  }
}

// One-off, idempotent backfill sweeps — the migration-can't-encrypt half of the protected-module
// expand-contract. A SQL migration adds the ciphertext column and mints nothing; the actual
// encryption (and the firm-key mint for firms provisioned before the mint step existed) is code,
// run here off the request path on the cron. Each sweep is idempotent PER FIRM: its step no-ops
// when nothing qualifies, so re-running every pass is harmless and a sweep that has finished its
// fleet simply does no work. Once every firm is backfilled these become permanent no-ops; removing
// them is a later cleanup.

export interface FirmBackfillReport {
  // Firms whose step ran without throwing this pass (whether or not it changed any rows).
  readonly firmsProcessed: number;
  // Total rows the step affected across the fleet this pass (keys minted, incidents encrypted).
  readonly rowsAffected: number;
}

// The generic per-firm backfill runner: walk a supplied set of firms, run one idempotent step
// against each, and isolate a single firm's failure (logged through the one telemetry pipeline, the
// next pass retries) so one broken firm cannot starve the rest of the fleet. The progress count
// rides a counter (ids/totals only — never any protected value). `name` tags the operation label and
// rides the counter as a DIMENSION, so the two sweeps are distinguishable in telemetry without every
// backfill minting its own metric name — a name built by interpolation cannot be declared in the
// catalog (@magna-carta/telemetry/metrics), and the emission path drops what it cannot lay out.
async function runFirmBackfill<TFirm extends { readonly firmId: string }>(
  name: string,
  logger: Logger,
  correlationId: string,
  firms: readonly TFirm[],
  step: (firm: TFirm) => Promise<number>,
): Promise<FirmBackfillReport> {
  let firmsProcessed = 0;
  let rowsAffected = 0;
  for (const firm of firms) {
    try {
      const affected = await step(firm);
      rowsAffected += affected;
      firmsProcessed += 1;
      if (affected > 0) logger.count("backfill.rows_affected", { backfill: name }, affected);
    } catch (caught) {
      logOperationFailed(logger, `cron:backfill:${name}:${firm.firmId}`, caught, correlationId);
    }
  }
  return { firmsProcessed, rowsAffected };
}

// `protected-key-mint`: a control-plane scan that mints the firm data key for every ACTIVE firm whose
// wrapped_firm_key is still null — the firms provisioned before the provisioning mint step existed.
// Idempotent: a firm with a key already minted is excluded by the WHERE, and a SHREDDED firm
// (a firm.key_shredded audit row, null key permanent) is excluded by the NOT EXISTS so its key is
// never resurrected. The mint mirrors the provisioner's step 4c — 32 random bytes, AES-KW-wrapped
// under the root KEK; only the wrapped form is stored.
export async function runProtectedKeyMintBackfill(
  env: Bindings,
  logger: Logger,
  correlationId: string,
): Promise<FirmBackfillReport> {
  const { results } = await env.DB_CONTROL.prepare(
    "SELECT id FROM firm WHERE status = 'active' AND wrapped_firm_key IS NULL " +
      "AND NOT EXISTS (SELECT 1 FROM auth_audit WHERE event = 'firm.key_shredded' AND metadata LIKE '%' || firm.id || '%')",
  ).all<{ id: string }>();
  const candidates = results.map((row) => ({ firmId: row.id }));
  const rootKek = await importRootKek(env.ROOT_KEK);

  return runFirmBackfill("protected-key-mint", logger, correlationId, candidates, async (firm) => {
    const wrappedFirmKey = await wrapFirmKey(rootKek, generateFirmKeyBytes());
    // The IS NULL guard makes a concurrent mint (a provisioning run, an overlapping pass) a no-op
    // rather than a clobber — the firm key is minted exactly once.
    const result = await env.DB_CONTROL.prepare(
      "UPDATE firm SET wrapped_firm_key = ?2 WHERE id = ?1 AND wrapped_firm_key IS NULL",
    )
      .bind(firm.firmId, wrappedFirmKey)
      .run();
    return result.meta.changes;
  });
}

interface UnencryptedIncidentRow {
  readonly id: string;
  readonly description: string;
}

// `incident-description-encrypt`: a per-firm sweep that seals the plaintext description of every
// pre-slice incident row (description_ciphertext IS NULL AND description IS NOT NULL) through the
// same protected-field chokepoint new writes use. Idempotent: a row already sealed has a non-null
// ciphertext and is excluded, so a re-run encrypts nothing. The plaintext column is LEFT IN PLACE
// (the expand-contract contract drops it in a later slice after a verification window); the backfill
// only fills the ciphertext. Each firm's rows are sealed and committed in one atomic batch so the
// firm either gains all its ciphertexts this pass or none (the next pass retries).
export async function runIncidentDescriptionEncryptBackfill(
  env: Bindings,
  firms: readonly ReachableActiveFirm[],
  logger: Logger,
  correlationId: string,
): Promise<FirmBackfillReport> {
  // The per-isolate key provider — the same wrapped-key read and non-extractable HKDF handle cache the
  // request paths use, so a firm unwrapped in a request stays cached for this sweep and vice versa. It
  // reads the live wrapped_firm_key, so a shredded firm yields null and fails closed here too.
  const firmKeyProvider = firmKeyProviderForEnv(env);

  return runFirmBackfill(
    "incident-description-encrypt",
    logger,
    correlationId,
    firms,
    async (firm) => {
      const { results } = await firm.database
        .prepare(
          "SELECT id, description FROM incident WHERE description_ciphertext IS NULL AND description IS NOT NULL",
        )
        .all<UnencryptedIncidentRow>();
      if (results.length === 0) return 0;

      const context = {
        firmId: firm.firmId as FirmId,
        firmKeyVersion: 1,
        firmKeyProvider,
      };
      const statements = [];
      for (const row of results) {
        const sealed = await composeProtectedWrite(
          context,
          incidentDescription,
          row.id,
          row.description,
        );
        statements.push(
          firm.database
            .prepare("UPDATE incident SET description_ciphertext = ?2 WHERE id = ?1")
            .bind(row.id, sealed.ciphertextValue),
        );
      }
      // D1 has no interactive transactions — the atomic batch is the all-or-nothing primitive.
      await firm.database.batch(statements);
      return results.length;
    },
  );
}

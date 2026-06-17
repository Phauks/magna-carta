import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { purgeExpiredIdempotencyRecordsStatement } from "@magna-carta/data-access/idempotency-statements";
import { incidentDescription } from "@magna-carta/data-access/protected-field-registry";
import { composeProtectedWrite } from "@magna-carta/data-access/protected-fields";
import {
  sweepOutbox,
  type OutboxRow,
  type OutboxSweepReport,
} from "@magna-carta/data-access/outbox-relay";
import {
  abandonVersionStatement,
  selectExpiredOpenSessionsStatement,
  setUploadSessionStatusByIdStatement,
} from "@magna-carta/file-manager/file-statements";
import {
  meterCorrectionStatements,
  normalizeR2StorageClass,
  reconciliationDiff,
  type ListedObject,
  type MeterRow,
} from "@magna-carta/file-manager/metering-statements";
import { FILES_PREFIX } from "@magna-carta/file-manager/file-statements";
import {
  listCleanVersionR2Keys,
  listUnscannedCommittedVersions,
} from "@magna-carta/file-manager/queries";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import type { FileVersionId, FirmId, UploadSessionId } from "@magna-carta/identifiers/types";
import { outboxDeadLettered, outboxSwept } from "@magna-carta/telemetry/events";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "./app.ts";
import { presignerForEnv } from "./files/presigner-wiring.ts";
import { resolveFirmDatabase } from "./firm-binding-resolver.ts";
import { firmKeyProviderForEnv } from "./firm-key-provider-wiring.ts";
import { consumeMemberProvision } from "./member-provision-consumer.ts";

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
};

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

// An active firm this deployment can reach: the control-plane row joined to its resolved binding.
// bucketName is the firm's R2 bucket (null until provisioning records it) — the stale-pending sweep
// needs it to abort a multipart upload at R2.
export interface ReachableActiveFirm {
  readonly firmId: string;
  readonly database: D1Database;
  readonly bucketName: string | null;
}

// The ONE active-firm enumeration per cron pass — the per-firm sweep, the stale-pending sweep, and the
// reconciliation backstop all consume the same list. Firms with no recorded database, or whose
// database this deployment cannot reach, are skipped; the next pass retries them.
export async function listReachableActiveFirms(env: Bindings): Promise<ReachableActiveFirm[]> {
  const firms = await env.DB_CONTROL.prepare(
    "SELECT id, database_identifier, bucket_name FROM firm WHERE status = 'active'",
  ).all<{ id: string; database_identifier: string | null; bucket_name: string | null }>();

  const reachable: ReachableActiveFirm[] = [];
  for (const firm of firms.results) {
    const database =
      firm.database_identifier === null ? null : resolveFirmDatabase(env, firm.database_identifier);
    if (database === null) continue;
    reachable.push({ firmId: firm.id, database, bucketName: firm.bucket_name });
  }
  return reachable;
}

// The reconciliation backstop: control-plane users with no member row
// in their firm's per-firm database. Detection only — repair runs through the relay: a PENDING
// member.provision row is dispatched by the next sweep, and a DEAD-LETTERED one is revived by
// requeueDeadLetteredMessageStatement (the documented operator seam — see sweepOutbox); the
// backstop never writes a member row from here. Takes the pass's listReachableActiveFirms result,
// so unreachable firms are skipped the same way the sweep skips them.
//
// The control-plane users are read in ONE grouped query (not per firm — that was an N+1 across the
// fleet), bucketed by firm_id in JS; the per-firm member reads stay per firm (irreducible — the
// firm databases are separate physical D1 instances).
export async function findUnprovisionedMembers(
  env: Bindings,
  firms: readonly ReachableActiveFirm[],
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

    const members = await firm.database.prepare("SELECT user_id FROM member").all<{
      user_id: string;
    }>();
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
//   2. per-firm outbox sweep over active firms — rows publish to env.QUEUE (nothing consumes the
//      per-firm queue yet this slice; publishing realizes the relay contract and the consumer
//      arrives with the first per-firm topic) — plus that firm's idempotency TTL purge;
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

  const controlPlane = await sweepOutbox({
    database: env.DB_CONTROL,
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
      const firmReport = await sweepOutbox({
        database: firm.database,
        publish: async (row) => {
          // The Queue message mirrors the outbox row (consumers dedup on id, order by
          // (aggregateKey, seq)); the payload is already redacted canonical JSON.
          // firmId tags the originating tenant: per-firm messages cross the single SHARED env.QUEUE,
          // so the first per-firm consumer (slice 0·5+) resolves the firm from the message — it has
          // no other handle on which physical database the row came from. (Control-plane outbox
          // topics are consumed DIRECTLY in this worker, never over the queue, so they need no such
          // tag.)
          await env.QUEUE.send({
            id: row.id,
            firmId: firm.firmId,
            topic: row.topic,
            payload: row.payload,
            aggregateKey: row.aggregate_key,
            seq: row.seq,
          });
        },
        deadLetter: logDeadLetter(logger, correlationId, `firm ${firm.firmId}`),
      });
      await purgeExpiredIdempotencyRecordsStatement(firm.database, idempotencyCutoff).run();
      await sweepStalePendingUploads(env, firm);
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

  const unprovisionedMembers = await findUnprovisionedMembers(env, firms);
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

  return { controlPlane, firmSweeps, unprovisionedMembers, keyMint, incidentEncrypt };
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
      await presigner.abortMultipartUpload(firm.bucketName, session.r2_key, session.r2_upload_id);
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

export interface ReconciliationReport {
  readonly firmsReconciled: number;
  readonly corrections: number;
}

// Reads a firm's authoritative storage rollup for the reconciliation diff.
async function readMeterRows(database: D1Database): Promise<MeterRow[]> {
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
// abandoned object (its bytes never metered, never deleted from R2) must not inflate the meter; and the
// single bound env.R2 is SHARED across dev-pool firms, so another firm's object — whose key is not in
// this firm's clean set — must not be counted against this firm. Both are excluded by keeping only the
// listed objects whose key is in this firm's clean-version set.
//
// PER-FIRM BUCKET SEAM: it reads the single bound env.R2 (the dev pool shares one bucket); in
// production a firm's bytes live in its own bucket bound per-firm, resolved through the same seam the
// ingest consumer documents. D1 stays authoritative; the AE trend seam (the telemetry package)
// consumes the corrected meter on its own path.
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
      // This firm's authoritative clean-version set: only these keys count toward its meter.
      const cleanKeys = new Set(
        (await listCleanVersionR2Keys(firm.database)).map((version) => version.r2Key),
      );
      const listed: ListedObject[] = [];
      let cursor: string | undefined;
      for (;;) {
        // Build options without a cursor key on the first page — passing an explicit `cursor:
        // undefined` makes Miniflare's R2 return an empty page.
        const page = await env.R2.list(
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
        const page = await env.R2.list(
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
// rides a counter (ids/totals only — never any protected value). `name` tags the operation label
// and the counter so the two sweeps are distinguishable in telemetry.
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
      if (affected > 0) logger.count(`backfill.${name}`, {}, affected);
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

// The per-firm per-run cap for the re-scan sweep: a reasonable bound that prevents a single weekly
// pass from flooding the queue when a large backlog exists (e.g. after a scan engine is first
// wired). Each capped pass leaves the remainder for the next weekly run.
const RESCAN_SWEEP_PER_FIRM_CAP = 100;

export interface RescanSweepReport {
  // Total re-scan messages enqueued across all firms this pass.
  readonly enqueued: number;
  // Number of firms processed without error.
  readonly firmsProcessed: number;
}

// The weekly re-scan sweep: for each reachable active firm, finds committed versions whose
// scan_verdict is still 'unscanned' (the current scan port marks every commit 'unscanned' because
// no real engine is wired yet), and re-enqueues each one onto FILES_INGEST as an R2-event-shaped
// message so a now-available scan engine can evaluate them in place.
//
// The in-place re-scan processing (updating scan_verdict on the committed version) arrives with
// the real scan engine — the current ingest consumer correctly no-ops on a non-pending version,
// so messages enqueued here are dormant until the engine lands.
//
// Each firm is capped at RESCAN_SWEEP_PER_FIRM_CAP per run to bound queue pressure; a per-firm
// failure is isolated (logged through the one telemetry pipeline) so one broken firm cannot starve
// the rest. FILES_INGEST absent (the binding is optional in Bindings) is a no-op per firm.
export async function runRescanSweep(
  env: Bindings,
  perFirmCap: number = RESCAN_SWEEP_PER_FIRM_CAP,
): Promise<RescanSweepReport> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const firms = await listReachableActiveFirms(env);
  let enqueued = 0;
  let firmsProcessed = 0;
  for (const firm of firms) {
    try {
      if (env.FILES_INGEST === undefined) {
        firmsProcessed++;
        continue;
      }
      const versions = await listUnscannedCommittedVersions(firm.database, perFirmCap);
      for (const version of versions) {
        await env.FILES_INGEST.send({
          // R2-event-shaped message: the ingest consumer reads bucket + object.key + action.
          // bucket resolves the firm on ingest; for the dev pool the single shared bucket_name
          // is used — the per-firm bucket seam (firm-binding-resolver.ts) handles production.
          bucket: firm.bucketName ?? "",
          object: { key: version.r2Key, size: 0 },
          action: "ObjectCreated:Put",
        });
        enqueued++;
      }
      firmsProcessed++;
    } catch (caught) {
      logOperationFailed(logger, `cron:rescan-sweep:${firm.firmId}`, caught, correlationId);
    }
  }
  return { enqueued, firmsProcessed };
}

import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { FirmId } from "@magna-carta/identifiers/types";
import {
  instanceDestroyedAudit,
  instanceProvisionedAudit,
  type NaturalLanguageWriteContext,
} from "@magna-carta/search/natural-language-audit";
import { NATURAL_LANGUAGE_FEED_PREFIX } from "@magna-carta/search/natural-language-feed";
import {
  NATURAL_LANGUAGE_INSTANCE_CONFIGURATION,
  NATURAL_LANGUAGE_INSTANCE_CONFIGURATION_GENERATION,
  naturalLanguageInstanceName,
} from "@magna-carta/search/natural-language-instance";
import {
  claimInstanceProvisioningStatement,
  markInstanceAbsentStatement,
  markInstanceReadyStatement,
  markInstanceTearingDownStatement,
  readInstanceForFirm,
} from "@magna-carta/search/natural-language-instance-statements";
import type { NaturalLanguageProvisioningPort } from "@magna-carta/search/natural-language-provisioning";
import {
  enumerateFeedObjects,
  markFeedObjectRemovedStatement,
  readFeedObjectsForDeletion,
  type FeedDeletionScope,
} from "@magna-carta/search/natural-language-statements";
import {
  naturalLanguageFeedReconciliationMismatch,
  naturalLanguageInstanceOperationFailed,
} from "@magna-carta/telemetry/events";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { Bindings } from "../bindings.ts";
import { resolveFirmBucketForFirmId } from "../files/firm-bucket.ts";
import { firmDatabaseFor, type ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { resolveNaturalLanguageProvisioningPort } from "./natural-language-binding.ts";

// Instance lifecycle and feed deletion — the queue-dispatched half of the natural-language search
// feature. Every function here runs from a per-firm queue message and never from a request handler:
// provisioning is a service round trip, and a teardown is proportional to a firm's whole corpus.
//
// TWO DATABASES, and the split is deliberate. The instance record is CONTROL-PLANE, because an
// instance is a resource in the platform's own account; the feed catalog is PER-FIRM, because what
// was copied out of a firm's documents is a fact about that firm's matters. Each statement below
// takes the handle its table lives behind, and neither can reach the other's rows.

// How many catalog rows one deletion pass handles. A firm-scope teardown is however many documents
// the firm has, so the pass is bounded and re-enqueues itself rather than attempting one unbounded
// batch inside one queue message's budget. R2 accepts a multi-key delete of up to a thousand.
const DELETION_PAGE_SIZE = 500;

// How many rows one reconciliation pass compares. Bounded for the same reason, and the report is a
// count rather than a list because the keys are already in the catalog, which is where somebody
// investigating will be looking.
const RECONCILIATION_PAGE_SIZE = 1_000;

const nowInstant = () => new Date().toISOString();

function writeContext(now: () => string): NaturalLanguageWriteContext {
  // A lifecycle job has no acting member: it runs because a member's opt-in or opt-out committed,
  // and that act has its own audit row against that member. Null is the codebase's recorded value
  // for a system-originated event, not an absence of attribution.
  return { clock: { now }, actorUserId: null };
}

// ── Provisioning ────────────────────────────────────────────────────────────

// Create the firm's instance. IDEMPOTENT by construction rather than by a guard: the name is derived
// from the firm identifier, so a repeated create converges on the same instance, and the
// control-plane row is an upsert keyed on the firm, so it converges on one row. A provisioning step
// that died halfway is restartable; nothing mints a second name and nothing orphans the first.
export async function provisionNaturalLanguageInstance(
  env: Bindings,
  firmId: FirmId,
  firmDatabase: ProxyBatchDatabase,
  logger: Logger,
  port: NaturalLanguageProvisioningPort = resolveNaturalLanguageProvisioningPort(env),
  now: () => string = nowInstant,
): Promise<void> {
  const instanceName = await naturalLanguageInstanceName(firmId);
  await claimInstanceProvisioningStatement(env.DB_CONTROL, {
    firmId,
    instanceName,
    configurationGeneration: NATURAL_LANGUAGE_INSTANCE_CONFIGURATION_GENERATION,
    now: now(),
  }).run();

  const { results } = await env.DB_CONTROL.prepare("SELECT bucket_name FROM firm WHERE id = ?1")
    .bind(firmId)
    .all<{ bucket_name: string | null }>();
  const bucketName = results[0]?.bucket_name;
  if (bucketName === null || bucketName === undefined || bucketName === "") {
    // A firm with no provisioned bucket has nothing to point a data source at. The row stays in
    // `provisioning`, which is the honest state: the work is owed, and a retry after the bucket
    // exists finds the same derived name and completes.
    logger.log(
      naturalLanguageInstanceOperationFailed(
        { correlationId: newCorrelationId(), now: now() },
        { operation: "provision", reason: "firm-bucket-not-provisioned", instanceName },
      ),
    );
    return;
  }

  const created = await port.createInstance({
    instanceName,
    bucketName,
    // The data source is the derived feed prefix and NOT the bucket. Pointing an index at a firm's
    // whole bucket would sweep in received productions, mid-edit working copies, and binary index
    // splits; the feed prefix holds only what the feed writer produced.
    keyPrefix: NATURAL_LANGUAGE_FEED_PREFIX,
    configuration: NATURAL_LANGUAGE_INSTANCE_CONFIGURATION,
  });
  if (!created.ok) {
    logger.log(
      naturalLanguageInstanceOperationFailed(
        { correlationId: newCorrelationId(), now: now() },
        { operation: "provision", reason: created.reason, instanceName },
      ),
    );
    return;
  }

  await markInstanceReadyStatement(env.DB_CONTROL, {
    firmId,
    instanceIdentifier: created.record.instanceIdentifier,
    now: now(),
  }).run();
  await commitEffectBatch(
    firmDatabase,
    {
      statements: [
        instanceProvisionedAudit(firmDatabase, writeContext(now), {
          instanceName,
          configurationGeneration: NATURAL_LANGUAGE_INSTANCE_CONFIGURATION_GENERATION,
        }),
      ],
      outboxMessages: [],
    },
    { now },
  );
}

// ── Teardown ────────────────────────────────────────────────────────────────

// Opt-out, in the one order that makes the resulting statement true.
//
//   1. Mark the instance tearing-down, so a teardown that dies partway is visible as a teardown in
//      progress rather than as a ready instance whose feed is half gone.
//   2. Delete every feed object from the firm's OWN storage and mark every catalog row removed. This
//      the platform performs against storage it owns and can therefore demonstrate.
//   3. Reconcile the catalog against a listing of the feed prefix, and record the result. This is
//      what turns "we deleted it" into something checkable.
//   4. Ask the service to delete the instance, and record its response verbatim.
//
// Step 4 is a REQUEST, and nothing here concludes anything from its success. The documentation this
// was built against states that a delete operation exists; it does not state what deletion
// guarantees about the vectors, the keyword index, or the converted text, nor within what interval,
// nor how a caller confirms it. So the record says the request was made and what came back, and the
// firm-facing statement says exactly that and no more.
export async function tearDownNaturalLanguageInstance(
  env: Bindings,
  firmId: FirmId,
  firmDatabase: ProxyBatchDatabase,
  logger: Logger,
  port: NaturalLanguageProvisioningPort = resolveNaturalLanguageProvisioningPort(env),
  now: () => string = nowInstant,
): Promise<void> {
  const instance = await readInstanceForFirm(env.DB_CONTROL, firmId);
  if (instance === undefined || instance.state === "absent") {
    // Nothing to tear down. Still delete the feed: a firm can have fed objects from an earlier
    // enablement whose instance is already gone, and leaving them would leave the material that
    // prompted the opt-out sitting in the firm's bucket under a prefix built to be indexed.
    await deleteNaturalLanguageFeed(env, firmId, firmDatabase, { kind: "firm" }, logger, now);
    return;
  }

  await markInstanceTearingDownStatement(env.DB_CONTROL, firmId, now()).run();

  const removed = await deleteNaturalLanguageFeed(
    env,
    firmId,
    firmDatabase,
    { kind: "firm" },
    logger,
    now,
  );

  const destroyed = await port.destroyInstance(instance.instanceName);
  if (!destroyed.ok) {
    // The feed is gone and the request to delete the managed index did not land. The row stays in
    // `tearing-down` — the honest state, and one somebody has to finish — rather than being recorded
    // as absent, which would claim a request that was never accepted.
    logger.log(
      naturalLanguageInstanceOperationFailed(
        { correlationId: newCorrelationId(), now: now() },
        { operation: "teardown", reason: destroyed.reason, instanceName: instance.instanceName },
      ),
    );
    return;
  }

  await markInstanceAbsentStatement(env.DB_CONTROL, {
    firmId,
    teardownResponse: destroyed.record.response,
    now: now(),
  }).run();
  await commitEffectBatch(
    firmDatabase,
    {
      statements: [
        instanceDestroyedAudit(firmDatabase, writeContext(now), {
          instanceName: instance.instanceName,
          acknowledged: destroyed.record.acknowledged,
          feedObjectsRemoved: removed,
        }),
      ],
      outboxMessages: [],
    },
    { now },
  );
}

// ── Deletion ────────────────────────────────────────────────────────────────

// Delete a scope's feed objects. Returns how many rows were marked removed.
//
// DRIVEN FROM THE CATALOG, never from a prefix listing, and that is the whole design of this
// function. A listing-driven delete cannot tell an object it has never heard of from one it wrote,
// so an object that reached the feed prefix some other way would be swept along silently. Driven
// from the catalog, that same object survives the delete and is surfaced by reconciliation as a
// detected inconsistency — a fact somebody can act on rather than a silent miss.
//
// OBJECTS BEFORE ROWS. A crash between the two leaves a row marked live whose bytes are gone, which
// reconciliation reports and the next pass repairs. The other order would leave bytes in the firm's
// bucket that no catalog row names and no sweep can recognize as garbage.

// Feed objects are the firm's bytes, so a deletion or a reconciliation addresses them the way every
// other per-firm read does — through the one storage seam, from the firm id these entry points carry.
async function feedBucket(env: Bindings, firmId: string): Promise<R2Bucket> {
  return (await resolveFirmBucketForFirmId(env, firmId)).bucket;
}

export async function deleteNaturalLanguageFeed(
  env: Bindings,
  firmId: string,
  firmDatabase: ProxyBatchDatabase,
  scope: FeedDeletionScope,
  logger: Logger,
  now: () => string = nowInstant,
): Promise<number> {
  let removed = 0;
  // Resolved on the first page rather than up front: a firm with no rows to delete never had objects,
  // and must not be refused for a bucket it was never going to be asked to reach.
  let bucket: R2Bucket | null = null;
  for (;;) {
    const page = await readFeedObjectsForDeletion(firmDatabase, scope, DELETION_PAGE_SIZE);
    if (page.length === 0) break;
    bucket ??= await feedBucket(env, firmId);
    await bucket.delete(page.map((row) => row.objectKey));
    const removedAt = now();
    await commitEffectBatch(
      firmDatabase,
      {
        statements: page.map((row) =>
          markFeedObjectRemovedStatement(firmDatabase, row.fileId, row.version, removedAt),
        ),
        outboxMessages: [],
      },
      { now },
    );
    removed += page.length;
    if (page.length < DELETION_PAGE_SIZE) break;
  }

  await reconcileNaturalLanguageFeed(env, firmId, firmDatabase, scope, logger, now);
  return removed;
}

// ── Reconciliation ──────────────────────────────────────────────────────────

export interface FeedReconciliationReport {
  readonly consistent: boolean;
  readonly objectsWithoutLiveRow: number;
  readonly liveRowsWithoutObject: number;
}

// Compare the catalog against a listing of the feed prefix. Either direction of disagreement is an
// inconsistency to raise: an object with no live row means something reached the feed prefix outside
// the writer, or a recorded deletion never executed; a live row with no object means a write was
// recorded and the bytes are gone.
//
// It runs as part of every teardown, and its result is recorded — which is what makes the opt-out
// confirmation a demonstration rather than an assertion.
export async function reconcileNaturalLanguageFeed(
  env: Bindings,
  firmId: string,
  firmDatabase: ProxyBatchDatabase,
  scope: FeedDeletionScope,
  logger: Logger,
  now: () => string = nowInstant,
): Promise<FeedReconciliationReport> {
  const prefix =
    scope.kind === "matter"
      ? `${NATURAL_LANGUAGE_FEED_PREFIX}${scope.matterId}/`
      : NATURAL_LANGUAGE_FEED_PREFIX;
  const listed = await (
    await feedBucket(env, firmId)
  ).list({
    prefix,
    limit: RECONCILIATION_PAGE_SIZE,
  });
  const listedKeys = new Set(listed.objects.map((object) => object.key));

  const rows = await enumerateFeedObjects(firmDatabase, scope, RECONCILIATION_PAGE_SIZE);
  const liveKeys = new Set(
    rows.filter((row) => row.removedAt === null).map((row) => row.objectKey),
  );

  const objectsWithoutLiveRow = [...listedKeys].filter((key) => !liveKeys.has(key)).length;
  const liveRowsWithoutObject = [...liveKeys].filter((key) => !listedKeys.has(key)).length;
  const report: FeedReconciliationReport = {
    consistent: objectsWithoutLiveRow === 0 && liveRowsWithoutObject === 0,
    objectsWithoutLiveRow,
    liveRowsWithoutObject,
  };

  if (!report.consistent) {
    logger.log(
      naturalLanguageFeedReconciliationMismatch(
        { correlationId: newCorrelationId(), now: now() },
        { objectsWithoutLiveRow, liveRowsWithoutObject },
      ),
    );
  }
  return report;
}

// The per-firm queue's entry points. Each resolves nothing the dispatcher has not already resolved —
// the firm's database handle arrives with the message — and each is the whole handler, so the
// dispatch table stays a table.
export function handleNaturalLanguageProvision(
  env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  firmId: string,
  logger: Logger,
): Promise<void> {
  return provisionNaturalLanguageInstance(env, firmId as FirmId, firmDatabase, logger);
}

export function handleNaturalLanguageTeardown(
  env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  firmId: string,
  logger: Logger,
): Promise<void> {
  return tearDownNaturalLanguageInstance(env, firmId as FirmId, firmDatabase, logger);
}

export async function handleNaturalLanguageFeedDeletion(
  env: Bindings,
  firmId: string,
  firmDatabase: ProxyBatchDatabase,
  scope: FeedDeletionScope,
  logger: Logger,
): Promise<void> {
  await deleteNaturalLanguageFeed(env, firmId, firmDatabase, scope, logger);
}

// Resolve the firm's database the way every other per-firm consumer does, for callers that have a
// firm id and no handle.
export function naturalLanguageFirmDatabase(env: Bindings, firmId: string): ProxyBatchDatabase {
  return firmDatabaseFor(env.FIRM_DATABASE, firmId);
}

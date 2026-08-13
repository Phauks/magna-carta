import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { createApp, type Bindings } from "./app.ts";
import { documentAssemblyQueue } from "./assemblies/assembly-consumer.ts";
import type { DocumentAssemblyMessage } from "./assemblies/assembly-types.ts";
import { conversionQueue } from "./conversions/conversion-consumer.ts";
import type { ConversionMessage } from "./conversions/conversion-types.ts";
import { perFirmQueue, type PerFirmQueueMessage } from "./costs/recoverable-charge-consumer.ts";
import { bundleBuildQueue } from "./downloads/bundle-consumer.ts";
import type { BundleBuildMessage } from "./downloads/bundle-types.ts";
import { emailsCaptureQueue, type EmailsCaptureMessage } from "./emails/capture-consumer.ts";
import { ingestQueue, type R2EventMessage } from "./files/ingest-consumer.ts";
import { inferenceQueue, type InferenceJob } from "./inference/inference-consumer.ts";
import { magnusQueue } from "./magnus/magnus-consumer.ts";
import type { MagnusTurnJob } from "./magnus/magnus-types.ts";
import { runIdleCheckoutSweep } from "./editing/idle-checkout-sweep.ts";
import { runTieringSweep } from "./editing/tiering-sweep.ts";
import { runDimensionBackfillSweep } from "./files/dimension-backfill-sweep.ts";
import { recoveryQueue } from "./recovery/recovery-consumer.ts";
import type { RecoveryShardMessage } from "./recovery/recovery-types.ts";
import {
  runNotificationRetentionSweep,
  runScheduledSweep,
  runStatusSnapshot,
  runStorageReconciliation,
} from "./scheduled.ts";
import { runReextractionSweep } from "./search/reextraction-sweep.ts";
import { searchIndexQueue } from "./search/index-consumer.ts";
import { searchCompactionQueue } from "./search/compaction-consumer.ts";
import type { SearchCompactionMessage } from "./search/compaction-types.ts";
import { runSearchCompactionSweep } from "./search/compaction-sweep.ts";
import type { SearchIndexMessage } from "./search/index-types.ts";
import { LiveTimerDurableObject } from "./timer/live-timer-durable-object.ts";

// The async bulk-download coordinator Durable Object must be exported from the Worker's main entrypoint
// so the runtime can instantiate the class named in wrangler.jsonc's durable_objects binding.
export { BundleBuildCoordinator } from "./downloads/bundle-coordinator.ts";

// The conversion-job coordinator Durable Object: keyed firmId:jobId, single-flights one conversion
// per job. Exported so the runtime can instantiate the class named in wrangler.jsonc's binding.
export { ConversionJob } from "./conversions/conversion-coordinator.ts";

// The document-assembly job coordinator Durable Object: keyed firmId:assemblyId, single-flights one
// assembly per job. Exported so the runtime can instantiate the class named in wrangler.jsonc's binding.
export { DocumentAssemblyJob } from "./assemblies/assembly-coordinator.ts";

// The per-firm SQLite-backed database Durable Object: one instance per firm (idFromName(firmId)),
// self-migrating on wake. Must be exported here so the runtime can instantiate the class named in
// wrangler.jsonc's durable_objects binding.
export { FirmDatabase } from "./firm-database/firm-database-object.ts";

// The password-recovery job coordinator Durable Object: fans a recovery job out across shards and
// aggregates outcomes. Exported so the runtime can instantiate the class named in wrangler.jsonc's
// durable_objects binding.
export { RecoveryJobCoordinator } from "./recovery/recovery-coordinator.ts";

// The search-index job coordinator Durable Object: keyed firmId:documentId:version, single-flights one
// split build per document version. Exported so the runtime can instantiate the class named in
// wrangler.jsonc's durable_objects binding.
export { SearchIndexJob } from "./search/index-coordinator.ts";
export { SearchCompactionJob } from "./search/compaction-coordinator.ts";

// The conversational assistant's per-conversation push object, keyed firmId:conversationId. It holds
// NO conversation content — it reads turn state back from the firm's own database and pushes it.
// Exported so the runtime can instantiate the class named in wrangler.jsonc's binding.
export { MagnusConversation } from "./magnus/magnus-conversation.ts";

// One discovery load's fan-out coordinator, keyed firmId:loadId. It holds the load's cursor and chunk
// state in durable storage and nothing on the instance, so an eviction mid-fan-out resumes where the
// load actually got to. Exported so the runtime can instantiate the class named in wrangler.jsonc.
export { DiscoveryLoadCoordinator } from "./discovery/discovery-load-coordinator.ts";

// The bundle-build queue's name (wrangler.jsonc queues.consumers) — the queue() handler routes its
// batches to the bundle consumer, every other queue to the files-ingest consumer.
const BUNDLE_BUILD_QUEUE = "magna-carta-production-bundle-build";

// The per-document editing session coordinator. Re-exported so wrangler can register the Durable
// Object class named in wrangler.jsonc (durable_objects + the SQLite migration).
export { DocumentSession } from "./editing/document-session.ts";

// The server-conversion queue's name — the queue() handler routes its batches to the conversion
// consumer, which runs the ConversionPort adapter to convert the source to the target format.
const CONVERSION_QUEUE = "magna-carta-production-conversion";

// The shared per-firm job queue's name (the env.QUEUE producer the outbox relay publishes to) — the
// queue() handler routes its batches to the per-firm cost-recovery consumer.
const PER_FIRM_JOB_QUEUE = "magna-carta-production-platform-jobs";

// The password-recovery shard queue's name — the queue() handler routes its batches to the recovery
// consumer, which runs one shard of a dictionary/rule search and reports its outcome back to the
// coordinator Durable Object.
const RECOVERY_QUEUE = "magna-carta-production-recovery-shard";
const EMAILS_CAPTURE_QUEUE = "magna-carta-production-emails-capture";

// The search-index queue's name — the queue() handler routes its batches to the index consumer, which
// extracts one document version's text, builds its split, and converges the per-firm split catalog.
const SEARCH_INDEX_QUEUE = "magna-carta-production-search-index";
const SEARCH_COMPACTION_QUEUE = "magna-carta-production-search-compaction";

// The document-assembly queue's name — the queue() handler routes its batches to the assembly consumer,
// which merges one template version against one matter and files the result through the ingest gate.
const DOCUMENT_ASSEMBLY_QUEUE = "magna-carta-production-document-assembly";

// The conversational assistant's queue name — the queue() handler routes its batches to the assistant
// consumer, which re-reads the firm's consent gates, builds the bounded conversation window, calls the
// one inference chokepoint, and settles the pending turn.
const MAGNUS_QUEUE = "magna-carta-production-magnus";

// createApp defaults the plugin runtime to the production seam — the firm_secret credential store
// throws until the marketplace wires the live credential read; carrier calls use a fetch-backed
// EasyPost client. Plugins mount from the registry; the core names none directly.
const app = createApp();

// The daily reconciliation Cron expression (wrangler.jsonc triggers.crons), distinct from the */5
// sweep — a full R2 LIST per firm is too heavy to run every five minutes.
const RECONCILIATION_CRON = "0 3 * * *";

// The status-snapshot Cron expression (wrangler.jsonc triggers.crons): probes the core primitives
// and polls the upstream provider feeds every ten minutes, independent of both the */5 outbox sweep
// and the daily reconciliation pass.
const STATUS_SNAPSHOT_CRON = "*/10 * * * *";

// fetch + scheduled + queue: the Hono app serves requests; the Cron triggers run the outbox relay
// sweeps + idempotency TTL purge + stale-pending upload sweep every 5 minutes, the storage
// reconciliation once daily, and the weekly re-scan sweep on Sundays at 04:00 UTC; the queue
// consumer ingests uploaded objects from the files-ingest queue (the R2 object-create event feed).
// waitUntil keeps the work alive past the handler return. Each scheduled pass routes a failure
// through the one telemetry pipeline (operation.failed) so a cron failure is never silently dropped.
export default {
  fetch: app.fetch,
  scheduled(controller, env, executionContext) {
    const pass =
      controller.cron === RECONCILIATION_CRON
        ? {
            // The daily storage-maintenance pass: reconcile the meter against the authoritative R2
            // LIST first, THEN tier cold superseded versions (so the tiering meter shift lands on an
            // already-reconciled baseline; next day's reconciliation backstops any tiering drift).
            operation: "cron:storage-reconciliation",
            run: async () => {
              await runStorageReconciliation(env);
              await runTieringSweep(env);
              // After tiering, because both rewrite objects and this one carries across whatever
              // storage class it finds — so it repairs what tiering has already settled rather than
              // racing it, and the next day's reconciliation backstops both.
              await runDimensionBackfillSweep(env);
              await runIdleCheckoutSweep(env);
              // Last: it only enqueues, so its cost lands on the search-index queue rather than on
              // this pass, and running it after the storage work means a firm whose bytes were just
              // reconciled is swept against the corrected picture.
              await runReextractionSweep(env);
              // After the re-extraction sweep, because that pass enqueues index work whose published
              // splits are exactly what this one then finds over threshold. It is also the pass that
              // retires superseded split objects, so it runs where a firm's storage picture has already
              // been reconciled rather than against a stale one.
              await runSearchCompactionSweep(env);
              // Last on the daily pass, and cheap: a bounded delete per firm over pointers whose
              // records are all still where their own subsystems keep them.
              await runNotificationRetentionSweep(env);
            },
          }
        : controller.cron === STATUS_SNAPSHOT_CRON
          ? { operation: "cron:status-snapshot", run: () => runStatusSnapshot(env) }
          : { operation: "cron:scheduled-sweep", run: () => runScheduledSweep(env) };
    executionContext.waitUntil(
      pass.run().catch((caught: unknown) => {
        logOperationFailed(createWorkersLogger(env.TELEMETRY), pass.operation, caught);
      }),
    );
  },
  queue(batch, env) {
    // The bundle-build queue routes to the async bulk-download consumer (R2 -> client-zip -> R2).
    if (batch.queue === BUNDLE_BUILD_QUEUE) {
      return bundleBuildQueue(batch as MessageBatch<BundleBuildMessage>, env);
    }
    // The inference queue carries inference jobs (the model call runs off the request path).
    if (batch.queue === "magna-carta-production-inference") {
      return inferenceQueue(batch as MessageBatch<InferenceJob>, env);
    }
    // The conversion queue routes to the conversion consumer (ConversionPort adapter).
    if (batch.queue === CONVERSION_QUEUE) {
      return conversionQueue(batch as MessageBatch<ConversionMessage>, env);
    }
    // The shared per-firm job queue carries the outbox relay's per-firm topics (firmId-tagged). Its
    // dispatch table owns shipment.purchased (matter cost recovery) and emailCaptureAddress.minted
    // (registering a capture token in the control-plane routing index), and ACK-AND-IGNOREs every
    // other topic on the bus.
    if (batch.queue === PER_FIRM_JOB_QUEUE) {
      return perFirmQueue(batch as MessageBatch<PerFirmQueueMessage>, env);
    }
    // The recovery shard queue routes to the recovery consumer (one dictionary/rule shard per message).
    if (batch.queue === RECOVERY_QUEUE) {
      return recoveryQueue(batch as MessageBatch<RecoveryShardMessage>, env);
    }
    // The email-capture queue routes to the capture consumer (one filing job per message).
    if (batch.queue === EMAILS_CAPTURE_QUEUE) {
      return emailsCaptureQueue(batch as MessageBatch<EmailsCaptureMessage>, env);
    }
    // The search-index queue routes to the index consumer (extract -> build split -> catalog).
    if (batch.queue === SEARCH_INDEX_QUEUE) {
      return searchIndexQueue(batch as MessageBatch<SearchIndexMessage>, env);
    }
    // The split-compaction queue routes to the compaction consumer (merge -> publish -> catalog swap).
    if (batch.queue === SEARCH_COMPACTION_QUEUE) {
      return searchCompactionQueue(batch as MessageBatch<SearchCompactionMessage>, env);
    }
    // The assistant's queue routes to its consumer (re-read the gates -> window -> model -> settle).
    if (batch.queue === MAGNUS_QUEUE) {
      return magnusQueue(batch as MessageBatch<MagnusTurnJob>, env);
    }
    // The document-assembly queue routes to the assembly consumer (resolve -> merge -> file).
    if (batch.queue === DOCUMENT_ASSEMBLY_QUEUE) {
      return documentAssemblyQueue(batch as MessageBatch<DocumentAssemblyMessage>, env);
    }
    // Both the interactive files-ingest queue and the bulk files-ingest-bulk queue route to the
    // same ingest handler — the lane separation is entirely in queue topology and concurrency.
    return ingestQueue(batch as MessageBatch<R2EventMessage>, env);
  },
} satisfies ExportedHandler<Bindings>;

// The Durable Object class the DURABLE_TIMER binding instantiates — exported from the Worker entrypoint
// so the runtime can construct it. The timer routes proxy to it; it writes no business data itself.
export { LiveTimerDurableObject };

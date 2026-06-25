import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { createApp, type Bindings } from "./app.ts";
import { conversionQueue } from "./conversions/conversion-consumer.ts";
import type { ConversionMessage } from "./conversions/conversion-types.ts";
import { bundleBuildQueue } from "./downloads/bundle-consumer.ts";
import type { BundleBuildMessage } from "./downloads/bundle-types.ts";
import { ingestQueue, type R2EventMessage } from "./files/ingest-consumer.ts";
import { inferenceQueue, type InferenceJob } from "./inference/inference-consumer.ts";
import { runIdleCheckoutSweep } from "./editing/idle-checkout-sweep.ts";
import { runTieringSweep } from "./editing/tiering-sweep.ts";
import { runScheduledSweep, runStorageReconciliation } from "./scheduled.ts";
import { LiveTimerDurableObject } from "./timer/live-timer-durable-object.ts";

// The async bulk-download coordinator Durable Object must be exported from the Worker's main entrypoint
// so the runtime can instantiate the class named in wrangler.jsonc's durable_objects binding.
export { BundleBuildCoordinator } from "./downloads/bundle-coordinator.ts";

// The conversion-job coordinator Durable Object: keyed firmId:jobId, single-flights one conversion
// per job. Exported so the runtime can instantiate the class named in wrangler.jsonc's binding.
export { ConversionJob } from "./conversions/conversion-coordinator.ts";

// The bundle-build queue's name (wrangler.jsonc queues.consumers) — the queue() handler routes its
// batches to the bundle consumer, every other queue to the files-ingest consumer.
const BUNDLE_BUILD_QUEUE = "magna-carta-production-bundle-build";

// The per-document editing session coordinator. Re-exported so wrangler can register the Durable
// Object class named in wrangler.jsonc (durable_objects + the SQLite migration).
export { DocumentSession } from "./editing/document-session.ts";

// The server-conversion queue's name — the queue() handler routes its batches to the conversion
// consumer, which runs the ConversionPort adapter to convert the source to the target format.
const CONVERSION_QUEUE = "magna-carta-production-conversion";

// createApp defaults the plugin runtime to the production seam — the firm_secret credential store
// throws until the marketplace wires the live credential read; carrier calls use a fetch-backed
// EasyPost client. Plugins mount from the registry; the core names none directly.
const app = createApp();

// The daily reconciliation Cron expression (wrangler.jsonc triggers.crons), distinct from the */5
// sweep — a full R2 LIST per firm is too heavy to run every five minutes.
const RECONCILIATION_CRON = "0 3 * * *";

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
              await runIdleCheckoutSweep(env);
            },
          }
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
    // The inference queue carries inference jobs (env.AI.run off the request path).
    if (batch.queue === "magna-carta-production-inference") {
      return inferenceQueue(batch as MessageBatch<InferenceJob>, env);
    }
    // The conversion queue routes to the conversion consumer (ConversionPort adapter).
    if (batch.queue === CONVERSION_QUEUE) {
      return conversionQueue(batch as MessageBatch<ConversionMessage>, env);
    }
    // Both the interactive files-ingest queue and the bulk files-ingest-bulk queue route to the
    // same ingest handler — the lane separation is entirely in queue topology and concurrency.
    return ingestQueue(batch as MessageBatch<R2EventMessage>, env);
  },
} satisfies ExportedHandler<Bindings>;

// The Durable Object class the DURABLE_TIMER binding instantiates — exported from the Worker entrypoint
// so the runtime can construct it. The timer routes proxy to it; it writes no business data itself.
export { LiveTimerDurableObject };

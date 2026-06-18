import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { createApp, type Bindings } from "./app.ts";
import { bundleBuildQueue } from "./downloads/bundle-consumer.ts";
import type { BundleBuildMessage } from "./downloads/bundle-types.ts";
import { ingestQueue, type R2EventMessage } from "./files/ingest-consumer.ts";
import { runRescanSweep, runScheduledSweep, runStorageReconciliation } from "./scheduled.ts";

// The async bulk-download coordinator Durable Object must be exported from the Worker's main entrypoint
// so the runtime can instantiate the class named in wrangler.jsonc's durable_objects binding.
export { BundleBuildCoordinator } from "./downloads/bundle-coordinator.ts";

// The malware-scan Container class (a DO-backed Container). Exported so the runtime can instantiate it
// once the deploy-time wrangler `containers`/DO binding names it; an unused export is otherwise inert.
export { ScanContainer } from "./files/scan-container.ts";

// The bundle-build queue's name (wrangler.jsonc queues.consumers) — the queue() handler routes its
// batches to the bundle consumer, every other queue to the files-ingest consumer.
const BUNDLE_BUILD_QUEUE = "magna-carta-production-bundle-build";

const app = createApp();

// The daily reconciliation Cron expression (wrangler.jsonc triggers.crons), distinct from the */5
// sweep — a full R2 LIST per firm is too heavy to run every five minutes.
const RECONCILIATION_CRON = "0 3 * * *";

// The weekly re-scan sweep: finds committed versions still marked scan_verdict = 'unscanned' and
// re-enqueues them onto FILES_INGEST so a now-available scan engine can evaluate them in place.
// Dormant until the scan engine lands; the sweep seam is built now so the engine can wire in
// without touching the scheduling layer.
const RESCAN_SWEEP_CRON = "0 4 * * 0";

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
        ? { operation: "cron:storage-reconciliation", run: () => runStorageReconciliation(env) }
        : controller.cron === RESCAN_SWEEP_CRON
          ? { operation: "cron:rescan-sweep", run: () => runRescanSweep(env) }
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
    // Both the interactive files-ingest queue and the bulk files-ingest-bulk queue route to the
    // same ingest handler — the lane separation is entirely in queue topology and concurrency.
    return ingestQueue(batch as MessageBatch<R2EventMessage>, env);
  },
} satisfies ExportedHandler<Bindings>;

import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { createApp, type Bindings } from "./app.ts";
import { ingestQueue, type R2EventMessage } from "./files/ingest-consumer.ts";
import { inferenceQueue, type InferenceJob } from "./inference/inference-consumer.ts";
import { runScheduledSweep, runStorageReconciliation } from "./scheduled.ts";

// The per-document editing session coordinator. Re-exported so wrangler can register the Durable
// Object class named in wrangler.jsonc (durable_objects + the SQLite migration).
export { DocumentSession } from "./editing/document-session.ts";

// createApp defaults the plugin runtime to the production seam — the firm_secret credential store
// throws until the marketplace wires the live credential read; carrier calls use a fetch-backed
// EasyPost client. Plugins mount from the registry; the core names none directly.
const app = createApp();

// The daily reconciliation Cron expression (wrangler.jsonc triggers.crons), distinct from the */5
// sweep — a full R2 LIST per firm is too heavy to run every five minutes.
const RECONCILIATION_CRON = "0 3 * * *";

// fetch + scheduled + queue: the Hono app serves requests; the Cron triggers run the outbox relay
// sweeps + idempotency TTL purge + stale-pending upload sweep every 5 minutes, and the storage
// reconciliation once daily; the queue consumer ingests uploaded objects from the files-ingest queue
// (the R2 object-create event feed). waitUntil keeps the work alive past the handler return. Each
// scheduled pass routes a failure through the one telemetry pipeline (operation.failed) — the same
// boundary the request-path sweep uses — so a cron failure is never silently dropped.
export default {
  fetch: app.fetch,
  scheduled(controller, env, executionContext) {
    const pass =
      controller.cron === RECONCILIATION_CRON
        ? { operation: "cron:storage-reconciliation", run: () => runStorageReconciliation(env) }
        : { operation: "cron:scheduled-sweep", run: () => runScheduledSweep(env) };
    executionContext.waitUntil(
      pass.run().catch((caught: unknown) => {
        logOperationFailed(createWorkersLogger(env.TELEMETRY), pass.operation, caught);
      }),
    );
  },
  queue(batch, env) {
    // Route by the producing queue's name: inference carries inference jobs; files-ingest carries R2
    // events (the only other consumed queue). A queue with no branch here is a misconfigured binding.
    if (batch.queue === "magna-carta-production-inference") {
      return inferenceQueue(batch as MessageBatch<InferenceJob>, env);
    }
    return ingestQueue(batch as MessageBatch<R2EventMessage>, env);
  },
} satisfies ExportedHandler<Bindings>;

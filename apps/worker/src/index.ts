import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { fetchHttpClient } from "@magna-carta/shipping/easypost/http";
import { createApp, type Bindings } from "./app.ts";
import { ingestQueue, type R2EventMessage } from "./files/ingest-consumer.ts";
import { runScheduledSweep, runStorageReconciliation } from "./scheduled.ts";
import { firmSecretStoreNotYetAvailable } from "./shipping/secret-store.ts";

// Shipping is wired with the real fetch-backed EasyPost client; its credential store throws until the
// firm_secret store lands (slice 1·2), so the routes are registered but cannot resolve a live account
// in production yet — the single swap that turns shipping on is firmSecretStoreNotYetAvailable.
const app = createApp({
  shipping: { secretStoreForFirm: firmSecretStoreNotYetAvailable, httpClient: fetchHttpClient() },
});

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
    // The only queue this Worker consumes is files-ingest; its messages are R2 events.
    return ingestQueue(batch as MessageBatch<R2EventMessage>, env);
  },
} satisfies ExportedHandler<Bindings>;

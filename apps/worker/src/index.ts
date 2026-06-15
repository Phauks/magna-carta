import { createApp, type Bindings } from "./app.ts";
import { ingestQueue, type R2EventMessage } from "./files/ingest-consumer.ts";
import { runScheduledSweep, runStorageReconciliation } from "./scheduled.ts";

const app = createApp();

// The daily reconciliation Cron expression (wrangler.jsonc triggers.crons), distinct from the */5
// sweep — a full R2 LIST per firm is too heavy to run every five minutes.
const RECONCILIATION_CRON = "0 3 * * *";

// fetch + scheduled + queue: the Hono app serves requests; the Cron triggers run the outbox relay
// sweeps + idempotency TTL purge + stale-pending upload sweep every 5 minutes, and the storage
// reconciliation once daily; the queue consumer ingests uploaded objects from the files-ingest queue
// (the R2 object-create event feed). waitUntil keeps the work alive past the handler return.
export default {
  fetch: app.fetch,
  scheduled(controller, env, executionContext) {
    if (controller.cron === RECONCILIATION_CRON) {
      executionContext.waitUntil(runStorageReconciliation(env));
    } else {
      executionContext.waitUntil(runScheduledSweep(env));
    }
  },
  queue(batch, env) {
    // The only queue this Worker consumes is files-ingest; its messages are R2 events.
    return ingestQueue(batch as MessageBatch<R2EventMessage>, env);
  },
} satisfies ExportedHandler<Bindings>;

import { createApp, type Bindings } from "./app.ts";
import { ingestQueue, type R2EventMessage } from "./files/ingest-consumer.ts";
import { runScheduledSweep } from "./scheduled.ts";

const app = createApp();

// fetch + scheduled + queue: the Hono app serves requests; the Cron trigger (wrangler.jsonc
// triggers.crons, every 5 minutes) runs the outbox relay sweeps and the idempotency TTL purge;
// the queue consumer ingests uploaded objects from the files-ingest queue (the R2 object-create
// event feed). waitUntil keeps the sweep alive past the handler return (the Workers idiom).
export default {
  fetch: app.fetch,
  scheduled(_controller, env, executionContext) {
    executionContext.waitUntil(runScheduledSweep(env));
  },
  queue(batch, env) {
    // The only queue this Worker consumes is files-ingest; its messages are R2 events.
    return ingestQueue(batch as MessageBatch<R2EventMessage>, env);
  },
} satisfies ExportedHandler<Bindings>;

import { createApp, type Bindings } from "./app.ts";
import { runScheduledSweep } from "./scheduled.ts";

const app = createApp();

// fetch + scheduled: the Hono app serves requests; the Cron trigger (wrangler.jsonc
// triggers.crons, every 5 minutes) runs the outbox relay sweeps and the idempotency TTL purge.
// waitUntil keeps the sweep alive past the handler return (the Workers scheduled-handler idiom).
export default {
  fetch: app.fetch,
  scheduled(_controller, env, executionContext) {
    executionContext.waitUntil(runScheduledSweep(env));
  },
} satisfies ExportedHandler<Bindings>;

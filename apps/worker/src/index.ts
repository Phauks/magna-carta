import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { createApp, type Bindings } from "./app.ts";
import { runScheduledSweep } from "./scheduled.ts";

const app = createApp();

// fetch + scheduled: the Hono app serves requests; the Cron trigger (wrangler.jsonc
// triggers.crons, every 5 minutes) runs the outbox relay sweeps and the idempotency TTL purge —
// the scheduled plumbing slice 0·2 deferred. waitUntil keeps the sweep alive past the handler
// return (the Workers scheduled-handler idiom). A control-plane sweep/purge failure rejects the
// pass; route it through the one telemetry pipeline (operation.failed) — the same boundary the
// request-path sweep uses — so a cron failure is never silently dropped (golden rule 4).
export default {
  fetch: app.fetch,
  scheduled(_controller, env, executionContext) {
    executionContext.waitUntil(
      runScheduledSweep(env).catch((caught: unknown) => {
        logOperationFailed(createWorkersLogger(env.TELEMETRY), "cron:scheduled-sweep", caught);
      }),
    );
  },
} satisfies ExportedHandler<Bindings>;

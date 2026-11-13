/*
 * The Worker entrypoint, kept deliberately THIN: Cloudflare validates every deploy against a
 * startup CPU budget covering all module-scope work (error 10021, "Script startup exceeded CPU
 * time limit"), and this Worker crossed it on 2026-08-31 — production deploys failed until the
 * heavy graph moved out of the entrypoint's static imports. What must be synchronous at startup
 * stays here: the Durable Object class re-exports the runtime instantiates by the names in
 * wrangler.jsonc. Everything that runs only when an event arrives — the Hono app, the Cron pass
 * router, the queue-batch router, and their whole import graph of route schemas, consumers, and
 * sweeps — lives in event-dispatch.ts and is reached through a DYNAMIC import, which the runtime
 * evaluates on the first event rather than at validation.
 *
 * Adding a consumer, sweep, or route belongs in event-dispatch.ts (or below it), never as a new
 * static import here. A static import added to this file spends the startup budget for the whole
 * fleet; prove it fits with `wrangler check startup` before shipping it. Budget reasoning:
 * docs/conventions/build-performance.md.
 */
import type { Bindings } from "./bindings.ts";
import { resolveApiWorkerSecrets } from "./stored-secrets.ts";

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

// One meeting's signaling room, keyed firmId:meetingId. It brokers each participant's session with
// the media routing service and keeps the roster; no media and nothing anybody said passes through
// it. Exported so the runtime can instantiate the class named in wrangler.jsonc's binding.
export { MeetingRoom } from "./meetings/meeting-room.ts";

// One recording's sink, keyed firmId:recordingId — the object the routing service's WebSocket adapters
// dial, which stages each track's audio in the firm's own bucket and holds none of it in storage.
// Exported so the runtime can instantiate the class named in wrangler.jsonc's binding.
export { MeetingRecorder } from "./meetings/meeting-recorder.ts";
export { MeetingCaptioner } from "./meetings/meeting-captioner.ts";

// One connected calendar account's sync passes, keyed firmId:connectionId. It holds who it is for
// and nothing of the calendar. Exported so the runtime can instantiate the class named in
// wrangler.jsonc's binding.
export { ConnectionSync } from "./calendar-sync/connection-sync.ts";

// The per-document editing session coordinator. Re-exported so wrangler can register the Durable
// Object class named in wrangler.jsonc (durable_objects + the SQLite migration).
export { DocumentSession } from "./editing/document-session.ts";

// The Durable Object class the DURABLE_TIMER binding instantiates — exported from the Worker
// entrypoint so the runtime can construct it. The timer routes proxy to it; it writes no business
// data itself.
export { LiveTimerDurableObject } from "./timer/live-timer-durable-object.ts";
export { SafeBrowseSession } from "./safe-browse/safe-browse-session.ts";

// Each handler resolves the secrets bound from the account's Secrets Store into the plain strings the
// rest of the Worker reads (src/stored-secrets.ts). With none bound it returns the same env, unread.
//
// The one dynamic import, shared by all three handlers and resolved once per isolate. A dynamic
// import is idempotent and cached by the runtime, so racing events share the same evaluation.
function dispatch(): Promise<typeof import("./event-dispatch.ts")> {
  return import("./event-dispatch.ts");
}

// fetch + scheduled + queue: the Hono app serves requests; the Cron triggers run the outbox relay
// sweeps + idempotency TTL purge + stale-pending upload sweep every 5 minutes, the storage
// reconciliation once daily, and the weekly re-scan sweep on Sundays at 04:00 UTC; the queue
// consumer ingests uploaded objects from the files-ingest queue (the R2 object-create event feed).
// waitUntil keeps the work alive past the handler return. Each scheduled pass routes a failure
// through the one telemetry pipeline (operation.failed) so a cron failure is never silently dropped.
export default {
  // The request param is annotated as a plain Request (not the contextual
  // IncomingRequestCfProperties-typed one) so callers that construct a Request — the Miniflare
  // tests driving worker.fetch directly — stay assignable, exactly as Hono's own fetch signature
  // allowed when this was `fetch: app.fetch`.
  async fetch(request: Request, env: Bindings, executionContext: ExecutionContext) {
    const [{ resolveApp }, resolvedEnv] = await Promise.all([
      dispatch(),
      resolveApiWorkerSecrets(env),
    ]);
    return resolveApp().fetch(request, resolvedEnv, executionContext);
  },
  scheduled(controller, env, executionContext) {
    executionContext.waitUntil(
      Promise.all([dispatch(), resolveApiWorkerSecrets(env)]).then(
        ([{ runScheduledPass }, resolvedEnv]) => runScheduledPass(controller, resolvedEnv),
      ),
    );
  },
  async queue(batch, env) {
    const [{ routeQueueBatch }, resolvedEnv] = await Promise.all([
      dispatch(),
      resolveApiWorkerSecrets(env),
    ]);
    return routeQueueBatch(batch, resolvedEnv);
  },
} satisfies ExportedHandler<Bindings>;

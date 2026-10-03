/*
 * The event-dispatch module: everything the Worker does when an event actually arrives — the Hono
 * app behind fetch, the Cron pass router, and the queue-batch router. Split out of index.ts and
 * reached from there ONLY through a dynamic import, never statically: this module's import graph
 * (every route's zod schemas and OpenAPI metadata, every consumer, every sweep) is the bulk of the
 * Worker's startup CPU, and Cloudflare validates a deploy against a startup budget that
 * module-scope work must fit inside (error 10021, "Script startup exceeded CPU time limit" — this
 * Worker crossed it on 2026-08-31 and production deploys failed until the graph moved here). The
 * first event after a cold start pays the module evaluation instead; every later event reuses it.
 * Budget reasoning: docs/conventions/build-performance.md.
 *
 * index.ts stays the entrypoint and keeps only what MUST be synchronous at startup: the Durable
 * Object class re-exports the runtime instantiates by name. Adding a consumer or sweep belongs
 * here; adding anything to index.ts's static import graph spends the startup budget and needs a
 * `wrangler check startup` run to prove it still fits.
 */
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { setServiceIdentity } from "@magna-carta/telemetry/service-identity";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { createApp, type Bindings } from "./app.ts";
import { documentAssemblyQueue } from "./assemblies/assembly-consumer.ts";
import type { DocumentAssemblyMessage } from "./assemblies/assembly-types.ts";
import { runTemplateOrphanSweep } from "./assemblies/template-orphan-sweep.ts";
import { conversionQueue } from "./conversions/conversion-consumer.ts";
import type { ConversionMessage } from "./conversions/conversion-types.ts";
import { perFirmQueue, type PerFirmQueueMessage } from "./costs/recoverable-charge-consumer.ts";
import { bundleBuildQueue } from "./downloads/bundle-consumer.ts";
import type { BundleBuildMessage } from "./downloads/bundle-types.ts";
import { emailsCaptureQueue, type EmailsCaptureMessage } from "./emails/capture-consumer.ts";
import { ingestQueue, type R2EventMessage } from "./files/ingest-consumer.ts";
import { inferenceQueue, type InferenceJob } from "./inference/inference-consumer.ts";
import { magnusQueue } from "./magnus/magnus-consumer.ts";
import type {
  MeetingRecordingComposeMessage,
  MeetingRecordingQueueMessage,
  MeetingSummaryMessage,
  MeetingTranscriptMessage,
} from "./meetings/meeting-recorder.ts";
import { meetingRecordingComposeQueue } from "./meetings/recording-compose-consumer.ts";
import { runRecordingSweep } from "./meetings/recording-sweep.ts";
import { meetingSummaryQueue } from "./meetings/summary-consumer.ts";
import { meetingTranscriptQueue } from "./meetings/transcript-consumer.ts";
import type { MagnusTurnJob } from "./magnus/magnus-types.ts";
import { runIdleCheckoutSweep } from "./editing/idle-checkout-sweep.ts";
import { runTieringSweep } from "./editing/tiering-sweep.ts";
import { runDimensionBackfillSweep } from "./files/dimension-backfill-sweep.ts";
import { recoveryQueue } from "./recovery/recovery-consumer.ts";
import type { RecoveryShardMessage } from "./recovery/recovery-types.ts";
import {
  runConflictsRecheckSweep,
  runNotificationComparisonSweep,
  runNotificationDigestPass,
  runNotificationRetentionSweep,
  runScheduledSweep,
  runStatusSnapshot,
  runStorageReconciliation,
} from "./scheduled.ts";
import { runDownloadShelfRetentionSweep } from "./downloads/shelf-retention-sweep.ts";
import { runReextractionSweep } from "./search/reextraction-sweep.ts";
import { discoveryProcessQueue } from "./discovery/process-consumer.ts";
import type { DiscoveryLaneMessage } from "./discovery/discovery-process-types.ts";
import { searchIndexQueue } from "./search/index-consumer.ts";
import { searchCompactionQueue } from "./search/compaction-consumer.ts";
import type { SearchCompactionMessage } from "./search/compaction-types.ts";
import { runSearchCompactionSweep } from "./search/compaction-sweep.ts";
import { runNaturalLanguageKeepAliveSweep } from "./search/natural-language-keep-alive.ts";
import type { SearchIndexMessage } from "./search/index-types.ts";

// Announced here rather than in index.ts, which is held to a startup CPU budget this package's
// import graph would spend. Every fetch, Cron pass and queue batch reaches the Worker through this
// module, so an Error ID minted on any of those paths carries the service by the time it is needed.
setServiceIdentity("api");

// The bundle-build queue's name (wrangler.jsonc queues.consumers) — routeQueueBatch routes its
// batches to the bundle consumer, every other queue to the files-ingest consumer.
const BUNDLE_BUILD_QUEUE = "magna-carta-production-bundle-build";

// The server-conversion queue's name — routeQueueBatch routes its batches to the conversion
// consumer, which runs the ConversionPort adapter to convert the source to the target format.
const CONVERSION_QUEUE = "magna-carta-production-conversion";

// The shared per-firm job queue's name (the env.QUEUE producer the outbox relay publishes to) — the
// routeQueueBatch routes its batches to the per-firm cost-recovery consumer.
const PER_FIRM_JOB_QUEUE = "magna-carta-production-platform-jobs";

// The password-recovery shard queue's name — routeQueueBatch routes its batches to the recovery
// consumer, which runs one shard of a dictionary/rule search and reports its outcome back to the
// coordinator Durable Object.
const RECOVERY_QUEUE = "magna-carta-production-recovery-shard";
const EMAILS_CAPTURE_QUEUE = "magna-carta-production-emails-capture";

// The search-index queue's name — routeQueueBatch routes its batches to the index consumer, which
// extracts one document version's text, builds its split, and converges the per-firm split catalog.
const SEARCH_INDEX_QUEUE = "magna-carta-production-search-index";
const SEARCH_COMPACTION_QUEUE = "magna-carta-production-search-compaction";

// The discovery processing queue's name — routeQueueBatch routes its batches to the processing
// consumer, which reads one review document's bytes through the composite extraction port, writes its
// text and metadata sidecar to R2, and ends the document in exactly one terminal state. Its own lane,
// apart from every ingest lane, so a quarter-million-document load cannot starve interactive upload.
const DISCOVERY_PROCESS_QUEUE = "magna-carta-production-discovery-process";

// The document-assembly queue's name — routeQueueBatch routes its batches to the assembly consumer,
// which merges one template version against one matter and files the result through the ingest gate.
const DOCUMENT_ASSEMBLY_QUEUE = "magna-carta-production-document-assembly";

// The conversational assistant's queue name — routeQueueBatch routes its batches to the assistant
// consumer, which re-reads the firm's consent gates, builds the bounded conversation window, calls the
// one inference chokepoint, and settles the pending turn.
const MAGNUS_QUEUE = "magna-carta-production-magnus";

// The meeting-recording compose queue's name — routeQueueBatch routes its batches to the compose
// consumer, which mixes one bounded window of a stopped recording's staged tracks into the composite,
// re-enqueues the next window, and files the finished recording through the upload pipeline.
const MEETING_RECORDING_COMPOSE_QUEUE = "magna-carta-production-meeting-recording-compose";

// createApp defaults the plugin runtime to the production seam — the firm_secret credential store
// throws until the marketplace wires the live credential read; carrier calls use a fetch-backed
// EasyPost client. Plugins mount from the registry; the core names none directly. Built once on the
// first request and reused — constructing it registers every route, which must never run at the
// entrypoint's module scope (see the header).
let app: ReturnType<typeof createApp> | undefined;
export function resolveApp(): ReturnType<typeof createApp> {
  app ??= createApp();
  return app;
}

// The daily reconciliation Cron expression (wrangler.jsonc triggers.crons), distinct from the */5
// sweep — a full R2 LIST per firm is too heavy to run every five minutes.
const RECONCILIATION_CRON = "0 3 * * *";

// The status-snapshot Cron expression (wrangler.jsonc triggers.crons): probes the core primitives
// and polls the upstream provider feeds every ten minutes, independent of both the */5 outbox sweep
// and the daily reconciliation pass.
const STATUS_SNAPSHOT_CRON = "*/10 * * * *";

// The notification-digest Cron expression (wrangler.jsonc triggers.crons). Hourly and no finer: a
// summary is anchored to the FIRM's own morning rather than to UTC's, so the pass has to wake every
// hour and ask each firm whether its local hour has come round. Firms whose hour it is not cost two
// small setting reads; only the firm whose morning it is does any work. A deployment with no
// outbound-mail provisioning exits the pass before it reads a single firm.
const NOTIFICATION_DIGEST_CRON = "0 * * * *";

// The weekly natural-language search keep-alive Cron expression (wrangler.jsonc triggers.crons).
// Sundays at 04:00 UTC, after the daily reconciliation pass has run and while nothing else is on the
// clock.
//
// Its own trigger rather than a rider on the daily pass, because the work is genuinely weekly: a
// managed search instance that goes a month without a request has its scheduled syncs paused, and one
// query a week sits comfortably inside that window at a seventh of the metered cost of a daily one.
// The failure it removes is the worst shape this feature has — not an error, but silently stale
// answers on an index nobody was told had stopped syncing.
// Sunday is `1` and not `0`. Cloudflare's cron parser numbers days of the week 1 = Sunday through
// 7 = Saturday, where almost every other implementation reads 0 as Sunday. `0 4 * * 0` is not a
// different-but-valid spelling — it is out of range, and the schedule write is one atomic call for
// the whole set, so it refuses every other trigger along with it. This constant and the expression
// in wrangler.jsonc have to change together: the dispatch chain in runScheduledPass ends in a
// catch-all that runs the five-minute sweep, so a constant that matches no configured expression
// does not fail loudly, it silently runs the control-plane migration pass on this schedule instead.
const NATURAL_LANGUAGE_KEEP_ALIVE_CRON = "0 4 * * 1";

/**
 * One Cron firing: pick the pass for the trigger's expression and run it. Each pass routes a
 * failure through the one telemetry pipeline (operation.failed) so a cron failure is never
 * silently dropped. The returned promise is what the entrypoint hands to waitUntil.
 */
export async function runScheduledPass(
  controller: ScheduledController,
  env: Bindings,
): Promise<void> {
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
            // The template-orphan MEASUREMENT, which despite sitting next to the collector above is
            // the opposite shape and deletes nothing: the compaction retirement removes objects its
            // own rows name as superseded, while this one reasons from the ABSENCE of a row over a
            // keyspace that is not firm-scoped. That complement is only trustworthy if the live set
            // is provably complete, and it is not — the pass says why in its own header. It has no
            // ordering relationship with anything here, because nothing meters the templates/
            // prefix and nothing acts on what it finds.
            //
            // Wrapped because its first two reads sit ahead of its per-firm guards: a control-plane
            // hiccup there would otherwise throw out of the whole chain and skip every sweep below,
            // and a pass that only counts must never be able to cost a pass that acts.
            try {
              await runTemplateOrphanSweep(env);
            } catch (error) {
              logOperationFailed(
                createWorkersLogger(env.TELEMETRY),
                "cron:template-orphan-sweep",
                error,
              );
            }
            // The comparison-driven notification pass, BEFORE retention rather than after: it
            // writes the rows retention then ages, and running it second would mean a firm's
            // freshly-raised overdue notice was swept on the same pass that raised it if the
            // window were ever set to its floor. Its dedupe key buckets by civil date, so a
            // second run in the same day writes nothing new.
            await runNotificationComparisonSweep(env);
            // Then, and cheap: a bounded delete per firm over pointers whose records are all
            // still where their own subsystems keep them.
            await runNotificationRetentionSweep(env);
            // The conflicts backstop. It rides the DAILY pass rather than the */5 sweep because
            // `scheduleRequestPathSweep` runs that sweep on `waitUntil` after a provisioning route
            // commits — anything added to it executes on the tail of an HTTP request, and running
            // full conflicts checks there is exactly the work that must not go on a request path.
            // Nothing is lost by the wait: the queue is the primary path and answers a cause within
            // one relay cycle; this only catches what the queue structurally cannot.
            await runConflictsRecheckSweep(env);
            // The download shelf's retention pass, beside the other storage passes: a bounded
            // delete per firm of shelf rows whose window has closed, and of the stored export
            // documents behind them. Cheap, and the only thing keeping the shelf a shelf.
            await runDownloadShelfRetentionSweep(env);
          },
        }
      : controller.cron === STATUS_SNAPSHOT_CRON
        ? {
            operation: "cron:status-snapshot",
            run: async () => {
              await runStatusSnapshot(env);
              // The recording sweep rides this ten-minute pass rather than a trigger of its own (the
              // trigger set is one atomic write, and a fourth has never been proved on this account)
              // and rather than the five-minute sweep (which also runs on a request's tail). Wrapped,
              // so a sweep that fails can never cost the status snapshot, and the reverse is already
              // true because the snapshot records its own failures.
              try {
                await runRecordingSweep(env);
              } catch (caught) {
                logOperationFailed(
                  createWorkersLogger(env.TELEMETRY),
                  "cron:recording-sweep",
                  caught,
                );
              }
            },
          }
        : controller.cron === NOTIFICATION_DIGEST_CRON
          ? {
              operation: "cron:notification-digest",
              run: () => runNotificationDigestPass(env),
            }
          : controller.cron === NATURAL_LANGUAGE_KEEP_ALIVE_CRON
            ? {
                operation: "cron:natural-language-keep-alive",
                run: async () => {
                  await runNaturalLanguageKeepAliveSweep(env);
                },
              }
            : { operation: "cron:scheduled-sweep", run: () => runScheduledSweep(env) };
  await pass.run().catch((caught: unknown) => {
    logOperationFailed(createWorkersLogger(env.TELEMETRY), pass.operation, caught);
  });
}

/** One queue batch: route it by queue name to its consumer. */
export function routeQueueBatch(batch: MessageBatch, env: Bindings): void | Promise<void> {
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
  // The discovery processing queue routes to the processing consumer (read -> extract -> record),
  // which also answers the one completion message a load sends when its last document ends.
  if (batch.queue === DISCOVERY_PROCESS_QUEUE) {
    return discoveryProcessQueue(batch as MessageBatch<DiscoveryLaneMessage>, env);
  }
  // The meeting-recording queue carries two kinds of message, routed by `kind`: the compose (mix a
  // window -> file) and the transcript the filing begins (transcribe a window -> assemble -> file).
  if (batch.queue === MEETING_RECORDING_COMPOSE_QUEUE) {
    return routeMeetingRecordingBatch(batch as MessageBatch<MeetingRecordingQueueMessage>, env);
  }
  // The document-assembly queue routes to the assembly consumer (resolve -> merge -> file).
  if (batch.queue === DOCUMENT_ASSEMBLY_QUEUE) {
    return documentAssemblyQueue(batch as MessageBatch<DocumentAssemblyMessage>, env);
  }
  // Both the interactive files-ingest queue and the bulk files-ingest-bulk queue route to the
  // same ingest handler — the lane separation is entirely in queue topology and concurrency.
  return ingestQueue(batch as MessageBatch<R2EventMessage>, env);
}

/**
 * ONE QUEUE, THREE CONSUMERS: the recording queue's messages split by their `kind` — the compose, the
 * transcript and the summary — and each share handed to its own consumer as a batch of its own. A message of a kind neither knows — a message sent by a later
 * deploy and read by an earlier one during a rollout — is retried rather than acknowledged, so it is
 * read again by the code that knows it instead of being lost.
 */
async function routeMeetingRecordingBatch(
  batch: MessageBatch<MeetingRecordingQueueMessage>,
  env: Bindings,
): Promise<void> {
  const { compose, transcript, summary } = splitMeetingRecordingBatch(batch);
  if (compose !== null) await meetingRecordingComposeQueue(compose, env);
  if (transcript !== null) await meetingTranscriptQueue(transcript, env);
  if (summary !== null) await meetingSummaryQueue(summary, env);
}

/**
 * The split itself, with no consumer behind it: the compose, transcript and summary shares as batches of
 * their own (null when a kind has no message), every message of an unknown kind already retried.
 * Exported so the routing is tested apart from the consumers it hands to.
 */
export function splitMeetingRecordingBatch(batch: MessageBatch<MeetingRecordingQueueMessage>): {
  readonly compose: MessageBatch<MeetingRecordingComposeMessage> | null;
  readonly transcript: MessageBatch<MeetingTranscriptMessage> | null;
  readonly summary: MessageBatch<MeetingSummaryMessage> | null;
} {
  const compose: Message<MeetingRecordingComposeMessage>[] = [];
  const transcript: Message<MeetingTranscriptMessage>[] = [];
  const summary: Message<MeetingSummaryMessage>[] = [];
  for (const message of batch.messages) {
    const body = message.body as { readonly kind?: unknown };
    if (body.kind === "meeting-transcript") {
      transcript.push(message as Message<MeetingTranscriptMessage>);
    } else if (body.kind === "meeting-recording-compose") {
      compose.push(message as Message<MeetingRecordingComposeMessage>);
    } else if (body.kind === "meeting-summary") {
      summary.push(message as Message<MeetingSummaryMessage>);
    } else {
      message.retry();
    }
  }
  return {
    compose: compose.length > 0 ? subBatch(batch, compose) : null,
    transcript: transcript.length > 0 ? subBatch(batch, transcript) : null,
    summary: summary.length > 0 ? subBatch(batch, summary) : null,
  };
}

/** Some of a batch's messages, as a batch of their own for a consumer that reads only `messages`. */
function subBatch<Body>(
  batch: MessageBatch,
  messages: readonly Message<Body>[],
): MessageBatch<Body> {
  return {
    queue: batch.queue,
    metadata: batch.metadata,
    messages,
    ackAll: () => {
      for (const message of messages) message.ack();
    },
    retryAll: (options?: QueueRetryOptions) => {
      for (const message of messages) message.retry(options);
    },
  };
}

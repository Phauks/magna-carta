import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  inferenceDedupStatements,
  tokenUsageCommitStatements,
  type TokenUsageKey,
} from "@magna-carta/data-access/token-usage-statements";
import { catalogEntryFor } from "@magna-carta/inference/catalog";
import type { FirmId } from "@magna-carta/identifiers/types";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../../bindings.ts";
import { firmDatabaseFor } from "../../firm-database/firm-database-proxy.ts";
import { inferencePortFor, resolveReasoningModel } from "../../inference/call-site.ts";

// The inference queue consumer runs OFF the hot path: a single firm cannot starve the shared gateway
// cap synchronously on the request path. It resolves the firm's per-firm database by firmId, routes
// through the firmRateGate back-pressure seam, calls the AI binding, captures the authoritative token
// usage from the response, and writes the metering record through the firm-scoped data-access layer —
// the firm's own per-firm database handle is the structural isolation.

export interface InferenceJob {
  readonly firmId: string;
  // Vestigial: the firm is addressed by firmId through its per-firm FirmDatabase Durable Object, so
  // this no longer selects the database. Retained until producers stop writing it.
  readonly databaseIdentifier: string;
  readonly prompt: string;
  // The producer's stable per-run idempotency anchor: identical across a redelivery of the SAME run,
  // so the two dedup guards below collapse a redelivery to a single spend + a single meter. The
  // producer (src/timekeeping/narrative-inference.ts) mints it via buildInferenceJobIdempotencyKey;
  // the consumer's inferenceJobDedupKey namespaces it for the dedup record family.
  readonly idempotencyKey: string;
}

// The per-run dedup record key: namespaced off the producer's idempotency key so it cannot collide
// with any other idempotency-record family in the firm database.
export function inferenceJobDedupKey(producerKey: string): string {
  return `inference:${producerKey}`;
}

// The per-firm back-pressure seam: a pass-through no-op at launch, sited between the queue dequeue
// and the AI binding call. A per-firm token bucket (or a Durable Object per firm) drops in here
// when load is measured without touching the InferencePort contract or any call site — only this
// body changes.
export function firmRateGate(_firmId: string): void {
  // Intentionally empty: the launch posture relies on queue dispatch + a single firm-scoped gateway
  // spend rule for back-pressure; the per-firm limiter is added when load is measured.
}

// The metering bucket key: a run's UTC civil date + the model's slot + the model id.
export function tokenUsageKeyForDay(nowIso: string, slot: string, modelId: string): TokenUsageKey {
  return { day: civilDateOf(nowIso), slot, modelId };
}

const ENVIRONMENT_LABEL = "production";

export async function handleInferenceJob(env: Bindings, job: InferenceJob): Promise<void> {
  // The firm's per-firm FirmDatabase Durable Object is addressed by its firmId and self-migrates the
  // per-firm lineage on first access — every firm is reachable by name. The firm came from the
  // job's firm-scoped context, never client input.
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, job.firmId);

  firmRateGate(job.firmId);

  const modelId = await resolveReasoningModel(firmDatabase);
  const port = inferencePortFor(env.AI, ENVIRONMENT_LABEL);
  const result = await port.generate({
    modelId,
    prompt: job.prompt,
    firmId: job.firmId as FirmId,
  });

  if (!result.ok) {
    // A model/gateway failure is a first-class adapter-error. A retryable problem (transient
    // gateway overload, timeout) throws so the queue redelivers and dead-letters at max attempts.
    // A terminal problem (the fail-closed ZDR refusal, capability-unsupported) acks — retrying
    // cannot help it and a retry loop would burn attempts on an unrecoverable state.
    if (result.problem?.retryable === true) {
      throw new Error(`inference adapter-error (${result.problem.category})`);
    }
    return;
  }

  const entry = catalogEntryFor(modelId);
  const slot = entry?.slot ?? "reasoning";
  // EXACTLY-ONCE on a redelivery is two guards over the producer's idempotency key. The queue is
  // at-least-once, and the model spend at port.generate above precedes the commit below, so a
  // redelivery would otherwise both re-bill the frontier model AND re-meter.
  //   Guard 1 (the re-BILL stop): a pre-model-call read of the dedup record keyed by
  //   inferenceJobDedupKey(job.idempotencyKey). On a hit the run already committed, so the model
  //   call is skipped entirely — the spend never repeats. The narrative call-site in
  //   src/timekeeping/narrative-inference.ts wires this pre-call read when the live suggestion
  //   feature ships in slice 3·5; the gated dark producer reaches no model today, so there is
  //   nothing to re-bill — the record family + key derivation are what land now.
  //   Guard 2 (the re-METER stop): the dedup record INSERT is composed into the SAME batch as the
  //   metering write, so the second delivery loses the UNIQUE(key) race and its whole batch — meter
  //   increment included — rolls back. The same-batch precedent is
  //   apps/api-worker/src/background/files/ingest-consumer.ts (runIdempotentEffect): the dedup record and the
  //   effect commit or roll back together.
  // One timestamp for the whole batch: the bucket day and the dedup row are provably consistent
  // (no latent UTC-midnight split between reading the day and writing the rows).
  const nowIso = new Date().toISOString();
  const key = tokenUsageKeyForDay(nowIso, slot, modelId);
  await commitEffectBatch(
    firmDatabase,
    {
      statements: [
        ...tokenUsageCommitStatements(
          firmDatabase,
          key,
          result.value.usage.inputTokens,
          result.value.usage.outputTokens,
        ),
        ...inferenceDedupStatements(firmDatabase, inferenceJobDedupKey(job.idempotencyKey), nowIso),
      ],
      outboxMessages: [],
    },
    { now: () => nowIso },
  );
}

// The queue() handler: one message at a time, ack on success, retry on a transient throw. A retried
// message is redelivered (at-least-once) and dead-lettered once it exhausts its attempts. Per-message
// ack so a single bad message never re-runs an already-committed sibling.
export async function inferenceQueue(
  batch: MessageBatch<InferenceJob>,
  env: Bindings,
): Promise<void> {
  // One logger per batch; a failed message routes through the one telemetry pipeline and is retried,
  // dead-lettering at max attempts. The console ban is structural (see docs/conventions/error-logging.md).
  const logger = createWorkersLogger(env.TELEMETRY);
  for (const message of batch.messages) {
    try {
      await handleInferenceJob(env, message.body);
      message.ack();
    } catch (error) {
      logOperationFailed(logger, `queue:inference:${message.id}`, error, newCorrelationId());
      message.retry();
    }
  }
}

import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  tokenUsageCommitStatements,
  type TokenUsageKey,
} from "@magna-carta/data-access/token-usage-statements";
import { catalogEntryFor } from "@magna-carta/inference/catalog";
import type { FirmId } from "@magna-carta/identifiers/types";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../app.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { inferencePortFor, resolveReasoningModel } from "./call-site.ts";

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
  return { day: nowIso.slice(0, 10), slot, modelId };
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
  // This path is at-least-once with NO idempotency guard. A redelivery of the SAME message — e.g.
  // port.generate above succeeded but commitEffectBatch below then threw, so the queue retries the
  // message — RE-RUNS the model (re-billing a frontier model) and re-meters (request_count += 1).
  // Making it exactly-once requires a producer-set stable idempotency key on InferenceJob plus a dedup
  // guard composed into the SAME batch as the metering write (and, because the model spend precedes the
  // commit, ideally a pre-model-call check too). That lands with the first AI feature's producer — there
  // is no producer and no key to guard on yet. The same-batch-commit precedent is
  // apps/worker/src/files/ingest-consumer.ts (runIdempotentEffect): the dedup record and the effect
  // commit or roll back together.
  // One timestamp for the whole batch: the bucket day and any future batch-stamped row are then
  // provably consistent (no latent UTC-midnight split between reading the day and writing the rows).
  const nowIso = new Date().toISOString();
  const key = tokenUsageKeyForDay(nowIso, slot, modelId);
  await commitEffectBatch(
    firmDatabase,
    {
      statements: tokenUsageCommitStatements(
        firmDatabase,
        key,
        result.value.usage.inputTokens,
        result.value.usage.outputTokens,
      ),
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

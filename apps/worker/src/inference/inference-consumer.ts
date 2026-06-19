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
import { resolveFirmDatabase } from "../firm-binding-resolver.ts";
import { inferencePortFor, resolveReasoningModel } from "./call-site.ts";

// The inference queue consumer runs OFF the hot path: a single firm cannot starve the shared gateway
// cap synchronously on the request path. It derives the firm database from the firm-scoped job context,
// routes through the firmRateGate back-pressure seam, calls the AI binding, captures the authoritative
// token usage from the response, and writes the metering record through the firm-scoped data-access
// layer — the firm's own D1 handle is the structural isolation.

export interface InferenceJob {
  readonly firmId: string;
  readonly databaseIdentifier: string; // the firm's database binding name (the firm-scoped context)
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
  // An unknown database identifier means this deployment cannot reach the firm — ack and move on.
  // Retrying cannot conjure a missing binding; the ingest consumer uses the same pattern.
  const firmDatabase = resolveFirmDatabase(env, job.databaseIdentifier);
  if (firmDatabase === null) return;

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
  const now = () => new Date().toISOString();
  const key = tokenUsageKeyForDay(now(), slot, modelId);
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
    { now },
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

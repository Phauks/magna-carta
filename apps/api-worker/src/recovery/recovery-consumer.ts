import type { Bindings } from "../bindings.ts";
import { resolveRecoveryBackend } from "./recovery-backend.ts";
import type { RecoveryBackend, RecoveryJobStatus, RecoveryShardMessage } from "./recovery-types.ts";

// Mirrors conversions/conversion-consumer.ts's coordinatorFor helper: the DO stub is keyed
// firmId:jobId, one coordinator per recovery job.
function coordinatorFor(env: Bindings, message: RecoveryShardMessage) {
  return env.RECOVERY_JOB.get(env.RECOVERY_JOB.idFromName(`${message.firmId}:${message.jobId}`));
}

// Matches RecoveryJobCoordinator's own terminal set (recovery-coordinator.ts) exactly. Not
// exported from there, so duplicated here rather than reaching into the DO's internals.
function isTerminal(status: RecoveryJobStatus): boolean {
  return (
    status === "found" || status === "exhausted" || status === "needsGpu" || status === "cancelled"
  );
}

async function dispatchOne(
  env: Bindings,
  message: RecoveryShardMessage,
  resolveBackend: (env: Bindings) => RecoveryBackend | null,
): Promise<void> {
  const coordinator = coordinatorFor(env, message);

  // Queues cannot delete an already-enqueued message, so every shard checks in before dispatch:
  // once a peer shard has won (found) or the job was cancelled/exhausted, later shards skip the
  // (expensive) container dispatch entirely rather than racing a done job.
  const state = await coordinator.status();
  if (isTerminal(state.status)) return;

  const backend = resolveBackend(env);
  if (backend === null) {
    // The recovery service is unbound (pre-deploy or test). Report an honest zero-count miss so
    // the job still terminates exhausted once every shard has checked in — never fabricate a hit.
    await coordinator.reportShard(message.shardIndex, { found: null, candidatesTried: 0 });
    return;
  }

  const outcome = await backend.recoverShard(message);
  await coordinator.reportShard(message.shardIndex, outcome);
}

export async function recoveryQueue(
  batch: MessageBatch<RecoveryShardMessage>,
  env: Bindings,
  resolveBackend: (env: Bindings) => RecoveryBackend | null = resolveRecoveryBackend,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await dispatchOne(env, message.body, resolveBackend);
      message.ack();
    } catch {
      // Transport/unexpected failure: retry the shard. The coordinator's per-shard dedup and
      // terminal guard (recovery-coordinator.ts) make a retried-then-succeeded duplicate report
      // idempotent — a late report that lands after the job is already done is dropped there.
      message.retry();
    }
  }
}

import { z } from "@hono/zod-openapi";
import type { Bindings } from "../bindings.ts";
import type { RecoveryBackend, RecoveryShardMessage, ShardOutcome } from "./recovery-types.ts";

// The recovery container's JSON reply — mirrors the Rust ShardOutcome. The response is validated
// against this schema, so a malformed body is a fault (a retryable throw), never a silently
// fabricated miss or hit.
const shardOutcomeSchema: z.ZodType<ShardOutcome> = z.object({
  found: z.string().nullable(),
  candidatesTried: z.number().int(),
});

// The worker-side ceiling on a single shard request. Mirrors the scan container's backstop
// (files/container-scan-adapter.ts): the container enforces its own hashcat run-time budget per
// shard, so it should always answer; this turns a wedged container (a hung process the runtime has
// not yet recycled) into a retryable throw rather than a request that hangs past the platform's
// subrequest timeout.
const RECOVERY_REQUEST_TIMEOUT_MS = 11 * 60 * 1000;

// Builds the one RecoveryBackend this slice ships: a typed, zod-validated fetch over the
// RECOVERY_SERVICE binding to apps/recovery-worker. Sets the per-shard X-Recovery-Instance header
// (`jobId:shardIndex`) so the fleet fans a job out across distinct container instances. POSTs the
// shard-by-count contract (hash + format + hashcatMode + shardIndex/shardCount + ruleSet) — never
// the file bytes, never wordStart/wordEnd. THROWS on any non-200 or malformed body — the queue
// consumer retries the message on a throw, so a backend fault never commits as a false miss. A
// later GPU-rung adapter plugs into the same RecoveryBackend interface with no coordinator rework.
export function cloudflareRecoveryBackend(
  service: Fetcher,
  requestTimeoutMs: number = RECOVERY_REQUEST_TIMEOUT_MS,
): RecoveryBackend {
  return {
    async recoverShard(message: RecoveryShardMessage): Promise<ShardOutcome> {
      const response = await service.fetch(
        new Request("http://recovery/recover-shard", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Recovery-Instance": `${message.jobId}:${message.shardIndex}`,
          },
          body: JSON.stringify({
            hash: message.hash,
            format: message.format,
            hashcatMode: message.hashcatMode,
            shardIndex: message.shardIndex,
            shardCount: message.shardCount,
            ruleSet: message.ruleSet,
          }),
          // A streaming request body requires the half-duplex hint in the Workers runtime.
          duplex: "half",
          // A wedged container becomes a retryable throw (AbortError) here rather than a hang; the
          // consumer re-queues, so a stuck shard never resolves as an exhausted false negative.
          signal: AbortSignal.timeout(requestTimeoutMs),
        } as RequestInit & { duplex: "half" }),
      );
      if (response.status !== 200) {
        throw new Error(`recovery service returned status ${response.status}`);
      }
      return shardOutcomeSchema.parse(await response.json());
    },
  };
}

// Resolve the active recovery backend. The container lives in the standalone recovery-worker
// (apps/recovery-worker), reached over the RECOVERY_SERVICE binding; selected here when the binding
// is present. Null before the recovery worker is deployed and in every test environment (a service
// binding to an unavailable service will not boot the pool) — the consumer treats null as an honest
// zero-count miss, never a false hit.
export function resolveRecoveryBackend(env: Bindings): RecoveryBackend | null {
  return env.RECOVERY_SERVICE !== undefined
    ? cloudflareRecoveryBackend(env.RECOVERY_SERVICE)
    : null;
}

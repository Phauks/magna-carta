import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../app.ts";
import type {
  RecoveryCoordinator,
  RecoveryJobState,
  RecoveryStartInput,
  ShardOutcome,
} from "./recovery-types.ts";

// The fan-out + aggregation coordinator for one recovery job, keyed firmId:jobId. start() persists
// `queued` (or the terminal `needsGpu` for a slow-KDF hash never attempted on Cloudflare), arms a
// stuck-job alarm, and enqueues one message per shard. Each shard's container reports back through
// reportShard: candidatesTried sums across shards, and the FIRST shard to find the password wins —
// every later report (a race between shards, or a stale retry) is dropped once the job is terminal,
// so a slower shard can never overwrite a password already surfaced. The alarm fails a job that never
// finishes fanning in closed — exhausted, never a fabricated password. Extends the single-flight
// pattern of bundle-coordinator.ts / conversion-coordinator.ts with the one thing neither precedent
// needs: a shard loop on enqueue and a counter aggregation on report.
const STUCK_DEADLINE_MS = 10 * 60 * 1000;

const UNKNOWN: RecoveryJobState = {
  status: "exhausted",
  tier: "cfCapable",
  progress: { candidatesTried: 0, shardsDone: 0, shardCount: 0 },
  password: null,
  error: "unknown job",
};

function isTerminal(status: RecoveryJobState["status"]): boolean {
  return (
    status === "found" || status === "exhausted" || status === "needsGpu" || status === "cancelled"
  );
}

export class RecoveryJobCoordinator extends DurableObject<Bindings> implements RecoveryCoordinator {
  async start(input: RecoveryStartInput): Promise<RecoveryJobState> {
    const existing = (await this.ctx.storage.get<RecoveryJobState>("state")) ?? null;
    if (existing !== null) return existing; // idempotent submit

    if (input.tier === "gpuRequired") {
      // Slow KDF — not attempted on the Cloudflare-CPU lane. Terminal on arrival: no shards, no alarm.
      const state: RecoveryJobState = {
        status: "needsGpu",
        tier: input.tier,
        progress: { candidatesTried: 0, shardsDone: 0, shardCount: 0 },
        password: null,
        error: null,
      };
      await this.ctx.storage.put("state", state);
      return state;
    }

    const state: RecoveryJobState = {
      status: "queued",
      tier: input.tier,
      progress: { candidatesTried: 0, shardsDone: 0, shardCount: input.shardCount },
      password: null,
      error: null,
    };
    await this.ctx.storage.put("state", state);
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
    for (let shardIndex = 0; shardIndex < input.shardCount; shardIndex++) {
      await this.env.RECOVERY_QUEUE.send({
        firmId: input.firmId,
        jobId: input.jobId,
        shardIndex,
        shardCount: input.shardCount,
        hash: input.hash,
        format: input.format,
        hashcatMode: input.hashcatMode,
        ruleSet: input.ruleSet,
      });
    }
    return state;
  }

  async reportShard(shardIndex: number, outcome: ShardOutcome): Promise<void> {
    const state = await this.ctx.storage.get<RecoveryJobState>("state");
    if (state === undefined || isTerminal(state.status)) return; // first hit / cancel already won

    // At-least-once queue delivery can redeliver a shard's message, so the same shard can report
    // more than once. Dedup per shard index (internal DO bookkeeping, kept out of the RPC-returned
    // RecoveryJobState) so a duplicate never double-counts shardsDone/candidatesTried — otherwise a
    // duplicate could push shardsDone to shardCount before every distinct shard has actually
    // reported, flip the job to a terminal exhausted, and drop a genuinely-later `found`. Defense in
    // depth: correct even if the consumer is not itself idempotent.
    const reportedShards = (await this.ctx.storage.get<number[]>("reportedShards")) ?? [];
    if (reportedShards.includes(shardIndex)) return; // redelivered report — already counted
    await this.ctx.storage.put("reportedShards", [...reportedShards, shardIndex]);

    const progress = {
      candidatesTried: state.progress.candidatesTried + outcome.candidatesTried,
      shardsDone: state.progress.shardsDone + 1,
      shardCount: state.progress.shardCount,
    };

    if (outcome.found !== null) {
      await this.ctx.storage.put("state", {
        ...state,
        status: "found",
        progress,
        password: outcome.found,
        error: null,
      });
      await this.ctx.storage.deleteAlarm();
      return;
    }

    // With per-shard dedup shardsDone can never overshoot shardCount, so an exact `===` is correct
    // and strictly safer than `>=` (which could terminate early on a miscount).
    if (progress.shardsDone === progress.shardCount) {
      await this.ctx.storage.put("state", { ...state, status: "exhausted", progress });
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.ctx.storage.put("state", { ...state, status: "running", progress });
  }

  async cancel(): Promise<void> {
    const state = await this.ctx.storage.get<RecoveryJobState>("state");
    if (state === undefined || isTerminal(state.status)) return;
    await this.ctx.storage.put("state", { ...state, status: "cancelled" });
    await this.ctx.storage.deleteAlarm();
  }

  async status(): Promise<RecoveryJobState> {
    return (await this.ctx.storage.get<RecoveryJobState>("state")) ?? UNKNOWN;
  }

  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<RecoveryJobState>("state");
    // A stuck fan-out (a shard container that never reports) fails closed: exhausted, never a
    // fabricated password. A terminal job (found/exhausted/needsGpu/cancelled) already has its
    // answer, so a zombie alarm firing late must not clobber it.
    if (state !== undefined && (state.status === "queued" || state.status === "running")) {
      await this.ctx.storage.put("state", {
        ...state,
        status: "exhausted",
        error: "recovery timed out",
      });
    }
  }
}

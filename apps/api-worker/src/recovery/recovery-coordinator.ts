import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../bindings.ts";
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
// The stuck-job deadline is a "time since last progress" watchdog, not a fixed guillotine: it is
// armed at start and RE-ARMED on every reported shard, so an actively-progressing job is never cut
// off mid-flight. It MUST exceed a single shard's full turnaround — recovery-backend.ts caps one
// shard's container request at RECOVERY_REQUEST_TIMEOUT_MS (11 min) — plus queue delivery and retry
// headroom, or the watchdog could fire while a shard is still legitimately searching and discard a
// real `found`. 20 min clears the 11 min per-shard budget with room for delivery/retry.
const STUCK_DEADLINE_MS = 20 * 60 * 1000;

// How long a recovered password is retained after `found` before the coordinator purges it. Long
// enough for the authorized requester to poll and retrieve it once, short enough that the most
// sensitive material in the subsystem does not sit in DO storage indefinitely ("surfaced once,
// never persisted long-term"). After purge the job stays `found` but the status route stops
// returning result.password.
const PASSWORD_RETENTION_MS = 60 * 60 * 1000;

const UNKNOWN: RecoveryJobState = {
  status: "exhausted",
  tier: "cfCapable",
  progress: { candidatesTried: 0, shardsDone: 0, shardCount: 0 },
  password: null,
  error: "unknown job",
  // No starter — an unknown job matches no user, so the status route's ownership check 404s it
  // exactly as it would a job owned by someone else (never distinguishing the two).
  startedByUserId: "",
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
        startedByUserId: input.startedByUserId,
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
      startedByUserId: input.startedByUserId,
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
      // Repurpose the alarm from stuck-watchdog to password-purge: the recovered password is held
      // only for the retention window, then alarm() nulls it (surfaced once, not persisted).
      await this.ctx.storage.setAlarm(Date.now() + PASSWORD_RETENTION_MS);
      return;
    }

    // With per-shard dedup shardsDone can never overshoot shardCount, so an exact `===` is correct
    // and strictly safer than `>=` (which could terminate early on a miscount).
    if (progress.shardsDone === progress.shardCount) {
      await this.ctx.storage.put("state", { ...state, status: "exhausted", progress });
      await this.ctx.storage.deleteAlarm();
      return;
    }

    // A shard reported a miss and the job is still running — re-arm the stuck watchdog so its
    // deadline measures time since THIS progress, never a fixed clock from job start.
    await this.ctx.storage.put("state", { ...state, status: "running", progress });
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
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
    if (state === undefined) return;

    // While the job is in flight the alarm is the stuck-fan-out watchdog: a shard container that
    // never reports fails the job closed — exhausted, never a fabricated password.
    if (state.status === "queued" || state.status === "running") {
      await this.ctx.storage.put("state", {
        ...state,
        status: "exhausted",
        error: "recovery timed out",
      });
      return;
    }

    // After `found` the alarm is the password-purge timer: null the recovered password once the
    // retention window elapses (surfaced once, never persisted long-term). The job stays `found`;
    // the status route simply stops returning result.password from here on.
    if (state.status === "found" && state.password !== null) {
      await this.ctx.storage.put("state", { ...state, password: null });
    }
  }
}

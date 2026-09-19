import { describe, expect, it } from "vitest";
import { recoveryQueue } from "../src/recovery/recovery-consumer.ts";
import type { Bindings } from "../src/bindings.ts";
import type {
  RecoveryJobState,
  RecoveryJobStatus,
  RecoveryShardMessage,
  ShardOutcome,
} from "../src/recovery/recovery-types.ts";

// recoveryQueue dispatches each shard to the recovery backend and reports the outcome back to the
// coordinator DO — unless the job is already terminal (a peer shard already won, or the job was
// cancelled), in which case dispatch is skipped and the message is just acked. RECOVERY_JOB is not
// yet declared on Bindings (lands with the binding-wiring task), so — like
// recovery-coordinator.test.ts — this fakes the coordinator stub directly rather than reaching a
// real Miniflare-registered DO.

let ackedCount = 0;
let retriedCount = 0;

interface FakeBindings {
  RECOVERY_JOB: {
    idFromName(name: string): string;
    get(id: string): {
      status(): Promise<RecoveryJobState>;
      reportShard(shardIndex: number, outcome: ShardOutcome): Promise<void>;
    };
  };
  _acked: number;
  _reported: Array<{ shardIndex: number; outcome: ShardOutcome }>;
}

function fakeEnv(options: { jobStatus: RecoveryJobStatus }): FakeBindings {
  ackedCount = 0;
  retriedCount = 0;
  const reported: Array<{ shardIndex: number; outcome: ShardOutcome }> = [];
  return {
    RECOVERY_JOB: {
      idFromName: (name) => name,
      get: () => ({
        status: async () => ({
          status: options.jobStatus,
          tier: "cfCapable",
          progress: { candidatesTried: 0, shardsDone: 0, shardCount: 4 },
          password: null,
          error: null,
          startedByUserId: "user_recovery_test",
        }),
        reportShard: async (shardIndex, outcome) => {
          reported.push({ shardIndex, outcome });
        },
      }),
    },
    get _acked() {
      return ackedCount;
    },
    get _reported() {
      return reported;
    },
  };
}

function shardMessage(overrides: Partial<RecoveryShardMessage> = {}): RecoveryShardMessage {
  return {
    firmId: "firm_recovery_test",
    jobId: "job_recovery_test",
    shardIndex: 0,
    shardCount: 4,
    hash: "$pdf$4*4*128*-1028*1*16*aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa*32*bb*8*cc",
    format: "pdf",
    hashcatMode: 10500,
    ruleSet: "none",
    ...overrides,
  };
}

function batchOf(message: RecoveryShardMessage): MessageBatch<RecoveryShardMessage> {
  return {
    queue: "magna-carta-production-recovery",
    messages: [
      {
        id: "msg-1",
        timestamp: new Date(),
        attempts: 1,
        body: message,
        ack: () => {
          ackedCount++;
        },
        retry: () => {
          retriedCount++;
        },
      },
    ],
  } as unknown as MessageBatch<RecoveryShardMessage>;
}

describe("recoveryQueue", () => {
  it("skips dispatch when the job is already terminal (first-hit-cancel)", async () => {
    let dispatched = 0;
    const env = fakeEnv({ jobStatus: "found" });
    const backend = {
      recoverShard: async () => {
        dispatched++;
        return { found: null, candidatesTried: 0 };
      },
    };
    await recoveryQueue(
      batchOf(shardMessage({ shardIndex: 2 })),
      env as unknown as Bindings,
      () => backend,
    );
    expect(dispatched).toBe(0);
    expect(env._acked).toBe(1);
    expect(env._reported).toEqual([]);
  });

  it("dispatches a live shard and reports the outcome back", async () => {
    const env = fakeEnv({ jobStatus: "running" });
    const backend = { recoverShard: async () => ({ found: null, candidatesTried: 9 }) };
    await recoveryQueue(
      batchOf(shardMessage({ shardIndex: 1 })),
      env as unknown as Bindings,
      () => backend,
    );
    expect(env._reported).toEqual([
      { shardIndex: 1, outcome: { found: null, candidatesTried: 9 } },
    ]);
    expect(env._acked).toBe(1);
  });

  it("reports an honest zero-count miss and acks when the backend is unbound (pre-deploy)", async () => {
    const env = fakeEnv({ jobStatus: "running" });
    await recoveryQueue(
      batchOf(shardMessage({ shardIndex: 3 })),
      env as unknown as Bindings,
      () => null,
    );
    expect(env._reported).toEqual([
      { shardIndex: 3, outcome: { found: null, candidatesTried: 0 } },
    ]);
    expect(env._acked).toBe(1);
  });

  it("retries the message on a thrown transport error, without reporting", async () => {
    const env = fakeEnv({ jobStatus: "running" });
    const backend = {
      recoverShard: async () => {
        throw new Error("container unreachable");
      },
    };
    await recoveryQueue(
      batchOf(shardMessage({ shardIndex: 0 })),
      env as unknown as Bindings,
      () => backend,
    );
    expect(env._reported).toEqual([]);
    expect(env._acked).toBe(0);
    expect(retriedCount).toBe(1);
  });
});

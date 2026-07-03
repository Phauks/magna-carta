import { describe, expect, it } from "vitest";
import { RecoveryJobCoordinator } from "../src/recovery/recovery-coordinator.ts";
import type { RecoveryShardMessage, RecoveryStartInput } from "../src/recovery/recovery-types.ts";

// Unit-tests the DO directly against a fake DurableObjectState — this coordinator has no wrangler.jsonc
// binding yet (that wiring, plus RECOVERY_QUEUE on Bindings, lands with the queue consumer that reports
// back to it), so it cannot be reached through the Miniflare `cloudflare:test` env the way
// bundle-coordinator.test.ts / conversion-coordinator.test.ts reach their registered DOs. The fake only
// implements the storage.get/put/setAlarm/deleteAlarm surface recovery-coordinator.ts touches.
//
// `new RecoveryJobCoordinator(fakeCtx, fakeEnv)` is not viable: workerd's native DurableObjectBase
// constructor rejects a non-native ctx with "constructor parameter 1 is not of type
// 'DurableObjectState'" — confirmed empirically. Since RecoveryJobCoordinator defines no constructor
// of its own (it only ever reads this.ctx / this.env, mirroring bundle-coordinator.ts and
// conversion-coordinator.ts, which reassign `.env` post-construction on a REAL DO instance to fake a
// downstream binding — proof that `env` is a plain writable own property, not a native accessor), the
// native constructor can be bypassed entirely with Object.create(prototype) plus a direct property
// assignment of ctx/env, without ever invoking the branded base constructor.

const HASH = "$pdf$4*4*128*-1028*1*16*aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa*32*bb*8*cc";

function input(overrides: Partial<RecoveryStartInput> = {}): RecoveryStartInput {
  return {
    tier: "cfCapable",
    shardCount: 3,
    hash: HASH,
    format: "ooxml",
    hashcatMode: 9600,
    ruleSet: "best64",
    firmId: "firm_x",
    jobId: "recoveryJob_1",
    ...overrides,
  };
}

// A minimal in-memory stand-in for DurableObjectState — only the storage surface
// recovery-coordinator.ts uses. Fresh per test so no state leaks between cases.
function fakeState(): DurableObjectState {
  const values = new Map<string, unknown>();
  let alarmTime: number | null = null;
  const storage = {
    get: async <T,>(key: string): Promise<T | undefined> => values.get(key) as T | undefined,
    put: async <T,>(key: string, value: T): Promise<void> => void values.set(key, value),
    setAlarm: async (time: number): Promise<void> => void (alarmTime = time),
    deleteAlarm: async (): Promise<void> => void (alarmTime = null),
    getAlarm: async (): Promise<number | null> => alarmTime,
  };
  return { storage } as unknown as DurableObjectState;
}

type FakeQueue = { send: (message: RecoveryShardMessage) => Promise<void> };

function newCoordinator(queue: FakeQueue): RecoveryJobCoordinator {
  const instance = Object.create(RecoveryJobCoordinator.prototype) as RecoveryJobCoordinator;
  const mutable = instance as unknown as { ctx: DurableObjectState; env: unknown };
  mutable.ctx = fakeState();
  mutable.env = { RECOVERY_QUEUE: queue };
  return instance;
}

describe("RecoveryJobCoordinator", () => {
  it("fans out shardCount messages and aggregates to exhausted when no shard finds it", async () => {
    const sent: RecoveryShardMessage[] = [];
    const coord = newCoordinator({ send: async (m) => void sent.push(m) });

    const state = await coord.start(input({ shardCount: 3 }));
    expect(state.status).toBe("queued");
    expect(state.progress).toEqual({ candidatesTried: 0, shardsDone: 0, shardCount: 3 });
    expect(sent.map((m) => m.shardIndex)).toEqual([0, 1, 2]);
    expect(sent.every((m) => m.hash === HASH)).toBe(true);

    await coord.reportShard(0, { found: null, candidatesTried: 10 });
    await coord.reportShard(1, { found: null, candidatesTried: 20 });
    const mid = await coord.status();
    expect(mid.status).toBe("running");
    expect(mid.progress).toEqual({ candidatesTried: 30, shardsDone: 2, shardCount: 3 });

    await coord.reportShard(2, { found: null, candidatesTried: 5 });
    const done = await coord.status();
    expect(done.status).toBe("exhausted");
    expect(done.progress).toEqual({ candidatesTried: 35, shardsDone: 3, shardCount: 3 });
    expect(done.password).toBeNull();
  });

  it("gpuRequired start is terminal and enqueues nothing", async () => {
    const sent: RecoveryShardMessage[] = [];
    const coord = newCoordinator({ send: async (m) => void sent.push(m) });

    const state = await coord.start(input({ tier: "gpuRequired", shardCount: 0 }));
    expect(state.status).toBe("needsGpu");
    expect(state.progress).toEqual({ candidatesTried: 0, shardsDone: 0, shardCount: 0 });
    expect(sent).toEqual([]);
  });

  it("start is idempotent — a second call returns the existing state without re-enqueuing", async () => {
    const sent: RecoveryShardMessage[] = [];
    const coord = newCoordinator({ send: async (m) => void sent.push(m) });

    await coord.start(input({ shardCount: 3 }));
    const again = await coord.start(input({ shardCount: 3 }));
    expect(again.status).toBe("queued");
    expect(sent).toHaveLength(3);
  });

  it("first hit wins and a later shard report is ignored", async () => {
    const coord = newCoordinator({ send: async () => {} });
    await coord.start(input({ shardCount: 3 }));

    await coord.reportShard(1, { found: "hunter2", candidatesTried: 12 });
    const found = await coord.status();
    expect(found.status).toBe("found");
    expect(found.password).toBe("hunter2");

    // A later, slower shard's report must not overwrite the password already surfaced.
    await coord.reportShard(2, { found: "other", candidatesTried: 4 });
    const after = await coord.status();
    expect(after.status).toBe("found");
    expect(after.password).toBe("hunter2");
  });

  it("cancel before completion is terminal and later reports are ignored", async () => {
    const coord = newCoordinator({ send: async () => {} });
    await coord.start(input({ shardCount: 3 }));

    await coord.reportShard(0, { found: null, candidatesTried: 7 });
    await coord.cancel();
    const cancelled = await coord.status();
    expect(cancelled.status).toBe("cancelled");

    await coord.reportShard(1, { found: "late", candidatesTried: 1 });
    const after = await coord.status();
    expect(after.status).toBe("cancelled");
    expect(after.password).toBeNull();

    // A second cancel is a no-op (idempotent).
    await coord.cancel();
    expect((await coord.status()).status).toBe("cancelled");
  });

  it("status of an unknown job returns a terminal exhausted / 'unknown job' default", async () => {
    const coord = newCoordinator({ send: async () => {} });
    const state = await coord.status();
    expect(state.status).toBe("exhausted");
    expect(state.error).toBe("unknown job");
  });

  it("alarm fails a still-queued job with 'recovery timed out', never fabricating a password", async () => {
    const coord = newCoordinator({ send: async () => {} });
    await coord.start(input({ shardCount: 3 }));
    await coord.reportShard(0, { found: null, candidatesTried: 1 });

    // Simulate the stuck-job alarm firing before every shard reports back.
    await coord.alarm();
    const state = await coord.status();
    expect(state.status).toBe("exhausted");
    expect(state.error).toBe("recovery timed out");
    expect(state.password).toBeNull();
  });

  it("alarm after found is a no-op — a zombie timeout cannot clobber a recovered password", async () => {
    const coord = newCoordinator({ send: async () => {} });
    await coord.start(input({ shardCount: 3 }));
    await coord.reportShard(0, { found: "hunter2", candidatesTried: 3 });

    await coord.alarm();
    const state = await coord.status();
    expect(state.status).toBe("found");
    expect(state.password).toBe("hunter2");
    expect(state.error).toBeNull();
  });
});

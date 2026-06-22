import { env, listDurableObjectIds, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { LiveTimerDurableObject } from "../src/timer/live-timer-durable-object.ts";

// Each test uses a unique name derived from a counter so there is no cross-test state bleed within
// the Miniflare session. Miniflare persists DO storage across tests in the same run (no automatic
// reset between its), so sharing a single constant name would let earlier tests poison later ones.
let testSeq = 0;
function uniqueName(suffix = ""): string {
  testSeq += 1;
  return `firm_test_${testSeq}:user_attorney${suffix}`;
}

describe("LiveTimerDurableObject — lifecycle", () => {
  let name: string;

  beforeEach(() => {
    name = uniqueName();
  });

  it("start returns a run id + start instant and sets an alarm", async () => {
    const stub = env.DURABLE_TIMER.getByName(name);
    const result = await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    expect(result.liveRunId).toMatch(/^timeEntry_/);
    expect(typeof result.startedAt).toBe("string");

    await runInDurableObject(stub, async (_instance: LiveTimerDurableObject, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  it("a second start replaces the first (single-active) and reschedules the alarm", async () => {
    const stub = env.DURABLE_TIMER.getByName(name);
    const first = await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    const second = await stub.start({ matterId: "matter_b", abandonedThresholdMinutes: 600 });
    expect(second.liveRunId).not.toBe(first.liveRunId);

    const read = await stub.read();
    expect(read).not.toBeNull();
    expect(read?.liveRunId).toBe(second.liveRunId);
    expect(read?.matterId).toBe("matter_b");
    expect(read?.status).toBe("running");
  });

  it("read returns null before any start", async () => {
    const stub = env.DURABLE_TIMER.getByName(name);
    expect(await stub.read()).toBeNull();
  });

  it("pause and resume move the status through the runtime", async () => {
    const stub = env.DURABLE_TIMER.getByName(name);
    await stub.start({ abandonedThresholdMinutes: 600 });
    expect((await stub.pause())?.status).toBe("paused");
    expect((await stub.resume())?.status).toBe("running");
  });

  it("bind attaches the matter to a scratch timer", async () => {
    const stub = env.DURABLE_TIMER.getByName(name);
    await stub.start({ abandonedThresholdMinutes: 600 });
    const bound = await stub.bind({ matterId: "matter_a", narrative: "drafted" });
    expect(bound?.matterId).toBe("matter_a");
    expect(bound?.narrative).toBe("drafted");
  });

  it("discard clears state and deletes the alarm", async () => {
    const stub = env.DURABLE_TIMER.getByName(name);
    await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    await stub.discard();
    expect(await stub.read()).toBeNull();
    await runInDurableObject(stub, async (_instance: LiveTimerDurableObject, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("isolates instances by firm:user name", async () => {
    // Two distinct names → two distinct DO instances. Starting one must not affect the other.
    const nameA = uniqueName("_a");
    const nameB = uniqueName("_b");
    const countBefore = (await listDurableObjectIds(env.DURABLE_TIMER)).length;

    const mine = env.DURABLE_TIMER.getByName(nameA);
    await mine.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });

    // mine has state. Starting mine created exactly one new DO instance.
    expect(await mine.read()).not.toBeNull();
    const countAfterOne = (await listDurableObjectIds(env.DURABLE_TIMER)).length;
    expect(countAfterOne).toBe(countBefore + 1);

    // A stub for a different name is a distinct instance — touching it (start + read) adds exactly
    // one more, and it has no state carried from mine.
    const theirs = env.DURABLE_TIMER.getByName(nameB);
    await theirs.start({ matterId: "matter_b", abandonedThresholdMinutes: 600 });
    expect((await theirs.read())?.matterId).toBe("matter_b");
    expect((await mine.read())?.matterId).toBe("matter_a");
    const countAfterTwo = (await listDurableObjectIds(env.DURABLE_TIMER)).length;
    expect(countAfterTwo).toBe(countBefore + 2);
  });
});

describe("LiveTimerDurableObject — abandoned alarm + idempotent stop-commit", () => {
  let name: string;

  beforeEach(() => {
    name = uniqueName();
  });

  it("the alarm flips a still-live timer to abandoned without committing or discarding", async () => {
    const stub = env.DURABLE_TIMER.getByName(name);
    await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    const read = await stub.read();
    expect(read?.status).toBe("abandoned");
    // Not committed, not discarded — the run is still present, flagged for resolution.
    expect(read?.liveRunId).toMatch(/^timeEntry_/);
  });

  it("stopAndCommit then discard cancels the alarm so none fires afterward", async () => {
    const stub = env.DURABLE_TIMER.getByName(name);
    await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    const stop = await stub.stopAndCommit();
    expect(stop.state).toBe("committing");
    await stub.discard();
    // After commit + discard, no alarm remains: runDurableObjectAlarm reports nothing to run.
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });

  it("two concurrent stopAndCommit calls return one committing and one already-committing, same id", async () => {
    const stub = env.DURABLE_TIMER.getByName(name);
    const start = await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    const [a, b] = await Promise.all([stub.stopAndCommit(), stub.stopAndCommit()]);
    const outcomes = [a.state, b.state].sort();
    expect(outcomes).toEqual(["already-committing", "committing"]);
    // Both report the same live_run_id (the dedup anchor the route derives its key + handle from).
    expect(a.liveRunId).toBe(start.liveRunId);
    expect(b.liveRunId).toBe(start.liveRunId);
  });

  it("stopAndCommit returns no-run for an idle DO with no live run", async () => {
    const stub = env.DURABLE_TIMER.getByName(uniqueName("_idle"));
    const stop = await stub.stopAndCommit();
    expect(stop.state).toBe("no-run");
    expect(stop.liveRunId).toBeNull();
  });

  it("an abandoned run resolves to keep (commit), surfacing committing on stop", async () => {
    const stub = env.DURABLE_TIMER.getByName(name);
    await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    await runDurableObjectAlarm(stub);
    const stop = await stub.stopAndCommit();
    expect(stop.state).toBe("committing");
    expect(stop.liveRunId).toMatch(/^timeEntry_/);
  });

  it("an abandoned run resolves to trim, clamping elapsed to last activity", async () => {
    const stub = env.DURABLE_TIMER.getByName(name);
    await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    await runDurableObjectAlarm(stub);
    const trimmed = await stub.resolveAbandoned("trim");
    expect(trimmed?.status).toBe("running");
    // A trailing open paused span from lastActivityAt onward marks the trim (future wall time excluded).
    const tail = trimmed?.pausedIntervals.at(-1);
    expect(tail?.to).toBeNull();
  });

  it("an abandoned run resolves to discard, clearing state and the alarm", async () => {
    const stub = env.DURABLE_TIMER.getByName(name);
    await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    await runDurableObjectAlarm(stub);
    await stub.resolveAbandoned("discard");
    expect(await stub.read()).toBeNull();
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });
});

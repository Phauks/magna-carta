import { env, listDurableObjectIds, runInDurableObject } from "cloudflare:test";
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

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureReady,
  MeetingGroupSession,
  MlsError,
  PAUSE_REASONS,
  pauseBits,
  pauseReasons,
} from "../src/index.ts";
import { SframeKeyRing } from "../src/sframe.ts";

// The real engine through the WebAssembly edge, held to what the crate's own tests hold it to natively.
beforeAll(async () => {
  await ensureReady(
    readFileSync(fileURLToPath(new URL("../src/pkg/mls_core_bg.wasm", import.meta.url))),
  );
});

const MEETING = "meeting_01";

function admitted(names: readonly string[]): {
  host: MeetingGroupSession;
  others: MeetingGroupSession[];
} {
  const host = new MeetingGroupSession("host");
  host.createGroup(MEETING);
  const others = names.map((name) => new MeetingGroupSession(name));
  others.forEach((other, index) => host.stageAdd(names[index] ?? "", other.keyPackage()));
  const output = host.commit();
  host.confirmCommit();
  for (const other of others) other.join(output.welcome ?? new Uint8Array(0), MEETING);
  return { host, others };
}

describe("a meeting's group", () => {
  it("gives everybody admitted the same keys, members and code, and their frames decrypt", async () => {
    const { host, others } = admitted(["alice", "bob"]);
    const [alice] = others;
    if (alice === undefined) throw new Error("no alice");
    expect(alice.epoch).toBe(host.epoch);
    expect(alice.securityCode()).toBe(host.securityCode());
    expect(alice.securityCode()).toMatch(/^\d{5}( \d{5}){5}$/);
    expect(host.members()).toEqual([
      { leafIndex: 0, identity: "host" },
      { leafIndex: 1, identity: "alice" },
      { leafIndex: 2, identity: "bob" },
    ]);

    const sending = new SframeKeyRing();
    const receiving = new SframeKeyRing();
    sending.addEpoch(alice.epoch, alice.sframeBaseKey());
    receiving.addEpoch(host.epoch, host.sframeBaseKey());
    const frame = new TextEncoder().encode("hello");
    const encrypted = await sending.encrypt(alice.ownLeafIndex, "audio", new Uint8Array(0), frame);
    expect(await receiving.decrypt(new Uint8Array(0), encrypted)).toEqual(frame);
    for (const session of [host, ...others]) session.release();
  });

  it("refuses a key package under another stay's name, with its code", () => {
    const host = new MeetingGroupSession("host");
    host.createGroup(MEETING);
    const mallory = new MeetingGroupSession("mallory");
    expect(() => host.stageAdd("alice", mallory.keyPackage())).toThrow(
      expect.objectContaining({ code: "identityMismatch" }),
    );
    expect(() => host.commit()).toThrow(MlsError);
  });

  it("removes a member who has gone, and tells them", () => {
    const { host, others } = admitted(["alice", "bob"]);
    const [alice, bob] = others;
    if (alice === undefined || bob === undefined) throw new Error("missing members");
    host.stageRemove("bob");
    const output = host.commit();
    host.confirmCommit();
    expect(alice.process(output.commit)).toBe("committed");
    expect(bob.process(output.commit)).toBe("removed");
    expect(alice.sframeBaseKey()).toEqual(host.sframeBaseKey());
  });

  it("reads a pause from the group, proposed by somebody who does not commit", () => {
    const { host, others } = admitted(["alice"]);
    const [alice] = others;
    if (alice === undefined) throw new Error("no alice");
    const proposal = alice.proposePause(pauseBits(["recording"]));
    expect(host.process(proposal)).toBe("proposed");
    const output = host.commit();
    host.confirmCommit();
    alice.process(output.commit);
    expect(pauseReasons(alice.pause)).toEqual(["recording"]);
    expect(host.pause).toBe(PAUSE_REASONS.recording);
  });

  it("names the committer from who is still connected", () => {
    const { host, others } = admitted(["alice"]);
    const [alice] = others;
    if (alice === undefined) throw new Error("no alice");
    expect(host.isCommitter(["host", "alice"])).toBe(true);
    expect(alice.isCommitter(["host", "alice"])).toBe(false);
    expect(alice.isCommitter(["alice"])).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, MeetingGroupSession } from "@magna-carta/mls";
import {
  EncryptionGroup,
  type GroupEpoch,
  type GroupStanding,
} from "../src/lib/meetings/client/encryption-group.ts";
import { FrameCipher } from "../src/lib/meetings/client/frame-encryption.ts";
import {
  type FrameEncryptionSeams,
  type FrameTransformTarget,
  MeetingEncryption,
} from "../src/lib/meetings/client/meeting-encryption.ts";

// THE BROWSER'S HALF OF AN ENCRYPTED MEETING, with the real MLS engine and a room reduced to what the
// meeting room's relay does (apps/api-worker/src/meetings/room/room-group.ts): found the group for the
// first to ask, relay key packages to the group, accept the first commit made from the epoch it holds,
// send the welcome to the stays a commit adds, and relay proposals.

beforeAll(async () => {
  await ensureReady(
    readFileSync(
      fileURLToPath(new URL("../../../packages/mls/src/pkg/mls_core_bg.wasm", import.meta.url)),
    ),
  );
});

const MEETING = "meeting_encryptionTest";

interface Browser {
  readonly stay: string;
  readonly group: EncryptionGroup;
  readonly epochs: GroupEpoch[];
  readonly standings: GroupStanding[];
}

/** The room's sequencing, in memory, delivering every frame in order through one queue. */
class FakeRoom {
  readonly browsers = new Map<string, Browser>();
  readonly #queue: (() => void)[] = [];
  #group: { epoch: number; members: string[] } | null = null;
  readonly #waiting = new Map<string, string>();
  live: string[] = [];

  join(stay: string): Browser {
    const epochs: GroupEpoch[] = [];
    const standings: GroupStanding[] = [];
    const group = new EncryptionGroup(MEETING, stay, {
      createSession: (identity) => new MeetingGroupSession(identity),
      send: (frame) => this.#queue.push(() => this.#fromBrowser(stay, frame)),
      onEpoch: (epoch) => epochs.push(epoch),
      onStanding: (standing) => standings.push(standing),
      schedule: (task) => this.#queue.push(task),
    });
    const browser = { stay, group, epochs, standings };
    this.browsers.set(stay, browser);
    this.live = [...this.live, stay];
    for (const each of this.browsers.values()) each.group.noteLiveStays(this.live);
    group.start();
    this.flush();
    return browser;
  }

  leave(stay: string): void {
    this.browsers.get(stay)?.group.stop();
    this.browsers.delete(stay);
    this.#waiting.delete(stay);
    this.live = this.live.filter((one) => one !== stay);
    for (const each of this.browsers.values()) each.group.noteLiveStays(this.live);
    this.flush();
  }

  flush(): void {
    for (let guard = 0; guard < 10_000; guard += 1) {
      const next = this.#queue.shift();
      if (next === undefined) return;
      next();
    }
    throw new Error("the room never settled");
  }

  #to(stays: Iterable<string>, frame: Record<string, unknown>, except?: string): void {
    for (const stay of stays) {
      if (stay === except) continue;
      const browser = this.browsers.get(stay);
      if (browser !== undefined) this.#queue.push(() => browser.group.receive(frame));
    }
  }

  #fromBrowser(stay: string, frame: Record<string, unknown>): void {
    const browser = this.browsers.get(stay);
    if (browser === undefined) return;
    if (frame.type === "mls-key-package") {
      if (this.#group === null) {
        this.#group = { epoch: 0, members: [stay] };
        this.#queue.push(() =>
          browser.group.receive({ type: "mls-welcome", epoch: 0, welcome: null }),
        );
        for (const [waiting, keyPackage] of this.#waiting) {
          this.#queue.push(() =>
            browser.group.receive({ type: "mls-key-package", from: waiting, keyPackage }),
          );
        }
        return;
      }
      this.#waiting.set(stay, frame.keyPackage as string);
      this.#to(
        this.#group.members,
        { type: "mls-key-package", from: stay, keyPackage: frame.keyPackage },
        stay,
      );
      return;
    }
    const group = this.#group;
    if (group === null || !group.members.includes(stay)) {
      this.#queue.push(() => browser.group.refused("not-in-group"));
      return;
    }
    if (frame.epoch !== group.epoch) {
      this.#queue.push(() => browser.group.refused("stale-epoch"));
      return;
    }
    if (frame.type === "mls-proposal") {
      this.#to(group.members, { ...frame, from: stay }, stay);
      return;
    }
    const added = frame.added as string[];
    const removed = frame.removed as string[];
    const before = [...group.members];
    group.members = [
      ...before.filter((member) => !removed.includes(member)),
      ...added.filter((one) => !before.includes(one) || removed.includes(one)),
    ];
    group.epoch += 1;
    for (const one of added) this.#waiting.delete(one);
    this.#to(
      before.filter((member) => !added.includes(member)),
      { type: "mls-commit", from: stay, epoch: frame.epoch, commit: frame.commit, added, removed },
    );
    this.#to(added, { type: "mls-welcome", epoch: group.epoch, welcome: frame.welcome });
  }
}

function lastEpoch(browser: Browser): GroupEpoch {
  const epoch = browser.epochs.at(-1);
  if (epoch === undefined) throw new Error(`${browser.stay} holds no epoch`);
  return epoch;
}

function sameKeys(browsers: readonly Browser[]): void {
  const [first, ...rest] = browsers.map(lastEpoch);
  for (const other of rest) {
    expect(other.epoch).toBe(first?.epoch);
    expect([...other.baseKey]).toEqual([...(first?.baseKey ?? [])]);
    expect(other.securityCode).toBe(first?.securityCode);
  }
}

describe("joining an encrypted meeting's key group", () => {
  it("founds the group for the first, admits the rest, and gives everybody the same keys", () => {
    const room = new FakeRoom();
    const host = room.join("stay_host");
    expect(host.standings).toEqual(["joining", "member"]);
    const alice = room.join("stay_alice");
    const bob = room.join("stay_bob");
    expect(alice.standings.at(-1)).toBe("member");
    expect(bob.standings.at(-1)).toBe("member");
    sameKeys([host, alice, bob]);
    expect(lastEpoch(host).epoch).toBe(2);
    expect(lastEpoch(host).pause).toBe(0);
    expect(new Set([host, alice, bob].map((one) => lastEpoch(one).ownLeafIndex)).size).toBe(3);
  });

  it("removes somebody who left, and the rest move to a key they never held", () => {
    const room = new FakeRoom();
    const host = room.join("stay_host");
    const alice = room.join("stay_alice");
    const bob = room.join("stay_bob");
    const keyBob = [...lastEpoch(bob).baseKey];
    room.leave("stay_bob");
    sameKeys([host, alice]);
    expect(lastEpoch(host).epoch).toBe(3);
    expect([...lastEpoch(host).baseKey]).not.toEqual(keyBob);
  });

  it("hands the group on when the committer leaves", () => {
    const room = new FakeRoom();
    room.join("stay_host");
    const alice = room.join("stay_alice");
    const bob = room.join("stay_bob");
    room.leave("stay_host");
    // Alice now holds the smallest live leaf, so she commits the host's removal and admits Carol.
    const carol = room.join("stay_carol");
    sameKeys([alice, bob, carol]);
  });

  it("carries a host's pause in the next commit, read from the group by everybody", () => {
    const room = new FakeRoom();
    const host = room.join("stay_host");
    const alice = room.join("stay_alice");
    alice.group.proposePause(0b001);
    room.flush();
    expect(lastEpoch(host).pause).toBe(0b001);
    expect(lastEpoch(alice).pause).toBe(0b001);
    sameKeys([host, alice]);
  });
});

describe("the frame cipher", () => {
  const baseKey = (): Uint8Array => Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  const keyframe = Uint8Array.from([0x10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

  it("seals a VP8 keyframe with its first ten bytes readable, and opens it for another member", async () => {
    const sender = new FrameCipher();
    sender.setEpoch(4, baseKey(), 1, false);
    const receiver = new FrameCipher();
    receiver.setEpoch(4, baseKey(), 2, false);
    const sealed = await sender.seal("vp8", "camera", keyframe);
    if (sealed === undefined) throw new Error("nothing sealed");
    expect([...sealed.subarray(0, 10)]).toEqual([...keyframe.subarray(0, 10)]);
    expect([...sealed.subarray(10)]).not.toEqual([...keyframe.subarray(10)]);
    expect([...((await receiver.open("vp8", sealed)) ?? [])]).toEqual([...keyframe]);
  });

  it("drops a frame whose readable prefix was changed on the way", async () => {
    const sender = new FrameCipher();
    sender.setEpoch(0, baseKey(), 0, false);
    const receiver = new FrameCipher();
    receiver.setEpoch(0, baseKey(), 1, false);
    const sealed = Uint8Array.from((await sender.seal("vp8", "camera", keyframe)) ?? []);
    sealed[3] = (sealed[3] ?? 0) ^ 0xff;
    expect(await receiver.open("vp8", sealed)).toBeUndefined();
  });

  it("sends nothing before it holds a key, and shows nothing it cannot open", async () => {
    const cipher = new FrameCipher();
    expect(await cipher.seal("opus", "audio", keyframe)).toBeUndefined();
    cipher.setEpoch(0, baseKey(), 0, false);
    expect(await cipher.open("opus", keyframe)).toBeUndefined();
  });

  it("passes frames through as they are while the group says encryption is paused", async () => {
    const cipher = new FrameCipher();
    cipher.setEpoch(0, baseKey(), 0, true);
    expect(await cipher.seal("opus", "audio", keyframe)).toBe(keyframe);
    expect(await cipher.open("opus", keyframe)).toBe(keyframe);
  });
});

describe("an encrypted meeting in the client's hands", () => {
  interface Attached {
    readonly target: unknown;
    readonly options: FrameTransformTarget;
  }

  function fakeSeams(): {
    seams: FrameEncryptionSeams;
    attached: Attached[];
    keys: GroupEpoch[];
    cleared: number[];
    preferred: unknown[];
  } {
    const attached: Attached[] = [];
    const keys: GroupEpoch[] = [];
    const cleared: number[] = [];
    const preferred: unknown[] = [];
    return {
      attached,
      keys,
      cleared,
      preferred,
      seams: {
        supported: () => true,
        loadEngine: () => Promise.resolve((identity: string) => new MeetingGroupSession(identity)),
        sendKey: (epoch) => keys.push(epoch),
        clearKeys: () => cleared.push(1),
        attach: (target, options) => attached.push({ target, options }),
        preferVp8: (transceiver) => preferred.push(transceiver),
        close: () => {},
      },
    };
  }

  function transceiver(kind: "audio" | "video", track: { kind: string } | null) {
    return { sender: { track }, receiver: { track: { kind } } };
  }

  it("puts the transform on every sender and receiver once, naming the camera, the screen and the sound", () => {
    const { seams, attached, preferred } = fakeSeams();
    const encryption = new MeetingEncryption(seams, {
      send: () => {},
      onStanding: () => {},
      onEpoch: () => {},
    });
    const microphone = { kind: "audio" };
    const camera = { kind: "video" };
    const screen = { kind: "video" };
    const remote = transceiver("video", null);
    const transceivers = [
      transceiver("audio", microphone),
      transceiver("video", camera),
      transceiver("video", screen),
      remote,
    ];
    const connection = { getTransceivers: () => transceivers } as unknown as RTCPeerConnection;
    encryption.cover(connection, screen as unknown as MediaStreamTrack);
    encryption.cover(connection, screen as unknown as MediaStreamTrack);

    const sends = attached.filter((one) => one.options.direction === "send");
    expect(sends.map((one) => [one.options.codec, one.options.stream])).toEqual([
      ["opus", "audio"],
      ["vp8", "camera"],
      ["vp8", "screen"],
    ]);
    expect(attached.filter((one) => one.options.direction === "receive")).toHaveLength(4);
    expect(attached.some((one) => one.target === remote.sender)).toBe(false);
    expect(preferred).toEqual([transceivers[1], transceivers[2]]);
  });

  it("founds the group on the welcome and hands its key to the transform", async () => {
    const { seams, keys } = fakeSeams();
    const sent: Record<string, unknown>[] = [];
    const standings: GroupStanding[] = [];
    const encryption = new MeetingEncryption(seams, {
      send: (frame) => sent.push(frame),
      onStanding: (standing) => standings.push(standing),
      onEpoch: () => {},
    });
    await encryption.load();
    encryption.noteLiveStays(["stay_host"]);
    encryption.start(MEETING, "stay_host");
    expect(sent.map((frame) => frame.type)).toEqual(["mls-key-package"]);
    encryption.receive({ type: "mls-welcome", epoch: 0, welcome: null });
    expect(standings.at(-1)).toBe("member");
    expect(keys).toHaveLength(1);
    expect(keys[0]?.epoch).toBe(0);
    expect(keys[0]?.baseKey.length).toBeGreaterThan(0);
    encryption.close();
  });

  it("drops the transform's keys when it stops", async () => {
    const { seams, cleared } = fakeSeams();
    const encryption = new MeetingEncryption(seams, {
      send: () => {},
      onStanding: () => {},
      onEpoch: () => {},
    });
    await encryption.load();
    encryption.start(MEETING, "stay_host");
    encryption.stop();
    expect(cleared.length).toBeGreaterThan(0);
  });
});

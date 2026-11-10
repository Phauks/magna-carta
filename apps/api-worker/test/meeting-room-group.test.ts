import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { meetingSocketRequestUrl } from "../src/meetings/meeting-room.ts";

// THE ROOM AS AN ENCRYPTED MEETING'S DELIVERY SERVICE.
//
// The room carries an MLS group's handshake messages without reading them, so these tests send it
// opaque base64 and check only what the room is responsible for: who founds the group, who hears a
// key package, which of two commits made from one epoch wins, who is sent the welcome, and that the
// lobby and the stays outside the group hear none of it. What the bytes mean is the engine's, tested
// in crates/mls-core and packages/mls.

const FIRM = "firm_meetingRoomGroupFirm0";
let meetingCounter = 0;

interface Participant {
  readonly frames: Record<string, unknown>[];
  send(data: string): void;
  close(): void;
}

function freshRoom(): { meetingId: string; stub: ReturnType<typeof env.MEETING_ROOM.get> } {
  meetingCounter += 1;
  const meetingId = `meeting_groupTest${String(meetingCounter).padStart(10, "0")}`;
  return {
    meetingId,
    stub: env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(`${FIRM}:${meetingId}`)),
  };
}

async function waitFor(condition: () => boolean, budgetMilliseconds = 10_000): Promise<void> {
  const deadline = Date.now() + budgetMilliseconds;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// A short pause, used ONLY to assert that something did not happen.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function connect(
  stub: ReturnType<typeof env.MEETING_ROOM.get>,
  meetingId: string,
  attendanceId: string,
  waiting = false,
): Promise<Participant> {
  const response = await stub.fetch(
    new Request(
      meetingSocketRequestUrl({
        firmId: FIRM,
        meetingId,
        userId: `user_${attendanceId}`,
        attendanceId,
        displayName: `seat ${attendanceId}`,
        medium: "video",
        hostRole: null,
        locked: false,
        lobby: waiting ? "on" : "off",
        waiting,
      }),
      { headers: { Upgrade: "websocket" } },
    ),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null || socket === undefined) throw new Error("no WebSocket on the 101");
  const frames: Record<string, unknown>[] = [];
  socket.accept();
  socket.addEventListener("message", (event) => {
    frames.push(JSON.parse(String(event.data)) as Record<string, unknown>);
  });
  await waitFor(() => frames.length > 0);
  return {
    frames,
    send: (data) => {
      socket.send(data);
    },
    close: () => {
      socket.send(JSON.stringify({ v: 1, type: "leave" }));
    },
  };
}

function framesOf(participant: Participant, type: string): Record<string, unknown>[] {
  return participant.frames.filter((frame) => frame["type"] === type);
}

function refusals(participant: Participant): unknown[] {
  return framesOf(participant, "refused").map((frame) => frame["reason"]);
}

const keyPackage = (marker: string): string =>
  JSON.stringify({ v: 1, type: "mls-key-package", keyPackage: btoa(`key package ${marker}`) });

function commit(epoch: number, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    type: "mls-commit",
    epoch,
    commit: btoa(`commit from ${String(epoch)}`),
    added: [],
    removed: [],
    ...fields,
  });
}

/** A founded group with `founder` in it, and `joiner` admitted at epoch 1. */
async function groupOfTwo(): Promise<{
  stub: ReturnType<typeof env.MEETING_ROOM.get>;
  meetingId: string;
  founder: Participant;
  joiner: Participant;
}> {
  const { stub, meetingId } = freshRoom();
  const founder = await connect(stub, meetingId, "stay_founder");
  founder.send(keyPackage("founder"));
  await waitFor(() => framesOf(founder, "mls-welcome").length === 1);
  const joiner = await connect(stub, meetingId, "stay_joiner");
  joiner.send(keyPackage("joiner"));
  await waitFor(() => framesOf(founder, "mls-key-package").length === 1);
  founder.send(commit(0, { added: ["stay_joiner"], welcome: btoa("welcome") }));
  await waitFor(() => framesOf(joiner, "mls-welcome").length === 1);
  return { stub, meetingId, founder, joiner };
}

describe("founding the group", () => {
  it("tells the first stay that asks to found it, with a welcome that carries none", async () => {
    const { stub, meetingId } = freshRoom();
    const first = await connect(stub, meetingId, "stay_first");
    first.send(keyPackage("first"));
    await waitFor(() => framesOf(first, "mls-welcome").length === 1);
    expect(framesOf(first, "mls-welcome")[0]).toMatchObject({ epoch: 0, welcome: null });
  });

  it("relays a later key package to the group, naming its sender, and to nobody outside it", async () => {
    const { stub, meetingId } = freshRoom();
    const founder = await connect(stub, meetingId, "stay_founder");
    founder.send(keyPackage("founder"));
    await waitFor(() => framesOf(founder, "mls-welcome").length === 1);
    const bystander = await connect(stub, meetingId, "stay_bystander");
    const joiner = await connect(stub, meetingId, "stay_joiner");
    joiner.send(keyPackage("joiner"));
    await waitFor(() => framesOf(founder, "mls-key-package").length === 1);
    expect(framesOf(founder, "mls-key-package")[0]).toMatchObject({
      from: "stay_joiner",
      keyPackage: btoa("key package joiner"),
    });
    await settle();
    expect(framesOf(bystander, "mls-key-package")).toEqual([]);
    expect(framesOf(joiner, "mls-key-package")).toEqual([]);
  });

  it("hands the founder every request that was already waiting", async () => {
    const { stub, meetingId } = freshRoom();
    const founder = await connect(stub, meetingId, "stay_founder");
    founder.send(keyPackage("founder"));
    await waitFor(() => framesOf(founder, "mls-welcome").length === 1);
    const joiner = await connect(stub, meetingId, "stay_joiner");
    joiner.send(keyPackage("joiner"));
    await waitFor(() => framesOf(founder, "mls-key-package").length === 1);
    // The only member leaves before admitting anybody: the next stay waiting founds the group.
    founder.close();
    await waitFor(() => framesOf(joiner, "mls-welcome").length === 1);
    expect(framesOf(joiner, "mls-welcome")[0]).toMatchObject({ epoch: 0, welcome: null });
  });

  it("never answers a socket that is still at the door", async () => {
    const { stub, meetingId } = freshRoom();
    const waiter = await connect(stub, meetingId, "stay_waiter", true);
    waiter.send(keyPackage("waiter"));
    await waitFor(() => refusals(waiter).length === 1);
    expect(refusals(waiter)).toEqual(["not-admitted"]);
    expect(framesOf(waiter, "mls-welcome")).toEqual([]);
  });
});

describe("sequencing commits", () => {
  it("sends an accepted commit to the group, the committer included, and the welcome to the newcomer", async () => {
    const { founder, joiner } = await groupOfTwo();
    expect(framesOf(founder, "mls-commit")).toEqual([
      expect.objectContaining({
        from: "stay_founder",
        epoch: 0,
        added: ["stay_joiner"],
        removed: [],
      }),
    ]);
    expect(framesOf(joiner, "mls-welcome")[0]).toMatchObject({
      epoch: 1,
      welcome: btoa("welcome"),
    });
    expect(framesOf(joiner, "mls-commit")).toEqual([]);
  });

  it("accepts the first commit made from an epoch and refuses the second as stale", async () => {
    const { founder, joiner } = await groupOfTwo();
    founder.send(commit(1));
    await waitFor(() => framesOf(joiner, "mls-commit").length === 1);
    joiner.send(commit(1));
    await waitFor(() => refusals(joiner).length === 1);
    expect(refusals(joiner)).toEqual(["stale-epoch"]);
    expect(framesOf(founder, "mls-commit")).toHaveLength(2);
    // The group is at epoch 2 now, and a commit from there is accepted.
    joiner.send(commit(2));
    await waitFor(() => framesOf(founder, "mls-commit").length === 3);
    expect(framesOf(founder, "mls-commit")[2]).toMatchObject({ from: "stay_joiner", epoch: 2 });
  });

  it("refuses a commit from a stay the group has not admitted", async () => {
    const { stub, meetingId } = await groupOfTwo();
    const outsider = await connect(stub, meetingId, "stay_outsider");
    outsider.send(commit(1));
    await waitFor(() => refusals(outsider).length === 1);
    expect(refusals(outsider)).toEqual(["not-in-group"]);
  });

  it("refuses a commit that adds somebody without a welcome", async () => {
    const { founder } = await groupOfTwo();
    founder.send(commit(1, { added: ["stay_somebody"] }));
    await waitFor(() => refusals(founder).length === 1);
    expect(refusals(founder)).toEqual(["malformed-frame"]);
  });

  it("tells a removed stay of its removal and nothing after it", async () => {
    const { founder, joiner } = await groupOfTwo();
    founder.send(commit(1, { removed: ["stay_joiner"] }));
    await waitFor(() => framesOf(joiner, "mls-commit").length === 1);
    expect(framesOf(joiner, "mls-commit")[0]).toMatchObject({ removed: ["stay_joiner"] });
    founder.send(commit(2));
    await waitFor(() => framesOf(founder, "mls-commit").length === 3);
    await settle();
    expect(framesOf(joiner, "mls-commit")).toHaveLength(1);
    joiner.send(commit(3));
    await waitFor(() => refusals(joiner).length === 1);
    expect(refusals(joiner)).toEqual(["not-in-group"]);
  });
});

describe("relaying proposals", () => {
  it("relays a proposal made at the current epoch to the rest of the group", async () => {
    const { founder, joiner } = await groupOfTwo();
    joiner.send(JSON.stringify({ v: 1, type: "mls-proposal", epoch: 1, proposal: btoa("pause") }));
    await waitFor(() => framesOf(founder, "mls-proposal").length === 1);
    expect(framesOf(founder, "mls-proposal")[0]).toMatchObject({
      from: "stay_joiner",
      epoch: 1,
      proposal: btoa("pause"),
    });
    expect(framesOf(joiner, "mls-proposal")).toEqual([]);
  });

  it("refuses a proposal made at an epoch the group has left", async () => {
    const { joiner } = await groupOfTwo();
    joiner.send(JSON.stringify({ v: 1, type: "mls-proposal", epoch: 0, proposal: btoa("pause") }));
    await waitFor(() => refusals(joiner).length === 1);
    expect(refusals(joiner)).toEqual(["stale-epoch"]);
  });
});

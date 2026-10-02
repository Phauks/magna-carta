import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { meetingSocketRequestUrl } from "../src/meetings/meeting-room.ts";
import { recordingForWelcome, recordingStarted } from "../src/meetings/room/room-recording.ts";
import type { MeetingSocketAttachment, RoomContext } from "../src/meetings/room/room-state.ts";
import {
  seedMemberIn,
  seedRecordedMeeting,
  seedRoomRoster,
  seedRunningRecording,
  waitUntil,
  type RecordedMeeting,
} from "./support/meeting-recording-fixture.ts";

// THE ANNOUNCEMENT AND THE RECORD OF IT — the room's half of the consent mechanism, driven against
// the room itself.
//
// What would be a real failure if it stopped holding: the `recording` frame reaches every welcomed
// socket, a guest's as much as a member's, and never somebody waiting at the door; a guest is told who
// started it by name and never by identifier; one notice row is written per stay per fan-out, in one
// batch with one audit row; a socket welcomed while a recording runs is told on its welcome and gets
// an `arrival` notice of its own; a stop clears the state a later welcome would carry; and the room
// answers the recorder with the audio tracks it carries and nothing else.

let firmId: FirmId;

beforeAll(() => {
  firmId = newIdentifier("firm") as FirmId;
});

interface Socket {
  readonly frames: Record<string, unknown>[];
}

function roomOf(meeting: RecordedMeeting) {
  return env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(`${firmId}:${meeting.meetingId}`));
}

async function connect(
  meeting: RecordedMeeting,
  options: {
    readonly attendanceId: string;
    readonly userId: string;
    readonly displayName: string;
    readonly guest?: boolean;
    readonly waiting?: boolean;
  },
): Promise<Socket> {
  const response = await roomOf(meeting).fetch(
    new Request(
      meetingSocketRequestUrl({
        firmId,
        meetingId: meeting.meetingId,
        userId: options.userId,
        attendanceId: options.attendanceId,
        displayName: options.displayName,
        medium: "audio",
        hostRole: null,
        locked: false,
        lobby: options.waiting === true ? "on" : "off",
        waiting: options.waiting === true,
        waitingFrom: options.waiting === true ? new Date().toISOString() : "",
        participantKind: options.guest === true ? "guest" : "member",
        ...(options.guest === true ? { invitedName: "Jane Hollis" } : {}),
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
  await waitUntil(() => frames.length > 0);
  return { frames };
}

function recordingFrames(socket: Socket): Record<string, unknown>[] {
  return socket.frames.filter((frame) => frame["type"] === "recording");
}

async function notices(recordingId: string) {
  const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(
      `SELECT participant_kind, participant_id, user_id, reason, delivered_at ` +
        `FROM meeting_recording_notice WHERE recording_id = ?1 ORDER BY reason, participant_kind`,
    )
    .bind(recordingId)
    .all<{
      participant_kind: string;
      participant_id: string;
      user_id: string | null;
      reason: string;
      delivered_at: string;
    }>();
  return results;
}

async function noticedAuditCount(recordingId: string): Promise<number> {
  const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(
      `SELECT COUNT(*) AS count FROM audit_log WHERE event = 'meetings.recording.noticed' AND subject_id = ?1`,
    )
    .bind(recordingId)
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}

/** A meeting with a member and a guest in the room, and a running recording row to announce. */
async function roomWithMemberAndGuest() {
  const meeting = await seedRecordedMeeting(firmId);
  const memberUserId = await seedMemberIn(firmId, "A Member");
  const memberStay = newIdentifier("meetingAttendance");
  const guestStay = newIdentifier("meetingGuestStay");
  const member = await connect(meeting, {
    attendanceId: memberStay,
    userId: memberUserId,
    displayName: "A Member",
  });
  const guest = await connect(meeting, {
    attendanceId: guestStay,
    userId: "",
    displayName: "Jane at the door",
    guest: true,
  });
  const { recordingId, startedAt } = await seedRunningRecording(meeting, []);
  return { meeting, memberUserId, memberStay, guestStay, member, guest, recordingId, startedAt };
}

describe("announcing a recording", () => {
  it("reaches every welcomed socket — a guest's too, told a name and never an identifier", async () => {
    const room = await roomWithMemberAndGuest();
    const reached = await roomOf(room.meeting).recordingStarted({
      firmId,
      meetingId: room.meeting.meetingId,
      recordingId: room.recordingId,
      at: room.startedAt,
      by: { userId: room.meeting.hostUserId, displayName: "A Host" },
    });
    expect(reached).toEqual({ recipientCount: 2, noticeCount: 2 });

    await waitUntil(
      () => recordingFrames(room.member).length > 0 && recordingFrames(room.guest).length > 0,
    );
    expect(recordingFrames(room.member)[0]).toEqual({
      v: 1,
      type: "recording",
      state: "started",
      recordingId: room.recordingId,
      by: { userId: room.meeting.hostUserId, displayName: "A Host" },
      at: room.startedAt,
    });
    // THE RECORD HANDLE IS THE FIRM'S: a guest is told that it started and by whom, by name, and is
    // handed neither the user identifier nor the recording's handle.
    expect(recordingFrames(room.guest)[0]).toEqual({
      v: 1,
      type: "recording",
      state: "started",
      recordingId: null,
      by: { userId: null, displayName: "A Host" },
      at: room.startedAt,
    });
  });

  it("hands a guest's welcome and the stop no record handle either", async () => {
    const room = await roomWithMemberAndGuest();
    await roomOf(room.meeting).recordingStarted({
      firmId,
      meetingId: room.meeting.meetingId,
      recordingId: room.recordingId,
      at: room.startedAt,
      by: { userId: room.meeting.hostUserId, displayName: "A Host" },
    });
    const lateGuest = await connect(room.meeting, {
      attendanceId: newIdentifier("meetingGuestStay"),
      userId: "",
      displayName: "Another guest",
      guest: true,
    });
    expect(lateGuest.frames[0]).toMatchObject({
      type: "welcome",
      recording: { state: "started", recordingId: null, by: { userId: null } },
    });
    await roomOf(room.meeting).recordingStopped({
      firmId,
      meetingId: room.meeting.meetingId,
      recordingId: room.recordingId,
      at: new Date().toISOString(),
      by: { userId: room.meeting.hostUserId, displayName: "A Host" },
    });
    await waitUntil(
      () => recordingFrames(room.guest).length === 2 && recordingFrames(room.member).length === 2,
    );
    expect(recordingFrames(room.guest)[1]).toMatchObject({ state: "stopped", recordingId: null });
    // A member's copy still carries the handle every member-facing read is addressed by.
    expect(recordingFrames(room.member)[1]).toMatchObject({
      state: "stopped",
      recordingId: room.recordingId,
    });
  });

  it("announces one recording ONCE, however many requests carry its start out", async () => {
    const room = await roomWithMemberAndGuest();
    const transition = {
      firmId,
      meetingId: room.meeting.meetingId,
      recordingId: room.recordingId,
      at: room.startedAt,
      by: { userId: room.meeting.hostUserId, displayName: "A Host" },
    };
    // The start route and a replay of it racing: both reach the room.
    const [first, second] = await Promise.all([
      roomOf(room.meeting).recordingStarted(transition),
      roomOf(room.meeting).recordingStarted(transition),
    ]);
    expect([first, second]).toContainEqual({ recipientCount: 2, noticeCount: 2 });
    expect([first, second]).toContainEqual({ recipientCount: 0, noticeCount: 0 });
    await roomOf(room.meeting).recordingStarted(transition);

    await waitUntil(() => recordingFrames(room.member).length > 0);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(recordingFrames(room.member)).toHaveLength(1);
    expect(recordingFrames(room.guest)).toHaveLength(1);
    expect((await notices(room.recordingId)).filter((row) => row.reason === "start")).toHaveLength(
      2,
    );
    expect(await noticedAuditCount(room.recordingId)).toBe(1);
  });

  it("writes ONE notice per stay told, a guest's by its stay, and ONE audit row for the fan-out", async () => {
    const room = await roomWithMemberAndGuest();
    await roomOf(room.meeting).recordingStarted({
      firmId,
      meetingId: room.meeting.meetingId,
      recordingId: room.recordingId,
      at: room.startedAt,
      by: { userId: room.meeting.hostUserId, displayName: "A Host" },
    });
    const written = await notices(room.recordingId);
    expect(
      written.map((row) => [row.participant_kind, row.participant_id, row.user_id, row.reason]),
    ).toEqual([
      ["guest", room.guestStay, null, "start"],
      ["member", room.memberStay, room.memberUserId, "start"],
    ]);
    // The instant is the server's, the same for everybody told in one fan-out.
    expect(new Set(written.map((row) => row.delivered_at))).toEqual(new Set([room.startedAt]));
    expect(await noticedAuditCount(room.recordingId)).toBe(1);
  });

  it("never tells somebody waiting at the door, where nobody is being recorded", async () => {
    const room = await roomWithMemberAndGuest();
    const waiter = await connect(room.meeting, {
      attendanceId: newIdentifier("meetingAttendance"),
      userId: await seedMemberIn(firmId, "At the Door"),
      displayName: "At the Door",
      waiting: true,
    });
    const reached = await roomOf(room.meeting).recordingStarted({
      firmId,
      meetingId: room.meeting.meetingId,
      recordingId: room.recordingId,
      at: room.startedAt,
      by: { userId: room.meeting.hostUserId, displayName: "A Host" },
    });
    expect(reached.recipientCount).toBe(2);
    await waitUntil(() => recordingFrames(room.member).length > 0);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(recordingFrames(waiter)).toHaveLength(0);
  });
});

describe("an arrival while a recording runs", () => {
  it("is told on its welcome, in the same vocabulary, and gets an arrival notice of its own", async () => {
    const room = await roomWithMemberAndGuest();
    await roomOf(room.meeting).recordingStarted({
      firmId,
      meetingId: room.meeting.meetingId,
      recordingId: room.recordingId,
      at: room.startedAt,
      by: { userId: room.meeting.hostUserId, displayName: "A Host" },
    });
    const lateUserId = await seedMemberIn(firmId, "Late Arrival");
    const lateStay = newIdentifier("meetingAttendance");
    const late = await connect(room.meeting, {
      attendanceId: lateStay,
      userId: lateUserId,
      displayName: "Late Arrival",
    });
    expect(late.frames[0]).toMatchObject({
      type: "welcome",
      recording: {
        state: "started",
        recordingId: room.recordingId,
        by: { userId: room.meeting.hostUserId, displayName: "A Host" },
        at: room.startedAt,
      },
    });
    await waitUntil(async () =>
      (await notices(room.recordingId)).some((row) => row.reason === "arrival"),
    );
    const arrival = (await notices(room.recordingId)).filter((row) => row.reason === "arrival");
    expect(arrival.map((row) => [row.participant_id, row.user_id])).toEqual([
      [lateStay, lateUserId],
    ]);

    // A RECONNECT IS ANOTHER OCCASION, and another row.
    await connect(room.meeting, {
      attendanceId: lateStay,
      userId: lateUserId,
      displayName: "Late Arrival",
    });
    await waitUntil(
      async () =>
        (await notices(room.recordingId)).filter((row) => row.reason === "arrival").length === 2,
    );
    expect(
      (await notices(room.recordingId)).filter((row) => row.reason === "arrival"),
    ).toHaveLength(2);
  });

  it("is told when a host lets them in from the door, on that welcome, with an arrival notice", async () => {
    const room = await roomWithMemberAndGuest();
    await roomOf(room.meeting).recordingStarted({
      firmId,
      meetingId: room.meeting.meetingId,
      recordingId: room.recordingId,
      at: room.startedAt,
      by: { userId: room.meeting.hostUserId, displayName: "A Host" },
    });
    const waiterUserId = await seedMemberIn(firmId, "Let In");
    const waiterStay = newIdentifier("meetingAttendance");
    const waiter = await connect(room.meeting, {
      attendanceId: waiterStay,
      userId: waiterUserId,
      displayName: "Let In",
      waiting: true,
    });

    // The door's own welcome is a second place a person enters the room; leaving the recording off
    // it would record somebody who was never told.
    await roomOf(room.meeting).participantsAdmitted([waiterStay]);
    await waitUntil(() => waiter.frames.some((frame) => frame["type"] === "welcome"));
    expect(waiter.frames.find((frame) => frame["type"] === "welcome")).toMatchObject({
      recording: { state: "started", recordingId: room.recordingId, at: room.startedAt },
    });
    await waitUntil(async () =>
      (await notices(room.recordingId)).some(
        (row) => row.reason === "arrival" && row.participant_id === waiterStay,
      ),
    );
  });

  it("carries nothing about recording on the welcome of a room that is not recording", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const socket = await connect(meeting, {
      attendanceId: newIdentifier("meetingAttendance"),
      userId: await seedMemberIn(firmId, "Somebody"),
      displayName: "Somebody",
    });
    expect(socket.frames[0]).toMatchObject({ type: "welcome" });
    expect(socket.frames[0]).not.toHaveProperty("recording");
  });
});

describe("a stop", () => {
  it("is announced to everybody with stop notices, and a later welcome no longer carries the recording", async () => {
    const room = await roomWithMemberAndGuest();
    await roomOf(room.meeting).recordingStarted({
      firmId,
      meetingId: room.meeting.meetingId,
      recordingId: room.recordingId,
      at: room.startedAt,
      by: { userId: room.meeting.hostUserId, displayName: "A Host" },
    });
    const stoppedAt = new Date().toISOString();
    // Every track lost: nobody stopped it, and nobody is named.
    await roomOf(room.meeting).recordingStopped({
      firmId,
      meetingId: room.meeting.meetingId,
      recordingId: room.recordingId,
      at: stoppedAt,
      by: null,
    });
    await waitUntil(() => recordingFrames(room.guest).length === 2);
    expect(recordingFrames(room.guest)[1]).toMatchObject({
      state: "stopped",
      by: null,
      at: stoppedAt,
    });
    const stops = (await notices(room.recordingId)).filter((row) => row.reason === "stop");
    expect(stops).toHaveLength(2);
    expect(await roomOf(room.meeting).runningRecording()).toBeNull();

    const after = await connect(room.meeting, {
      attendanceId: newIdentifier("meetingAttendance"),
      userId: await seedMemberIn(firmId, "After"),
      displayName: "After",
    });
    expect(after.frames[0]).not.toHaveProperty("recording");
  });
});

describe("what the room tells the recorder", () => {
  it("answers the audio tracks of the participants in the room, and nothing else", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const userId = await seedMemberIn(firmId, "Talker");
    const participantId = newIdentifier("meetingAttendance");
    await seedRoomRoster(meeting, [
      {
        trackId: newIdentifier("meetingRecordingTrack") as never,
        trackName: `${participantId}:microphone`,
        sessionId: "routing-session-talker",
        participantId,
        userId,
      },
    ]);
    const candidates = await roomOf(meeting).recordingCandidates();
    expect(candidates).toEqual([
      {
        participantKind: "member",
        participantId,
        userId,
        trackName: `${participantId}:microphone`,
        sessionId: "routing-session-talker",
      },
    ]);
  });
});

// A ROOM DRIVEN WITHOUT THE RUNTIME, for the two cases the runtime will not produce on demand: a
// socket that throws on `send` (closed between the walk and the send) and a welcome that has been
// built and not yet sent. The modules take `RoomContext` explicitly so they can be driven like this;
// the firm's database is the real one.
interface DrivenSocket {
  readonly socket: WebSocket;
  readonly sent: string[];
}

function drivenSocket(
  attachment: Pick<MeetingSocketAttachment, "attendanceId" | "userId"> & {
    readonly guest?: boolean;
    readonly closed?: boolean;
  },
  meetingId: string,
): DrivenSocket {
  const sent: string[] = [];
  const stored = {
    attendanceId: attachment.attendanceId,
    userId: attachment.userId,
    meetingId,
    welcomed: true,
    participantKind: attachment.guest === true ? "guest" : "member",
  };
  const socket = {
    send(payload: string) {
      if (attachment.closed === true) throw new TypeError("WebSocket send() after close()");
      sent.push(payload);
    },
    deserializeAttachment: () => stored,
  };
  return { socket: socket as unknown as WebSocket, sent };
}

function drivenRoom(sockets: readonly WebSocket[]): {
  readonly room: RoomContext;
  readonly background: Promise<unknown>[];
} {
  const storage = new Map<string, unknown>();
  const background: Promise<unknown>[] = [];
  const ctx = {
    getWebSockets: () => [...sockets],
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
      delete: async (key: string) => storage.delete(key),
    },
    waitUntil: (work: Promise<unknown>) => {
      background.push(work);
    },
  };
  return { room: { ctx: ctx as unknown as DurableObjectState, env }, background };
}

describe("what counts as told", () => {
  it("writes a notice only for a stay whose socket was actually handed the frame", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const memberUserId = await seedMemberIn(firmId, "Still Here");
    const memberStay = newIdentifier("meetingAttendance");
    const goneStay = newIdentifier("meetingAttendance");
    const present = drivenSocket(
      { attendanceId: memberStay, userId: memberUserId },
      meeting.meetingId,
    );
    const gone = drivenSocket(
      { attendanceId: goneStay, userId: await seedMemberIn(firmId, "Just Left"), closed: true },
      meeting.meetingId,
    );
    const { recordingId, startedAt } = await seedRunningRecording(meeting, []);
    const { room } = drivenRoom([present.socket, gone.socket]);

    const reached = await recordingStarted(room, {
      firmId,
      meetingId: meeting.meetingId,
      recordingId,
      at: startedAt,
      by: { userId: meeting.hostUserId, displayName: "A Host" },
    });
    // The socket that closed under the send told nobody, so it is neither a recipient nor a notice.
    expect(reached).toEqual({ recipientCount: 1, noticeCount: 1 });
    expect(present.sent).toHaveLength(1);
    expect((await notices(recordingId)).map((row) => row.participant_id)).toEqual([memberStay]);
  });

  it("writes the arrival notice only once the welcome that carried the recording was sent", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const { recordingId, startedAt } = await seedRunningRecording(meeting, []);
    const { room, background } = drivenRoom([]);
    await recordingStarted(room, {
      firmId,
      meetingId: meeting.meetingId,
      recordingId,
      at: startedAt,
      by: { userId: meeting.hostUserId, displayName: "A Host" },
    });
    const arrivingUserId = await seedMemberIn(firmId, "Arriving");
    const arrivingStay = newIdentifier("meetingAttendance");
    const attachment = {
      attendanceId: arrivingStay,
      userId: arrivingUserId,
      meetingId: meeting.meetingId,
      welcomed: false,
      participantKind: "member",
    } as unknown as MeetingSocketAttachment;

    const onWelcome = await recordingForWelcome(room, attachment);
    expect(onWelcome?.announcement).toEqual({
      state: "started",
      recordingId,
      by: { userId: meeting.hostUserId, displayName: "A Host" },
      at: startedAt,
    });
    // Built, and not yet sent: nobody has been told, so nothing is on the record.
    await Promise.all(background);
    expect((await notices(recordingId)).filter((row) => row.reason === "arrival")).toEqual([]);

    onWelcome?.welcomeSent();
    await Promise.all(background);
    expect(
      (await notices(recordingId))
        .filter((row) => row.reason === "arrival")
        .map((row) => [row.participant_id, row.user_id]),
    ).toEqual([[arrivingStay, arrivingUserId]]);
  });
});

import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MeetingId } from "@magna-carta/identifiers/types";
import type { InferencePort } from "@magna-carta/inference/port";
import { createStubInferencePort, STUB_RESPONSE_MARKER } from "@magna-carta/inference/stub";
import { CAPTION_SILENCE_CLOSE_MILLISECONDS } from "@magna-carta/meetings/caption-sessions";
import { captionsEnabledDefinition } from "@magna-carta/meetings/settings";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Bindings } from "../src/bindings.ts";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { captionerFor } from "../src/meetings/caption-binding.ts";
import { verifyCaptionSinkToken } from "../src/meetings/caption-sink-token.ts";
import {
  setCaptionerClockForTests,
  setCaptionInferencePortForTests,
} from "../src/meetings/meeting-captioner.ts";
import {
  setRecordingComposeQueueForTests,
  type RecorderStartInput,
} from "../src/meetings/meeting-recorder.ts";
import { meetingSocketRequestUrl } from "../src/meetings/meeting-room.ts";
import { setSfuFetchForTests } from "../src/meetings/sfu/sfu-client.ts";
import {
  MEETING_SINK_PATH_PREFIX,
  setMeetingSinkSigningKeyForTests,
} from "../src/meetings/sink-token.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  fakeAdapterService,
  pcmEnvelope,
  seedMemberIn,
  seedRecordedMeeting,
  seedRunningRecording,
  waitUntil,
  type AdapterCall,
} from "./support/meeting-recording-fixture.ts";
import { seedFirmRow } from "./support/test-auth.ts";

// LIVE CAPTIONS, END TO END IN THE TEST POOL — the room, the captioner and the sink route, against a
// stand-in routing service and the stub inference port.
//
// What would be a real failure if it stopped holding: a caption session is opened for somebody only
// while they are speaking, and closed three seconds after they stop; captions run with no recording at
// all, the adapter opened for the speaker and torn down after; the words reach EVERY welcomed socket as
// `caption` frames carrying who said them — a guest is told the speaker's name and never a firm user's
// identifier; interims are coalesced and a final is never held back; nothing the model heard is kept by
// the room or the captioner; captions run only where the firm has switched them on and a host has
// turned them on, and a host turning them off closes every session; and a caption model that fails
// mid-meeting costs that speaker their captions for the turn and touches the recording not at all.

const SIGNING_KEY = "meeting-captions-test-signing-key";
const app = createApp();

let firmId: FirmId;
let calls: AdapterCall[] = [];
// How far the captioner's clock has been wound forward past the runtime's.
let windForward = 0;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm") as FirmId;
  await seedFirmRow(firmId);
  setMeetingSinkSigningKeyForTests(SIGNING_KEY);
  setCaptionerClockForTests(() => Date.now() + windForward);
  // The recording one test runs beside its captions is handed on to a collector, not composed: what
  // that test is about is that the recording was left alone.
  setRecordingComposeQueueForTests({ send: async () => {} });
});

afterAll(() => {
  setSfuFetchForTests(null);
  setMeetingSinkSigningKeyForTests(null);
  setCaptionerClockForTests(null);
  setCaptionInferencePortForTests(null);
  setRecordingComposeQueueForTests(null);
});

beforeEach(async () => {
  calls = [];
  windForward = 0;
  setSfuFetchForTests(fakeAdapterService(calls));
  setCaptionInferencePortForTests(createStubInferencePort());
  await setFirmCaptions(true);
});

async function setFirmCaptions(enabled: boolean): Promise<void> {
  await writeFirmSettingStatement(
    firmDatabaseFor(env.FIRM_DATABASE, firmId),
    captionsEnabledDefinition,
    enabled,
    new Date().toISOString(),
  ).run();
}

interface Socket {
  readonly socket: WebSocket;
  readonly attendanceId: string;
  readonly userId: string;
  readonly frames: Record<string, unknown>[];
}

function roomOf(meetingId: string) {
  return env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(`${firmId}:${meetingId}`));
}

function captionerOf(meetingId: string) {
  const captioner = captionerFor(env as unknown as Bindings, firmId, meetingId);
  if (captioner === null) throw new Error("the test pool binds no captioner");
  return captioner;
}

/** One person into the room on a socket, welcomed, with a microphone published at the routing service. */
async function arrive(
  meetingId: string,
  options: {
    readonly displayName: string;
    readonly host?: boolean;
    readonly guest?: boolean;
    readonly microphone?: boolean;
  },
): Promise<Socket> {
  const attendanceId = newIdentifier(
    options.guest === true ? "meetingGuestStay" : "meetingAttendance",
  );
  const userId = options.guest === true ? "" : newIdentifier("user");
  const response = await roomOf(meetingId).fetch(
    new Request(
      meetingSocketRequestUrl({
        firmId,
        meetingId,
        userId,
        attendanceId,
        displayName: options.displayName,
        medium: "audio",
        hostRole: options.host === true ? "host" : null,
        locked: false,
        lobby: "off",
        waiting: false,
        waitingFrom: "",
        participantKind: options.guest === true ? "guest" : "member",
        ...(options.guest === true ? { invitedName: options.displayName } : {}),
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
  await waitUntil(() => frames.some((frame) => frame["type"] === "welcome"));
  if (options.microphone !== false) {
    // As the room writes somebody who has published a microphone: a routing session and one audio
    // track named under their own handle.
    await runInDurableObject(roomOf(meetingId), async (_room, state) => {
      const key = `participant:${attendanceId}`;
      const participant = await state.storage.get<Record<string, unknown>>(key);
      await state.storage.put(key, {
        ...participant,
        sfuSessionId: `routing-session-${attendanceId}`,
        tracks: [{ trackName: `${attendanceId}:microphone`, kind: "audio", mid: "0" }],
      });
    });
  }
  return { socket, attendanceId, userId, frames };
}

function send(person: Socket, frame: Record<string, unknown>): void {
  person.socket.send(JSON.stringify({ v: 1, ...frame }));
}

function framesOf(person: Socket, type: string): Record<string, unknown>[] {
  return person.frames.filter((frame) => frame["type"] === type);
}

function lastRoomState(person: Socket): Record<string, unknown> | undefined {
  return framesOf(person, "room-state").at(-1);
}

/** Whether the last room state this person was sent says captions are off — the field absent. */
function captionsAnnouncedOff(person: Socket): boolean {
  const state = lastRoomState(person);
  return state !== undefined && state["captions"] === undefined;
}

/** The caption adapters the stand-in routing service was asked for, with their verified claims. */
async function captionAdapters() {
  const opened = [];
  for (const call of calls) {
    if (!call.path.endsWith("/adapters/websocket/new")) continue;
    for (const request of (call.body["tracks"] ?? []) as {
      trackName: string;
      endpoint: string;
    }[]) {
      const token = new URL(request.endpoint).pathname.slice(MEETING_SINK_PATH_PREFIX.length);
      // eslint-disable-next-line no-await-in-loop -- a handful of tokens, verified in order
      const claims = await verifyCaptionSinkToken(SIGNING_KEY, token, Date.now());
      if (claims !== null) opened.push({ trackName: request.trackName, token, claims });
    }
  }
  return opened;
}

function closedAdapterIds(): string[] {
  return calls
    .filter((call) => call.path.endsWith("/adapters/websocket/close"))
    .flatMap((call) =>
      ((call.body["tracks"] ?? []) as { adapterId: string }[]).map((t) => t.adapterId),
    );
}

/** The routing service dialling the caption address it was handed, through the real sink route. */
async function dialCaptionAdapter(token: string): Promise<WebSocket> {
  const response = await app.request(
    `https://magnacarta.esq${MEETING_SINK_PATH_PREFIX}${token}`,
    { headers: { Upgrade: "websocket" } },
    env,
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null || socket === undefined) throw new Error("no socket on the 101");
  socket.accept();
  return socket;
}

/** Twenty milliseconds of stereo audio from the adapter, `count` frames of it. */
function speak(audio: WebSocket, count: number, firstSequence = 1): void {
  for (let index = 0; index < count; index += 1)
    audio.send(pcmEnvelope(firstSequence + index, 960));
}

async function captionerState(meetingId: string) {
  return await captionerOf(meetingId).inspect();
}

/** A meeting with a host, a member who will speak, and a guest listening — captions on. */
async function captionedRoom() {
  const meetingId = newIdentifier("meeting") as MeetingId;
  const host = await arrive(meetingId, { displayName: "Ana Host", host: true });
  const speaker = await arrive(meetingId, { displayName: "Ben Speaker" });
  const guest = await arrive(meetingId, { displayName: "Gail Guest", guest: true });
  send(host, { type: "captions", enabled: true });
  await waitUntil(() => lastRoomState(guest)?.["captions"] !== undefined);
  return { meetingId, host, speaker, guest };
}

/** Opens a speaker's session and dials its adapter, answering the audio socket. */
async function startSpeaking(meetingId: string, speaker: Socket): Promise<WebSocket> {
  send(speaker, { type: "presence", speaking: true, muted: false });
  await waitUntil(async () => (await captionerState(meetingId)).sessions.some((s) => s.streaming));
  const adapter = (await captionAdapters()).find(
    (opened) => opened.claims.participantId === speaker.attendanceId,
  );
  if (adapter === undefined) throw new Error("no caption adapter was opened for the speaker");
  return await dialCaptionAdapter(adapter.token);
}

describe("a host turning captions on", () => {
  it("is announced to every socket on the room state, and rides the welcome of a late arrival", async () => {
    const { meetingId, host, speaker, guest } = await captionedRoom();
    await Promise.all(
      [host, speaker, guest].map(async (person) => {
        await waitUntil(() => lastRoomState(person)?.["captions"] !== undefined);
      }),
    );
    for (const person of [host, speaker, guest]) {
      expect(lastRoomState(person)?.["captions"]).toMatchObject({ by: host.attendanceId });
    }
    const late = await arrive(meetingId, { displayName: "Late Arrival" });
    const welcome = framesOf(late, "welcome")[0]!;
    expect((welcome["roomState"] as Record<string, unknown>)["captions"]).toMatchObject({
      by: host.attendanceId,
    });
  });

  it("is refused to somebody who is not running the meeting", async () => {
    const meetingId = newIdentifier("meeting") as MeetingId;
    const member = await arrive(meetingId, { displayName: "Not A Host" });
    send(member, { type: "captions", enabled: true });
    await waitUntil(() => framesOf(member, "refused").length > 0);
    expect(framesOf(member, "refused")[0]).toMatchObject({ reason: "not-host" });
  });

  it("is refused where the firm has not switched captions on, and nothing changes", async () => {
    await setFirmCaptions(false);
    const meetingId = newIdentifier("meeting") as MeetingId;
    const host = await arrive(meetingId, { displayName: "Ana Host", host: true });
    send(host, { type: "captions", enabled: true });
    await waitUntil(() => framesOf(host, "refused").length > 0);
    expect(framesOf(host, "refused")[0]).toMatchObject({ reason: "captions-unavailable" });
    expect(framesOf(host, "room-state")).toHaveLength(0);
  });
});

describe("a caption session", () => {
  it("is opened only while somebody speaks, with no recording, and closed three seconds after", async () => {
    const { meetingId, speaker } = await captionedRoom();
    // Captions on and nobody speaking: nothing is opened and nothing is billed.
    expect(await captionAdapters()).toHaveLength(0);
    expect((await captionerState(meetingId)).sessions).toHaveLength(0);

    const audio = await startSpeaking(meetingId, speaker);
    const [adapter] = await captionAdapters();
    expect(adapter?.trackName).toBe(`${speaker.attendanceId}:microphone`);
    expect(adapter?.claims.meetingId).toBe(meetingId);
    speak(audio, 5);
    await waitUntil(async () => (await captionerState(meetingId)).sessions[0]?.attached === true);

    // They stop. Inside the three seconds the session stays open, so a pause between sentences does
    // not cost the first words of the next.
    send(speaker, { type: "presence", speaking: false, muted: false });
    await waitUntil(async () => (await captionerState(meetingId)).sessions[0]?.quiet === true);
    // Wound short of the deadline by more than the milliseconds that really pass between the stop and
    // the alarm, so the test measures the rule and not the machine.
    windForward = CAPTION_SILENCE_CLOSE_MILLISECONDS - 500;
    await runDurableObjectAlarm(captionerOf(meetingId));
    expect((await captionerState(meetingId)).sessions).toHaveLength(1);

    windForward = CAPTION_SILENCE_CLOSE_MILLISECONDS;
    await runDurableObjectAlarm(captionerOf(meetingId));
    const after = await captionerState(meetingId);
    expect(after.sessions).toHaveLength(0);
    expect(after.storedAdapters).toBe(0);
    expect(after.meter.sessionsOpened).toBe(1);
    expect(after.meter.audioMilliseconds).toBe(100);
    // The adapter the session opened is the one the routing service was told to close.
    expect(closedAdapterIds()).toHaveLength(1);
    // And its address opens nothing any more: the captioner is the authority on an open session.
    const redial = await app.request(
      `https://magnacarta.esq${MEETING_SINK_PATH_PREFIX}${adapter!.token}`,
      { headers: { Upgrade: "websocket" } },
      env,
    );
    expect(redial.status).toBe(404);
  });

  it("is kept open by a start inside the silence", async () => {
    const { meetingId, speaker } = await captionedRoom();
    await startSpeaking(meetingId, speaker);
    send(speaker, { type: "presence", speaking: false, muted: false });
    await waitUntil(async () => (await captionerState(meetingId)).sessions[0]?.quiet === true);
    send(speaker, { type: "presence", speaking: true, muted: false });
    await waitUntil(async () => (await captionerState(meetingId)).sessions[0]?.quiet === false);
    windForward = CAPTION_SILENCE_CLOSE_MILLISECONDS * 2;
    await runDurableObjectAlarm(captionerOf(meetingId));
    expect((await captionerState(meetingId)).sessions).toHaveLength(1);
    expect(await captionAdapters()).toHaveLength(1);
  });
});

describe("what is heard", () => {
  it("reaches every socket as interim and final captions, named, a guest told no firm identifier", async () => {
    const { meetingId, host, speaker, guest } = await captionedRoom();
    const audio = await startSpeaking(meetingId, speaker);
    // Fifty frames is one second of speech: the stub answers each with an interim and the fiftieth
    // with a final.
    speak(audio, 50);
    await Promise.all(
      [host, speaker, guest].map(async (person) => {
        await waitUntil(() => framesOf(person, "caption").some((frame) => frame["final"] === true));
      }),
    );
    const hostCaptions = framesOf(host, "caption");
    const interims = hostCaptions.filter((frame) => frame["final"] === false);
    const finals = hostCaptions.filter((frame) => frame["final"] === true);
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({
      v: 1,
      participantId: speaker.attendanceId,
      userId: speaker.userId,
      displayName: "Ben Speaker",
      text: `${STUB_RESPONSE_MARKER} 96000 bytes of speech`,
      final: true,
    });
    // COALESCED: forty-nine guesses arrived inside the first half-second, and at most a couple reach a
    // socket — never one per guess.
    expect(interims.length).toBeGreaterThanOrEqual(1);
    expect(interims.length).toBeLessThan(5);
    // Every caption of one stretch of speech names the same segment, so a browser replaces its line.
    const segment = finals[0]!["segmentId"];
    for (const interim of interims) expect(interim["segmentId"]).toBe(segment);

    const guestFinal = framesOf(guest, "caption").find((frame) => frame["final"] === true);
    expect(guestFinal).toMatchObject({
      participantId: speaker.attendanceId,
      userId: null,
      displayName: "Ben Speaker",
      text: finals[0]!["text"],
    });
  });

  it("names a guest speaker by the name typed at the door, with no identifier on any copy", async () => {
    const { meetingId, host, guest } = await captionedRoom();
    const audio = await startSpeaking(meetingId, guest);
    speak(audio, 50);
    await waitUntil(() => framesOf(host, "caption").some((frame) => frame["final"] === true));
    const final = framesOf(host, "caption").find((frame) => frame["final"] === true);
    expect(final).toMatchObject({
      participantId: guest.attendanceId,
      userId: null,
      displayName: "Gail Guest",
    });
  });

  it("is kept nowhere: not by the room and not by the captioner", async () => {
    const { meetingId, host, speaker } = await captionedRoom();
    const audio = await startSpeaking(meetingId, speaker);
    speak(audio, 50);
    await waitUntil(() => framesOf(host, "caption").some((frame) => frame["final"] === true));
    const inRoom = await runInDurableObject(roomOf(meetingId), async (_room, state) => [
      ...(await state.storage.list()).entries(),
    ]);
    const inCaptioner = await runInDurableObject(
      captionerOf(meetingId),
      async (_captioner, state) => [...(await state.storage.list()).entries()],
    );
    expect(inRoom.length).toBeGreaterThan(0);
    for (const stored of [inRoom, inCaptioner]) {
      expect(JSON.stringify(stored)).not.toContain(STUB_RESPONSE_MARKER);
      expect(JSON.stringify(stored)).not.toContain("bytes of speech");
    }
  });

  it("is not sent once a host turns captions off, and every session closes", async () => {
    const { meetingId, host, speaker, guest } = await captionedRoom();
    await startSpeaking(meetingId, speaker);
    send(host, { type: "captions", enabled: false });
    await waitUntil(() => captionsAnnouncedOff(guest));
    await waitUntil(async () => (await captionerState(meetingId)).sessions.length === 0);
    expect(closedAdapterIds()).toHaveLength(1);
    // A caption the captioner heard just before the switch moved is dropped by the room.
    const reached = await roomOf(meetingId).captionHeard({
      participantId: speaker.attendanceId,
      participantKind: "member",
      userId: speaker.userId,
      displayName: "Ben Speaker",
      segmentId: "late-0",
      text: "too late",
      final: true,
      at: new Date().toISOString(),
    });
    expect(reached).toBe(0);
  });
});

describe("the firm's switch", () => {
  it("turned off mid-meeting stops the next session from opening and turns captions off for everybody", async () => {
    const { meetingId, speaker, guest } = await captionedRoom();
    await setFirmCaptions(false);
    send(speaker, { type: "presence", speaking: true, muted: false });
    await waitUntil(() => captionsAnnouncedOff(guest));
    expect(await captionAdapters()).toHaveLength(0);
    expect((await captionerState(meetingId)).sessions).toHaveLength(0);
  });
});

describe("a caption model that fails mid-meeting", () => {
  it("costs the speaker their captions for the turn, and leaves the recording running untouched", async () => {
    // A stub whose streams the test can drop under the captioner.
    const stub = createStubInferencePort();
    const drops: ((outcome: "closed" | "failed") => void)[] = [];
    const port: InferencePort = {
      ...stub,
      openCaptionStream: async (input) => {
        drops.push(input.onEnd);
        return await stub.openCaptionStream(input);
      },
    };
    setCaptionInferencePortForTests(port);

    // A recording running in the same meeting, on its own recorder.
    const meeting = await seedRecordedMeeting(firmId);
    const recorded = await seedMemberIn(firmId, "Recorded Member");
    const { recordingId, tracks, startedAt } = await seedRunningRecording(meeting, [recorded]);
    const recorder = env.MEETING_RECORDER!.get(
      env.MEETING_RECORDER!.idFromName(`${firmId}:${recordingId}`),
    );
    const start: RecorderStartInput = {
      firmId,
      meetingId: meeting.meetingId,
      matterId: meeting.matterId,
      recordingId,
      startedAt,
      ceiling: 11,
      tracks: tracks.map((track) => ({
        trackId: track.trackId,
        trackName: track.trackName,
        sessionId: track.sessionId,
        participantKind: "member" as const,
        participantId: track.participantId,
        userId: track.userId,
      })),
    };
    await recorder.start(start);
    const recorderAdapters = calls.filter((call) =>
      call.path.endsWith("/adapters/websocket/new"),
    ).length;

    const host = await arrive(meeting.meetingId, { displayName: "Ana Host", host: true });
    const speaker = await arrive(meeting.meetingId, { displayName: "Ben Speaker" });
    send(host, { type: "captions", enabled: true });
    await waitUntil(() => lastRoomState(host)?.["captions"] !== undefined);
    const audio = await startSpeaking(meeting.meetingId, speaker);
    speak(audio, 5);

    // Dropped from inside the captioner, as the model's own socket event would be.
    await runInDurableObject(captionerOf(meeting.meetingId), () => {
      for (const drop of drops) drop("failed");
    });
    await waitUntil(async () => (await captionerState(meeting.meetingId)).sessions.length === 0);
    const after = await captionerState(meeting.meetingId);
    expect(after.meter.sessionFailures).toBe(1);
    // Only the caption adapter was closed; the room sent nobody an error frame.
    expect(closedAdapterIds()).toEqual([`adapter-${String(recorderAdapters + 1)}`]);
    expect(framesOf(host, "refused")).toHaveLength(0);
    expect(lastRoomState(host)?.["captions"]).toMatchObject({ by: host.attendanceId });

    // The recording is exactly where it was.
    const recording = await recorder.inspect();
    expect(recording.state).toBe("recording");
    expect(recording.tracks.map((track) => track.state)).toEqual(["open"]);
    const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
      .prepare(`SELECT state FROM meeting_recording WHERE id = ?1`)
      .bind(recordingId)
      .all<{ state: string }>();
    expect(results[0]?.state).toBe("recording");

    // And the speaker's next turn is captioned again.
    send(speaker, { type: "presence", speaking: false, muted: false });
    send(speaker, { type: "presence", speaking: true, muted: false });
    await waitUntil(async () =>
      (await captionerState(meeting.meetingId)).sessions.some((session) => session.streaming),
    );
    await recorder.stop("member");
  });
});

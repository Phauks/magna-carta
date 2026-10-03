import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MeetingRecordingId } from "@magna-carta/identifiers/types";
import { parseTrackSegments, placeTrackSegments } from "@magna-carta/meetings/recording-types";
import { readWavHeader } from "@magna-carta/meetings/wav";
import {
  RECORDED_TRACK_CEILING_MAXIMUM,
  RECORDER_ISOLATE_MEMORY_BYTES,
  RECORDER_RESERVED_BYTES,
  RECORDING_PART_UPLOADS_IN_FLIGHT,
  RECORDING_TRACK_BUFFER_BYTES,
} from "@magna-carta/meetings/settings";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Bindings } from "../src/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  EMPTY_ROOM_ABANDON_MILLISECONDS,
  MAXIMUM_RECORDING_MILLISECONDS,
  MeetingRecorder,
  RECORDING_PART_BYTES,
  setRecordingComposeQueueForTests,
  STORAGE_PUT_BATCH_KEYS,
  TRACK_LOSS_GRACE_MILLISECONDS,
  type MeetingRecordingComposeMessage,
  type RecorderStartInput,
} from "../src/meetings/meeting-recorder.ts";
import { composeWindow } from "../src/meetings/recording-compose-consumer.ts";
import { setSfuFetchForTests } from "../src/meetings/sfu/sfu-client.ts";
import {
  MEETING_SINK_PATH_PREFIX,
  setMeetingSinkSigningKeyForTests,
  verifySinkToken,
  type MeetingSinkClaims,
} from "../src/meetings/sink-token.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  fakeAdapterService,
  pcmEnvelope,
  seedMemberIn,
  seedRecordedMeeting,
  seedRoomRoster,
  seedRunningRecording,
  sinkClaimsFor,
  waitUntil,
  type AdapterCall,
  type RecordedMeeting,
  type SeededTrack,
} from "./support/meeting-recording-fixture.ts";
import { seedFirmRow } from "./support/test-auth.ts";

// THE RECORDER, against a fake routing service and the test pool's own R2.
//
// What would be a real failure if it stopped holding: every track gets an adapter that dials back
// with a signed address and an upload in the firm's own bucket; frames become mono parts of exactly
// the part size, with silence written for every frame the sequence numbers say never arrived; a stop
// closes every adapter and completes every upload with what was actually captured; a track whose
// socket never comes back is recorded as lost; a recording whose every track is lost, whose room has
// been empty too long, or that reached its maximum length stops itself; a stop the record holds is
// honoured on the next pass even if it never reached the recorder; and what the recorder holds in
// memory is the bound the settings arithmetic promises, however large a gap or however full a room.
//
// The recorder is not hibernating, and the test pool runs it as the runtime would: real sockets, a
// real multipart upload, the firm's own database through the proxy. The routing service and the sink
// signing key are installed through the same module seams the room's tests use, because a Durable
// Object is constructed with the deployment's own environment and cannot be handed another.

const SIGNING_KEY = "meeting-recorder-test-signing-key";

let calls: AdapterCall[] = [];
let firmId: FirmId;
// What the recorder handed on to be composed. Collected rather than delivered: these tests read the
// staged objects after a stop, and a compose running behind them would file and delete those objects.
// The compose step has its own suite (recording-compose.test.ts).
const composeMessages: unknown[] = [];

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm") as FirmId;
  await seedFirmRow(firmId);
  setMeetingSinkSigningKeyForTests(SIGNING_KEY);
  setRecordingComposeQueueForTests({
    send: async (message: unknown) => {
      composeMessages.push(message);
    },
  });
});

afterAll(() => {
  setSfuFetchForTests(null);
  setMeetingSinkSigningKeyForTests(null);
  setRecordingComposeQueueForTests(null);
});

beforeEach(() => {
  calls = [];
  setSfuFetchForTests(fakeAdapterService(calls));
});

function recorderStub(recordingId: string) {
  return env.MEETING_RECORDER!.get(env.MEETING_RECORDER!.idFromName(`${firmId}:${recordingId}`));
}

interface Started {
  readonly meeting: RecordedMeeting;
  readonly recordingId: string;
  readonly tracks: SeededTrack[];
  readonly stub: ReturnType<typeof recorderStub>;
}

/** A meeting, a recording with this many tracks on the room's roster, and the recorder started. */
async function startRecorder(trackCount: number, ceiling = 32): Promise<Started> {
  const meeting = await seedRecordedMeeting(firmId);
  const members = [];
  for (let index = 0; index < trackCount; index += 1) {
    members.push(await seedMemberIn(firmId, `Member ${String(index)}`));
  }
  const { recordingId, tracks, startedAt } = await seedRunningRecording(meeting, members);
  await seedRoomRoster(meeting, tracks);
  const stub = recorderStub(recordingId);
  const input: RecorderStartInput = {
    firmId,
    meetingId: meeting.meetingId,
    matterId: meeting.matterId,
    recordingId: recordingId,
    startedAt,
    ceiling,
    tracks: tracks.map((track) => ({
      trackId: track.trackId,
      trackName: track.trackName,
      sessionId: track.sessionId,
      participantKind: "member" as const,
      participantId: track.participantId,
      userId: track.userId,
    })),
  };
  await stub.start(input);
  return { meeting, recordingId, tracks, stub };
}

/** The upgrade the sink route forwards, built from a token's verified claims. */
async function dialWith(stub: Started["stub"], claims: MeetingSinkClaims): Promise<Response> {
  const address = new URL("https://meeting-recorder.invalid/sink");
  address.searchParams.set("track", claims.trackId);
  address.searchParams.set("adapter", claims.adapterNonce);
  return await stub.fetch(new Request(address.toString(), { headers: { Upgrade: "websocket" } }));
}

/** Opens the socket the routing service would dial for one track's current adapter. */
async function dial(stub: Started["stub"], trackName: string): Promise<WebSocket> {
  const response = await dialWith(stub, await sinkClaimsFor(calls, trackName, SIGNING_KEY));
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null || socket === undefined) throw new Error("no socket on the 101");
  socket.accept();
  return socket;
}

/** Takes participants off the room's roster, as the room does when they leave. */
async function removeFromRoom(meeting: RecordedMeeting, participantIds: readonly string[]) {
  await runInDurableObject(
    env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(`${firmId}:${meeting.meetingId}`)),
    async (_room, state) => {
      await state.storage.delete(participantIds.map((id) => `participant:${id}`));
    },
  );
}

/** Reaches into the live recorder — the one thing a test may wind back is the clock it measures. */
interface RecorderInternals {
  recording: { startedAt: string; emptySince: number | null } | null;
  tracks: Map<
    string,
    {
      trackId: string;
      socketLostAt: number | null;
      resumeFromWallClock: boolean;
      framesDropped: number;
      stagedSamples: number;
      timelineSamples: number;
    }
  >;
  dirty: Set<string>;
  bucket: R2Bucket | null;
  ctx: DurableObjectState;
  persistTracks(): Promise<void>;
}

function internals(instance: MeetingRecorder): RecorderInternals {
  return instance as unknown as RecorderInternals;
}

async function trackRows(recordingId: string) {
  const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(
      `SELECT track_name, state, adapter_id, staging_key, frames_received, frames_dropped ` +
        `FROM meeting_recording_track WHERE recording_id = ?1`,
    )
    .bind(recordingId)
    .all<{
      track_name: string;
      state: string;
      adapter_id: string | null;
      staging_key: string | null;
      frames_received: number;
      frames_dropped: number;
    }>();
  return results;
}

async function recordingRow(recordingId: string) {
  const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(
      `SELECT state, stop_reason, captured_seconds, failure_error_id FROM meeting_recording WHERE id = ?1`,
    )
    .bind(recordingId)
    .all<{
      state: string;
      stop_reason: string | null;
      captured_seconds: number | null;
      failure_error_id: string | null;
    }>();
  return results[0];
}

/** The route's own stop, committed to the record without the call to the recorder. */
async function stopInRecordOnly(recordingId: string): Promise<void> {
  await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(
      `UPDATE meeting_recording SET state = 'composing', stopped_at = ?2, stop_reason = 'member' WHERE id = ?1`,
    )
    .bind(recordingId, new Date().toISOString())
    .run();
}

// A 32 KiB stereo payload folds to 16 KiB of mono, so this many frames fill exactly one part.
const PAIRS_PER_LARGE_FRAME = 8192;
const MONO_BYTES_PER_LARGE_FRAME = PAIRS_PER_LARGE_FRAME * 2;
const LARGE_FRAMES_PER_PART = RECORDING_PART_BYTES / MONO_BYTES_PER_LARGE_FRAME;

describe("starting the recorder", () => {
  it("opens one adapter per track, each dialling a signed address for that track row and adapter", async () => {
    const { recordingId, tracks } = await startRecorder(2);

    const opened = calls.filter((call) => call.path.endsWith("/adapters/websocket/new"));
    expect(opened).toHaveLength(2);
    const nonces = new Set<string>();
    for (const [index, call] of opened.entries()) {
      const [request] = call.body["tracks"] as {
        location: string;
        sessionId: string;
        trackName: string;
        endpoint: string;
        outputCodec: string;
      }[];
      expect(request?.location).toBe("remote");
      expect(request?.outputCodec).toBe("pcm");
      expect(request?.sessionId).toBe(tracks[index]?.sessionId);
      expect(request?.trackName).toBe(tracks[index]?.trackName);
      // THE ADDRESS IS THE CREDENTIAL: this deployment's own origin, the sink path, and a token that
      // verifies to exactly this firm, recording and track ROW — never the browser's track name.
      const endpoint = new URL(request?.endpoint ?? "");
      expect(endpoint.protocol).toBe("wss:");
      expect(endpoint.pathname.startsWith(MEETING_SINK_PATH_PREFIX)).toBe(true);
      const claims = await verifySinkToken(
        SIGNING_KEY,
        endpoint.pathname.slice(MEETING_SINK_PATH_PREFIX.length),
        Date.now(),
      );
      expect(claims).toMatchObject({ firmId, recordingId, trackId: tracks[index]?.trackId });
      expect(claims && "trackName" in claims).toBe(false);
      nonces.add(claims?.adapterNonce ?? "");
      // The token never rides a query string, where the platform's request log would keep it whole.
      expect(endpoint.search).toBe("");
    }
    expect(nonces.size).toBe(2);

    const rows = await trackRows(recordingId);
    expect(rows.every((row) => row.adapter_id !== null && row.staging_key !== null)).toBe(true);
    // The object key is minted from server handles, never from the track name a browser chose.
    expect(rows.every((row) => !(row.staging_key ?? "").includes("microphone"))).toBe(true);
  });

  it("records a track whose adapter the routing service refuses as lost, and keeps the rest", async () => {
    setSfuFetchForTests(fakeAdapterService(calls, { refuse: true }));
    const { recordingId } = await startRecorder(1);
    const [row] = await trackRows(recordingId);
    expect(row?.state).toBe("lost");
  });
});

describe("frames in, bytes out", () => {
  it("uploads a part at exactly the part size and completes the staged object on stop", async () => {
    const { recordingId, tracks, stub } = await startRecorder(1);
    const track = tracks[0]!;
    const socket = await dial(stub, track.trackName);

    const frameCount = LARGE_FRAMES_PER_PART + 10;
    for (let sequence = 1; sequence <= frameCount; sequence += 1) {
      socket.send(pcmEnvelope(sequence, PAIRS_PER_LARGE_FRAME));
    }
    await waitUntil(async () => {
      const inspected = await stub.inspect();
      return inspected.tracks[0]?.framesReceived === frameCount && inspected.tracks[0].parts === 1;
    });
    const inspected = await stub.inspect();
    expect(inspected.tracks[0]?.parts).toBe(1);
    // What is left in memory is the overflow past the part, moved down in place.
    expect(inspected.tracks[0]?.carriedBytes).toBe(10 * MONO_BYTES_PER_LARGE_FRAME);
    // Only what has UPLOADED counts as staged.
    expect(inspected.tracks[0]?.stagedSamples).toBe(RECORDING_PART_BYTES / 2);

    const outcome = await stub.stop("member");
    expect(outcome?.outcome).toBe("composing");
    // Handed on to be composed, by identifiers alone.
    expect(composeMessages).toContainEqual({
      kind: "meeting-recording-compose",
      firmId,
      meetingId: expect.any(String),
      recordingId,
    });

    const [row] = await trackRows(recordingId);
    expect(row?.frames_received).toBe(frameCount);
    expect(row?.state).toBe("closed");
    const object = await env.R2.get(row?.staging_key ?? "");
    expect(object?.size).toBe(frameCount * MONO_BYTES_PER_LARGE_FRAME);
    // Mono is the average of the two channels: (1000 + 3000) / 2.
    const head = new DataView((await object!.arrayBuffer()).slice(0, 4));
    expect(head.getInt16(0, true)).toBe(2000);
    // And the object is stamped with the matter it belongs to.
    expect(object?.customMetadata?.["object_class"]).toBe("meeting-recording-track");

    expect((await recordingRow(recordingId))?.captured_seconds).toBeGreaterThanOrEqual(
      Math.floor((frameCount * PAIRS_PER_LARGE_FRAME) / 48_000),
    );
  });

  it("writes silence of exactly the gap's length for frames that never arrived, and counts every discarded frame", async () => {
    const { recordingId, tracks, stub } = await startRecorder(1);
    const track = tracks[0]!;
    const socket = await dial(stub, track.trackName);
    const pairs = 960;
    // Frames 3 and 4 never arrive; a duplicate of 5 arrives late and is not taken twice — but it is
    // counted, because every frame the recorder discards is one the record should account for.
    for (const sequence of [1, 2, 5, 5, 6]) socket.send(pcmEnvelope(sequence, pairs));
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.framesReceived === 4);
    await stub.stop("member");

    const [row] = await trackRows(recordingId);
    expect(row?.frames_received).toBe(4);
    expect(row?.frames_dropped).toBe(3);
    const bytes = new Uint8Array(await (await env.R2.get(row?.staging_key ?? ""))!.arrayBuffer());
    // Four frames of audio and two of silence: the timeline stays real.
    expect(bytes.length).toBe(6 * pairs * 2);
    const silence = bytes.subarray(2 * pairs * 2, 4 * pairs * 2);
    expect(silence.every((byte) => byte === 0)).toBe(true);
    const after = new DataView(bytes.buffer, 4 * pairs * 2, 2);
    expect(after.getInt16(0, true)).toBe(2000);
  });

  it("counts a message that is not an envelope as dropped and carries on", async () => {
    const { tracks, stub } = await startRecorder(1);
    const socket = await dial(stub, tracks[0]!.trackName);
    socket.send(Uint8Array.from([0x08, 0xff, 0xff]));
    socket.send(pcmEnvelope(1, 10));
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.framesReceived === 1);
    expect((await stub.inspect()).tracks[0]?.framesDropped).toBe(1);
    await stub.stop("member");
  });
});

describe("the sequence, against the wall clock", () => {
  it("places the first frame on a NEW socket by the wall clock, so a counter that restarted is taken", async () => {
    const { recordingId, tracks, stub } = await startRecorder(1);
    const first = await dial(stub, tracks[0]!.trackName);
    for (let sequence = 1; sequence <= 5; sequence += 1) first.send(pcmEnvelope(sequence, 960));
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.framesReceived === 5);
    first.close(1000, "routing service reconnecting");
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.attached === false);

    // The redialled adapter's counter starts at one again.
    const second = await dial(stub, tracks[0]!.trackName);
    second.send(pcmEnvelope(1, 960));
    second.send(pcmEnvelope(2, 960));
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.framesReceived === 7);
    expect((await stub.inspect()).tracks[0]?.framesReceived).toBe(7);
    await stub.stop("member");
    expect((await trackRows(recordingId))[0]?.frames_received).toBe(7);
  });

  it("reads a jump backwards past the reorder window as a counter reset, and discards repeats inside it", async () => {
    const { tracks, stub } = await startRecorder(1);
    const socket = await dial(stub, tracks[0]!.trackName);
    // 1002 repeated and 1001 behind are inside the window: discarded and counted. Then the counter
    // restarts at 1, which is far behind — a reset, taken, not a repeat.
    for (const sequence of [1000, 1001, 1002, 1002, 1001, 1, 2]) {
      socket.send(pcmEnvelope(sequence, 960));
    }
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.framesReceived === 5);
    const inspected = (await stub.inspect()).tracks[0];
    expect(inspected?.framesReceived).toBe(5);
    expect(inspected?.framesDropped).toBeGreaterThanOrEqual(2);
    await stub.stop("member");
  });
});

describe("what the recorder holds in memory", () => {
  it("never holds more buffers than the ceiling the memory allows, nor more uploads in flight than the bound", async () => {
    // The caller asks for far more than the memory allows; the recorder holds the bound and records
    // the rest as not heard.
    const { recordingId, tracks, stub } = await startRecorder(
      RECORDED_TRACK_CEILING_MAXIMUM + 2,
      64,
    );
    const started = await stub.inspect();
    expect(started.memory.trackBuffers).toBe(RECORDED_TRACK_CEILING_MAXIMUM);
    expect(started.memory.trackBufferBytes).toBe(
      RECORDED_TRACK_CEILING_MAXIMUM * RECORDING_TRACK_BUFFER_BYTES,
    );
    const rows = await trackRows(recordingId);
    expect(rows.filter((row) => row.state === "lost")).toHaveLength(2);
    expect(started.tracks.every((one) => one.bufferBytes <= RECORDING_TRACK_BUFFER_BYTES)).toBe(
      true,
    );

    // Three tracks cross a part at the same moment, so their uploads contend.
    const sockets = await Promise.all(tracks.slice(0, 3).map((one) => dial(stub, one.trackName)));
    const frameCount = LARGE_FRAMES_PER_PART + 2;
    for (let sequence = 1; sequence <= frameCount; sequence += 1) {
      for (const socket of sockets) socket.send(pcmEnvelope(sequence, PAIRS_PER_LARGE_FRAME));
    }
    await waitUntil(async () =>
      (await stub.inspect()).tracks.slice(0, 3).every((one) => one.parts === 1),
    );
    const inspected = await stub.inspect();
    expect(inspected.tracks.slice(0, 3).every((one) => one.parts === 1)).toBe(true);
    expect(inspected.memory.peakTrackBuffers).toBeLessThanOrEqual(RECORDED_TRACK_CEILING_MAXIMUM);
    expect(inspected.memory.peakUploadsInFlight).toBeLessThanOrEqual(
      RECORDING_PART_UPLOADS_IN_FLIGHT,
    );
    // And what that bound is in bytes fits the isolate with its reserve: buffers, one shared part of
    // silence, and a copy per upload in flight.
    expect(
      inspected.memory.peakTrackBuffers * RECORDING_TRACK_BUFFER_BYTES +
        (1 + RECORDING_PART_UPLOADS_IN_FLIGHT) * RECORDING_PART_BYTES +
        RECORDER_RESERVED_BYTES,
    ).toBeLessThanOrEqual(RECORDER_ISOLATE_MEMORY_BYTES);

    await stub.stop("member");
    expect((await stub.inspect()).memory.trackBuffers).toBe(0);
  });

  it("does not allocate a long gap: five minutes of silence is counted parts, not twenty-eight megabytes in memory", async () => {
    const { recordingId, tracks, stub } = await startRecorder(1);
    const socket = await dial(stub, tracks[0]!.trackName);
    const pairs = 960;
    const gapFrames = 14_998;
    socket.send(pcmEnvelope(1, pairs));
    socket.send(pcmEnvelope(2 + gapFrames, pairs));
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.framesReceived === 2);
    const inspected = await stub.inspect();
    expect(inspected.memory.trackBuffers).toBe(1);
    expect(inspected.tracks[0]?.bufferBytes).toBe(RECORDING_TRACK_BUFFER_BYTES);
    expect(inspected.memory.peakTrackBuffers).toBe(1);
    // The gap is about 28.8 MB; the track holds at most its one buffer while it is staged.
    expect(inspected.tracks[0]?.carriedBytes).toBeLessThanOrEqual(RECORDING_TRACK_BUFFER_BYTES);

    await stub.stop("member");
    const [row] = await trackRows(recordingId);
    expect(row?.frames_dropped).toBe(gapFrames);
    const object = await env.R2.head(row?.staging_key ?? "");
    expect(object?.size).toBe((2 + gapFrames) * pairs * 2);
  });

  it("flushes and releases a track's buffer when its participant leaves", async () => {
    const { meeting, recordingId, tracks, stub } = await startRecorder(2);
    const socket = await dial(stub, tracks[0]!.trackName);
    socket.send(pcmEnvelope(1, 960));
    const leaving = await dial(stub, tracks[1]!.trackName);
    leaving.send(pcmEnvelope(1, 960));
    await waitUntil(async () =>
      (await stub.inspect()).tracks.every((one) => one.framesReceived === 1),
    );
    expect((await stub.inspect()).memory.trackBuffers).toBe(2);
    await removeFromRoom(meeting, [tracks[1]!.participantId]);
    await runDurableObjectAlarm(stub);

    const rows = await trackRows(recordingId);
    expect(rows.find((row) => row.track_name === tracks[1]!.trackName)?.state).toBe("closed");
    expect(rows.find((row) => row.track_name === tracks[0]!.trackName)?.state).toBe("open");
    expect((await recordingRow(recordingId))?.state).toBe("recording");
    const inspected = await stub.inspect();
    expect(inspected.memory.trackBuffers).toBe(1);
    // What the departed track held went up, padded to a part boundary.
    expect(inspected.tracks[1]?.parts).toBe(1);
    await stub.stop("member");
    // The record never claims the padding: a part is about fifty-five seconds, and one frame of
    // twenty milliseconds on each track is all that was heard.
    expect((await recordingRow(recordingId))?.captured_seconds).toBeLessThan(10);
  });
});

describe("a stop the recorder never heard about", () => {
  it("settles on its next pass when the record says the recording stopped, and captures nothing after", async () => {
    const { recordingId, tracks, stub } = await startRecorder(1);
    const socket = await dial(stub, tracks[0]!.trackName);
    let closed = false;
    socket.addEventListener("close", () => {
      closed = true;
    });
    socket.send(pcmEnvelope(1, 960));
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.framesReceived === 1);

    // The route committed the stop; its call to the recorder never arrived.
    await stopInRecordOnly(recordingId);
    await runDurableObjectAlarm(stub);

    expect((await stub.inspect()).state).toBe("stopped");
    await waitUntil(() => closed);
    expect(closed).toBe(true);
    const [row] = await trackRows(recordingId);
    expect(row?.state).toBe("closed");
    expect(row?.frames_received).toBe(1);
    const object = await env.R2.head(row?.staging_key ?? "");
    expect(object?.size).toBe(960 * 2);
    expect((await recordingRow(recordingId))?.state).toBe("composing");
  });
});

describe("a recording nobody stops", () => {
  it("stops as abandoned once nobody has been in the room for the sustained window", async () => {
    const { meeting, recordingId, tracks, stub } = await startRecorder(1);
    await removeFromRoom(meeting, [tracks[0]!.participantId]);
    await runDurableObjectAlarm(stub);
    expect((await trackRows(recordingId))[0]?.state).toBe("closed");
    expect((await recordingRow(recordingId))?.state).toBe("recording");

    await runInDurableObject(stub, async (instance: MeetingRecorder) => {
      const recording = internals(instance).recording;
      expect(recording?.emptySince).not.toBeNull();
      internals(instance).recording = {
        ...recording!,
        emptySince: Date.now() - EMPTY_ROOM_ABANDON_MILLISECONDS - 1_000,
      };
    });
    await runDurableObjectAlarm(stub);
    const recording = await recordingRow(recordingId);
    expect(recording?.stop_reason).toBe("abandoned");
    expect((await stub.inspect()).state).toBe("stopped");
  });

  it("holds a recording that never had a track to the same rule", async () => {
    const { recordingId, stub } = await startRecorder(0);
    await runDurableObjectAlarm(stub);
    expect((await recordingRow(recordingId))?.state).toBe("recording");
    await runInDurableObject(stub, async (instance: MeetingRecorder) => {
      const recording = internals(instance).recording;
      internals(instance).recording = {
        ...recording!,
        emptySince: Date.now() - EMPTY_ROOM_ABANDON_MILLISECONDS - 1_000,
      };
    });
    await runDurableObjectAlarm(stub);
    expect((await recordingRow(recordingId))?.stop_reason).toBe("abandoned");
  });

  it("stops at its maximum length with the ceiling reason", async () => {
    const { recordingId, tracks, stub } = await startRecorder(1);
    const socket = await dial(stub, tracks[0]!.trackName);
    socket.send(pcmEnvelope(1, 960));
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.framesReceived === 1);
    await runInDurableObject(stub, async (instance: MeetingRecorder) => {
      const recording = internals(instance).recording;
      internals(instance).recording = {
        ...recording!,
        startedAt: new Date(Date.now() - MAXIMUM_RECORDING_MILLISECONDS - 60_000).toISOString(),
      };
    });
    await runDurableObjectAlarm(stub);
    const recording = await recordingRow(recordingId);
    expect(recording?.stop_reason).toBe("ceiling");
    expect(recording?.state).not.toBe("recording");
    expect((await stub.inspect()).state).toBe("stopped");
  });
});

describe("a restart", () => {
  it("counts the audio it lost as dropped once, and waits for the socket on the ordinary loss path", async () => {
    const { recordingId, tracks, stub } = await startRecorder(1);
    const socket = await dial(stub, tracks[0]!.trackName);
    for (let sequence = 1; sequence <= 20; sequence += 1) socket.send(pcmEnvelope(sequence, 960));
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.framesReceived === 20);
    // A pass writes the metadata down, as it does every few seconds.
    await runDurableObjectAlarm(stub);

    await runInDurableObject(stub, async (_instance: MeetingRecorder, state) => {
      // AN EVICTION: a new instance over the same storage, with nothing of the old one's memory.
      const revived = new MeetingRecorder(state, env);
      await waitUntil(() => internals(revived).tracks.size === 1);
      const track = [...internals(revived).tracks.values()][0]!;
      expect(track.socketLostAt).not.toBeNull();
      expect(track.resumeFromWallClock).toBe(true);
      // Twenty frames were in memory and never uploaded: counted as dropped, not as staged.
      expect(track.framesDropped).toBe(20);
      expect(track.stagedSamples).toBe(0);
      const revivedTrack = (await revived.inspect()).tracks[0];
      // Their length is silence now, so the next frame still lands at its own instant.
      expect(revivedTrack?.carriedBytes).toBe(20 * 960 * 2);

      // A second restart before anything more uploaded does not count the same loss again.
      const again = new MeetingRecorder(state, env);
      await waitUntil(() => internals(again).tracks.size === 1);
      expect([...internals(again).tracks.values()][0]!.framesDropped).toBe(20);

      // Nobody redials: the grace runs out and the track is lost the ordinary way.
      for (const one of internals(again).tracks.values()) {
        one.socketLostAt = Date.now() - TRACK_LOSS_GRACE_MILLISECONDS - 1_000;
      }
      await again.alarm();
    });
    const [row] = await trackRows(recordingId);
    expect(row?.state).toBe("lost");
    expect(row?.frames_dropped).toBe(20);
  });
});

describe("the sink token, at the recorder", () => {
  it("refuses an earlier adapter's token after the track is reopened on a new one", async () => {
    const { meeting, tracks, stub } = await startRecorder(1);
    const trackName = tracks[0]!.trackName;
    const earlier = await sinkClaimsFor(calls, trackName, SIGNING_KEY, 0);
    await removeFromRoom(meeting, [tracks[0]!.participantId]);
    await runDurableObjectAlarm(stub);
    await seedRoomRoster(meeting, tracks);
    await runDurableObjectAlarm(stub);
    const later = await sinkClaimsFor(calls, trackName, SIGNING_KEY);
    expect(later.adapterNonce).not.toBe(earlier.adapterNonce);
    expect(later.trackId).toBe(earlier.trackId);

    expect((await dialWith(stub, earlier)).status).toBe(404);
    const accepted = await dialWith(stub, later);
    expect(accepted.status).toBe(101);
    accepted.webSocket?.accept();
    accepted.webSocket?.close(1000, "done");
    await stub.stop("member");
  });

  it("refuses a second dial against a track whose socket is live, and takes one once it has dropped", async () => {
    const { tracks, stub } = await startRecorder(1);
    const claims = await sinkClaimsFor(calls, tracks[0]!.trackName, SIGNING_KEY);
    const first = await dialWith(stub, claims);
    expect(first.status).toBe(101);
    first.webSocket?.accept();
    expect((await dialWith(stub, claims)).status).toBe(404);

    first.webSocket?.close(1000, "dropped");
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.attached === false);
    const redial = await dialWith(stub, claims);
    expect(redial.status).toBe(101);
    redial.webSocket?.accept();
    await stub.stop("member");
  });
});

describe("the ceiling counts stays", () => {
  it("records a stay's second audio track as not heard, rather than letting it take another stay's slot", async () => {
    const { meeting, recordingId, tracks, stub } = await startRecorder(1, 2);
    const speaker = tracks[0]!;
    const extra = (suffix: string): SeededTrack => ({
      ...speaker,
      trackId: newIdentifier("meetingRecordingTrack") as SeededTrack["trackId"],
      trackName: `${speaker.participantId}:${suffix}`,
    });
    const otherUser = await seedMemberIn(firmId, "Another Speaker");
    const otherParticipant = newIdentifier("meetingAttendance");
    const other: SeededTrack = {
      trackId: newIdentifier("meetingRecordingTrack") as SeededTrack["trackId"],
      trackName: `${otherParticipant}:microphone`,
      sessionId: `routing-session-other-${otherParticipant}`,
      participantId: otherParticipant,
      userId: otherUser,
    };
    await seedRoomRoster(meeting, [
      speaker,
      extra("screen-audio"),
      extra("second-microphone"),
      other,
    ]);
    const socket = await dial(stub, speaker.trackName);
    socket.send(pcmEnvelope(1, 960));
    await runDurableObjectAlarm(stub);

    const rows = await trackRows(recordingId);
    const stateOf = (name: string) => rows.find((row) => row.track_name === name)?.state;
    expect(stateOf(speaker.trackName)).toBe("open");
    expect(stateOf(`${speaker.participantId}:screen-audio`)).toBe("lost");
    expect(stateOf(`${speaker.participantId}:second-microphone`)).toBe("lost");
    // The other participant is heard: one participant's tracks did not take their slot.
    expect(stateOf(other.trackName)).toBe("open");
    await stub.stop("member");
  });
});

describe("writing the metadata down", () => {
  it("writes only the tracks that changed, in batches the storage API accepts", async () => {
    const { tracks, stub } = await startRecorder(2);
    const socket = await dial(stub, tracks[0]!.trackName);
    await runInDurableObject(stub, async (instance: MeetingRecorder) => {
      await internals(instance).persistTracks();
    });
    socket.send(pcmEnvelope(1, 960));
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.framesReceived === 1);

    await runInDurableObject(stub, async (instance: MeetingRecorder) => {
      const recorder = internals(instance);
      const realContext = recorder.ctx;
      const written: string[][] = [];
      // What the write was handed, and nothing written: the keys are the measurement.
      recorder.ctx = {
        storage: {
          put: async (entries: Record<string, unknown>): Promise<void> => {
            written.push(Object.keys(entries));
          },
        },
      } as unknown as DurableObjectState;
      try {
        await internals(instance).persistTracks();
        expect(written).toEqual([[`track:${tracks[0]!.trackId}`]]);

        // A recording that has seen hundreds of tracks writes them in batches of at most 128.
        written.length = 0;
        const template = [...internals(instance).tracks.values()][1]!;
        for (let index = 0; index < 300; index += 1) {
          const trackId = `track-${String(index)}`;
          internals(instance).tracks.set(trackId, { ...template, trackId });
          internals(instance).dirty.add(trackId);
        }
        await internals(instance).persistTracks();
        expect(written.every((keys) => keys.length <= STORAGE_PUT_BATCH_KEYS)).toBe(true);
        expect(written.flat()).toHaveLength(300);
        for (let index = 0; index < 300; index += 1) {
          internals(instance).tracks.delete(`track-${String(index)}`);
        }
      } finally {
        recorder.ctx = realContext;
      }
    });
    await stub.stop("member");
  });
});

/** The firm's bucket with the next `failures` part uploads refused. */
function bucketFailingParts(
  bucket: R2Bucket,
  failures: { remaining: number; attempts: number },
): R2Bucket {
  // Every other method is the runtime's own, called on the runtime's own object.
  const passThrough = (target: object, property: string | symbol): unknown => {
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  };
  return new Proxy(bucket, {
    get(target, property) {
      if (property !== "resumeMultipartUpload") return passThrough(target, property);
      return (key: string, uploadId: string) => {
        const upload = target.resumeMultipartUpload(key, uploadId);
        return new Proxy(upload, {
          get(inner, name) {
            if (name !== "uploadPart") return passThrough(inner, name);
            return async (partNumber: number, value: Uint8Array) => {
              failures.attempts += 1;
              if (failures.remaining > 0) {
                failures.remaining -= 1;
                throw new Error("storage refused the part");
              }
              return await inner.uploadPart(partNumber, value);
            };
          },
        });
      };
    },
  });
}

describe("a part that fails to upload", () => {
  it("keeps the bytes, does not count them as staged, and retries once on the next pass", async () => {
    const { recordingId, tracks, stub } = await startRecorder(1);
    const failures = { remaining: 1, attempts: 0 };
    await runInDurableObject(stub, async (instance: MeetingRecorder) => {
      const recorder = internals(instance);
      recorder.bucket = bucketFailingParts(recorder.bucket!, failures);
    });
    const socket = await dial(stub, tracks[0]!.trackName);
    for (let sequence = 1; sequence <= LARGE_FRAMES_PER_PART; sequence += 1) {
      socket.send(pcmEnvelope(sequence, PAIRS_PER_LARGE_FRAME));
    }
    await waitUntil(() => failures.attempts === 1);
    await waitUntil(
      async () => (await stub.inspect()).tracks[0]?.framesReceived === LARGE_FRAMES_PER_PART,
    );
    let inspected = (await stub.inspect()).tracks[0];
    expect(inspected?.parts).toBe(0);
    expect(inspected?.stagedSamples).toBe(0);
    expect(inspected?.carriedBytes).toBe(RECORDING_PART_BYTES);

    await runDurableObjectAlarm(stub);
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.parts === 1);
    inspected = (await stub.inspect()).tracks[0];
    expect(inspected?.parts).toBe(1);
    expect(inspected?.stagedSamples).toBe(RECORDING_PART_BYTES / 2);
    await stub.stop("member");
    const [row] = await trackRows(recordingId);
    expect(row?.frames_dropped).toBe(0);
    const object = await env.R2.get(row?.staging_key ?? "");
    const head = new DataView((await object!.arrayBuffer()).slice(0, 2));
    expect(head.getInt16(0, true)).toBe(2000);
  });

  it("records the loss as a gap when the retry fails too", async () => {
    const { recordingId, tracks, stub } = await startRecorder(1);
    const failures = { remaining: 2, attempts: 0 };
    await runInDurableObject(stub, async (instance: MeetingRecorder) => {
      const recorder = internals(instance);
      recorder.bucket = bucketFailingParts(recorder.bucket!, failures);
    });
    const socket = await dial(stub, tracks[0]!.trackName);
    for (let sequence = 1; sequence <= LARGE_FRAMES_PER_PART + 1; sequence += 1) {
      socket.send(pcmEnvelope(sequence, PAIRS_PER_LARGE_FRAME));
    }
    await waitUntil(() => failures.attempts === 1);
    await runDurableObjectAlarm(stub);
    // The retry fails; the part is given up as silence, which then uploads.
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.parts === 1);
    const inspected = (await stub.inspect()).tracks[0];
    expect(inspected?.framesDropped).toBe(LARGE_FRAMES_PER_PART);
    await stub.stop("member");

    const [row] = await trackRows(recordingId);
    expect(row?.frames_dropped).toBe(LARGE_FRAMES_PER_PART);
    const object = await env.R2.get(row?.staging_key ?? "");
    const bytes = new Uint8Array(await object!.arrayBuffer());
    // The timeline keeps its length: a part of silence where the audio could not be staged, and the
    // frame after it still at its own instant.
    expect(bytes.length).toBe((LARGE_FRAMES_PER_PART + 1) * MONO_BYTES_PER_LARGE_FRAME);
    expect(bytes.subarray(0, RECORDING_PART_BYTES).every((byte) => byte === 0)).toBe(true);
    expect(new DataView(bytes.buffer, RECORDING_PART_BYTES, 2).getInt16(0, true)).toBe(2000);
  });
});

describe("stopping", () => {
  it("closes every adapter it opened, and hangs up every socket", async () => {
    const { tracks, stub } = await startRecorder(2);
    const socket = await dial(stub, tracks[0]!.trackName);
    let closed = false;
    socket.addEventListener("close", () => {
      closed = true;
    });
    socket.send(pcmEnvelope(1, 960));
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.framesReceived === 1);
    calls.length = 0;
    await stub.stop("member");

    const closing = calls.filter((call) => call.path.endsWith("/adapters/websocket/close"));
    expect(closing).toHaveLength(1);
    const adapterIds = ((closing[0]?.body["tracks"] ?? []) as { adapterId: string }[]).map(
      (one) => one.adapterId,
    );
    expect(adapterIds).toHaveLength(2);
    await waitUntil(() => closed);
    expect(closed).toBe(true);
    // A second stop has nothing left to settle.
    expect(await stub.stop("member")).toBeNull();
  });

  it("fails a recording that captured nothing at all, with an Error ID and no staged object", async () => {
    const { recordingId, stub } = await startRecorder(1);
    // The route commits the stop before it calls the recorder.
    await stopInRecordOnly(recordingId);
    const outcome = await stub.stop("member");
    expect(outcome?.outcome).toBe("failed");
    const recording = await recordingRow(recordingId);
    expect(recording?.state).toBe("failed");
    expect(recording?.captured_seconds).toBe(0);
    expect(recording?.failure_error_id).toMatch(/^error_/);
    // The abandoned upload is not named by the row any more.
    const [row] = await trackRows(recordingId);
    expect(row?.staging_key).toBeNull();
  });
});

describe("a track the recorder cannot hear", () => {
  it("is recorded as lost once its socket has been gone past the grace — and when every track is, the recording stops itself", async () => {
    const { recordingId, stub } = await startRecorder(1);
    // The routing service never dialled. Wind the track's clock back past the grace rather than wait.
    await runInDurableObject(stub, async (instance: MeetingRecorder) => {
      for (const track of internals(instance).tracks.values()) {
        track.socketLostAt = Date.now() - TRACK_LOSS_GRACE_MILLISECONDS - 1_000;
      }
    });
    await runDurableObjectAlarm(stub);

    const [row] = await trackRows(recordingId);
    expect(row?.state).toBe("lost");
    const recording = await recordingRow(recordingId);
    expect(recording?.stop_reason).toBe("sink-lost");
    // Nothing was captured on the only track, so there is nothing to compose: failed, with an ID.
    expect(recording?.state).toBe("failed");
    expect(recording?.failure_error_id).toMatch(/^error_/);
    expect((await stub.inspect()).state).toBe("stopped");
  });

  it("admits a track published after the start, and records one past the ceiling as lost with no frames", async () => {
    const { meeting, recordingId, tracks, stub } = await startRecorder(1, 1);
    const lateUser = await seedMemberIn(firmId, "Late Arrival");
    const lateParticipant = newIdentifier("meetingAttendance");
    const late: SeededTrack = {
      trackId: newIdentifier("meetingRecordingTrack") as SeededTrack["trackId"],
      trackName: `${lateParticipant}:microphone`,
      sessionId: `routing-session-late-${lateParticipant}`,
      participantId: lateParticipant,
      userId: lateUser,
    };
    await seedRoomRoster(meeting, [...tracks, late]);
    // Keep the first track alive so this pass is about the arrival, not a loss.
    const socket = await dial(stub, tracks[0]!.trackName);
    socket.send(pcmEnvelope(1, 960));
    await runDurableObjectAlarm(stub);

    const rows = await trackRows(recordingId);
    const lateRow = rows.find((row) => row.track_name === late.trackName);
    expect(lateRow?.state).toBe("lost");
    expect(lateRow?.frames_received).toBe(0);
    await stub.stop("member");
  });
});

describe("a participant who leaves and comes back", () => {
  it("is placed at the instant they came back, not after the silence that closed their stretch", async () => {
    const { meeting, recordingId, tracks, stub } = await startRecorder(2);
    const staying = await dial(stub, tracks[0]!.trackName);
    staying.send(pcmEnvelope(1, 960));
    const leaving = await dial(stub, tracks[1]!.trackName);
    for (let sequence = 1; sequence <= 5; sequence += 1) leaving.send(pcmEnvelope(sequence, 960));
    await waitUntil(async () => (await stub.inspect()).tracks[1]?.framesReceived === 5);

    // They leave: their buffer is closed with silence to a part boundary — about fifty-five seconds of
    // staged object — and released, the upload kept open in case they come back.
    await removeFromRoom(meeting, [tracks[1]!.participantId]);
    await runDurableObjectAlarm(stub);
    expect((await stub.inspect()).tracks[1]?.timelineSamples).toBe(RECORDING_PART_BYTES / 2);

    // A few moments later they are back, on a new adapter whose counter starts again.
    await seedRoomRoster(meeting, tracks);
    await runDurableObjectAlarm(stub);
    const returned = await dial(stub, tracks[1]!.trackName);
    for (let sequence = 1; sequence <= 5; sequence += 1) returned.send(pcmEnvelope(sequence, 960));
    await waitUntil(async () => (await stub.inspect()).tracks[1]?.framesReceived === 10);
    // The route commits the stop, then tells the recorder.
    await stopInRecordOnly(recordingId);
    await stub.stop("member");

    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const row = await database
      .prepare(
        `SELECT meeting_recording_track.segments AS segments, ` +
          `meeting_recording_track.first_frame_at AS first_frame_at, ` +
          `meeting_recording_track.staging_key AS staging_key, ` +
          `meeting_recording.started_at AS started_at ` +
          `FROM meeting_recording_track JOIN meeting_recording ` +
          `ON meeting_recording.id = meeting_recording_track.recording_id ` +
          `WHERE meeting_recording_track.recording_id = ?1 AND meeting_recording_track.track_name = ?2`,
      )
      .bind(recordingId, tracks[1]!.trackName)
      .first<{
        segments: string | null;
        first_frame_at: string;
        staging_key: string;
        started_at: string;
      }>();
    // TWO STRETCHES: the first ends where their audio did, before the padding; the second begins at
    // the part boundary, carrying the instant they came back.
    const segments = parseTrackSegments(row?.segments ?? null);
    expect(segments).toHaveLength(2);
    expect(segments?.[0]?.stagedToSample).toBe(5 * 960);
    expect(segments?.[1]?.stagedFromSample).toBe(RECORDING_PART_BYTES / 2);
    const object = await env.R2.head(row!.staging_key);
    const spans = placeTrackSegments({
      startedAt: row!.started_at,
      firstFrameAt: row!.first_frame_at,
      segments,
      objectSamples: object!.size / 2,
    });
    expect(spans.map((span) => span.samples)).toEqual([5 * 960, 5 * 960]);
    // Placed a moment after they left — not fifty-five seconds after it, which is where the padding
    // would have put everything they said for the rest of the meeting.
    const away = spans[1]!.offset - (spans[0]!.offset + spans[0]!.samples);
    expect(away).toBeGreaterThanOrEqual(0);
    expect(away).toBeLessThan(10 * 48_000);
    expect((await recordingRow(recordingId))?.captured_seconds).toBeLessThan(10);

    // AND THE COMPOSITE AGREES: composed from the recorder's own staged objects, it runs seconds,
    // not the minute the padding would have made of it.
    const ingested: unknown[] = [];
    const composing = {
      ...env,
      MEETING_RECORDING_COMPOSE: { send: async () => {} },
      FILES_INGEST: {
        send: async (message: unknown) => {
          ingested.push(message);
        },
      },
    } as unknown as Bindings;
    const message: MeetingRecordingComposeMessage = {
      kind: "meeting-recording-compose",
      firmId,
      meetingId: meeting.meetingId,
      recordingId: recordingId as MeetingRecordingId,
    };
    expect(await composeWindow(composing, message)).toBe("filed");
    const filed = await database
      .prepare(
        `SELECT file_version.r2_key AS r2_key FROM meeting_recording JOIN file_version ` +
          `ON file_version.id = meeting_recording.file_version_id WHERE meeting_recording.id = ?1`,
      )
      .bind(recordingId)
      .first<{ r2_key: string }>();
    const header = await env.R2.get(filed!.r2_key, { range: { offset: 0, length: 44 } });
    const reading = readWavHeader(new Uint8Array(await header!.arrayBuffer()));
    expect((reading?.dataBytes ?? 0) / 2 / 48_000).toBeLessThan(10);
    expect(ingested).toHaveLength(1);
  });
});

describe("abandoning", () => {
  it("keeps what each track captured — its upload completed, not aborted — writes it down, and composes nothing", async () => {
    const { recordingId, tracks, stub } = await startRecorder(2);
    const socket = await dial(stub, tracks[0]!.trackName);
    for (let sequence = 1; sequence <= 10; sequence += 1) socket.send(pcmEnvelope(sequence, 960));
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.framesReceived === 10);

    // THE SWEEP'S RECORD FIRST, as the sweep commits it: abandoned, every open track lost.
    const now = new Date().toISOString();
    await firmDatabaseFor(env.FIRM_DATABASE, firmId).batch([
      firmDatabaseFor(env.FIRM_DATABASE, firmId)
        .prepare(
          `UPDATE meeting_recording SET state = 'abandoned', stopped_at = ?2, stop_reason = 'abandoned' WHERE id = ?1`,
        )
        .bind(recordingId, now),
      firmDatabaseFor(env.FIRM_DATABASE, firmId)
        .prepare(
          `UPDATE meeting_recording_track SET state = 'lost' WHERE recording_id = ?1 AND state = 'open'`,
        )
        .bind(recordingId),
    ]);
    const handedOnBefore = composeMessages.length;

    expect(await stub.abandon()).toEqual({ completedUploads: 1, abortedUploads: 1 });

    const rows = await trackRows(recordingId);
    const heard = rows.find((row) => row.track_name === tracks[0]!.trackName);
    const silent = rows.find((row) => row.track_name === tracks[1]!.trackName);
    // The audio is an object now, kept for the sweep's retention window — the only copy there is.
    expect(heard).toMatchObject({ state: "lost", frames_received: 10 });
    expect((await env.R2.head(heard?.staging_key ?? ""))?.size).toBe(10 * 960 * 2);
    // A track that staged nothing has no object to keep, and its row stops naming one.
    expect(silent?.staging_key).toBeNull();
    // Nothing is handed on: an abandoned recording is not composed.
    expect(composeMessages.slice(handedOnBefore)).toEqual([]);
    expect((await recordingRow(recordingId))?.state).toBe("abandoned");
    const inspected = await stub.inspect();
    expect(inspected.state).toBe("stopped");
    expect(inspected.memory.trackBuffers).toBe(0);
    // A second word from the sweep finds nothing running.
    expect(await stub.abandon()).toEqual({ completedUploads: 0, abortedUploads: 0 });
  });
});

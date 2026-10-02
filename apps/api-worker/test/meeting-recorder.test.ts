import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  RECORDING_PART_BYTES,
  TRACK_LOSS_GRACE_MILLISECONDS,
  type MeetingRecorder,
  type RecorderStartInput,
} from "../src/meetings/meeting-recorder.ts";
import { setSfuFetchForTests } from "../src/meetings/sfu/sfu-client.ts";
import {
  MEETING_SINK_PATH_PREFIX,
  setMeetingSinkSigningKeyForTests,
  verifySinkToken,
} from "../src/meetings/sink-token.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  fakeAdapterService,
  pcmEnvelope,
  seedMemberIn,
  seedRecordedMeeting,
  seedRoomRoster,
  seedRunningRecording,
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
// socket never comes back is recorded as lost; and a recording whose every track is lost stops
// itself rather than run on under a mark that says it is recording.
//
// The recorder is not hibernating, and the test pool runs it as the runtime would: real sockets, a
// real multipart upload, the firm's own database through the proxy. The routing service and the sink
// signing key are installed through the same module seams the room's tests use, because a Durable
// Object is constructed with the deployment's own environment and cannot be handed another.

const SIGNING_KEY = "meeting-recorder-test-signing-key";

let calls: AdapterCall[] = [];
let firmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm") as FirmId;
  await seedFirmRow(firmId);
  setMeetingSinkSigningKeyForTests(SIGNING_KEY);
});

afterAll(() => {
  setSfuFetchForTests(null);
  setMeetingSinkSigningKeyForTests(null);
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

/** Opens the socket the routing service would dial for one track, straight to the recorder. */
async function dial(stub: Started["stub"], trackName: string): Promise<WebSocket> {
  const address = new URL("https://meeting-recorder.invalid/sink");
  address.searchParams.set("track", trackName);
  const response = await stub.fetch(
    new Request(address.toString(), { headers: { Upgrade: "websocket" } }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null || socket === undefined) throw new Error("no socket on the 101");
  socket.accept();
  return socket;
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

describe("starting the recorder", () => {
  it("opens one adapter per track, each dialling a signed address for that track alone", async () => {
    const { recordingId, tracks } = await startRecorder(2);

    const opened = calls.filter((call) => call.path.endsWith("/adapters/websocket/new"));
    expect(opened).toHaveLength(2);
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
      // verifies to exactly this firm, recording and track.
      const endpoint = new URL(request?.endpoint ?? "");
      expect(endpoint.protocol).toBe("wss:");
      expect(endpoint.pathname.startsWith(MEETING_SINK_PATH_PREFIX)).toBe(true);
      const claims = await verifySinkToken(
        SIGNING_KEY,
        endpoint.pathname.slice(MEETING_SINK_PATH_PREFIX.length),
        Date.now(),
      );
      expect(claims).toMatchObject({ firmId, recordingId, trackName: tracks[index]?.trackName });
      // The token never rides a query string, where the platform's request log would keep it whole.
      expect(endpoint.search).toBe("");
    }

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

    // A 32 KiB stereo payload folds to 16 KiB of mono, so this many frames cross one part.
    const pairsPerFrame = 8192;
    const monoBytesPerFrame = pairsPerFrame * 2;
    const framesForOnePart = RECORDING_PART_BYTES / monoBytesPerFrame;
    const frameCount = framesForOnePart + 10;
    for (let sequence = 1; sequence <= frameCount; sequence += 1) {
      socket.send(pcmEnvelope(sequence, pairsPerFrame));
    }
    await waitUntil(async () => {
      const inspected = await stub.inspect();
      return inspected.tracks[0]?.framesReceived === frameCount && inspected.tracks[0].parts === 1;
    });
    const inspected = await stub.inspect();
    expect(inspected.tracks[0]?.parts).toBe(1);
    // What is left in memory is the carry past the part, and never more than a part.
    expect(inspected.tracks[0]?.carriedBytes).toBe(10 * monoBytesPerFrame);

    const outcome = await stub.stop("member");
    expect(outcome?.outcome).toBe("composing");

    const [row] = await trackRows(recordingId);
    expect(row?.frames_received).toBe(frameCount);
    expect(row?.state).toBe("closed");
    const object = await env.R2.get(row?.staging_key ?? "");
    expect(object?.size).toBe(frameCount * monoBytesPerFrame);
    // Mono is the average of the two channels: (1000 + 3000) / 2.
    const head = new DataView((await object!.arrayBuffer()).slice(0, 4));
    expect(head.getInt16(0, true)).toBe(2000);
    // And the object is stamped with the matter it belongs to.
    expect(object?.customMetadata?.["object_class"]).toBe("meeting-recording-track");

    expect((await recordingRow(recordingId))?.captured_seconds).toBeGreaterThanOrEqual(
      Math.floor((frameCount * pairsPerFrame) / 48_000),
    );
  });

  it("writes silence of exactly the gap's length for frames that never arrived, and counts them", async () => {
    const { recordingId, tracks, stub } = await startRecorder(1);
    const track = tracks[0]!;
    const socket = await dial(stub, track.trackName);
    const pairs = 960;
    // Frames 3 and 4 never arrive; a duplicate of 5 arrives late and is not taken twice.
    for (const sequence of [1, 2, 5, 5, 6]) socket.send(pcmEnvelope(sequence, pairs));
    await waitUntil(async () => (await stub.inspect()).tracks[0]?.framesReceived === 4);
    await stub.stop("member");

    const [row] = await trackRows(recordingId);
    expect(row?.frames_received).toBe(4);
    expect(row?.frames_dropped).toBe(2);
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
    await firmDatabaseFor(env.FIRM_DATABASE, firmId)
      .prepare(
        `UPDATE meeting_recording SET state = 'composing', stopped_at = ?2, stop_reason = 'member' WHERE id = ?1`,
      )
      .bind(recordingId, new Date().toISOString())
      .run();
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
    const { meeting, recordingId, stub } = await startRecorder(1);
    // The routing service never dialled. Wind the track's clock back past the grace rather than wait.
    await runInDurableObject(stub, async (instance: MeetingRecorder) => {
      const tracks = (
        instance as unknown as { tracks: Map<string, { socketLostAt: number | null }> }
      ).tracks;
      for (const track of tracks.values()) {
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
    expect(meeting.meetingId).toBeDefined();
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

  it("closes the track of a participant who left the room, and keeps the recording running", async () => {
    const { meeting, recordingId, tracks, stub } = await startRecorder(2);
    const socket = await dial(stub, tracks[0]!.trackName);
    socket.send(pcmEnvelope(1, 960));
    await dial(stub, tracks[1]!.trackName);
    // The second participant is no longer on the roster.
    await seedRoomRoster(meeting, [tracks[0]!]);
    await runInDurableObject(
      env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(`${firmId}:${meeting.meetingId}`)),
      async (_room, state) => {
        await state.storage.delete(`participant:${tracks[1]!.participantId}`);
      },
    );
    await runDurableObjectAlarm(stub);
    const rows = await trackRows(recordingId);
    expect(rows.find((row) => row.track_name === tracks[1]!.trackName)?.state).toBe("closed");
    expect(rows.find((row) => row.track_name === tracks[0]!.trackName)?.state).toBe("open");
    expect((await recordingRow(recordingId))?.state).toBe("recording");
    await stub.stop("member");
  });
});

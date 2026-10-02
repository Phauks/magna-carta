import { env, runInDurableObject } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmId,
  MatterId,
  MeetingId,
  MeetingRecordingId,
  MeetingRecordingTrackId,
  UserId,
} from "@magna-carta/identifiers/types";
import { PCM_FRAME_PAYLOAD_FIELD } from "@magna-carta/meetings/pcm-frame";
import { firmDatabaseFor } from "../../src/firm-database/firm-database-proxy.ts";
import type { MeetingRoom } from "../../src/meetings/meeting-room.ts";

// The shared scaffolding of the recording suites: a meeting on a matter in a firm's own database, a
// recording row with its tracks, a room whose roster carries those tracks, a fake routing service
// that answers the two adapter calls, and the adapter's envelope built byte by byte.
//
// Every row is written straight through the firm-scoped data-access proxy in the shape the services
// write it, because what these suites are about is the recorder, the room and the sink — not the
// path that created the meeting, which the meetings suites own.

const SEED_INSTANT = "2026-10-02T12:00:00.000Z";

export interface RecordedMeeting {
  readonly firmId: FirmId;
  readonly meetingId: MeetingId;
  readonly matterId: MatterId;
  readonly hostUserId: UserId;
}

/** A member, a matter, an event on it and a live meeting on the event, in this firm's own database. */
export async function seedRecordedMeeting(firmId: FirmId): Promise<RecordedMeeting> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const hostUserId = newIdentifier("user") as UserId;
  const matterId = newIdentifier("matter") as MatterId;
  const eventId = newIdentifier("matterEvent");
  const meetingId = newIdentifier("meeting") as MeetingId;
  await database.batch([
    database
      .prepare(
        `INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'A Host', 'active', ?2)`,
      )
      .bind(hostUserId, SEED_INSTANT),
    database
      .prepare(
        `INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) ` +
          `VALUES (?1, 'Herrera v Alvarez', 'open', ?2, ?3, ?3)`,
      )
      .bind(matterId, hostUserId, SEED_INSTANT),
    database
      .prepare(
        `INSERT INTO matter_event (id, matter_id, title, status, starts_on, starts_at_time, ` +
          `ends_at_time, time_zone, recorded_at, recorded_by, created_at, updated_at) VALUES ` +
          `(?1, ?2, 'Settlement conference', 'scheduled', '2026-10-02', '09:30', '10:30', ` +
          `'America/Los_Angeles', ?3, ?4, ?3, ?3)`,
      )
      .bind(eventId, matterId, SEED_INSTANT, hostUserId),
    database
      .prepare(
        `INSERT INTO meeting (id, event_kind, medium, matter_event_id, firm_event_id, status, ` +
          `created_by_user_id, started_at, ended_at, ended_by_user_id, created_at, updated_at) ` +
          `VALUES (?1, 'matter', 'audio', ?2, NULL, 'live', ?3, ?4, NULL, NULL, ?4, ?4)`,
      )
      .bind(meetingId, eventId, hostUserId, SEED_INSTANT),
  ]);
  return { firmId, meetingId, matterId, hostUserId };
}

/** One member more in the firm, so a track or a notice has somebody to belong to. */
export async function seedMemberIn(firmId: FirmId, displayName: string): Promise<UserId> {
  const userId = newIdentifier("user") as UserId;
  await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, 'active', ?3)`,
    )
    .bind(userId, displayName, SEED_INSTANT)
    .run();
  return userId;
}

export interface SeededTrack {
  readonly trackId: MeetingRecordingTrackId;
  readonly trackName: string;
  readonly sessionId: string;
  readonly participantId: string;
  readonly userId: UserId;
}

/** A running recording and an open track row per member given, as the start route writes them. */
export async function seedRunningRecording(
  meeting: RecordedMeeting,
  members: readonly UserId[],
): Promise<{ recordingId: MeetingRecordingId; tracks: SeededTrack[]; startedAt: string }> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, meeting.firmId);
  const recordingId = newIdentifier("meetingRecording") as MeetingRecordingId;
  const startedAt = new Date().toISOString();
  const tracks: SeededTrack[] = members.map((userId, index) => {
    const participantId = newIdentifier("meetingAttendance");
    return {
      trackId: newIdentifier("meetingRecordingTrack") as MeetingRecordingTrackId,
      trackName: `${participantId}:microphone`,
      sessionId: `routing-session-${String(index)}-${participantId}`,
      participantId,
      userId,
    };
  });
  await database.batch([
    database
      .prepare(
        `INSERT INTO meeting_recording (id, meeting_id, matter_id, breakout_id, state, ` +
          `started_by_user_id, started_at, track_count, created_at, updated_at) ` +
          `VALUES (?1, ?2, ?3, NULL, 'recording', ?4, ?5, ?6, ?5, ?5)`,
      )
      .bind(
        recordingId,
        meeting.meetingId,
        meeting.matterId,
        meeting.hostUserId,
        startedAt,
        tracks.length,
      ),
    ...tracks.map((track) =>
      database
        .prepare(
          `INSERT INTO meeting_recording_track (id, recording_id, participant_kind, participant_id, ` +
            `user_id, track_name, state, created_at, updated_at) ` +
            `VALUES (?1, ?2, 'member', ?3, ?4, ?5, 'open', ?6, ?6)`,
        )
        .bind(
          track.trackId,
          recordingId,
          track.participantId,
          track.userId,
          track.trackName,
          startedAt,
        ),
    ),
  ]);
  return { recordingId, tracks, startedAt };
}

/**
 * Puts these tracks on the room's roster exactly as the room writes a participant who has published
 * a microphone — so the recorder's reconciliation finds the people it is recording still there.
 */
export async function seedRoomRoster(
  meeting: RecordedMeeting,
  tracks: readonly SeededTrack[],
): Promise<void> {
  const stub = env.MEETING_ROOM.get(
    env.MEETING_ROOM.idFromName(`${meeting.firmId}:${meeting.meetingId}`),
  );
  await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
    const entries: Record<string, unknown> = {
      room: { firmId: meeting.firmId, meetingId: meeting.meetingId, medium: "audio" },
    };
    for (const track of tracks) {
      entries[`participant:${track.participantId}`] = {
        userId: track.userId,
        participantKind: "member",
        displayName: "Recorded Member",
        sfuSessionId: track.sessionId,
        tracks: [{ trackName: track.trackName, kind: "audio", mid: "0" }],
        socketLostAt: null,
        speaking: false,
        muted: false,
        presenceAt: null,
        presenceDirty: false,
        syncAt: null,
        layerAt: null,
        subscribedMids: [],
        hostRole: null,
      };
    }
    await state.storage.put(entries);
  });
}

export interface AdapterCall {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

/**
 * A fake routing service that answers the WebSocket adapter's two calls — and the session calls the
 * room makes, with empty answers — recording every call so a test can assert what was asked for.
 */
export function fakeAdapterService(calls: AdapterCall[], options: { refuse?: boolean } = {}) {
  let adapterCounter = 0;
  const fake: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url);
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ path: url.pathname, body });
    const json = (payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (url.pathname.endsWith("/adapters/websocket/new")) {
      const tracks = (body["tracks"] ?? []) as { trackName: string; sessionId: string }[];
      return json({
        tracks: tracks.map((track) => {
          adapterCounter += 1;
          return options.refuse === true
            ? { trackName: track.trackName, errorCode: "adapter_refused" }
            : {
                trackName: track.trackName,
                sessionId: track.sessionId,
                adapterId: `adapter-${String(adapterCounter)}`,
              };
        }),
      });
    }
    if (url.pathname.endsWith("/adapters/websocket/close")) return json({ tracks: [] });
    if (/\/sessions\/[^/]+$/.test(url.pathname)) return json({ tracks: [] });
    return json({ tracks: [] });
  };
  return fake;
}

/** A protobuf varint, written the way the wire format writes one. */
function varint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  bytes.push(remaining);
  return bytes;
}

/**
 * One adapter envelope: a sequence number, a timestamp and a stereo payload of `pairs` sample pairs,
 * every left sample `left` and every right sample `right`.
 */
export function pcmEnvelope(
  sequenceNumber: number,
  pairs: number,
  left = 1000,
  right = 3000,
): Uint8Array {
  const payload = new Uint8Array(pairs * 4);
  const view = new DataView(payload.buffer);
  for (let index = 0; index < pairs; index += 1) {
    view.setInt16(index * 4, left, true);
    view.setInt16(index * 4 + 2, right, true);
  }
  return Uint8Array.from([
    0x08,
    ...varint(sequenceNumber),
    0x10,
    ...varint(sequenceNumber * 960),
    PCM_FRAME_PAYLOAD_FIELD * 8 + 2,
    ...varint(payload.length),
    ...payload,
  ]);
}

/** Waits on a condition for up to ten seconds — the suites share a box with other runtimes. */
export async function waitUntil(condition: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await condition()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

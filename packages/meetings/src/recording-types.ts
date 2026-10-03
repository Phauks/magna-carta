import type {
  FileId,
  FileVersionId,
  MatterId,
  MeetingId,
  MeetingRecordingId,
  MeetingRecordingNoticeId,
  MeetingRecordingTrackId,
  UserId,
} from "@magna-carta/identifiers/types";
import { PCM_SAMPLE_RATE } from "./pcm-frame.ts";
import type { MeetingContributorKind } from "./types.ts";

// A MEETING'S RECORDING: the vocabularies, the stored rows, and what a surface is given.
//
// Every vocabulary below is also a SQLite CHECK on the per-firm schema, so a value that reaches a
// write without appearing here fails at the database and not only at the type checker. The recording
// table is a PARENT (its tracks and notices point at it), which is why its two vocabularies carry
// every value the later slices write — composing, filed, a sweep's abandoned — from the first
// migration: a CHECK on a parent cannot be widened without the rebuild the lineage refuses.

// WHERE ONE RECORDING IS IN ITS LIFE. `recording` while audio is arriving; `composing` once it has
// stopped and its tracks are waiting to be mixed into one document; `filed` once that document is on
// the matter; `failed` when nothing usable was captured or the compose could not finish; `abandoned`
// when the recorder disappeared mid-meeting and a sweep closed what it left. Only the first is a
// running recording — every other state carries the instant and the reason it stopped.
export const MEETING_RECORDING_STATES = Object.freeze([
  "recording",
  "composing",
  "filed",
  "failed",
  "abandoned",
] as const);
export type MeetingRecordingState = (typeof MEETING_RECORDING_STATES)[number];

// WHY A RECORDING STOPPED. A member holding the key pressed Stop; a member running the room pressed
// it without the key; the meeting ended under it; every track's socket was lost and did not return;
// the ceiling refused it; a sweep found the recorder gone; or the start itself could not be carried
// out — the room could not be told, or the recorder could not take it — so the recording was stopped
// before anybody's voice was captured. One labelled reason rather than seven states, because "it
// stopped" is the fact and the label is its footnote. A start that failed is its own reason rather
// than `sink-lost` because the two are different faults with different remedies: one is a meeting
// whose audio went away, the other a recording that never began.
export const MEETING_RECORDING_STOP_REASONS = Object.freeze([
  "member",
  "host",
  "meeting-ended",
  "sink-lost",
  "ceiling",
  "abandoned",
  "start-failed",
] as const);
export type MeetingRecordingStopReason = (typeof MEETING_RECORDING_STOP_REASONS)[number];

// ONE TRACK'S STATE. `open` while the recorder is receiving it; `closed` when its participant left or
// the recording stopped; `lost` when its socket went and never came back, or when the ceiling refused
// to hold it at all — and a lost track is still a row, because a record that silently omitted a
// speaker is worse than one that says it could not hear them.
export const MEETING_RECORDING_TRACK_STATES = Object.freeze(["open", "closed", "lost"] as const);
export type MeetingRecordingTrackState = (typeof MEETING_RECORDING_TRACK_STATES)[number];

// WHY A STAY WAS TOLD. The recording started while they were in the room; it was running when they
// arrived (or re-arrived — each reconnect is another occasion, and another row); or it stopped.
export const MEETING_RECORDING_NOTICE_REASONS = Object.freeze([
  "start",
  "arrival",
  "stop",
] as const);
export type MeetingRecordingNoticeReason = (typeof MEETING_RECORDING_NOTICE_REASONS)[number];

// THE PREFIX EVERY STAGED TRACK LIVES UNDER in the firm's own bucket. The key below it is minted from
// handles the server issued — the meeting, the recording and the TRACK ROW — and never from the track
// name the routing service carries, which a browser chose: an object key is opaque and server-minted,
// the rule every other object a firm holds is written under.
export const MEETING_RECORDING_STAGING_PREFIX = "meeting-recordings";

/** Where one track's audio is staged while the recording runs. */
export function recordingStagingKey(
  meetingId: MeetingId,
  recordingId: MeetingRecordingId,
  trackId: MeetingRecordingTrackId,
): string {
  return `${MEETING_RECORDING_STAGING_PREFIX}/${meetingId}/${recordingId}/${trackId}.pcm`;
}

// ---------------------------------------------------------------------------------------------
// The stored rows, in the database's own column names.
// ---------------------------------------------------------------------------------------------

export interface MeetingRecordingRow {
  readonly id: MeetingRecordingId;
  readonly meeting_id: MeetingId;
  readonly matter_id: MatterId;
  readonly breakout_id: string | null;
  readonly state: MeetingRecordingState;
  readonly started_by_user_id: UserId;
  readonly started_at: string;
  readonly stopped_by_user_id: UserId | null;
  readonly stopped_at: string | null;
  readonly stop_reason: MeetingRecordingStopReason | null;
  readonly track_count: number;
  readonly captured_seconds: number | null;
  readonly file_id: FileId | null;
  readonly file_version_id: FileVersionId | null;
  readonly failure_error_id: string | null;
  // The compose step's cursor — handles and counts only; see `MeetingRecordingComposePart`.
  readonly compose_upload_session_id: string | null;
  readonly compose_parts_done: number;
  // JSON of `MeetingRecordingComposePart[]`, null until the first part has uploaded.
  readonly compose_parts: string | null;
  readonly compose_attempts: number;
  readonly compose_progress_at: string | null;
  // When the consumer composing the current window claimed it; null when nobody holds it. A lease, so
  // two deliveries of one message never compose one window at once.
  readonly compose_claimed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * ONE UPLOADED PART OF A COMPOSED RECORDING, as R2 hands it back: its number and its entity tag. Kept on
 * the recording row because completing the upload needs every part's tag and the storage binding cannot
 * list an upload's parts — and nothing else, because a part's bytes are the bucket's.
 */
export interface MeetingRecordingComposePart {
  readonly partNumber: number;
  readonly etag: string;
}

export interface MeetingRecordingTrackRow {
  readonly id: MeetingRecordingTrackId;
  readonly recording_id: MeetingRecordingId;
  readonly participant_kind: MeetingContributorKind;
  readonly participant_id: string;
  readonly user_id: UserId | null;
  readonly track_name: string;
  readonly adapter_id: string | null;
  readonly staging_key: string | null;
  readonly first_frame_at: string | null;
  readonly last_frame_at: string | null;
  // JSON of `MeetingRecordingTrackSegment[]`; null for a track that never carried a frame, or one
  // staged before segments were recorded (read as one stretch from `first_frame_at`).
  readonly segments: string | null;
  readonly frames_received: number;
  readonly frames_dropped: number;
  readonly state: MeetingRecordingTrackState;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MeetingRecordingNoticeRow {
  readonly id: MeetingRecordingNoticeId;
  readonly recording_id: MeetingRecordingId;
  readonly participant_kind: MeetingContributorKind;
  readonly participant_id: string;
  readonly user_id: UserId | null;
  readonly reason: MeetingRecordingNoticeReason;
  readonly delivered_at: string;
  readonly created_at: string;
}

// ---------------------------------------------------------------------------------------------
// What the room and the recorder hand the service, and what a surface is given.
// ---------------------------------------------------------------------------------------------

/**
 * ONE STAY, BY VALUE — who a track belongs to, or who a notice told.
 *
 * The kind says which table the handle belongs to and `userId` is the member behind a member's stay,
 * null for a guest or anybody else without a user. The room supplies these off the sockets it holds;
 * nothing here re-reads a stay, because the notice is a record of a delivery the room made, and the
 * room is the only witness to it.
 */
export interface MeetingRecordingParticipant {
  readonly participantKind: MeetingContributorKind;
  readonly participantId: string;
  readonly userId: UserId | null;
}

/** One audio track the room is carrying, as a recording would take it. */
export interface MeetingRecordingCandidateTrack extends MeetingRecordingParticipant {
  readonly trackName: string;
  // The routing-service session the track is published in, which is what an adapter is opened on.
  readonly sessionId: string;
}

/** A person named on a recording: who started it, or who stopped it. */
export interface MeetingRecordingActor {
  readonly userId: UserId;
  readonly displayName: string;
}

/**
 * ONE RECORDING, AS A SURFACE PAINTS IT. Identifiers, instants, counts and a state — the audio is a
 * filed document reached through `fileId`, never anything this shape carries. `transcriptId` and
 * `summaryState` are null until the transcript and summary slices write them, and are here now so a
 * screen built against this shape does not change when they do.
 */
export interface MeetingRecordingSummary {
  readonly id: MeetingRecordingId;
  readonly meetingId: MeetingId;
  readonly state: MeetingRecordingState;
  readonly startedBy: MeetingRecordingActor;
  readonly startedAt: string;
  readonly stoppedBy: MeetingRecordingActor | null;
  readonly stoppedAt: string | null;
  readonly stopReason: MeetingRecordingStopReason | null;
  readonly trackCount: number;
  readonly capturedSeconds: number | null;
  readonly fileId: FileId | null;
  readonly transcriptId: string | null;
  readonly summaryState: string | null;
  // The standard pipeline's Error ID when the recording failed, or when a fault on the way was
  // recorded against it — a handle support can look up, never a message. Null otherwise.
  readonly failureErrorId: string | null;
}

/** One notice, as the consent read returns it. */
export interface MeetingRecordingNoticeEntry {
  readonly id: MeetingRecordingNoticeId;
  readonly participantKind: MeetingContributorKind;
  readonly participantId: string;
  readonly userId: UserId | null;
  // The name the room knew this stay by: the member's, or the name a guest typed at the door. Read
  // off the stay at the moment of asking, never stored on the notice — the notice is a fact about a
  // delivery, and the name is the stay's own.
  readonly displayName: string;
  readonly reason: MeetingRecordingNoticeReason;
  readonly deliveredAt: string;
}

/**
 * WHAT A MEETINGS SCREEN NEEDS TO KNOW about a room's recording, in one word: `none` when it has
 * never been recorded, otherwise the state of its most recent recording.
 */
export type MeetingRecordingStateOfRoom = "none" | MeetingRecordingState;

// ---------------------------------------------------------------------------------------------
// Where a staged track's audio belongs in time.
// ---------------------------------------------------------------------------------------------

/**
 * ONE STRETCH OF A STAGED TRACK: the staged sample it begins at, the instant that sample was heard,
 * and — for a stretch its participant left at — the staged sample its audio ends at.
 *
 * WHY A TRACK HAS STRETCHES. A staged track is one object, and an object is one run of samples. Most
 * of a track is exactly that: every frame lands right after the last one, with silence written for the
 * frames that never arrived. Two things break the run. A participant who leaves has their buffer
 * closed with silence up to a part boundary (a multipart upload takes only one short part, and it has
 * to be the last), so when they come back, the object has run on by up to a part — about fifty-five
 * seconds — that they were not away for. And a gap too long to be worth staging as silence (a
 * participant away for an hour is an hour of zeros uploaded for nothing) is not staged at all. In both
 * cases the next frame begins a new stretch, at the end of the object as it stands, and carries the
 * instant it was heard; the compose places every stretch at its own instant, so neither the padding nor
 * the gap moves anything said afterwards.
 */
export interface MeetingRecordingTrackSegment {
  readonly stagedFromSample: number;
  readonly at: string;
  // Where this stretch's audio ends in the staged object when something that is not audio follows it
  // (the padding a departure closes it with); null when it runs to the next stretch or the object's end.
  readonly stagedToSample: number | null;
}

/**
 * THE MOST STRETCHES ONE TRACK RECORDS. A stretch is one departure and return, or one gap longer than
 * the recorder stages as silence, so even a participant on a connection that drops every few minutes
 * for a twelve-hour day stays far below it. The bound exists because the stretches ride the track's
 * metadata in the recorder's own storage, beside its part list, and that record has a size ceiling;
 * past it, a return is placed on the track's own timeline instead (late by the padding, never lost).
 */
export const MAXIMUM_TRACK_SEGMENTS = 256;

/** The stretches a stored row carries, or null when they are not a list of stretches. */
export function parseTrackSegments(text: string | null): MeetingRecordingTrackSegment[] | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const segments: MeetingRecordingTrackSegment[] = [];
  for (const entry of parsed as unknown[]) {
    if (typeof entry !== "object" || entry === null) return null;
    const { stagedFromSample, at, stagedToSample } = entry as Record<string, unknown>;
    if (
      typeof stagedFromSample !== "number" ||
      !Number.isInteger(stagedFromSample) ||
      stagedFromSample < 0 ||
      typeof at !== "string" ||
      Number.isNaN(Date.parse(at)) ||
      !(
        stagedToSample === null ||
        stagedToSample === undefined ||
        (typeof stagedToSample === "number" &&
          Number.isInteger(stagedToSample) &&
          stagedToSample >= stagedFromSample)
      )
    ) {
      return null;
    }
    segments.push({ stagedFromSample, at, stagedToSample: stagedToSample ?? null });
  }
  return segments;
}

/** One run of a staged object as it lands on the composite. */
export interface PlacedTrackSpan {
  // The staged sample the run begins at.
  readonly stagedFromSample: number;
  // The composite sample it lands on.
  readonly offset: number;
  readonly samples: number;
}

/**
 * WHERE A STAGED TRACK LANDS ON THE COMPOSITE: each stretch at the sample its instant is from the
 * recording's start, running to whichever comes first of its own audio's end, the next stretch's
 * beginning, and the samples the object actually holds.
 *
 * A stretch whose instant would put it over the one before it is placed right after that one instead:
 * one person's audio never sums with itself, and a wall clock that ran a little behind the samples
 * costs a moment of lateness rather than an echo. `segments` null is a row staged before stretches
 * were recorded — one run from `firstFrameAt`, which is exactly what that row meant.
 */
export function placeTrackSegments(input: {
  readonly startedAt: string;
  readonly firstFrameAt: string;
  readonly segments: readonly MeetingRecordingTrackSegment[] | null;
  readonly objectSamples: number;
}): PlacedTrackSpan[] {
  const startedAt = Date.parse(input.startedAt);
  const segments =
    input.segments === null || input.segments.length === 0
      ? [{ stagedFromSample: 0, at: input.firstFrameAt, stagedToSample: null }]
      : input.segments;
  const spans: PlacedTrackSpan[] = [];
  let previousEnd = 0;
  for (const [index, segment] of segments.entries()) {
    const next = segments[index + 1];
    const end = Math.min(
      segment.stagedToSample ?? Number.POSITIVE_INFINITY,
      next?.stagedFromSample ?? Number.POSITIVE_INFINITY,
      input.objectSamples,
    );
    const samples = end - segment.stagedFromSample;
    if (samples <= 0) continue;
    const instantOffset = Math.round(
      ((Date.parse(segment.at) - startedAt) / 1000) * PCM_SAMPLE_RATE,
    );
    const offset = Math.max(0, instantOffset, previousEnd);
    spans.push({ stagedFromSample: segment.stagedFromSample, offset, samples });
    previousEnd = offset + samples;
  }
  return spans;
}

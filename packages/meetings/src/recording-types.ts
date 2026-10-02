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

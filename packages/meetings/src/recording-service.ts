import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectStatement, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  MeetingId,
  MeetingRecordingId,
  MeetingRecordingTrackId,
  UserId,
} from "@magna-carta/identifiers/types";
import { readLiveHostGrant } from "./hosting-statements.ts";
import { readMeeting, readMeetingSummary } from "./meeting-statements.ts";
import {
  abandonRecordingStatement,
  beginComposeStatement,
  claimComposeWindowStatement,
  closeOpenTracksStatement,
  failRecordingStatement,
  fileRecordingStatement,
  incrementTrackCountStatement,
  insertRecordingFailedAuditStatement,
  insertRecordingNoticeStatement,
  insertRecordingStatement,
  insertRecordingTrackStatement,
  listRecordingTracks,
  loseOpenTracksStatement,
  readRecordingById,
  readRunningRecording,
  recordComposeProgressStatement,
  recordComposeRetryStatement,
  stopRecordingStatement,
} from "./recording-statements.ts";
import type {
  MeetingRecordingCandidateTrack,
  MeetingRecordingComposePart,
  MeetingRecordingNoticeReason,
  MeetingRecordingParticipant,
  MeetingRecordingRow,
  MeetingRecordingStopReason,
  MeetingRecordingSummary,
} from "./recording-types.ts";
import type { MeetingRow } from "./types.ts";
import { refuse, refuseRecording } from "./validation.ts";

// Starting a recording, stopping it, admitting a track that arrived late, and writing down who was
// told. Each returns an effect for the caller to commit, beside its audit rows; nothing here reads a
// clock, holds a binding or calls anything external — the routing service, the recorder and the room
// are the Worker's.
//
// WHO MAY RECORD. Starting is `meetings:record`, which the route's chokepoint asks, AND a live grant
// on this meeting, which this service asks: the key says the firm trusts this member to create a
// recording at all, the grant says they are running THIS room — and a member who could start a
// recording of any meeting they can see the event for, from outside it, would be recording a
// conversation they are not part of. Stopping is the key — or a live grant on this meeting, because a
// member running the room can already end the meeting and ending it stops the recording; that stop is
// labelled `host` so the record says which. The service is handed whether the caller holds the key (it
// cannot read a permission set) and asks the grant itself, because the grant is a fact in this
// database.
//
// THE AUDIT ROWS CARRY IDENTIFIERS, INSTANTS AND COUNTS, and nothing else: there is no audio here to
// carry, and the notice row's audit is ONE row per fan-out with the count, never a row per person —
// the per-person record is the notice table itself.

/** The label the stop carries, exported because a caller has to match on it. */
export const STOP_RECORDING_GUARD = "meeting.recording.stop";

export interface MeetingRecordingOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
  // The same predicate every calendar source composes. A recording has no visibility rule of its own
  // — it inherits the meeting's, which inherits the event's — so a recording of a room a list read
  // could not reach is as absent as the room.
  readonly visibility: VisibleMatterPredicate;
}

/** The platform acting on its own record — the room, the recorder — with no member behind it. */
export interface MeetingRecordingSystemOptions {
  readonly clock: { now(): string };
  readonly randomSource?: RandomSource;
}

/** The meeting, through the gate, or the room's own one refusal for every way it is out of reach. */
async function reachMeeting(
  database: SqlDatabase,
  meetingId: MeetingId,
  visibility: VisibleMatterPredicate,
): Promise<MeetingRow> {
  const meeting = await readMeeting(database, meetingId, visibility);
  if (meeting === undefined) refuse("meeting-unknown-event", "that is not a meeting you can reach");
  return meeting;
}

/** Track names are the attribution key, so one name is one track however many times it is offered. */
function distinctTracks(
  tracks: readonly MeetingRecordingCandidateTrack[],
): MeetingRecordingCandidateTrack[] {
  const seen = new Set<string>();
  const distinct: MeetingRecordingCandidateTrack[] = [];
  for (const track of tracks) {
    if (seen.has(track.trackName)) continue;
    seen.add(track.trackName);
    distinct.push(track);
  }
  return distinct;
}

/**
 * HOW MANY STAYS the tracks belong to — what the ceiling counts. The recorder holds one open track per
 * stay (a participant's microphone; their screen share's audio, or any further audio track, is recorded
 * as not heard rather than taking a slot another participant needs), so the memory the ceiling bounds
 * scales with the people being heard, never with the tracks each of them publishes.
 */
function distinctStays(tracks: readonly MeetingRecordingCandidateTrack[]): number {
  return new Set(tracks.map((track) => `${track.participantKind}:${track.participantId}`)).size;
}

/** A started recording's tracks, with the handles minted for them. */
export interface StartedRecordingTrack extends MeetingRecordingCandidateTrack {
  readonly trackId: MeetingRecordingTrackId;
}

/**
 * Pressing Record.
 *
 * REFUSED, IN THIS ORDER, for: a room the caller cannot reach; a meeting that has ended (there is
 * nobody left to record and nobody left to tell); a caller who is not running this meeting
 * (`meeting-not-host` — the key alone is not enough, see the note at the top of the file); a meeting
 * on a FIRM event (a recording is filed into a matter, and a firm event has none); a room already
 * being recorded; and a room with more participants publishing audio than one recording may hear —
 * counted by STAY, not by track, because the recorder holds one track per stay — refused at the door,
 * before the mark lights, because a recording that started and then crashed would have told everybody
 * something untrue.
 *
 * A room nobody is talking in yet may still be recorded: its tracks are admitted as they are
 * published, and every arrival is told on their own welcome.
 *
 * ONE BATCH: the recording, every track the room is carrying, and the audit row. The one-running index
 * is what settles two members pressing Record in the same instant; the loser's batch rolls back and
 * the route answers that the room is already being recorded.
 */
export async function startMeetingRecording(
  database: SqlDatabase,
  meetingId: MeetingId,
  input: {
    readonly tracks: readonly MeetingRecordingCandidateTrack[];
    readonly ceiling: number;
  },
  options: MeetingRecordingOptions,
): Promise<{
  recording: MeetingRecordingRow;
  tracks: readonly StartedRecordingTrack[];
  effect: EffectWrite;
}> {
  const meeting = await readMeetingSummary(database, meetingId, options.visibility);
  if (meeting === undefined) {
    refuse("meeting-unknown-event", "that is not a meeting you can reach");
  }
  if (meeting.status === "ended") refuse("meeting-already-ended", "this meeting has ended");
  if ((await readLiveHostGrant(database, meetingId, options.actorUserId)) === undefined) {
    refuse(
      "meeting-not-host",
      "starting a recording needs the recording permission and a member running this meeting",
    );
  }
  if (meeting.eventKind !== "matter" || meeting.matterId === null) {
    refuseRecording(
      "meeting-recording-needs-matter",
      "a meeting on a firm event cannot be recorded: a recording is filed into a matter, and this event has none",
    );
  }
  if ((await readRunningRecording(database, meetingId)) !== undefined) {
    refuseRecording("meeting-recording-already-running", "this meeting is already being recorded");
  }
  const candidates = distinctTracks(input.tracks);
  const stays = distinctStays(candidates);
  if (stays > input.ceiling) {
    refuseRecording(
      "meeting-recording-too-many-tracks",
      `this room has ${String(stays)} participants publishing audio and one recording hears at most ${String(input.ceiling)}`,
    );
  }

  const now = options.clock.now();
  const recordingId = newIdentifier("meetingRecording", options.randomSource);
  const tracks: StartedRecordingTrack[] = candidates.map((track) => ({
    ...track,
    trackId: newIdentifier("meetingRecordingTrack", options.randomSource),
  }));
  const recording: MeetingRecordingRow = {
    id: recordingId,
    meeting_id: meetingId,
    matter_id: meeting.matterId,
    breakout_id: null,
    state: "recording",
    started_by_user_id: options.actorUserId,
    started_at: now,
    stopped_by_user_id: null,
    stopped_at: null,
    stop_reason: null,
    track_count: tracks.length,
    captured_seconds: null,
    file_id: null,
    file_version_id: null,
    failure_error_id: null,
    compose_upload_session_id: null,
    compose_parts_done: 0,
    compose_parts: null,
    compose_attempts: 0,
    compose_progress_at: null,
    compose_claimed_at: null,
    created_at: now,
    updated_at: now,
  };

  const statements: EffectStatement[] = [
    insertRecordingStatement(database, {
      id: recordingId,
      meetingId,
      matterId: meeting.matterId,
      startedByUserId: options.actorUserId,
      trackCount: tracks.length,
      now,
    }),
    ...tracks.map((track) =>
      insertRecordingTrackStatement(database, {
        id: track.trackId,
        recordingId,
        participantKind: track.participantKind,
        participantId: track.participantId,
        userId: track.userId,
        trackName: track.trackName,
        state: "open",
        now,
      }),
    ),
    domainAuditStatement(database, {
      event: "meetings.recording.started",
      subjectId: recordingId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: { meetingId, startedAt: now, trackCount: tracks.length },
    }),
  ];
  return { recording, tracks, effect: { statements, outboxMessages: [] } };
}

/** The statements that stop one running recording, and the instant they stop it at. */
function stopStatements(
  database: SqlDatabase,
  recording: MeetingRecordingRow,
  trackCount: number,
  stop: {
    readonly stoppedByUserId: UserId | null;
    readonly stopReason: MeetingRecordingStopReason;
    readonly now: string;
  },
  options: MeetingRecordingSystemOptions,
): EffectStatement[] {
  return [
    guarded(
      stopRecordingStatement(database, {
        id: recording.id,
        stoppedByUserId: stop.stoppedByUserId,
        stopReason: stop.stopReason,
        trackCount,
        now: stop.now,
      }),
      STOP_RECORDING_GUARD,
    ),
    // EVERY OPEN TRACK AT THE SAME INSTANT, and a lost one is left lost: a track whose socket never
    // came back was not heard after it went, and a stop is not evidence that it was.
    closeOpenTracksStatement(database, recording.id, stop.now),
    domainAuditStatement(database, {
      event: "meetings.recording.stopped",
      subjectId: recording.id,
      actorUserId: stop.stoppedByUserId,
      clock: { now: () => stop.now },
      randomSource: options.randomSource,
      metadata: {
        meetingId: recording.meeting_id,
        stoppedAt: stop.now,
        stopReason: stop.stopReason,
        trackCount,
      },
    }),
  ];
}

/** What a stop produced: the recording as it now stands, and the effect that makes it so. */
export interface StoppedRecording {
  readonly recording: MeetingRecordingRow;
  readonly effect: EffectWrite;
}

/**
 * Pressing Stop.
 *
 * WHO MAY: a member holding `meetings:record` (`mayRecord`, which the route reads off the permission
 * set) — labelled `member`; otherwise a member holding a live grant on THIS meeting — labelled `host`,
 * because a member running the room can already end the meeting and ending it stops the recording.
 * Anybody else is refused `meeting-recording-not-permitted`.
 *
 * Stopping a recording when none is running is refused `meeting-recording-not-running`: somebody else
 * stopped it, the meeting ended, or every track was lost. Not a success, because what the caller
 * wanted — that THEY stopped it — is not what happened, and the screen should say so.
 */
export async function stopMeetingRecording(
  database: SqlDatabase,
  meetingId: MeetingId,
  input: { readonly mayRecord: boolean },
  options: MeetingRecordingOptions,
): Promise<StoppedRecording> {
  await reachMeeting(database, meetingId, options.visibility);
  const running = await readRunningRecording(database, meetingId);
  if (running === undefined) {
    refuseRecording("meeting-recording-not-running", "this meeting is not being recorded");
  }
  let stopReason: MeetingRecordingStopReason = "member";
  if (!input.mayRecord) {
    const grant = await readLiveHostGrant(database, meetingId, options.actorUserId);
    if (grant === undefined) {
      refuseRecording(
        "meeting-recording-not-permitted",
        "stopping a recording needs the recording permission, or a member running this meeting",
      );
    }
    stopReason = "host";
  }
  const trackCount = (await listRecordingTracks(database, running.id)).length;
  const now = options.clock.now();
  return {
    recording: {
      ...running,
      state: "composing",
      stopped_by_user_id: options.actorUserId,
      stopped_at: now,
      stop_reason: stopReason,
      track_count: trackCount,
      updated_at: now,
    },
    effect: {
      statements: stopStatements(
        database,
        running,
        trackCount,
        { stoppedByUserId: options.actorUserId, stopReason, now },
        options,
      ),
      outboxMessages: [],
    },
  };
}

/**
 * THE MEETING IS ENDING, and a recording running in it stops with it — `meeting-ended`, attributed to
 * the member ending the meeting. Composed into the END's own batch by the route, after the end has
 * already reached the meeting through the gate; no recording running produces no statements.
 */
export async function stopRecordingForMeetingEnd(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: {
    readonly clock: { now(): string };
    readonly actorUserId: UserId;
    readonly randomSource?: RandomSource;
  },
): Promise<StoppedRecording | undefined> {
  const running = await readRunningRecording(database, meetingId);
  if (running === undefined) return undefined;
  const trackCount = (await listRecordingTracks(database, running.id)).length;
  const now = options.clock.now();
  return {
    recording: {
      ...running,
      state: "composing",
      stopped_by_user_id: options.actorUserId,
      stopped_at: now,
      stop_reason: "meeting-ended",
      track_count: trackCount,
      updated_at: now,
    },
    effect: {
      statements: stopStatements(
        database,
        running,
        trackCount,
        { stoppedByUserId: options.actorUserId, stopReason: "meeting-ended", now },
        options,
      ),
      outboxMessages: [],
    },
  };
}

/** A stop the platform makes on its own record, with nobody behind it. */
async function stopRecordingWithNobodyBehindIt(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  stopReason: "sink-lost" | "start-failed" | "abandoned" | "ceiling",
  options: MeetingRecordingSystemOptions,
): Promise<StoppedRecording | undefined> {
  const running = await readRecordingById(database, recordingId);
  if (running === undefined || running.state !== "recording") return undefined;
  const trackCount = (await listRecordingTracks(database, running.id)).length;
  const now = options.clock.now();
  return {
    recording: {
      ...running,
      state: "composing",
      stopped_at: now,
      stop_reason: stopReason,
      track_count: trackCount,
      updated_at: now,
    },
    effect: {
      statements: stopStatements(
        database,
        running,
        trackCount,
        { stoppedByUserId: null, stopReason, now },
        options,
      ),
      outboxMessages: [],
    },
  };
}

/**
 * THE RECORDER STOPPING ITSELF because every track it held was lost: `sink-lost`, with nobody behind
 * it. A recording already stopped produces no statements — whichever stop committed first is the one
 * the record keeps.
 */
export async function stopRecordingAfterSinkLoss(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  options: MeetingRecordingSystemOptions,
): Promise<StoppedRecording | undefined> {
  return await stopRecordingWithNobodyBehindIt(database, recordingId, "sink-lost", options);
}

/**
 * THE RECORDER STOPPING A RECORDING NOBODY ELSE WILL: `abandoned` when the room has had nobody
 * publishing audio for long enough that a recording nobody stopped is not left running for the rest of
 * the day, `ceiling` when it reached the longest a recording may run. With nobody behind it, and the
 * same three statements every such stop commits — the guarded stop, every open track closed, the audit
 * row with the reason and the count. A recording already stopped produces no statements: whichever
 * stop committed first is the one the record keeps, and that stop announced itself.
 */
export async function stopRecordingByPlatform(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  reason: "abandoned" | "ceiling",
  options: MeetingRecordingSystemOptions,
): Promise<StoppedRecording | undefined> {
  return await stopRecordingWithNobodyBehindIt(database, recordingId, reason, options);
}

/**
 * A START THAT COULD NOT BE CARRIED OUT — the room could not be told (or could not write down who it
 * told), or the recorder could not take the recording: `start-failed`, with nobody behind it, so the
 * record never mistakes a recording that never began for one whose audio went away. A recording
 * already stopped produces no statements, on the same rule as the sink's own stop.
 */
export async function stopRecordingAfterStartFailure(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  options: MeetingRecordingSystemOptions,
): Promise<StoppedRecording | undefined> {
  return await stopRecordingWithNobodyBehindIt(database, recordingId, "start-failed", options);
}

/**
 * A TRACK PUBLISHED AFTER THE RECORDING STARTED — somebody arrived, or somebody unmuted for the first
 * time — written in the state the RECORDER decided: `open` when it will hear the track, `lost` with no
 * frames when it will not (the recording is at its ceiling, or this stay already has a track being
 * heard). The decision is the recorder's because only it knows which tracks it is holding open; the
 * record keeps the people it can hear and says plainly who it could not.
 */
export function admitTrackStatements(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  track: MeetingRecordingCandidateTrack,
  state: "open" | "lost",
  options: MeetingRecordingSystemOptions,
): { trackId: MeetingRecordingTrackId; state: "open" | "lost"; statements: EffectStatement[] } {
  const now = options.clock.now();
  const trackId = newIdentifier("meetingRecordingTrack", options.randomSource);
  return {
    trackId,
    state,
    statements: [
      insertRecordingTrackStatement(database, {
        id: trackId,
        recordingId,
        participantKind: track.participantKind,
        participantId: track.participantId,
        userId: track.userId,
        trackName: track.trackName,
        state,
        now,
      }),
      incrementTrackCountStatement(database, recordingId, now),
    ],
  };
}

/**
 * WHO WAS TOLD — one notice per stay the room fanned the frame out to, in ONE batch, and ONE audit row
 * for the fan-out with the count. The room calls this with the stays it actually sent the frame to;
 * the notice is the record of that delivery, which is why nothing here re-reads a stay.
 *
 * An empty fan-out still writes its audit row: a recording started in a room nobody was in is a fact
 * the log should carry, and the count of zero is what says it.
 */
export function recordingNoticeEffect(
  database: SqlDatabase,
  input: {
    readonly recordingId: MeetingRecordingId;
    readonly meetingId: MeetingId;
    readonly reason: MeetingRecordingNoticeReason;
    readonly deliveredAt: string;
    readonly recipients: readonly MeetingRecordingParticipant[];
  },
  options: MeetingRecordingSystemOptions,
): EffectWrite {
  const statements: EffectStatement[] = input.recipients.map((recipient) =>
    insertRecordingNoticeStatement(database, {
      id: newIdentifier("meetingRecordingNotice", options.randomSource),
      recordingId: input.recordingId,
      participantKind: recipient.participantKind,
      participantId: recipient.participantId,
      userId: recipient.userId,
      reason: input.reason,
      deliveredAt: input.deliveredAt,
    }),
  );
  statements.push(
    domainAuditStatement(database, {
      event: "meetings.recording.noticed",
      subjectId: input.recordingId,
      actorUserId: null,
      clock: { now: () => input.deliveredAt },
      randomSource: options.randomSource,
      metadata: {
        meetingId: input.meetingId,
        reason: input.reason,
        deliveredAt: input.deliveredAt,
        noticeCount: input.recipients.length,
      },
    }),
  );
  return { statements, outboxMessages: [] };
}

/**
 * THE AUDIT ROW FOR A RECORDING THAT FAILED — with the Error ID the standard pipeline recorded, never
 * a message. Written beside the `failed` state by whichever part of the Worker gave up on it, and
 * placed AFTER `failRecordingStatement` in the same batch, because it is written only when that
 * statement left the row failed with this Error ID: two parts of the Worker giving up on one
 * recording write one audit row between them, not two (`insertRecordingFailedAuditStatement`).
 */
export function recordingFailedAuditStatement(
  database: SqlDatabase,
  input: {
    readonly recordingId: MeetingRecordingId;
    readonly meetingId: MeetingId;
    readonly failureErrorId: string;
  },
  options: MeetingRecordingSystemOptions,
): EffectStatement {
  return insertRecordingFailedAuditStatement(database, {
    auditLogId: newIdentifier("auditLog", options.randomSource),
    recordingId: input.recordingId,
    failureErrorId: input.failureErrorId,
    // Handles only: the meeting and the Error ID. There is nothing else here, and nothing else may be.
    metadata: canonicalJsonStringify({
      meetingId: input.meetingId,
      failureErrorId: input.failureErrorId,
    }),
    now: options.clock.now(),
  });
}

/** One stored recording, as a surface paints it — the two names supplied by the caller's read. */
export function toRecordingSummary(
  row: MeetingRecordingRow,
  names: { readonly startedBy: string; readonly stoppedBy: string | null },
  // The recording's transcript, when the caller read it; a recording not yet filed has none.
  transcriptId: string | null = null,
): MeetingRecordingSummary {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    state: row.state,
    startedBy: { userId: row.started_by_user_id, displayName: names.startedBy },
    startedAt: row.started_at,
    stoppedBy:
      row.stopped_by_user_id === null
        ? null
        : { userId: row.stopped_by_user_id, displayName: names.stoppedBy ?? "" },
    stoppedAt: row.stopped_at,
    stopReason: row.stop_reason,
    trackCount: row.track_count,
    capturedSeconds: row.captured_seconds,
    fileId: row.file_id,
    transcriptId,
    // The summary is written once summaries are built; until then a recording has none.
    summaryState: null,
    failureErrorId: row.failure_error_id,
  };
}

/**
 * THE MEETING A RECORDING BELONGS TO, through the gate — for the reads that address a recording by
 * its handle under a meeting the caller names.
 */
export async function reachRecordedMeeting(
  database: SqlDatabase,
  meetingId: MeetingId,
  visibility: VisibleMatterPredicate,
): Promise<MeetingRow> {
  return await reachMeeting(database, meetingId, visibility);
}

// ---------------------------------------------------------------------------------------------
// Composing and filing — the platform's own acts on its own record, with nobody behind them
// ---------------------------------------------------------------------------------------------

/** The labels the compose step's guarded writes carry, exported because a caller matches on them. */
export const COMPOSE_BEGIN_GUARD = "meeting.recording.compose.begin";
export const COMPOSE_PROGRESS_GUARD = "meeting.recording.compose.progress";
export const COMPOSE_CLAIM_GUARD = "meeting.recording.compose.claim";
export const FILE_RECORDING_GUARD = "meeting.recording.file";
export const FAIL_COMPOSE_GUARD = "meeting.recording.compose.fail";
export const ABANDON_RECORDING_GUARD = "meeting.recording.abandon";

/**
 * ONE CONSUMER TAKES THE NEXT WINDOW, or is refused because another holds it (or the cursor moved, or
 * the recording settled) — see `claimComposeWindowStatement`. `leaseMilliseconds` is how long a claim
 * holds against another delivery: a queue consumer's own longest run, past which its holder is gone.
 */
export function claimComposeWindowEffect(
  database: SqlDatabase,
  input: {
    readonly recordingId: MeetingRecordingId;
    readonly partsDone: number;
    readonly claimedAt: string;
    readonly leaseMilliseconds: number;
  },
): EffectWrite {
  return {
    statements: [
      guarded(
        claimComposeWindowStatement(database, {
          id: input.recordingId,
          partsDone: input.partsDone,
          now: input.claimedAt,
          leaseExpiredBefore: new Date(
            Date.parse(input.claimedAt) - input.leaseMilliseconds,
          ).toISOString(),
        }),
        COMPOSE_CLAIM_GUARD,
      ),
    ],
    outboxMessages: [],
  };
}

/**
 * THE COMPOSE BEGINS: the upload session the composite is written through, recorded on a recording
 * nothing has begun composing. Committed in ONE batch with the session's own statements, so a second
 * invocation that began the same recording at the same instant is refused whole and leaves nothing.
 */
export function beginComposeStatements(
  database: SqlDatabase,
  input: { readonly recordingId: MeetingRecordingId; readonly uploadSessionId: string },
  options: MeetingRecordingSystemOptions,
): EffectStatement[] {
  return [
    guarded(
      beginComposeStatement(database, {
        id: input.recordingId,
        uploadSessionId: input.uploadSessionId,
        now: options.clock.now(),
      }),
      COMPOSE_BEGIN_GUARD,
    ),
  ];
}

/**
 * PARTS UPLOADED: the cursor moved from where this invocation found it, with every part's tag so far.
 * A count and tags — never a byte of what the parts hold, which is the bucket's.
 */
export function composeProgressEffect(
  database: SqlDatabase,
  input: {
    readonly recordingId: MeetingRecordingId;
    readonly fromPartsDone: number;
    readonly parts: readonly MeetingRecordingComposePart[];
    // True when the invocation hands the next window to the queue; false when it goes on to file.
    readonly releaseClaim: boolean;
  },
  options: MeetingRecordingSystemOptions,
): EffectWrite {
  return {
    statements: [
      guarded(
        recordComposeProgressStatement(database, {
          id: input.recordingId,
          fromPartsDone: input.fromPartsDone,
          partsDone: input.parts.length,
          parts: canonicalJsonStringify(input.parts),
          releaseClaim: input.releaseClaim,
          now: options.clock.now(),
        }),
        COMPOSE_PROGRESS_GUARD,
      ),
    ],
    outboxMessages: [],
  };
}

/**
 * THE RECORDING IS ON THE MATTER: `filed`, naming the document and its version, beside ONE audit row of
 * handles — the meeting, the file and the version, and never the document's name, which is derived from
 * the event's title.
 */
export function fileRecordingStatements(
  database: SqlDatabase,
  input: {
    readonly recording: MeetingRecordingRow;
    readonly fileId: string;
    readonly fileVersionId: string;
    // The composite's own length, which the captured length is brought down to when it is shorter.
    readonly composedSeconds: number;
  },
  options: MeetingRecordingSystemOptions,
): EffectStatement[] {
  const now = options.clock.now();
  return [
    guarded(
      fileRecordingStatement(database, {
        id: input.recording.id,
        fileId: input.fileId,
        fileVersionId: input.fileVersionId,
        composedSeconds: input.composedSeconds,
        now,
      }),
      FILE_RECORDING_GUARD,
    ),
    domainAuditStatement(database, {
      event: "meetings.recording.filed",
      subjectId: input.recording.id,
      actorUserId: null,
      clock: { now: () => now },
      randomSource: options.randomSource,
      metadata: {
        meetingId: input.recording.meeting_id,
        fileId: input.fileId,
        fileVersionId: input.fileVersionId,
        filedAt: now,
      },
    }),
  ];
}

/**
 * A COMPOSE THAT CANNOT FINISH: `failed` with the Error ID the standard pipeline recorded, and ONE audit
 * row, written only when this failure is the one the record kept (`recordingFailedAuditStatement`). The
 * staged tracks are left where they are: they are the only copy of what was captured, and the sweep
 * deletes them after a retention window rather than now.
 *
 * GUARDED on `composing`, unlike the recorder's own failure: the caller commits the composite's upload
 * session ABORTED in the same batch, and a compose that filed the recording in the meantime has
 * completed that session — so a failure that lost the race must roll back whole rather than abandon
 * the version of a document that is already on the matter.
 */
export function failComposeEffect(
  database: SqlDatabase,
  input: { readonly recording: MeetingRecordingRow; readonly failureErrorId: string },
  options: MeetingRecordingSystemOptions,
): EffectWrite {
  return {
    statements: [
      guarded(
        failRecordingStatement(database, {
          id: input.recording.id,
          failureErrorId: input.failureErrorId,
          now: options.clock.now(),
        }),
        FAIL_COMPOSE_GUARD,
      ),
      recordingFailedAuditStatement(
        database,
        {
          recordingId: input.recording.id,
          meetingId: input.recording.meeting_id,
          failureErrorId: input.failureErrorId,
        },
        options,
      ),
    ],
    outboxMessages: [],
  };
}

/** A stalled compose handed on again: one more attempt counted, and the stall measured from now. */
export function composeRetryEffect(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  options: MeetingRecordingSystemOptions,
): EffectWrite {
  return {
    statements: [
      recordComposeRetryStatement(database, { id: recordingId, now: options.clock.now() }),
    ],
    outboxMessages: [],
  };
}

/**
 * A RECORDING WHOSE RECORDER IS GONE — it stopped reconciling, or never held the recording at all — and
 * which nothing else will ever stop: `abandoned` with nobody behind it, every open track lost (nothing
 * could hear them from then on), and ONE audit row with the count. A recording already stopped produces
 * nothing: whichever stop committed first is the one the record keeps.
 */
export async function abandonRecordingAfterRecorderLoss(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  options: MeetingRecordingSystemOptions,
): Promise<StoppedRecording | undefined> {
  const running = await readRecordingById(database, recordingId);
  if (running === undefined || running.state !== "recording") return undefined;
  const trackCount = (await listRecordingTracks(database, running.id)).length;
  const now = options.clock.now();
  return {
    recording: {
      ...running,
      state: "abandoned",
      stopped_at: now,
      stop_reason: "abandoned",
      track_count: trackCount,
      updated_at: now,
    },
    effect: {
      statements: [
        guarded(
          abandonRecordingStatement(database, { id: running.id, trackCount, now }),
          ABANDON_RECORDING_GUARD,
        ),
        loseOpenTracksStatement(database, running.id, now),
        domainAuditStatement(database, {
          event: "meetings.recording.abandoned",
          subjectId: running.id,
          actorUserId: null,
          clock: { now: () => now },
          randomSource: options.randomSource,
          metadata: { meetingId: running.meeting_id, stoppedAt: now, trackCount },
        }),
      ],
      outboxMessages: [],
    },
  };
}

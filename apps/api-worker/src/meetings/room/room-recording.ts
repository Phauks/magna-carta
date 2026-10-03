import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { MeetingId, MeetingRecordingId, UserId } from "@magna-carta/identifiers/types";
import {
  recordingFrame,
  type MeetingRecordingActor,
  type MeetingRecordingAnnouncement,
} from "@magna-carta/meeting-protocol/frames";
import type { MeetingParticipantKind } from "@magna-carta/meeting-protocol/types";
import { recordingNoticeEffect } from "@magna-carta/meetings/recording-service";
import type {
  MeetingRecordingCandidateTrack,
  MeetingRecordingNoticeReason,
  MeetingRecordingParticipant,
} from "@magna-carta/meetings/recording-types";
import { meetingRecordingAnnounced } from "@magna-carta/telemetry/events";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { trackBackgroundWork } from "../../background.ts";
import { firmDatabaseFor } from "../../firm-database/firm-database-proxy.ts";
import { realtimeLoggerFor } from "../sfu/realtime-failure.ts";
import {
  attachmentOf,
  readEndedAt,
  recordRoomFailure,
  storedParticipants,
  trySend,
  viewerKindOf,
  type MeetingSocketAttachment,
  type RoomContext,
} from "./room-state.ts";

// THE ANNOUNCEMENT, AND THE RECORD OF WHO WAS TOLD.
//
// The owner's ruling of 2026-09-20 made the announcement and the indicator the CONSENT MECHANISM for a
// recording: "Recording in progress" to everybody at the start and to every late arrival, audibly and
// on screen, with a mark for as long as it runs. That makes this module a mechanism with a record
// rather than a courtesy:
//
//   * every WELCOMED socket — a guest's as much as a member's, because everybody whose voice is being
//     captured is told — receives the `recording` frame the instant the route has committed a start
//     or a stop;
//   * a socket welcomed while a recording runs is told on its own welcome, in the same vocabulary;
//   * and for every stay the frame was SENT to, a notice row is written to the firm's own record —
//     one batch per fan-out, never one write per socket — because the consent evidence is what the
//     server announced to whom, not what a browser happened to render.
//
// WHAT THE ROOM HOLDS: one key, the running recording's identity and who started it, so a welcome can
// say so without asking the firm's database per arrival. Deleted on the stop, and with every other key
// when the meeting ends. Beside it, a short list of the recordings the room has been told STOPPED, so a
// start that arrives after its own stop is recognised for what it is (see `recordingStarted`). Nothing about the audio is here or anywhere in this object: the audio goes
// from the routing service to the recorder (../meeting-recorder.ts) and never crosses the room.
//
// THE ROOM KEEPS THE MEDIA PATH FREE OF RECORDING. It does not tell the recorder who published what;
// the recorder asks (`recordingCandidates`) on its own schedule, so a publish never waits on a
// recorder and a recorder that is slow or gone never slows a meeting.

const RECORDING_KEY = "recording";

// THE RECORDINGS THIS ROOM HAS BEEN TOLD STOPPED, newest last. The start route commits the recording and
// only then calls the room, so a stop, an end or a calendar cancel can commit and reach the room first —
// and a replayed start can carry a start out after the stop too. Without a record of the stop, that late
// start would store the recording and light the mark on every screen, and nothing would ever clear it:
// the stop has already been announced, and every later welcome would tell an arrival they are being
// recorded when nobody is. The list is bounded because the race it closes is seconds wide and concerns
// the room's most recent recordings only; sixteen is far more stops than one meeting makes in that
// window, and a list that grew with every recording of a long-lived room would be state kept for nothing.
const STOPPED_RECORDINGS_KEY = "recording-stopped";
const STOPPED_RECORDINGS_KEPT = 16;

async function stoppedRecordingIds(room: RoomContext): Promise<readonly string[]> {
  return (await room.ctx.storage.get<string[]>(STOPPED_RECORDINGS_KEY)) ?? [];
}

async function rememberStopped(room: RoomContext, recordingId: string): Promise<void> {
  const stopped = await stoppedRecordingIds(room);
  if (stopped.includes(recordingId)) return;
  await room.ctx.storage.put(
    STOPPED_RECORDINGS_KEY,
    [...stopped, recordingId].slice(-STOPPED_RECORDINGS_KEPT),
  );
}

/** The running recording, as the room holds it between frames. */
interface StoredRoomRecording {
  readonly firmId: string;
  readonly meetingId: string;
  readonly recordingId: string;
  readonly startedAt: string;
  // Who pressed Record, as a member's socket is told it. A guest's copy drops the user identifier.
  readonly by: { readonly userId: string; readonly displayName: string };
}

/** What the routes hand the room at each transition — every value read off the committed record. */
export interface RecordingTransition {
  readonly firmId: string;
  readonly meetingId: string;
  readonly recordingId: string;
  readonly at: string;
  // Who acted; null when nobody did — every track was lost, or the recorder disappeared.
  readonly by: { readonly userId: string; readonly displayName: string } | null;
}

/**
 * The recording's handle, as one kind of reader is told it. A recording's handle is a FIRM RECORD
 * handle — it names a row in the firm's own database and is what every member-facing read of the
 * recording is addressed by — so a guest's copy carries null, on the rule `by.userId` already keeps:
 * somebody from outside the firm is told that a recording started or stopped, and never the handle of
 * the record. The browser tells one recording from the next by the transition, not by the handle.
 */
function recordingIdFor(recordingId: string, viewer: MeetingParticipantKind): string | null {
  return viewer === "guest" ? null : recordingId;
}

/** Who acted, as one kind of reader is told it: a guest is told a name and never an identifier. */
function actorFor(
  by: RecordingTransition["by"],
  viewer: MeetingParticipantKind,
): MeetingRecordingActor | null {
  if (by === null) return null;
  return { userId: viewer === "guest" ? null : by.userId, displayName: by.displayName };
}

/** The stay a socket holds, as a notice names it: by kind and by value. */
function participantOf(attachment: MeetingSocketAttachment): MeetingRecordingParticipant {
  return {
    participantKind: viewerKindOf(attachment),
    participantId: attachment.attendanceId,
    // A guest's socket carries the empty string where a member's carries their user; the notice says
    // null for "nobody", which is what it is.
    userId: attachment.userId === "" ? null : (attachment.userId as UserId),
  };
}

/**
 * ONE FRAME TO EVERY WELCOMED SOCKET, built per kind of reader, answering the stays it reached.
 *
 * The broadcast is written here rather than through `broadcastPerViewer` because the consent record
 * needs to know WHO was sent the frame, not only how many — and the walk that sends is the only
 * witness to that. One stay holding two sockets (a reconnect a heartbeat from being superseded) is one
 * person told once, so the recipients are distinct by stay.
 *
 * A STAY IS A RECIPIENT ONLY WHEN THE FRAME WAS HANDED TO ITS SOCKET. A socket closing between the
 * walk and the send swallows the frame in `trySend`, and writing a notice for it would put on the
 * consent record that somebody was told who was not. Their close handler is already running; if they
 * come back, their welcome tells them, and that is an `arrival` notice of its own.
 */
function announce(
  room: RoomContext,
  payloadFor: (viewer: MeetingParticipantKind) => string,
): MeetingRecordingParticipant[] {
  const built = new Map<MeetingParticipantKind, string>();
  const recipients = new Map<string, MeetingRecordingParticipant>();
  for (const socket of room.ctx.getWebSockets()) {
    const attachment = attachmentOf(socket);
    if (attachment?.welcomed !== true) continue;
    const viewer = viewerKindOf(attachment);
    let payload = built.get(viewer);
    if (payload === undefined) {
      payload = payloadFor(viewer);
      built.set(viewer, payload);
    }
    if (trySend(socket, payload)) {
      recipients.set(attachment.attendanceId, participantOf(attachment));
    }
  }
  return [...recipients.values()];
}

/**
 * Writes the notices for one fan-out in ONE batch, and records the announcement. Answers how many
 * notices committed — zero when the write failed, which the event records beside the recipient count
 * so an announcement with no record behind it is visible rather than silent.
 */
async function recordNotices(
  room: RoomContext,
  transition: RecordingTransition,
  reason: MeetingRecordingNoticeReason,
  recipients: readonly MeetingRecordingParticipant[],
): Promise<number> {
  let noticeCount = 0;
  try {
    const database = firmDatabaseFor(room.env.FIRM_DATABASE, transition.firmId);
    const effect = recordingNoticeEffect(
      database,
      {
        recordingId: transition.recordingId as MeetingRecordingId,
        meetingId: transition.meetingId as MeetingId,
        reason,
        deliveredAt: transition.at,
        recipients,
      },
      { clock: { now: () => transition.at }, randomSource: cryptoRandomSource },
    );
    await commitEffectBatch(database, effect, { now: () => new Date().toISOString() });
    noticeCount = recipients.length;
  } catch (caught) {
    // Recorded through the standard pipeline. The frame has already been delivered — the people in the
    // room WERE told — and the event below says the record of it is missing, which is the case an
    // operator must be able to find.
    recordRoomFailure(room, "recording-notice", caught);
  }
  try {
    realtimeLoggerFor(room.env).log(
      meetingRecordingAnnounced(
        { correlationId: newCorrelationId(), now: new Date().toISOString() },
        {
          firmId: transition.firmId,
          meetingId: transition.meetingId,
          recordingId: transition.recordingId,
          reason,
          recipientCount: recipients.length,
          noticeCount,
        },
      ),
    );
  } catch {
    // Telemetry never costs the room anything.
  }
  return noticeCount;
}

/**
 * A RECORDING STARTED — called by the start route AFTER the recording row committed, and before any
 * adapter is opened, so nobody's voice is captured before they have been told.
 *
 * The room keeps who started it so every later welcome can say so, broadcasts the announcement to
 * every welcomed socket, and writes a `start` notice for each stay it reached.
 */
/**
 * What the room says to a start. `stopped` is set only when the recording is already over by the time
 * its start reaches the room, so the caller knows not to hand it to a recorder either: a recorder
 * started then would capture until its own pass read the record, with no mark lit to say so.
 */
export interface RecordingStartReply {
  readonly recipientCount: number;
  readonly noticeCount: number;
  readonly stopped?: true;
}

export async function recordingStarted(
  room: RoomContext,
  transition: RecordingTransition,
): Promise<RecordingStartReply> {
  // ONE ANNOUNCEMENT PER RECORDING, whoever asks. The start route and a replay of it can both carry a
  // start out — a replay arriving while the first request is still on its way here finds the room not
  // yet holding the recording and announces it, and the first request then arrives too. The room
  // holding THIS recording is the proof it was announced (it is written before the frame goes out, and
  // nothing else is delivered to the room between the two), so a second call tells nobody again,
  // writes no second set of notices, and answers that it reached nobody — which the caller reads as an
  // announcement with nothing left unrecorded, and carries on to the recorder.
  const held = await room.ctx.storage.get<StoredRoomRecording>(RECORDING_KEY);
  if (held !== undefined && held.recordingId === transition.recordingId) {
    return { recipientCount: 0, noticeCount: 0 };
  }
  // A START THAT ARRIVES AFTER ITS OWN STOP — or after the meeting ended, which wipes the room's keys,
  // this list among them, and closes every socket — tells nobody and stores nothing. The recording is
  // over: lighting the mark now would tell the room it is being recorded when it is not, and nothing
  // would come along afterwards to clear it. It answers that nobody was told and nothing was left
  // unrecorded, and that the recording is over, so the caller starts no recorder for it.
  if (
    (await stoppedRecordingIds(room)).includes(transition.recordingId) ||
    (await readEndedAt(room)) !== undefined
  ) {
    return { recipientCount: 0, noticeCount: 0, stopped: true };
  }
  if (transition.by !== null) {
    await room.ctx.storage.put<StoredRoomRecording>(RECORDING_KEY, {
      firmId: transition.firmId,
      meetingId: transition.meetingId,
      recordingId: transition.recordingId,
      startedAt: transition.at,
      by: transition.by,
    });
  }
  const recipients = announce(room, (viewer) =>
    recordingFrame({
      state: "started",
      recordingId: recordingIdFor(transition.recordingId, viewer),
      by: actorFor(transition.by, viewer),
      at: transition.at,
    }),
  );
  const noticeCount = await recordNotices(room, transition, "start", recipients);
  return { recipientCount: recipients.length, noticeCount };
}

/**
 * A RECORDING STOPPED — by a member, by whoever is running the room, by the meeting ending, or by the
 * recorder losing every track. The mark clears on every screen, and a `stop` notice is written for
 * each stay told. A stop for a recording the room is not holding is still announced: the route's
 * record is the authority, and a mark that stayed lit because the room had forgotten would be a lie.
 */
export async function recordingStopped(
  room: RoomContext,
  transition: RecordingTransition,
): Promise<{ readonly recipientCount: number; readonly noticeCount: number }> {
  const stored = await room.ctx.storage.get<StoredRoomRecording>(RECORDING_KEY);
  if (stored !== undefined && stored.recordingId === transition.recordingId) {
    await room.ctx.storage.delete(RECORDING_KEY);
  }
  // Remembered whether or not the room held it: a stop that beats its start here is exactly the case
  // the list exists for.
  await rememberStopped(room, transition.recordingId);
  const recipients = announce(room, (viewer) =>
    recordingFrame({
      state: "stopped",
      recordingId: recordingIdFor(transition.recordingId, viewer),
      by: actorFor(transition.by, viewer),
      at: transition.at,
    }),
  );
  const noticeCount = await recordNotices(room, transition, "stop", recipients);
  return { recipientCount: recipients.length, noticeCount };
}

/** The running recording a welcome carries, and the act of recording that it was delivered. */
export interface RecordingOnWelcome {
  // What the welcome says, as the arriving socket's kind of reader is told it.
  readonly announcement: MeetingRecordingAnnouncement;
  // Called by the caller ONLY once the welcome was handed to the socket — see below.
  readonly welcomeSent: () => void;
}

/**
 * WHAT A WELCOME CARRIES ABOUT RECORDING — the "and on arrival" half of the ruling.
 *
 * Answers the running recording as the arriving socket's kind of reader is told it, or null when
 * nothing is being recorded; the caller puts the announcement on the welcome, sends it, and calls
 * `welcomeSent` only when `trySend` answered that the welcome went out. That is what writes the
 * `arrival` notice for this stay: the notice says this person was told, and a welcome swallowed by a
 * socket that closed under it told nobody — so the record of it is written after the send rather
 * than beside the build. It is written in the background, so the welcome is never held up by a write
 * to the firm's database, and its instant is the moment the welcome went out. A reconnect is another
 * arrival and another notice, correctly: each is a separate occasion on which somebody was told.
 */
export async function recordingForWelcome(
  room: RoomContext,
  attachment: MeetingSocketAttachment,
): Promise<RecordingOnWelcome | null> {
  const stored = await room.ctx.storage.get<StoredRoomRecording>(RECORDING_KEY);
  if (stored === undefined) return null;
  return {
    announcement: {
      state: "started",
      recordingId: recordingIdFor(stored.recordingId, viewerKindOf(attachment)),
      by: actorFor(stored.by, viewerKindOf(attachment)),
      at: stored.startedAt,
    },
    welcomeSent: () => {
      const transition: RecordingTransition = {
        firmId: stored.firmId,
        meetingId: stored.meetingId,
        recordingId: stored.recordingId,
        at: new Date().toISOString(),
        by: stored.by,
      };
      room.ctx.waitUntil(
        trackBackgroundWork(
          recordNotices(room, transition, "arrival", [participantOf(attachment)]),
        ),
      );
    },
  };
}

/** The recording the room believes is running, or null — for the room's own tests and an operator. */
export async function runningRecordingOf(
  room: RoomContext,
): Promise<{ readonly recordingId: string; readonly startedAt: string } | null> {
  const stored = await room.ctx.storage.get<StoredRoomRecording>(RECORDING_KEY);
  return stored === undefined
    ? null
    : { recordingId: stored.recordingId, startedAt: stored.startedAt };
}

/**
 * EVERY AUDIO TRACK THE ROOM IS CARRYING, as a recording would take it — what the start route counts
 * against the ceiling and what the recorder reconciles against on each pass.
 *
 * A track is a candidate when its participant is in the room with a routing session and a live
 * socket. One roster read, which is the room's own rule for a question about who is in the meeting.
 */
export async function recordingCandidates(
  room: RoomContext,
): Promise<MeetingRecordingCandidateTrack[]> {
  const stored = await storedParticipants(room);
  const candidates: MeetingRecordingCandidateTrack[] = [];
  for (const [attendanceId, participant] of stored) {
    if (participant.sfuSessionId === null || participant.socketLostAt !== null) continue;
    for (const track of participant.tracks) {
      if (track.kind !== "audio") continue;
      candidates.push({
        participantKind: participant.participantKind === "guest" ? "guest" : "member",
        participantId: attendanceId,
        userId: participant.userId === "" ? null : (participant.userId as UserId),
        trackName: track.trackName,
        sessionId: participant.sfuSessionId,
      });
    }
  }
  return candidates;
}

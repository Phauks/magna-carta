import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { FirmId, MeetingId } from "@magna-carta/identifiers/types";
import { captionFrame } from "@magna-carta/meeting-protocol/frames";
import { captionsEnabledDefinition } from "@magna-carta/meetings/settings";
import { trackBackgroundWork } from "../../background.ts";
import { firmDatabaseFor } from "../../firm-database/firm-database-proxy.ts";
import { captionerFor, captionerNamespaceOf } from "../caption-binding.ts";
import type { CaptionHeard, CaptionSpeakingUpdate } from "../meeting-captioner.ts";
import { sfuClientForEnv } from "../sfu/sfu-client.ts";
import { sinkSigningKeyForEnv } from "../sink-token.ts";
import { refuseAndRecord } from "./room-diagnostics.ts";
import {
  announceRoomState,
  broadcastPerViewer,
  putCaptions,
  readCaptions,
  readParticipant,
  readRoom,
  recordRoomFailure,
  type RoomContext,
  type StoredParticipant,
} from "./room-state.ts";

// LIVE CAPTIONS, AS THE ROOM SEES THEM — the switch a host turns, the speaking presence the captioner is
// told, and the words it hands back, fanned out to every socket.
//
// THE ROOM HOLDS THE SWITCH AND NOTHING ELSE. One key — that captions are on, and which host's stay
// turned them on — rides every welcome and every `room-state` through `roomStateOf`. The words are never
// written: a caption arrives from the captioner (../meeting-captioner.ts), goes out to every welcomed
// socket, and is gone. The transcript is the record; a caption is a display.
//
// THE AUDIO NEVER CROSSES THE ROOM. What the room tells the captioner is that somebody started or
// stopped speaking — the presence it already relays — and which microphone is theirs; the captioner
// asks the routing service for that microphone's audio itself. So the room's rule that the media
// crosses this directory in one place still holds, with a second place beside the recorder: the
// captioner, which is not the room.
//
// WHO MAY TURN THEM ON. A host or co-host, by a frame (`captions`), answered with the room state — and
// only where the firm has switched captions on (`meetings.captionsEnabled`) and this deployment can
// route meeting audio to the caption model. A recording is NOT needed: captions run with or without one.
// The firm's AI-processing eligibility is NOT asked either: the audio goes to a speech model hosted on
// Cloudflare, on exactly the terms the transcript of record's does, and the transcript runs without
// that switch. That reading is the owner's to confirm (the recording spec's amendments).

/**
 * WHETHER THIS DEPLOYMENT CAN CAPTION AT ALL: a captioner to run the sessions, the routing service to
 * take the audio from, the signing key its adapters' addresses are signed with, and the origin they
 * dial. The same key recording waits on, so captions are configured exactly when recording is.
 */
export function captionsConfigured(room: RoomContext): boolean {
  const appBaseUrl = room.env.APP_BASE_URL;
  return (
    captionerNamespaceOf(room.env) !== undefined &&
    sfuClientForEnv(room.env) !== null &&
    sinkSigningKeyForEnv(room.env) !== null &&
    appBaseUrl !== undefined &&
    appBaseUrl !== ""
  );
}

/**
 * A HOST TURNED CAPTIONS ON OR OFF — the act behind the `captions` frame, its authority already decided
 * from the stored record in room-hosting.ts.
 *
 * On: refused `captions-unavailable` where the deployment or the firm does not allow them, the socket
 * kept open; otherwise the switch is written, the room state announced to everybody, and the captioner
 * told about everybody already speaking, so a sentence under way when the host pressed the control is
 * captioned from that moment. Off: the switch goes, the room state is announced, and every session
 * closes. A frame that restates what is already true changes nothing and announces nothing.
 */
export async function setCaptions(
  room: RoomContext,
  socket: WebSocket,
  hostAttendanceId: string,
  enabled: boolean,
  stored: ReadonlyMap<string, StoredParticipant>,
): Promise<void> {
  const current = await readCaptions(room);
  if (!enabled) {
    if (current === undefined) return;
    await putCaptions(room, null);
    await announceRoomState(room);
    const identity = await readRoom(room);
    if (identity !== undefined)
      stopCaptioner(room, identity.firmId, identity.meetingId, "captions-off");
    return;
  }
  if (current !== undefined) return;
  const identity = await readRoom(room);
  if (identity === undefined || !captionsConfigured(room)) {
    await refuseAndRecord(
      room,
      socket,
      undefined,
      hostAttendanceId,
      "captions-unavailable",
      "captions",
    );
    return;
  }
  let allowed: boolean;
  try {
    allowed = await readFirmSetting(
      firmDatabaseFor(room.env.FIRM_DATABASE, identity.firmId),
      captionsEnabledDefinition,
    );
  } catch (caught) {
    await refuseAndRecord(
      room,
      socket,
      undefined,
      hostAttendanceId,
      "captions-unavailable",
      "captions",
      recordRoomFailure(room, "captions-setting", caught),
    );
    return;
  }
  if (!allowed) {
    await refuseAndRecord(
      room,
      socket,
      undefined,
      hostAttendanceId,
      "captions-unavailable",
      "captions",
    );
    return;
  }
  await putCaptions(room, { by: hostAttendanceId, at: new Date().toISOString() });
  await announceRoomState(room);
  const at = Date.now();
  for (const [attendanceId, participant] of stored) {
    if (!participant.speaking) continue;
    tellCaptioner(room, speakingUpdate(identity, attendanceId, participant, true, at));
  }
}

/**
 * SOMEBODY'S `speaking` MOVED — called by the frame dispatch after the presence module stored it, and
 * by a host's mute, which silences somebody without their browser saying so. One storage read when
 * captions are off and that is all; otherwise one more for the participant, and the captioner is told
 * in the background so the presence frame is never held by it.
 */
export async function noteSpeakingForCaptions(
  room: RoomContext,
  attendanceId: string,
  speaking: boolean,
): Promise<void> {
  if ((await readCaptions(room)) === undefined) return;
  const [identity, participant] = await Promise.all([
    readRoom(room),
    readParticipant(room, attendanceId),
  ]);
  if (identity === undefined || participant === undefined) return;
  tellCaptioner(room, speakingUpdate(identity, attendanceId, participant, speaking, Date.now()));
}

/** Somebody left the room: a session of theirs closes now rather than after its silence. */
export async function captionParticipantGone(
  room: RoomContext,
  attendanceId: string,
): Promise<void> {
  if ((await readCaptions(room)) === undefined) return;
  const identity = await readRoom(room);
  if (identity === undefined) return;
  const captioner = captionerFor(room.env, identity.firmId, identity.meetingId);
  if (captioner === null) return;
  background(room, "captioner-gone", captioner.participantGone(attendanceId));
}

/**
 * ONE CAPTION, TO EVERY WELCOMED SOCKET — the captioner's words, relayed and kept nowhere. Built per
 * kind of reader, so a guest's copy names the speaker and carries no firm user identifier. Dropped when
 * captions have been turned off since the captioner heard it: the switch is the room's, and a caption
 * arriving after it moved is a caption nobody asked for. Answers how many sockets it went to.
 */
export async function relayCaption(room: RoomContext, heard: CaptionHeard): Promise<number> {
  if ((await readCaptions(room)) === undefined) return 0;
  return broadcastPerViewer(room, (viewer) =>
    captionFrame({
      participantId: heard.participantId,
      userId: viewer === "guest" || heard.participantKind === "guest" ? null : heard.userId,
      displayName: heard.displayName,
      segmentId: heard.segmentId,
      text: heard.text,
      final: heard.final,
      at: heard.at,
    }),
  );
}

/**
 * THE FIRM SWITCHED CAPTIONS OFF while they ran — the captioner found it so when it next opened a
 * session, and has already closed every session. The room turns them off and tells everybody, so no
 * screen goes on showing a control that does nothing.
 */
export async function captionsWithdrawn(room: RoomContext): Promise<void> {
  if ((await readCaptions(room)) === undefined) return;
  await putCaptions(room, null);
  await announceRoomState(room);
}

/**
 * THE MEETING IS ENDING — called before the room's keys are deleted, so it can still read whether
 * captions were on. Every session closes; the switch goes with every other key.
 */
export async function captionsEndedWithMeeting(room: RoomContext): Promise<void> {
  if ((await readCaptions(room)) === undefined) return;
  const identity = await readRoom(room);
  if (identity === undefined) return;
  stopCaptioner(room, identity.firmId, identity.meetingId, "meeting-ended");
}

// ---------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------

/** What the captioner is told about one person — their stay, their name and their microphone. */
function speakingUpdate(
  identity: { readonly firmId: string; readonly meetingId: string },
  attendanceId: string,
  participant: StoredParticipant,
  speaking: boolean,
  at: number,
): CaptionSpeakingUpdate {
  const microphone = participant.tracks.find((track) => track.kind === "audio");
  return {
    firmId: identity.firmId as FirmId,
    meetingId: identity.meetingId as MeetingId,
    participantId: attendanceId,
    participantKind: participant.participantKind === "guest" ? "guest" : "member",
    userId: participant.userId === "" ? null : participant.userId,
    displayName: participant.displayName,
    // A participant who has stopped speaking needs no microphone named; one who has started and
    // publishes none has nothing to caption, and the captioner opens nothing for them.
    speaking: speaking && microphone !== undefined && participant.sfuSessionId !== null,
    track:
      microphone === undefined || participant.sfuSessionId === null
        ? null
        : { sessionId: participant.sfuSessionId, trackName: microphone.trackName },
    at,
  };
}

function tellCaptioner(room: RoomContext, update: CaptionSpeakingUpdate): void {
  const captioner = captionerFor(room.env, update.firmId, update.meetingId);
  if (captioner === null) return;
  background(room, "captioner-speaking", captioner.speakingChanged(update));
}

function stopCaptioner(
  room: RoomContext,
  firmId: string,
  meetingId: string,
  reason: "captions-off" | "meeting-ended",
): void {
  const captioner = captionerFor(room.env, firmId, meetingId);
  if (captioner === null) return;
  background(room, "captioner-stop", captioner.stop(reason));
}

/**
 * A call to the captioner that nothing in the room waits on: a presence frame, a host's switch and the
 * end of a meeting are all answered without it, and a captioner that is slow or gone costs the room
 * nothing but a recorded failure.
 */
function background(room: RoomContext, operation: string, work: Promise<unknown>): void {
  room.ctx.waitUntil(
    trackBackgroundWork(
      work.catch((caught: unknown) => {
        recordRoomFailure(room, operation, caught);
      }),
    ),
  );
}

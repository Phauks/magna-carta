import type { MeetingHostRole, MeetingSpotlight } from "@magna-carta/meeting-protocol/types";
import {
  attachmentOf,
  connectedAttendanceIds,
  type RoomContext,
  type StoredClientSample,
  type StoredParticipant,
  type StoredRoom,
  type StoredWaiting,
} from "./room-state.ts";

// WHAT IS ACTUALLY INSIDE ONE ROOM, for the one caller entitled to ask.
//
// A meeting that is going wrong is the hardest thing in this platform to see into. It holds no rows,
// its state is deleted as it goes, and the two ends that can see anything are a browser somebody
// else is sitting at and a Durable Object that hibernates between frames. Everything a support
// question needs — is the roster what the member thinks it is, is their socket even open, is the
// alarm armed, is the room holding a spotlight on somebody who left — is knowable only from inside.
// This is the read that answers it, and it exists because the alternative is asking a firm to
// reproduce a three-hundred-person meeting.
//
// WHAT IT WILL NOT CARRY, and the list is deliberate rather than incidental:
//
//   * NO SESSION DESCRIPTION. An SDP is the most identifying thing on this wire — addresses,
//     fingerprints, codecs, the shape of somebody's network — and the room only ever passes them
//     through. There is no field for one here and there must never be.
//   * NO DISPLAY NAME. Every participant is named by the handle the platform minted. A roster of
//     names is a list of who a firm was meeting, which is a disclosure with no transcript attached,
//     and an operator diagnosing a black tile does not need one: the handle is what every frame,
//     every log line and the member's own screen already correlate by.
//   * NO TRACK NAMES. A track name carries its publisher's handle and the name a browser gave it;
//     the count is what says whether somebody is publishing.
//
// It is a READ and changes nothing. An inspect that repaired what it found would hide the fault it
// exists to expose, on the same reasoning the upload-readiness report is held to.

/** One participant, as an operator sees them. */
export interface InspectedParticipant {
  readonly participantId: string;
  readonly userId: string;
  readonly hostRole: MeetingHostRole | null;
  readonly speaking: boolean;
  readonly muted: boolean;
  /** A transition the throttle held back, waiting on the alarm. The room's own half of presence. */
  readonly presenceDirty: boolean;
  /** Whether a socket is open for this stay right now — the answer a roster entry cannot give. */
  readonly connected: boolean;
  readonly socketLostAt: string | null;
  readonly sfuSessionId: string | null;
  readonly trackCount: number;
  readonly subscribedMidCount: number;
  /** When this browser last reported on itself, and what it said. Null until it has. */
  readonly reportAt: string | null;
  readonly lastSample: StoredClientSample | null;
}

/** One person at the door, as an operator sees them. */
export interface InspectedWaiting {
  readonly participantId: string;
  readonly userId: string;
  readonly waitingFrom: string;
  readonly socketLostAt: string | null;
}

/** The deadlines a room is holding, named. */
export type PendingAlarmJob =
  | "participant-grace"
  | "door-grace"
  | "presence-flush"
  | "ended-marker-retirement";

/** The whole of what one room is holding. */
export interface MeetingRoomInspection {
  readonly firmId: string | null;
  readonly meetingId: string | null;
  readonly medium: string | null;
  readonly locked: boolean;
  readonly lobby: string;
  readonly spotlight: MeetingSpotlight | null;
  /** The instant the meeting closed, or null while it runs. */
  readonly endedAt: string | null;
  readonly roster: readonly InspectedParticipant[];
  readonly waiting: readonly InspectedWaiting[];
  readonly sockets: {
    readonly count: number;
    /** One entry per OPEN SOCKET, not per stay: two here for one handle is a supersede in flight. */
    readonly attendanceIds: readonly string[];
    /** Sockets whose attachment could not be read — a build older than the current protocol. */
    readonly unreadable: number;
    readonly welcomed: number;
  };
  readonly alarm: {
    readonly at: string | null;
    readonly pendingJobs: readonly PendingAlarmJob[];
  };
  readonly storage: {
    readonly keyCount: number;
    /** What the stored values come to as JSON. An estimate, and enough to see a room that is fat. */
    readonly approximateBytes: number;
  };
  /** The routing sessions this room is carrying, which is what the service is billing for. */
  readonly sfuSessionIds: readonly string[];
}

const PARTICIPANT_PREFIX = "participant:";
const WAITING_PREFIX = "waiting:";
const ROOM_KEY = "room";
const ENDED_KEY = "ended";
const SPOTLIGHT_KEY = "spotlight";

/**
 * Everything the room holds, in ONE pass over its storage.
 *
 * One `list()` rather than the four typed reads the rest of the room uses, and that is the whole
 * reason the key constants are restated here: the roster, the door, the room's identity, the ended
 * marker and the spotlight are all in this one read, and so are the key count and the size — which
 * the typed reads cannot answer at all, because each of them is scoped to a prefix. A second read
 * per fact would make the diagnostic more expensive than the meeting.
 */
export async function inspectRoom(room: RoomContext): Promise<MeetingRoomInspection> {
  const everything = await room.ctx.storage.list();
  const connected = connectedAttendanceIds(room);

  const roster: InspectedParticipant[] = [];
  const waiting: InspectedWaiting[] = [];
  const sfuSessionIds: string[] = [];
  let approximateBytes = 0;
  let stored: StoredRoom | undefined;
  let endedAt: string | null = null;
  let spotlight: MeetingSpotlight | null = null;

  for (const [key, value] of everything) {
    approximateBytes += key.length + jsonSizeOf(value);
    if (key.startsWith(PARTICIPANT_PREFIX)) {
      const participantId = key.slice(PARTICIPANT_PREFIX.length);
      const participant = value as StoredParticipant;
      roster.push({
        participantId,
        userId: participant.userId,
        hostRole: participant.hostRole ?? null,
        speaking: participant.speaking,
        muted: participant.muted,
        presenceDirty: participant.presenceDirty,
        connected: connected.has(participantId),
        socketLostAt: participant.socketLostAt,
        sfuSessionId: participant.sfuSessionId,
        trackCount: participant.tracks.length,
        subscribedMidCount: participant.subscribedMids.length,
        reportAt: participant.reportAt ?? null,
        lastSample: participant.lastSample ?? null,
      });
      if (participant.sfuSessionId !== null) sfuSessionIds.push(participant.sfuSessionId);
      continue;
    }
    if (key.startsWith(WAITING_PREFIX)) {
      const one = value as StoredWaiting;
      waiting.push({
        participantId: key.slice(WAITING_PREFIX.length),
        userId: one.userId,
        waitingFrom: one.waitingFrom,
        socketLostAt: one.socketLostAt,
      });
      continue;
    }
    if (key === ROOM_KEY) stored = value as StoredRoom;
    else if (key === ENDED_KEY) endedAt = value as string;
    else if (key === SPOTLIGHT_KEY) spotlight = value as MeetingSpotlight;
  }

  const attendanceIds: string[] = [];
  let unreadable = 0;
  let welcomed = 0;
  for (const socket of room.ctx.getWebSockets()) {
    const attachment = attachmentOf(socket);
    if (attachment === null) {
      unreadable += 1;
      continue;
    }
    attendanceIds.push(attachment.attendanceId);
    if (attachment.welcomed === true) welcomed += 1;
  }

  const alarmAt = await room.ctx.storage.getAlarm();
  return {
    firmId: stored?.firmId ?? null,
    meetingId: stored?.meetingId ?? null,
    medium: stored?.medium ?? null,
    locked: stored?.locked ?? false,
    lobby: stored?.lobby ?? "off",
    spotlight,
    endedAt,
    roster,
    waiting,
    sockets: { count: attendanceIds.length + unreadable, attendanceIds, unreadable, welcomed },
    alarm: {
      at: alarmAt === null ? null : new Date(alarmAt).toISOString(),
      pendingJobs: pendingJobsOf(roster, waiting, endedAt),
    },
    storage: { keyCount: everything.size, approximateBytes },
    sfuSessionIds,
  };
}

/**
 * Which of the four deadlines this room is actually holding.
 *
 * Derived from the state that armed them rather than from the alarm, which is one instant and cannot
 * say what it is for. An armed alarm naming no job is the shape of a deadline nobody lowered; an
 * unarmed room naming one is a wake that was never scheduled, and a member who will sit in a
 * half-closed stay until something else wakes the room. Neither is visible any other way.
 */
function pendingJobsOf(
  roster: readonly InspectedParticipant[],
  waiting: readonly InspectedWaiting[],
  endedAt: string | null,
): PendingAlarmJob[] {
  const jobs: PendingAlarmJob[] = [];
  if (roster.some((one) => one.socketLostAt !== null && !one.connected)) {
    jobs.push("participant-grace");
  }
  if (waiting.some((one) => one.socketLostAt !== null)) jobs.push("door-grace");
  if (roster.some((one) => one.presenceDirty)) jobs.push("presence-flush");
  if (endedAt !== null) jobs.push("ended-marker-retirement");
  return jobs;
}

// The size of one stored value as JSON. A value the runtime will not serialize is counted as
// nothing rather than throwing: this is an estimate on a diagnostic read, and a room that cannot be
// inspected because one key is odd is worse than a byte count that is slightly low.
function jsonSizeOf(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

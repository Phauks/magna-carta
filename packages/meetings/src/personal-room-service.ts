import {
  insertMatterEventParticipantStatement,
  insertMatterEventStatement,
} from "@magna-carta/calendar/event-statements";
import {
  insertFirmEventParticipantStatement,
  insertFirmEventStatement,
} from "@magna-carta/calendar/firm-event-statements";
import {
  isFixedOffset,
  isResolvableTimeZone,
  zonedReading,
} from "@magna-carta/civil-time/time-zone";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectStatement, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmEventId,
  MatterEventId,
  MatterId,
  MeetingId,
} from "@magna-carta/identifiers/types";
import { readLiveHostGrant } from "./hosting-statements.ts";
import { freeRoomAddressName, roomAddressNames } from "./meeting-addresses.ts";
import type { MeetingLobbyMode } from "./lobby-types.ts";
import {
  END_MEETING_GUARD,
  openMeetingOnEvent,
  sessionEventSettlement,
  type MeetingServiceOptions,
} from "./meeting-service.ts";
import { endMeetingStatement, readMeeting } from "./meeting-statements.ts";
import {
  addSessionParticipantStatement,
  deleteMovedFirmEventParticipantsStatement,
  deleteMovedFirmEventStatement,
  insertPersonalRoomStatement,
  moveMeetingToMatterEventStatement,
  readFirmEventForMove,
  readFirmEventParticipantsForMove,
  readMemberDisplayName,
  readPersonalRoomByAddressName,
  readPersonalRoomForOwner,
  readPersonalRoomOpenSession,
  readTakenRoomAddressNames,
  readVisibleMatter,
  replacePersonalRoomLinkStatement,
  updatePersonalRoomDefaultsStatement,
} from "./personal-room-statements.ts";
import {
  isPersonalRoomAddress,
  newPersonalRoomLinkCode,
  personalRoomEventTitle,
  refusePersonalRoom,
  type MeetingPersonalRoomRow,
  type PersonalRoomOpenSession,
} from "./personal-room-types.ts";
import { stopRecordingForMeetingEnd } from "./recording-service.ts";
import type { MeetingMedium } from "./types.ts";
import { refuse } from "./validation.ts";

// A MEMBER'S PERSONAL ROOM: make it, change it, open a session in it, arrive at it by its link, and
// move a session onto a matter. Like the rest of this package nothing here reads a clock or holds a
// binding; each act returns its statements and audit rows for the route to commit in one batch.

/** The guard on replacing a link: somebody else replaced it between the read and the write. */
export const REPLACE_LINK_GUARD = "meeting.personalRoom.replaceLink";
/** The guard on moving a session onto a matter: another move, or an edit to the event, got there first. */
export const MOVE_TO_MATTER_GUARD = "meeting.personalRoom.moveToMatter";
/** The guard on deleting the firm event a move leaves behind. */
export const MOVE_DELETE_EVENT_GUARD = "meeting.personalRoom.moveDeleteEvent";

/**
 * The caller's room, made when it does not exist yet. Returns the row when it exists and the write
 * that makes it when it does not; the route commits the write and reads the row back, so two first
 * reads racing both end with the one room the unique index allowed.
 */
export async function ensurePersonalRoom(
  database: SqlDatabase,
  options: MeetingServiceOptions,
): Promise<{ room: MeetingPersonalRoomRow | undefined; effect: EffectWrite }> {
  const existing = await readPersonalRoomForOwner(database, options.actorUserId);
  if (existing !== undefined) {
    return { room: existing, effect: { statements: [], outboxMessages: [] } };
  }
  const now = options.clock.now();
  const id = newIdentifier("meetingPersonalRoom", options.randomSource);
  const linkCode = newPersonalRoomLinkCode(options.randomSource);
  // The room's address by name. A name with no plain first word is addressed by its link code.
  const candidates = roomAddressNames(
    (await readMemberDisplayName(database, options.actorUserId)) ?? "",
  );
  const addressName =
    candidates.length === 0
      ? linkCode
      : freeRoomAddressName(candidates, await readTakenRoomAddressNames(database, candidates));
  return {
    room: undefined,
    effect: {
      statements: [
        insertPersonalRoomStatement(database, {
          id,
          ownerUserId: options.actorUserId,
          linkCode,
          addressName,
          now,
        }),
        domainAuditStatement(database, {
          event: "meetings.personalRoom.created",
          subjectId: id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {},
        }),
      ],
      outboxMessages: [],
    },
  };
}

async function requireOwnRoom(
  database: SqlDatabase,
  options: MeetingServiceOptions,
): Promise<MeetingPersonalRoomRow> {
  const room = await readPersonalRoomForOwner(database, options.actorUserId);
  if (room === undefined) {
    refusePersonalRoom("personal-room-unknown", "you do not have a personal room yet");
  }
  return room;
}

/**
 * A new link for the caller's room. The old one stops working at once; a session already open is not
 * touched, because whoever is in it is already in it.
 */
export async function replacePersonalRoomLink(
  database: SqlDatabase,
  options: MeetingServiceOptions,
): Promise<{ linkCode: string; effect: EffectWrite }> {
  const room = await requireOwnRoom(database, options);
  const now = options.clock.now();
  const linkCode = newPersonalRoomLinkCode(options.randomSource);
  return {
    linkCode,
    effect: {
      statements: [
        guarded(
          replacePersonalRoomLinkStatement(database, {
            id: room.id,
            previousLinkCode: room.link_code,
            linkCode,
            now,
          }),
          REPLACE_LINK_GUARD,
        ),
        // The codes themselves stay out of the log: an old code is an address somebody may still
        // be holding, and the log is read more widely than the room.
        domainAuditStatement(database, {
          event: "meetings.personalRoom.linkReplaced",
          subjectId: room.id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {},
        }),
      ],
      outboxMessages: [],
    },
  };
}

/** The owner's standing choices for the sessions their room opens. */
export async function updatePersonalRoomDefaults(
  database: SqlDatabase,
  input: { readonly medium?: MeetingMedium; readonly lobby?: MeetingLobbyMode },
  options: MeetingServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const room = await requireOwnRoom(database, options);
  const medium = input.medium ?? room.medium;
  const lobby = input.lobby ?? room.lobby;
  if (medium === room.medium && lobby === room.lobby) {
    return { effect: { statements: [], outboxMessages: [] } };
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        updatePersonalRoomDefaultsStatement(database, { id: room.id, medium, lobby, now }),
        domainAuditStatement(database, {
          event: "meetings.personalRoom.settingsChanged",
          subjectId: room.id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { medium, lobby },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// WHETHER AN OPEN SESSION IS STILL IN USE. A session nobody has walked into yet is: its owner opened
// it a moment ago and is on the way in. A live one is while anybody is in the room or at its door.
// A live session everybody has left is over in all but name — nothing ends a meeting when the last
// person leaves — so the next Open ends it at the instant the last person left and opens a fresh one,
// rather than putting tomorrow's colleague into yesterday's meeting.
function isInUse(session: PersonalRoomOpenSession): boolean {
  return session.status === "scheduled" || session.present_count > 0;
}

async function endAbandonedSession(
  database: SqlDatabase,
  session: PersonalRoomOpenSession,
  options: MeetingServiceOptions,
): Promise<EffectStatement[]> {
  const meeting = await readMeeting(database, session.id, options.visibility);
  if (meeting === undefined) return [];
  // The session ended when the last person left it, not when its owner came back.
  const endedAt = session.last_left_at ?? session.started_at ?? options.clock.now();
  const stopped = await stopRecordingForMeetingEnd(database, session.id, {
    clock: { now: () => endedAt },
    actorUserId: options.actorUserId,
    randomSource: options.randomSource,
  });
  return [
    guarded(
      endMeetingStatement(database, {
        id: session.id,
        endedByUserId: options.actorUserId,
        now: endedAt,
      }),
      END_MEETING_GUARD,
    ),
    ...(stopped?.effect.statements ?? []),
    domainAuditStatement(database, {
      event: "meetings.meeting.ended",
      subjectId: session.id,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: { startedAt: session.started_at, endedAt, reason: "room-reopened" },
    }),
    ...(await sessionEventSettlement(database, meeting, endedAt)),
  ];
}

export interface OpenPersonalRoomInput {
  // The zone the session's event is written in: the opener's own, which the browser reports. A
  // fixed offset is refused, as on every event.
  readonly timeZone: string;
  // The matter the session is about, when the owner already knows. Without one the session is a firm
  // event and can be moved onto a matter later.
  readonly matterId?: MatterId | null;
  // Whether the session's pictures and sound are sealed end to end, as the deployment decides. Read
  // only when this call opens a session; a session already in use keeps what it was opened with.
  readonly encrypted?: boolean;
}

/**
 * Opening the caller's room: the session's event, the meeting on it with the owner hosting, and the
 * owner on the event's participants — one batch. Opening a room that already has a session in use
 * returns that session and writes nothing, so two tabs pressing Open land in one room; the partial
 * unique index on the meeting holds the same rule underneath for two that arrive together.
 */
export async function openPersonalRoom(
  database: SqlDatabase,
  input: OpenPersonalRoomInput,
  options: MeetingServiceOptions,
): Promise<{
  meetingId: MeetingId;
  created: boolean;
  // The abandoned session this open ended on the way, which the caller tells the room about after
  // the commit; null when there was none.
  endedMeetingId: MeetingId | null;
  effect: EffectWrite;
}> {
  const room = await requireOwnRoom(database, options);
  const open = await readPersonalRoomOpenSession(database, room.id);
  if (open !== undefined && isInUse(open)) {
    return {
      meetingId: open.id,
      created: false,
      endedMeetingId: null,
      effect: { statements: [], outboxMessages: [] },
    };
  }
  if (!isResolvableTimeZone(input.timeZone) || isFixedOffset(input.timeZone)) {
    refuse("meeting-unknown-event", "a session's event needs a named time zone");
  }
  const matterId = input.matterId ?? null;
  if (
    matterId !== null &&
    (await readVisibleMatter(database, matterId, options.visibility)) === undefined
  ) {
    refuse("meeting-unknown-event", "that is not a matter you can open a session on");
  }

  const ending = open === undefined ? [] : await endAbandonedSession(database, open, options);
  const now = options.clock.now();
  const startsAt = zonedReading(Date.parse(now), input.timeZone);
  const ownerName = (await readMemberDisplayName(database, options.actorUserId)) ?? "A colleague";
  const title = personalRoomEventTitle(ownerName);

  const eventStatements: EffectStatement[] = [];
  let eventKind: "matter" | "firm";
  let eventId: MatterEventId | FirmEventId;
  if (matterId !== null) {
    const matterEventId = newIdentifier("matterEvent", options.randomSource);
    eventKind = "matter";
    eventId = matterEventId;
    eventStatements.push(
      insertMatterEventStatement(database, {
        id: matterEventId,
        matterId,
        eventTypeId: null,
        title,
        description: null,
        status: "scheduled",
        startsOn: startsAt.civilDate,
        startsAtTime: startsAt.wallClockTime,
        endsOn: null,
        endsAtTime: null,
        timeZone: input.timeZone,
        locationText: null,
        conferenceUrl: null,
        courtReference: null,
        recurrenceRule: null,
        recordedAt: now,
        recordedBy: options.actorUserId,
        now,
      }),
      insertMatterEventParticipantStatement(database, {
        id: newIdentifier("matterEventParticipant", options.randomSource),
        eventId: matterEventId,
        participantKind: "member",
        memberUserId: options.actorUserId,
        entityId: null,
        participantName: null,
        role: null,
        now,
      }),
      domainAuditStatement(database, {
        event: "calendar.event.created",
        subjectId: matterEventId,
        actorUserId: options.actorUserId,
        clock: options.clock,
        randomSource: options.randomSource,
        metadata: { matterId },
      }),
    );
  } else {
    const firmEventId = newIdentifier("firmEvent", options.randomSource);
    eventKind = "firm";
    eventId = firmEventId;
    eventStatements.push(
      insertFirmEventStatement(database, {
        id: firmEventId,
        eventTypeId: null,
        title,
        description: null,
        status: "scheduled",
        startsOn: startsAt.civilDate,
        startsAtTime: startsAt.wallClockTime,
        endsOn: null,
        endsAtTime: null,
        timeZone: input.timeZone,
        audience: "participants",
        locationId: null,
        locationText: null,
        conferenceUrl: null,
        recurrenceRule: null,
        recordedAt: now,
        recordedBy: options.actorUserId,
        now,
      }),
      insertFirmEventParticipantStatement(database, {
        id: newIdentifier("firmEventParticipant", options.randomSource),
        firmEventId,
        participantKind: "member",
        memberUserId: options.actorUserId,
        entityId: null,
        participantName: null,
        role: null,
        now,
      }),
      domainAuditStatement(database, {
        event: "calendar.firmEvent.created",
        subjectId: firmEventId,
        actorUserId: options.actorUserId,
        clock: options.clock,
        randomSource: options.randomSource,
        metadata: {},
      }),
    );
  }

  const opened = openMeetingOnEvent(
    database,
    {
      eventKind,
      eventId,
      matterId,
      medium: room.medium,
      lobby: room.lobby,
      personalRoomId: room.id,
      encrypted: input.encrypted ?? false,
    },
    options,
  );
  return {
    meetingId: opened.meetingId,
    created: true,
    endedMeetingId: open?.id ?? null,
    effect: {
      statements: [
        ...ending,
        ...eventStatements,
        ...opened.effect.statements,
        domainAuditStatement(database, {
          event: "meetings.personalRoom.opened",
          subjectId: room.id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { meetingId: opened.meetingId, eventKind, eventId, matterId },
        }),
      ],
      outboxMessages: opened.effect.outboxMessages,
    },
  };
}

/** What a room's link answers: whose room it is, and the session to join when one is open. */
export type PersonalRoomArrival =
  | {
      readonly state: "closed";
      readonly ownerDisplayName: string;
      readonly isOwner: boolean;
      readonly addressName: string;
    }
  | {
      readonly state: "open";
      readonly ownerDisplayName: string;
      readonly isOwner: boolean;
      readonly addressName: string;
      readonly meetingId: MeetingId;
    };

async function readLinkedRoom(database: SqlDatabase, linkCode: string) {
  // A string that cannot be a code is refused before any read, with the same answer an unknown code
  // gets, so a probe learns nothing from the difference.
  const room = isPersonalRoomAddress(linkCode)
    ? await readPersonalRoomByAddressName(database, linkCode)
    : undefined;
  if (room === undefined || room.owner_active !== 1) {
    refusePersonalRoom("personal-room-unknown", "that link does not open a room");
  }
  return room;
}

/** What following a room's link shows, without arriving. A read: it writes nothing. */
export async function readPersonalRoomAtLink(
  database: SqlDatabase,
  linkCode: string,
  options: MeetingServiceOptions,
): Promise<PersonalRoomArrival> {
  const room = await readLinkedRoom(database, linkCode);
  const isOwner = room.owner_user_id === options.actorUserId;
  const open = await readPersonalRoomOpenSession(database, room.id);
  const addressName = room.address_name ?? room.link_code;
  if (open === undefined || !isInUse(open)) {
    return { state: "closed", ownerDisplayName: room.owner_display_name, isOwner, addressName };
  }
  return {
    state: "open",
    ownerDisplayName: room.owner_display_name,
    isOwner,
    addressName,
    meetingId: open.id,
  };
}

/**
 * Arriving by a room's link while a session is open: the caller joins the session's event, so it is on
 * their calendar and the event says who was there, and is answered with the meeting to join through
 * the ordinary join path — which is where the door, the lock and the ceiling are decided. A session on
 * a matter the caller may not see is as absent as any walled meeting.
 */
export async function arriveAtPersonalRoom(
  database: SqlDatabase,
  linkCode: string,
  options: MeetingServiceOptions,
): Promise<{ arrival: PersonalRoomArrival; effect: EffectWrite }> {
  const arrival = await readPersonalRoomAtLink(database, linkCode, options);
  const nothing = { statements: [], outboxMessages: [] };
  if (arrival.state === "closed" || arrival.isOwner) return { arrival, effect: nothing };

  const meeting = await readMeeting(database, arrival.meetingId, options.visibility);
  if (meeting === undefined) {
    refuse("meeting-unknown-event", "that is not a meeting you can reach");
  }
  const eventId = meeting.event_kind === "matter" ? meeting.matter_event_id : meeting.firm_event_id;
  if (eventId === null) refuse("meeting-unknown-event", "that is not a meeting you can reach");
  const now = options.clock.now();
  return {
    arrival,
    effect: {
      statements: [
        addSessionParticipantStatement(database, {
          id: newIdentifier(
            meeting.event_kind === "matter" ? "matterEventParticipant" : "firmEventParticipant",
            options.randomSource,
          ),
          eventKind: meeting.event_kind,
          eventId,
          userId: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          event: "meetings.personalRoom.arrived",
          subjectId: meeting.id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { personalRoomId: meeting.personal_room_id },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Moving a personal-room session onto a matter, while it runs or after it ended: a matter event that
 * carries the firm event's title, times and participants; the meeting re-pointed at it, keeping its
 * handle and so everything that hangs from it; and the firm event deleted. One batch, so there is
 * never a moment with two events for one gathering or none.
 *
 * Only a session moves here. An ordinary firm event is the calendar's to edit, and a meeting already
 * on a matter has its matter. The room's owner may move any of its sessions, and whoever is running a
 * session may move that one.
 */
export async function moveSessionToMatter(
  database: SqlDatabase,
  meetingId: MeetingId,
  matterId: MatterId,
  options: MeetingServiceOptions,
): Promise<{ matterEventId: MatterEventId; effect: EffectWrite }> {
  const meeting = await readMeeting(database, meetingId, options.visibility);
  if (meeting === undefined) refuse("meeting-unknown-event", "that is not a meeting you can reach");
  if (
    meeting.personal_room_id === null ||
    meeting.event_kind !== "firm" ||
    meeting.firm_event_id === null
  ) {
    refusePersonalRoom(
      "meeting-move-refused",
      "only a personal-room session that is not on a matter yet can be moved onto one",
    );
  }
  const ownRoom = await readPersonalRoomForOwner(database, options.actorUserId);
  const mayMove =
    ownRoom?.id === meeting.personal_room_id ||
    (await readLiveHostGrant(database, meetingId, options.actorUserId)) !== undefined;
  if (!mayMove) {
    refusePersonalRoom(
      "meeting-move-refused",
      "only the room's owner, or whoever is running this session, can move it onto a matter",
    );
  }
  if ((await readVisibleMatter(database, matterId, options.visibility)) === undefined) {
    refuse("meeting-unknown-event", "that is not a matter you can move a session onto");
  }
  const firmEventId = meeting.firm_event_id;
  const event = await readFirmEventForMove(database, firmEventId);
  if (event === undefined) refuse("meeting-unknown-event", "that is not a meeting you can reach");
  const participants = await readFirmEventParticipantsForMove(database, firmEventId);

  const now = options.clock.now();
  const matterEventId = newIdentifier("matterEvent", options.randomSource);
  return {
    matterEventId,
    effect: {
      statements: [
        insertMatterEventStatement(database, {
          id: matterEventId,
          matterId,
          eventTypeId: null,
          title: event.title,
          description: event.description,
          status: event.status,
          startsOn: event.starts_on,
          startsAtTime: event.starts_at_time,
          endsOn: event.ends_on,
          endsAtTime: event.ends_at_time,
          timeZone: event.time_zone,
          locationText: null,
          conferenceUrl: null,
          courtReference: null,
          recurrenceRule: null,
          recordedAt: now,
          recordedBy: options.actorUserId,
          now,
        }),
        ...participants.map((participant) =>
          insertMatterEventParticipantStatement(database, {
            id: newIdentifier("matterEventParticipant", options.randomSource),
            eventId: matterEventId,
            participantKind: participant.participant_kind,
            memberUserId: participant.member_user_id,
            entityId: participant.entity_id,
            participantName: participant.participant_name,
            role: participant.role,
            now,
          }),
        ),
        guarded(
          moveMeetingToMatterEventStatement(database, {
            meetingId,
            firmEventId,
            matterEventId,
            now,
          }),
          MOVE_TO_MATTER_GUARD,
        ),
        deleteMovedFirmEventParticipantsStatement(database, firmEventId),
        guarded(deleteMovedFirmEventStatement(database, firmEventId), MOVE_DELETE_EVENT_GUARD),
        domainAuditStatement(database, {
          event: "meetings.meeting.movedToMatter",
          subjectId: meetingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { firmEventId, matterEventId, matterId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

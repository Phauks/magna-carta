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
  MeetingPersonalRoomId,
  UserId,
} from "@magna-carta/identifiers/types";
import { readLiveHostGrant } from "./hosting-statements.ts";
import {
  freeRoomAddressName,
  roomAddressFromTitle,
  roomAddressNames,
} from "./meeting-addresses.ts";
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
  insertSharedRoomStatement,
  readRoomById,
  renameRoomStatement,
  retireSharedRoomStatement,
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
  cleanRoomTitle,
  isPersonalRoomAddress,
  newPersonalRoomLinkCode,
  personalRoomEventTitle,
  refusePersonalRoom,
  roomDisplayName,
  type MeetingRoomKind,
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
/** The guard on renaming a room: somebody else renamed or retired it between the read and the write. */
export const RENAME_ROOM_GUARD = "meeting.personalRoom.rename";
/** The guard on retiring a shared room: somebody else retired it first. */
export const RETIRE_ROOM_GUARD = "meeting.personalRoom.retire";

const NOTHING: EffectWrite = { statements: [], outboxMessages: [] };

/**
 * The first free address for a room called `title`, or for a member's own room with no name of its
 * own, the one made from its owner's name. A room keeps the address it has when that is still the
 * first choice, so renaming a room back to what it was called keeps its link.
 */
async function addressFor(
  database: SqlDatabase,
  title: string | null,
  ownerUserId: UserId,
  fallback: string,
  current: string | null,
): Promise<string> {
  const candidates =
    title === null
      ? roomAddressNames((await readMemberDisplayName(database, ownerUserId)) ?? "")
      : roomAddressFromTitle(title);
  if (candidates.length === 0) return fallback;
  if (current !== null && candidates.includes(current)) return current;
  const taken = new Set(await readTakenRoomAddressNames(database, candidates));
  if (current !== null) taken.delete(current);
  return freeRoomAddressName(candidates, taken);
}

function requireTitle(typed: string): string {
  const title = cleanRoomTitle(typed);
  if (title === undefined) {
    refusePersonalRoom("personal-room-invalid-title", "a room's name is 1 to 80 characters");
  }
  return title;
}

async function requireSharedRoom(
  database: SqlDatabase,
  roomId: MeetingPersonalRoomId,
): Promise<MeetingPersonalRoomRow> {
  const room = await readRoomById(database, roomId);
  if (room === undefined || room.kind !== "shared" || room.retired_at !== null) {
    refusePersonalRoom("personal-room-unknown", "that is not one of the firm's rooms");
  }
  return room;
}

/**
 * A ROOM THE FIRM SHARES, such as "Red Room": set up by a member who may host, named for the place,
 * addressed by its name (/room/red-room), and opened by anybody who may host. The caller (the route)
 * has already asked `meetings:host`.
 */
export async function createSharedRoom(
  database: SqlDatabase,
  input: {
    readonly title: string;
    readonly medium?: MeetingMedium;
    readonly lobby?: MeetingLobbyMode;
  },
  options: MeetingServiceOptions,
): Promise<{ roomId: MeetingPersonalRoomId; effect: EffectWrite }> {
  const title = requireTitle(input.title);
  const id = newIdentifier("meetingPersonalRoom", options.randomSource);
  const linkCode = newPersonalRoomLinkCode(options.randomSource);
  const addressName = await addressFor(database, title, options.actorUserId, linkCode, null);
  const now = options.clock.now();
  return {
    roomId: id,
    effect: {
      statements: [
        insertSharedRoomStatement(database, {
          id,
          setUpByUserId: options.actorUserId,
          linkCode,
          addressName,
          title,
          medium: input.medium ?? "video",
          // On by default, like a member's room: a room named for a place is a link that travels.
          lobby: input.lobby ?? "on",
          now,
        }),
        // The name stays out of the log, like a meeting's title: it can say who a room is for.
        domainAuditStatement(database, {
          event: "meetings.personalRoom.created",
          subjectId: id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { kind: "shared" },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * A ROOM'S NAME. `room` is the caller's own room (`own`) or a shared room by its handle, which any
 * member who may host can rename. `null` puts a member's own room back to being called by their name.
 * The address follows the name, and the old one stops working.
 */
export async function renameRoom(
  database: SqlDatabase,
  room: "own" | MeetingPersonalRoomId,
  typed: string | null,
  options: MeetingServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const target =
    room === "own"
      ? await requireOwnRoom(database, options)
      : await requireSharedRoom(database, room);
  const title = typed === null ? null : requireTitle(typed);
  if (title === null && target.kind === "shared") {
    refusePersonalRoom("personal-room-invalid-title", "a shared room always has a name");
  }
  const addressName = await addressFor(
    database,
    title,
    target.owner_user_id,
    target.link_code,
    target.address_name,
  );
  if (title === target.title && addressName === target.address_name) return { effect: NOTHING };
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(
          renameRoomStatement(database, {
            id: target.id,
            previousAddressName: target.address_name,
            title,
            addressName,
            now,
          }),
          RENAME_ROOM_GUARD,
        ),
        domainAuditStatement(database, {
          event: "meetings.personalRoom.renamed",
          subjectId: target.id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { kind: target.kind, addressChanged: addressName !== target.address_name },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/** A shared room's standing choices, changed by any member who may host. */
export async function updateSharedRoomDefaults(
  database: SqlDatabase,
  roomId: MeetingPersonalRoomId,
  input: { readonly medium?: MeetingMedium; readonly lobby?: MeetingLobbyMode },
  options: MeetingServiceOptions,
): Promise<{ effect: EffectWrite }> {
  return changeDefaults(database, await requireSharedRoom(database, roomId), input, options);
}

/**
 * A shared room taken off the firm's list. A session open in it carries on; its address is given up
 * at once, so the link names nothing and the name is free for another room.
 */
export async function retireSharedRoom(
  database: SqlDatabase,
  roomId: MeetingPersonalRoomId,
  options: MeetingServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const room = await requireSharedRoom(database, roomId);
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(retireSharedRoomStatement(database, { id: room.id, now }), RETIRE_ROOM_GUARD),
        domainAuditStatement(database, {
          event: "meetings.personalRoom.retired",
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
  return changeDefaults(database, await requireOwnRoom(database, options), input, options);
}

async function changeDefaults(
  database: SqlDatabase,
  room: MeetingPersonalRoomRow,
  input: { readonly medium?: MeetingMedium; readonly lobby?: MeetingLobbyMode },
  options: MeetingServiceOptions,
): Promise<{ effect: EffectWrite }> {
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
  // The nine digits the session is addressed by, so the caller can open /meeting/482-917-305.
  joinCode: string | null;
  created: boolean;
  // The abandoned session this open ended on the way, which the caller tells the room about after
  // the commit; null when there was none.
  endedMeetingId: MeetingId | null;
  effect: EffectWrite;
}> {
  return openRoomSession(database, await requireOwnRoom(database, options), input, options);
}

/**
 * Opening the room at an address: a member's own room by its owner alone, and a shared room by any
 * member who may host (`mayHost`, which the route reads off the session).
 */
export async function openRoomAtAddress(
  database: SqlDatabase,
  addressName: string,
  input: OpenPersonalRoomInput,
  options: MeetingServiceOptions & { readonly mayHost: boolean },
): ReturnType<typeof openPersonalRoom> {
  const room = await readLinkedRoom(database, addressName);
  if (!mayOpen(room, options.actorUserId, options.mayHost)) {
    refusePersonalRoom("personal-room-not-owner", "only the room's owner opens it");
  }
  return openRoomSession(database, room, input, options);
}

function mayOpen(
  room: { readonly kind: MeetingRoomKind; readonly owner_user_id: UserId },
  userId: UserId,
  mayHost: boolean,
): boolean {
  return room.kind === "shared" ? mayHost : room.owner_user_id === userId;
}

async function openRoomSession(
  database: SqlDatabase,
  room: MeetingPersonalRoomRow,
  input: OpenPersonalRoomInput,
  options: MeetingServiceOptions,
): ReturnType<typeof openPersonalRoom> {
  const open = await readPersonalRoomOpenSession(database, room.id);
  if (open !== undefined && isInUse(open)) {
    return {
      meetingId: open.id,
      joinCode: open.join_code,
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
  // The event says which room it was: a shared room's name, or the name a member gave their own,
  // or, for a member's room they never named, whose it is.
  const ownerName = (await readMemberDisplayName(database, room.owner_user_id)) ?? "A colleague";
  const title = room.title ?? personalRoomEventTitle(ownerName);

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
    joinCode: opened.joinCode,
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
interface RoomAtLinkFacts {
  readonly ownerDisplayName: string;
  readonly isOwner: boolean;
  readonly addressName: string;
  // What the room is called, and whether it is the firm's rather than a member's.
  readonly roomName: string;
  readonly kind: MeetingRoomKind;
  // Whether the caller may open it: its owner for a member's room, anybody who may host for a shared one.
  readonly mayOpen: boolean;
}

export type PersonalRoomArrival =
  | (RoomAtLinkFacts & { readonly state: "closed" })
  | (RoomAtLinkFacts & {
      readonly state: "open";
      readonly meetingId: MeetingId;
      readonly joinCode: string | null;
    });

async function readLinkedRoom(database: SqlDatabase, linkCode: string) {
  // A string that cannot be a code is refused before any read, with the same answer an unknown code
  // gets, so a probe learns nothing from the difference.
  const room = isPersonalRoomAddress(linkCode)
    ? await readPersonalRoomByAddressName(database, linkCode)
    : undefined;
  // A member's room goes when they leave the firm; a shared room is the firm's and does not.
  if (room === undefined || (room.kind === "personal" && room.owner_active !== 1)) {
    refusePersonalRoom("personal-room-unknown", "that link does not open a room");
  }
  return room;
}

/** What following a room's link shows, without arriving. A read: it writes nothing. */
export async function readPersonalRoomAtLink(
  database: SqlDatabase,
  linkCode: string,
  options: MeetingServiceOptions & { readonly mayHost?: boolean },
): Promise<PersonalRoomArrival> {
  const room = await readLinkedRoom(database, linkCode);
  const facts: RoomAtLinkFacts = {
    ownerDisplayName: room.owner_display_name,
    isOwner: room.kind === "personal" && room.owner_user_id === options.actorUserId,
    addressName: room.address_name ?? room.link_code,
    roomName: roomDisplayName(room, room.owner_display_name),
    kind: room.kind,
    mayOpen: mayOpen(room, options.actorUserId, options.mayHost ?? false),
  };
  const open = await readPersonalRoomOpenSession(database, room.id);
  if (open === undefined || !isInUse(open)) return { ...facts, state: "closed" };
  return { ...facts, state: "open", meetingId: open.id, joinCode: open.join_code };
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
  options: MeetingServiceOptions & { readonly mayHost?: boolean },
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

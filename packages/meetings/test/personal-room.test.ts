import { describe, expect, it } from "vitest";
import type { MeetingId } from "@magna-carta/identifiers/types";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import { createMeeting, endMeeting, joinMeeting, leaveMeeting } from "../src/meeting-service.ts";
import { readMeeting } from "../src/meeting-statements.ts";
import {
  arriveAtPersonalRoom,
  ensurePersonalRoom,
  moveSessionToMatter,
  openPersonalRoom,
  readPersonalRoomAtLink,
  replacePersonalRoomLink,
  updatePersonalRoomDefaults,
} from "../src/personal-room-service.ts";
import { readPersonalRoomForOwner } from "../src/personal-room-statements.ts";
import {
  isPersonalRoomLinkCode,
  MeetingPersonalRoomRefusedError,
  newPersonalRoomLinkCode,
} from "../src/personal-room-types.ts";
import { MeetingValidationError } from "../src/validation.ts";
import {
  FIRM_EVENT,
  GUEST,
  HOLDING_MATTER,
  HOST,
  MATTER,
  commit,
  migratedDatabase,
  options,
  optionsFor,
  seedFirm,
  visibility,
} from "./support.ts";

const ZONE = "America/Los_Angeles";

function fresh() {
  const database = migratedDatabase();
  seedFirm(database.raw);
  return database;
}

type Fixture = ReturnType<typeof fresh>;

async function makeRoom(database: Fixture, serviceOptions = options) {
  const { effect } = await ensurePersonalRoom(database.database, serviceOptions);
  await commit(database.database, effect);
  const room = await readPersonalRoomForOwner(database.database, serviceOptions.actorUserId);
  if (room === undefined) throw new Error("the room was not made");
  return room;
}

async function open(
  database: Fixture,
  input: { matterId?: typeof MATTER } = {},
  serviceOptions = options,
): Promise<{ meetingId: MeetingId; created: boolean }> {
  const { meetingId, created, effect } = await openPersonalRoom(
    database.database,
    { timeZone: ZONE, ...input },
    serviceOptions,
  );
  await commit(database.database, effect);
  return { meetingId, created };
}

function firmEventOf(database: Fixture, meetingId: MeetingId) {
  return database.raw
    .prepare(
      `SELECT firm_event.* FROM firm_event JOIN meeting ON meeting.firm_event_id = firm_event.id WHERE meeting.id = ?`,
    )
    .get(meetingId) as Record<string, unknown> | undefined;
}

describe("the link code", () => {
  it("is ten characters from an alphabet with no look-alikes", () => {
    const code = newPersonalRoomLinkCode(seededRandomSource("room"));
    expect(code).toHaveLength(10);
    expect(isPersonalRoomLinkCode(code)).toBe(true);
    expect(code).not.toMatch(/[01ilo]/);
    expect(isPersonalRoomLinkCode("ABCDEFGHJK")).toBe(false);
    expect(isPersonalRoomLinkCode("short")).toBe(false);
  });
});

describe("a member's room", () => {
  it("is made once, with the door on by default", async () => {
    const database = fresh();
    const room = await makeRoom(database);
    expect(room.owner_user_id).toBe(HOST);
    expect(room.lobby).toBe("on");
    expect(room.medium).toBe("video");

    const again = await ensurePersonalRoom(database.database, options);
    expect(again.room?.id).toBe(room.id);
    expect(again.effect.statements).toHaveLength(0);
  });

  it("takes new defaults, and a new link that retires the old one", async () => {
    const database = fresh();
    const room = await makeRoom(database);
    const defaults = await updatePersonalRoomDefaults(
      database.database,
      { lobby: "off", medium: "audio" },
      options,
    );
    await commit(database.database, defaults.effect);
    const replaced = await replacePersonalRoomLink(database.database, options);
    await commit(database.database, replaced.effect);

    const after = await readPersonalRoomForOwner(database.database, HOST);
    expect(after?.lobby).toBe("off");
    expect(after?.medium).toBe("audio");
    expect(after?.link_code).toBe(replaced.linkCode);
    expect(after?.link_code).not.toBe(room.link_code);
    await expect(
      readPersonalRoomAtLink(database.database, room.link_code, optionsFor(GUEST)),
    ).rejects.toBeInstanceOf(MeetingPersonalRoomRefusedError);
  });
});

describe("opening a session", () => {
  it("writes a firm event titled for the owner, starting now in their zone, with the owner on it", async () => {
    const database = fresh();
    const room = await makeRoom(database);
    const { meetingId, created } = await open(database);
    expect(created).toBe(true);

    const meeting = await readMeeting(database.database, meetingId, visibility);
    expect(meeting?.personal_room_id).toBe(room.id);
    expect(meeting?.event_kind).toBe("firm");
    expect(meeting?.lobby).toBe("on");

    const event = firmEventOf(database, meetingId);
    expect(event?.["title"]).toMatch(/'s room$/);
    // 12:00 UTC on 18 September is 05:00 in Los Angeles, on daylight time.
    expect(event?.["starts_on"]).toBe("2026-09-18");
    expect(event?.["starts_at_time"]).toBe("05:00");
    expect(event?.["time_zone"]).toBe(ZONE);
    expect(event?.["ends_on"]).toBeNull();
    const participants = database.raw
      .prepare(`SELECT member_user_id FROM firm_event_participant WHERE firm_event_id = ?`)
      .all(event?.["id"]) as { member_user_id: string }[];
    expect(participants.map((row) => row.member_user_id)).toEqual([HOST]);
  });

  it("returns the session already in use rather than opening a second", async () => {
    const database = fresh();
    await makeRoom(database);
    const first = await open(database);
    const second = await open(database);
    expect(second.created).toBe(false);
    expect(second.meetingId).toBe(first.meetingId);
  });

  it("ends a session everybody has left, at the moment the last person left, and opens a fresh one", async () => {
    const database = fresh();
    await makeRoom(database);
    const first = await open(database);
    const joined = await joinMeeting(database.database, first.meetingId, options);
    await commit(database.database, joined.effect);
    const leftAt = "2026-09-18T12:20:00.000Z";
    const left = await leaveMeeting(database.database, first.meetingId, {
      ...options,
      clock: { now: () => leftAt },
    });
    await commit(database.database, left.effect);

    const next = await open(database, {}, { ...options, clock: { now: () => "2026-09-19T09:00:00.000Z" } });
    expect(next.created).toBe(true);
    expect(next.meetingId).not.toBe(first.meetingId);
    const old = await readMeeting(database.database, first.meetingId, visibility);
    expect(old?.status).toBe("ended");
    expect(old?.ended_at).toBe(leftAt);
    // The old event ends when the session did, in its own zone.
    const event = firmEventOf(database, first.meetingId);
    expect(event?.["status"]).toBe("occurred");
    expect(event?.["ends_on"]).toBe("2026-09-18");
    expect(event?.["ends_at_time"]).toBe("05:20");
  });

  it("can be opened on a matter the owner may see, and not on one they may not", async () => {
    const database = fresh();
    await makeRoom(database);
    const { meetingId } = await open(database, { matterId: MATTER });
    const meeting = await readMeeting(database.database, meetingId, visibility);
    expect(meeting?.event_kind).toBe("matter");

    const other = fresh();
    await makeRoom(other);
    await expect(open(other, { matterId: HOLDING_MATTER })).rejects.toBeInstanceOf(
      MeetingValidationError,
    );
  });

  it("is only the owner's to open", async () => {
    const database = fresh();
    await makeRoom(database);
    await expect(open(database, {}, optionsFor(GUEST))).rejects.toBeInstanceOf(
      MeetingPersonalRoomRefusedError,
    );
  });
});

describe("arriving by the link", () => {
  it("says the room is closed until its owner opens it", async () => {
    const database = fresh();
    const room = await makeRoom(database);
    const arrival = await readPersonalRoomAtLink(database.database, room.link_code, optionsFor(GUEST));
    expect(arrival.state).toBe("closed");
    expect(arrival.isOwner).toBe(false);
  });

  it("puts a colleague on the session's event and hands back the meeting to join", async () => {
    const database = fresh();
    const room = await makeRoom(database);
    const { meetingId } = await open(database);
    const { arrival, effect } = await arriveAtPersonalRoom(
      database.database,
      room.link_code,
      optionsFor(GUEST),
    );
    await commit(database.database, effect);
    expect(arrival.state === "open" && arrival.meetingId).toBe(meetingId);

    // Twice is still once on the event.
    const again = await arriveAtPersonalRoom(database.database, room.link_code, optionsFor(GUEST));
    await commit(database.database, again.effect);
    const event = firmEventOf(database, meetingId);
    const participants = database.raw
      .prepare(`SELECT member_user_id FROM firm_event_participant WHERE firm_event_id = ? ORDER BY member_user_id`)
      .all(event?.["id"]) as { member_user_id: string }[];
    expect(participants.map((row) => row.member_user_id).toSorted()).toEqual([GUEST, HOST].toSorted());
  });

  it("refuses a code that names nothing, with the same answer as a malformed one", async () => {
    const database = fresh();
    await expect(
      readPersonalRoomAtLink(database.database, "abcdefghjk", options),
    ).rejects.toMatchObject({ code: "personal-room-unknown" });
    await expect(
      readPersonalRoomAtLink(database.database, "../../etc", options),
    ).rejects.toMatchObject({ code: "personal-room-unknown" });
  });
});

describe("moving a session onto a matter", () => {
  it("carries the event across, keeps the meeting's handle, and deletes the firm event", async () => {
    const database = fresh();
    await makeRoom(database);
    const { meetingId } = await open(database);
    const firmEventId = firmEventOf(database, meetingId)?.["id"];

    const moved = await moveSessionToMatter(database.database, meetingId, MATTER, options);
    await commit(database.database, moved.effect);

    const meeting = await readMeeting(database.database, meetingId, visibility);
    expect(meeting?.event_kind).toBe("matter");
    expect(meeting?.matter_event_id).toBe(moved.matterEventId);
    expect(meeting?.firm_event_id).toBeNull();
    const event = database.raw
      .prepare(`SELECT matter_id, title, starts_at_time, time_zone FROM matter_event WHERE id = ?`)
      .get(moved.matterEventId) as Record<string, unknown>;
    expect(event["matter_id"]).toBe(MATTER);
    expect(event["title"]).toMatch(/'s room$/);
    expect(event["time_zone"]).toBe(ZONE);
    expect(database.raw.prepare(`SELECT id FROM firm_event WHERE id = ?`).get(firmEventId)).toBeUndefined();
  });

  it("works after the session ended, and the event keeps the end it was given", async () => {
    const database = fresh();
    await makeRoom(database);
    const { meetingId } = await open(database);
    const ended = await endMeeting(database.database, meetingId, {
      ...options,
      clock: { now: () => "2026-09-18T13:00:00.000Z" },
    });
    await commit(database.database, ended.effect);
    const moved = await moveSessionToMatter(database.database, meetingId, MATTER, options);
    await commit(database.database, moved.effect);
    const event = database.raw
      .prepare(`SELECT status, ends_at_time FROM matter_event WHERE id = ?`)
      .get(moved.matterEventId) as Record<string, unknown>;
    expect(event["status"]).toBe("occurred");
    expect(event["ends_at_time"]).toBe("06:00");
  });

  it("refuses an ordinary meeting, a session already on a matter, and a colleague who is not running it", async () => {
    const database = fresh();
    await makeRoom(database);
    const ordinary = await createMeeting(
      database.database,
      { eventKind: "firm", eventId: FIRM_EVENT },
      options,
    );
    await commit(database.database, ordinary.effect);
    await expect(
      moveSessionToMatter(database.database, ordinary.meetingId, MATTER, options),
    ).rejects.toMatchObject({ code: "meeting-move-refused" });

    const { meetingId } = await open(database);
    await expect(
      moveSessionToMatter(database.database, meetingId, MATTER, optionsFor(GUEST)),
    ).rejects.toMatchObject({ code: "meeting-move-refused" });

    const moved = await moveSessionToMatter(database.database, meetingId, MATTER, options);
    await commit(database.database, moved.effect);
    await expect(
      moveSessionToMatter(database.database, meetingId, MATTER, options),
    ).rejects.toMatchObject({ code: "meeting-move-refused" });
  });
});

describe("ending a session", () => {
  it("gives its event an end and marks it as having happened", async () => {
    const database = fresh();
    await makeRoom(database);
    const { meetingId } = await open(database);
    const ended = await endMeeting(database.database, meetingId, {
      ...options,
      clock: { now: () => "2026-09-18T12:45:00.000Z" },
    });
    await commit(database.database, ended.effect);
    const event = firmEventOf(database, meetingId);
    expect(event?.["status"]).toBe("occurred");
    expect(event?.["ends_on"]).toBe("2026-09-18");
    expect(event?.["ends_at_time"]).toBe("05:45");
  });

  it("leaves an ordinary meeting's event exactly as it was written", async () => {
    const database = fresh();
    const ordinary = await createMeeting(
      database.database,
      { eventKind: "firm", eventId: FIRM_EVENT },
      options,
    );
    await commit(database.database, ordinary.effect);
    const before = database.raw.prepare(`SELECT * FROM firm_event WHERE id = ?`).get(FIRM_EVENT);
    const ended = await endMeeting(database.database, ordinary.meetingId, options);
    await commit(database.database, ended.effect);
    const after = database.raw.prepare(`SELECT * FROM firm_event WHERE id = ?`).get(FIRM_EVENT);
    expect(after).toEqual(before);
  });
});

import { describe, expect, it } from "vitest";
import type { MeetingId } from "@magna-carta/identifiers/types";
import { createMeeting, endMeeting, joinMeeting, leaveMeeting } from "../src/meeting-service.ts";
import {
  listAttendance,
  readMeeting,
  readMeetingForEvent,
  readMeetingSummary,
} from "../src/meeting-statements.ts";
import { MAX_MEETING_PARTICIPANTS } from "../src/types.ts";
import { MeetingValidationError } from "../src/validation.ts";
import {
  CROWD,
  FIRM_EVENT,
  GUEST,
  HOST,
  MATTER,
  MATTER_EVENT,
  WALLED_MATTER_EVENT,
  END_INSTANT,
  clock,
  commit,
  endClock,
  migratedDatabase,
  options,
  optionsFor,
  seedFirm,
  tickingClock,
  visibility,
} from "./support.ts";

function fresh() {
  const database = migratedDatabase();
  seedFirm(database.raw);
  return database;
}

async function start(
  database: ReturnType<typeof fresh>,
  eventKind: "matter" | "firm" = "matter",
  eventId: string = MATTER_EVENT,
): Promise<MeetingId> {
  const { meetingId, effect } = await createMeeting(
    database.database,
    { eventKind, eventId },
    options,
  );
  await commit(database.database, effect);
  return meetingId;
}

async function join(
  database: ReturnType<typeof fresh>,
  meetingId: MeetingId,
  serviceOptions = options,
): Promise<string> {
  const { attendanceId, effect } = await joinMeeting(database.database, meetingId, serviceOptions);
  await commit(database.database, effect);
  return attendanceId;
}

describe("starting a meeting on an event", () => {
  it("creates the room and leaves it scheduled until somebody arrives", async () => {
    const database = fresh();
    const meetingId = await start(database);

    const row = await readMeeting(database.database, meetingId, visibility);
    expect(row?.event_kind).toBe("matter");
    expect(row?.matter_event_id).toBe(MATTER_EVENT);
    expect(row?.firm_event_id).toBeNull();
    // A room is not live because somebody made it. Nobody has walked into this one.
    expect(row?.status).toBe("scheduled");
    expect(row?.started_at).toBeNull();
    expect(row?.created_by_user_id).toBe(HOST);
  });

  it("carries the event's own title and window rather than a copy of its own", async () => {
    const database = fresh();
    const meetingId = await start(database);

    const summary = await readMeetingSummary(database.database, meetingId, visibility);
    expect(summary?.title).toBe("Settlement conference");
    expect(summary?.startsOn).toBe("2026-09-21");
    expect(summary?.startsAtTime).toBe("09:30");
    expect(summary?.endsAtTime).toBe("10:30");
    expect(summary?.timeZone).toBe("America/Los_Angeles");
    expect(summary?.matterId).toBe(MATTER);
    expect(summary?.liveCount).toBe(0);
  });

  it("is idempotent per event: a second Start returns the first member's room", async () => {
    const database = fresh();
    const first = await start(database);

    const second = await createMeeting(
      database.database,
      { eventKind: "matter", eventId: MATTER_EVENT },
      optionsFor(GUEST),
    );
    expect(second.meetingId).toBe(first);
    expect(second.created).toBe(false);
    // Nothing is written the second time, so the room keeps the member who actually opened it.
    expect(second.effect.statements).toHaveLength(0);
    await commit(database.database, second.effect);

    const row = await readMeeting(database.database, first, visibility);
    expect(row?.created_by_user_id).toBe(HOST);
  });

  it("works on a firm event, which has no matter at all", async () => {
    const database = fresh();
    const meetingId = await start(database, "firm", FIRM_EVENT);

    const summary = await readMeetingSummary(database.database, meetingId, visibility);
    expect(summary?.eventKind).toBe("firm");
    expect(summary?.eventId).toBe(FIRM_EVENT);
    // The whole reason both permission keys bind the firm rather than a matter.
    expect(summary?.matterId).toBeNull();
    expect(summary?.title).toBe("Monday staff meeting");

    const found = await readMeetingForEvent(database.database, "firm", FIRM_EVENT, visibility);
    expect(found?.id).toBe(meetingId);
  });

  it("refuses an event on a matter the member may not see, in the same words as one that does not exist", async () => {
    const database = fresh();

    const walled = await createMeeting(
      database.database,
      { eventKind: "matter", eventId: WALLED_MATTER_EVENT },
      options,
    ).catch((error: unknown) => error);
    const absent = await createMeeting(
      database.database,
      { eventKind: "matter", eventId: "matterEvent_nothingAtAll00" },
      options,
    ).catch((error: unknown) => error);

    expect(walled).toBeInstanceOf(MeetingValidationError);
    expect(absent).toBeInstanceOf(MeetingValidationError);
    expect((walled as MeetingValidationError).code).toBe("meeting-unknown-event");
    // Indistinguishable by design: a different refusal would make the route an existence oracle.
    expect((absent as MeetingValidationError).message).toBe(
      (walled as MeetingValidationError).message,
    );
  });
});

describe("arriving", () => {
  it("the first join flips the room live and sets when the first person arrived", async () => {
    const database = fresh();
    const meetingId = await start(database);

    await join(database, meetingId);

    const row = await readMeeting(database.database, meetingId, visibility);
    expect(row?.status).toBe("live");
    expect(row?.started_at).toBe(clock.now());

    // The second arrival does not move it: the room started when the first person got there.
    await join(database, meetingId, optionsFor(GUEST, tickingClock()));
    const after = await readMeeting(database.database, meetingId, visibility);
    expect(after?.started_at).toBe(clock.now());

    const summary = await readMeetingSummary(database.database, meetingId, visibility);
    expect(summary?.liveCount).toBe(2);
  });

  it("a member who is already in the room gets their own stay back rather than a second one", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const first = await join(database, meetingId);

    const again = await join(database, meetingId);
    expect(again).toBe(first);
    expect(await listAttendance(database.database, meetingId)).toHaveLength(1);
  });

  it("refuses the thirteenth person, counting the stays that are still open", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const ticking = tickingClock();

    for (const member of CROWD.slice(0, MAX_MEETING_PARTICIPANTS)) {
      await join(database, meetingId, optionsFor(member, ticking));
    }
    const summary = await readMeetingSummary(database.database, meetingId, visibility);
    expect(summary?.liveCount).toBe(MAX_MEETING_PARTICIPANTS);

    const refused = await joinMeeting(
      database.database,
      meetingId,
      optionsFor(CROWD[MAX_MEETING_PARTICIPANTS] as (typeof CROWD)[number], ticking),
    ).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(MeetingValidationError);
    expect((refused as MeetingValidationError).code).toBe("meeting-room-full");

    // And a seat freed by somebody leaving lets the next person in, which is what makes the cap a
    // count of who is present rather than of who has ever been here.
    const leaving = await leaveMeeting(
      database.database,
      meetingId,
      optionsFor(CROWD[0] as (typeof CROWD)[number], ticking),
    );
    await commit(database.database, leaving.effect);
    await join(
      database,
      meetingId,
      optionsFor(CROWD[MAX_MEETING_PARTICIPANTS] as (typeof CROWD)[number], ticking),
    );
    const refilled = await readMeetingSummary(database.database, meetingId, visibility);
    expect(refilled?.liveCount).toBe(MAX_MEETING_PARTICIPANTS);
  });
});

describe("leaving", () => {
  it("closes the caller's stay and nobody else's", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const ticking = tickingClock();
    await join(database, meetingId, optionsFor(HOST, ticking));
    await join(database, meetingId, optionsFor(GUEST, ticking));

    const { effect } = await leaveMeeting(database.database, meetingId, optionsFor(HOST, ticking));
    await commit(database.database, effect);

    const stays = await listAttendance(database.database, meetingId);
    expect(stays.find((stay) => stay.user_id === HOST)?.left_at).not.toBeNull();
    expect(stays.find((stay) => stay.user_id === GUEST)?.left_at).toBeNull();

    const summary = await readMeetingSummary(database.database, meetingId, visibility);
    expect(summary?.liveCount).toBe(1);
    // The room stays live while somebody is still in it.
    expect(summary?.status).toBe("live");
  });

  it("refuses a member who is not in the room", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId);

    const refused = await leaveMeeting(database.database, meetingId, optionsFor(GUEST)).catch(
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(MeetingValidationError);
    expect((refused as MeetingValidationError).code).toBe("meeting-not-joined");
  });

  it("refuses a room nobody has walked into", async () => {
    const database = fresh();
    const meetingId = await start(database);

    const refused = await leaveMeeting(database.database, meetingId, options).catch(
      (error: unknown) => error,
    );
    expect((refused as MeetingValidationError).code).toBe("meeting-not-live");
  });
});

describe("ending it", () => {
  it("closes every open stay at one instant and records who ended it", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const ticking = tickingClock();
    await join(database, meetingId, optionsFor(HOST, ticking));
    await join(database, meetingId, optionsFor(GUEST, ticking));
    await join(database, meetingId, optionsFor(CROWD[0] as (typeof CROWD)[number], ticking));

    // One member leaves first, so the end has both an already-closed stay and two open ones to deal
    // with — the shape that catches an end written as a blanket overwrite.
    const early = await leaveMeeting(
      database.database,
      meetingId,
      optionsFor(CROWD[0] as (typeof CROWD)[number], ticking),
    );
    await commit(database.database, early.effect);
    const earlyLeft = (await listAttendance(database.database, meetingId)).find(
      (stay) => stay.user_id === CROWD[0],
    )?.left_at;

    const { effect } = await endMeeting(database.database, meetingId, optionsFor(HOST, endClock));
    await commit(database.database, effect);

    const row = await readMeeting(database.database, meetingId, visibility);
    expect(row?.status).toBe("ended");
    expect(row?.ended_at).toBe(END_INSTANT);
    expect(row?.ended_by_user_id).toBe(HOST);

    const stays = await listAttendance(database.database, meetingId);
    expect(stays).toHaveLength(3);
    expect(stays.every((stay) => stay.left_at !== null)).toBe(true);
    // The two who were still here left at the same instant, because the meeting ended once.
    const closedByTheEnd = stays
      .filter((stay) => stay.user_id !== CROWD[0])
      .map((stay) => stay.left_at);
    expect(new Set(closedByTheEnd)).toEqual(new Set([END_INSTANT]));
    // The member who had already gone keeps the instant they actually went.
    expect(stays.find((stay) => stay.user_id === CROWD[0])?.left_at).toBe(earlyLeft);

    const summary = await readMeetingSummary(database.database, meetingId, visibility);
    expect(summary?.liveCount).toBe(0);
  });

  it("closes a room nobody joined, so a mistaken Start does not block the event forever", async () => {
    const database = fresh();
    const meetingId = await start(database);

    const { effect } = await endMeeting(database.database, meetingId, options);
    await commit(database.database, effect);

    const row = await readMeeting(database.database, meetingId, visibility);
    expect(row?.status).toBe("ended");
    expect(row?.started_at).toBeNull();
  });

  it("refuses every act on a meeting that has ended", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId);
    const { effect } = await endMeeting(database.database, meetingId, options);
    await commit(database.database, effect);

    for (const act of [
      () => joinMeeting(database.database, meetingId, optionsFor(GUEST)),
      () => leaveMeeting(database.database, meetingId, options),
      () => endMeeting(database.database, meetingId, options),
    ]) {
      const refused = await act().catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(MeetingValidationError);
      expect((refused as MeetingValidationError).code).toBe("meeting-already-ended");
    }
  });
});

describe("reaching a room at all", () => {
  it("a meeting on a matter the member may not see is refused as an unknown event", async () => {
    const database = fresh();
    // Opened while the matter was reachable, then read back under a predicate that walls it. The
    // holding matter is walled from every read, so the room behind it is unreachable by id.
    database.raw.exec(
      `INSERT INTO meeting (id, event_kind, matter_event_id, firm_event_id, status, created_by_user_id, created_at, updated_at) ` +
        `VALUES ('meeting_walledRoom000000000', 'matter', '${WALLED_MATTER_EVENT}', NULL, 'scheduled', '${HOST}', '2026-09-18T11:00:00.000Z', '2026-09-18T11:00:00.000Z')`,
    );
    const walledMeeting = "meeting_walledRoom000000000" as MeetingId;

    expect(await readMeeting(database.database, walledMeeting, visibility)).toBeUndefined();
    expect(await readMeetingSummary(database.database, walledMeeting, visibility)).toBeUndefined();

    const refused = await joinMeeting(database.database, walledMeeting, options).catch(
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(MeetingValidationError);
    expect((refused as MeetingValidationError).code).toBe("meeting-unknown-event");
  });

  it("an event nobody has started has no meeting, which is not an error", async () => {
    const database = fresh();
    expect(
      await readMeetingForEvent(database.database, "matter", MATTER_EVENT, visibility),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import type { MatterEventId, MeetingAttendanceId, MeetingId } from "@magna-carta/identifiers/types";
import {
  closeAttendanceAfterSocketLoss,
  createMeeting,
  endMeeting,
  JOIN_CAPACITY_GUARD,
  joinMeeting,
  leaveMeeting,
} from "../src/meeting-service.ts";
import {
  isOpenStayConflict,
  listAttendance,
  listMeetings,
  MAX_ATTENDANCE_PAGE_SIZE,
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
    expect(
      await listAttendance(database.database, meetingId, { limit: MAX_ATTENDANCE_PAGE_SIZE }),
    ).toHaveLength(1);
  });

  it("refuses the arrival past the cap, counting the stays that are still open", async () => {
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

    const stays = await listAttendance(database.database, meetingId, {
      limit: MAX_ATTENDANCE_PAGE_SIZE,
    });
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
    const earlyLeft = (
      await listAttendance(database.database, meetingId, { limit: MAX_ATTENDANCE_PAGE_SIZE })
    ).find((stay) => stay.user_id === CROWD[0])?.left_at;

    const { effect } = await endMeeting(database.database, meetingId, optionsFor(HOST, endClock));
    await commit(database.database, effect);

    const row = await readMeeting(database.database, meetingId, visibility);
    expect(row?.status).toBe("ended");
    expect(row?.ended_at).toBe(END_INSTANT);
    expect(row?.ended_by_user_id).toBe(HOST);

    const stays = await listAttendance(database.database, meetingId, {
      limit: MAX_ATTENDANCE_PAGE_SIZE,
    });
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

describe("a meeting has a medium, and it is decided once", () => {
  it("records a call as a call, and a meeting it did not ask about as a video meeting", async () => {
    const database = fresh();
    const call = await createMeeting(
      database.database,
      { eventKind: "matter", eventId: MATTER_EVENT, medium: "audio" },
      options,
    );
    await commit(database.database, call.effect);
    expect((await readMeetingSummary(database.database, call.meetingId, visibility))?.medium).toBe(
      "audio",
    );

    // A caller that has not heard of calls keeps getting what it has always got.
    const meeting = await createMeeting(
      database.database,
      { eventKind: "firm", eventId: FIRM_EVENT },
      options,
    );
    await commit(database.database, meeting.effect);
    expect(
      (await readMeetingSummary(database.database, meeting.meetingId, visibility))?.medium,
    ).toBe("video");
  });

  it("does not change a room's medium when somebody presses Start again asking for the other", async () => {
    const database = fresh();
    const call = await createMeeting(
      database.database,
      { eventKind: "matter", eventId: MATTER_EVENT, medium: "audio" },
      options,
    );
    await commit(database.database, call.effect);

    // ONE MEETING PER EVENT, so the first Start decides. Widening it here would switch a camera on
    // for everybody already in the call, on the strength of somebody else's click.
    const again = await createMeeting(
      database.database,
      { eventKind: "matter", eventId: MATTER_EVENT, medium: "video" },
      options,
    );
    expect(again.created).toBe(false);
    expect(again.meetingId).toBe(call.meetingId);
    expect(again.effect.statements).toHaveLength(0);
    expect((await readMeetingSummary(database.database, call.meetingId, visibility))?.medium).toBe(
      "audio",
    );
  });

  it("puts the medium on the audit row as a label, beside the identifiers", async () => {
    const database = fresh();
    const call = await createMeeting(
      database.database,
      { eventKind: "matter", eventId: MATTER_EVENT, medium: "audio" },
      options,
    );
    await commit(database.database, call.effect);

    const audit = database.raw
      .prepare(`SELECT metadata FROM audit_log WHERE event = 'meetings.meeting.created' LIMIT 1`)
      .get() as { metadata: string } | undefined;
    const metadata = JSON.parse(audit?.metadata ?? "{}") as Record<string, unknown>;
    expect(metadata["medium"]).toBe("audio");
  });
});

describe("the races the read-then-write cannot span", () => {
  it("refuses the stay past the cap at the DATABASE, so a concurrent join cannot slip past the count", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const ticking = tickingClock();
    for (const member of CROWD.slice(0, MAX_MEETING_PARTICIPANTS)) {
      await join(database, meetingId, optionsFor(member, ticking));
    }

    // The effect is built while there is still a seat free and committed after there is not, which
    // is exactly what two browsers joining together produce: both services read one seat free, both
    // pass. Staged here by freeing a seat, building a join against the room while it is free, and
    // filling it from elsewhere before the commit.
    const spare = CROWD[MAX_MEETING_PARTICIPANTS] as (typeof CROWD)[number];
    const leaving = await leaveMeeting(
      database.database,
      meetingId,
      optionsFor(CROWD[0] as (typeof CROWD)[number], ticking),
    );
    await commit(database.database, leaving.effect);
    const staged = await joinMeeting(database.database, meetingId, optionsFor(spare, ticking));
    // Somebody else takes the free seat between the read and the commit.
    await join(database, meetingId, optionsFor(GUEST, ticking));

    const refused = await commit(database.database, staged.effect).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(GuardedWriteRefusedError);
    expect((refused as GuardedWriteRefusedError).guard).toBe(JOIN_CAPACITY_GUARD);

    // The WHOLE batch rolled back: no stay, and no audit row saying somebody arrived. Counted in
    // SQL rather than read through the attendance page, which is a page — a room at the ceiling
    // holds more stays than one of those carries, and a walk of them would be testing pagination.
    const summary = await readMeetingSummary(database.database, meetingId, visibility);
    expect(summary?.liveCount).toBe(MAX_MEETING_PARTICIPANTS);
    const spareStays = database.raw
      .prepare(`SELECT COUNT(*) AS present FROM meeting_attendance WHERE user_id = ?`)
      .get(spare) as { present: number };
    expect(spareStays.present).toBe(0);
    const spareArrivals = database.raw
      .prepare(
        `SELECT COUNT(*) AS present FROM audit_log WHERE event = 'meetings.meeting.joined' AND actor_user_id = ?`,
      )
      .get(spare) as { present: number };
    expect(spareArrivals.present).toBe(0);
  });

  it("refuses a second OPEN stay for one member, and allows a second closed one", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const ticking = tickingClock();
    await join(database, meetingId, optionsFor(HOST, ticking));

    // Two joins built against the same empty read — the double-clicked button. The second insert
    // meets the partial unique index rather than a second seat.
    const doubled = await joinMeeting(database.database, meetingId, optionsFor(GUEST, ticking));
    await join(database, meetingId, optionsFor(GUEST, ticking));
    const refused = await commit(database.database, doubled.effect).catch(
      (error: unknown) => error,
    );
    expect(isOpenStayConflict(refused)).toBe(true);

    // And the rule is about the OPEN stay only: a member who leaves and comes back has two rows,
    // which is what happened.
    const leaving = await leaveMeeting(database.database, meetingId, optionsFor(GUEST, ticking));
    await commit(database.database, leaving.effect);
    await join(database, meetingId, optionsFor(GUEST, ticking));
    const stays = await listAttendance(database.database, meetingId, {
      limit: MAX_ATTENDANCE_PAGE_SIZE,
    });
    expect(stays.filter((stay) => stay.user_id === GUEST)).toHaveLength(2);
  });
});

describe("a stay closed by the room after a connection went away", () => {
  it("closes it, and says on the record that nobody pressed anything", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const ticking = tickingClock();
    const attendanceId = await join(database, meetingId, optionsFor(HOST, ticking));
    await join(database, meetingId, optionsFor(GUEST, ticking));

    const { closed, effect } = await closeAttendanceAfterSocketLoss(
      database.database,
      attendanceId as MeetingAttendanceId,
      { clock: endClock },
    );
    expect(closed).toBe(true);
    await commit(database.database, effect);

    const stays = await listAttendance(database.database, meetingId, {
      limit: MAX_ATTENDANCE_PAGE_SIZE,
    });
    expect(stays.find((stay) => stay.id === attendanceId)?.left_at).toBe(END_INSTANT);
    // Only that one: a dropped connection is one person's, and the others are still in the room.
    expect(stays.find((stay) => stay.user_id === GUEST)?.left_at).toBeNull();

    // THE MEETING IS NOT ENDED BY IT. Ending is the host's act and records who ended it.
    expect((await readMeeting(database.database, meetingId, visibility))?.status).toBe("live");

    const audit = database.raw
      .prepare(
        `SELECT metadata FROM audit_log WHERE event = 'meetings.meeting.left' ORDER BY id LIMIT 1`,
      )
      .get() as { metadata: string } | undefined;
    const metadata = JSON.parse(audit?.metadata ?? "{}") as Record<string, unknown>;
    expect(metadata["reason"]).toBe("socket-lost");
    expect(metadata["attendanceId"]).toBe(attendanceId);
    // Identifiers, instants and the one label. Nothing about the connection itself.
    expect(Object.keys(metadata).toSorted()).toEqual([
      "attendanceId",
      "joinedAt",
      "leftAt",
      "reason",
    ]);
  });

  it("writes nothing for a stay somebody already closed", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const ticking = tickingClock();
    const attendanceId = await join(database, meetingId, optionsFor(HOST, ticking));
    const leaving = await leaveMeeting(database.database, meetingId, optionsFor(HOST, ticking));
    await commit(database.database, leaving.effect);
    const leftAt = (
      await listAttendance(database.database, meetingId, { limit: MAX_ATTENDANCE_PAGE_SIZE })
    )[0]?.left_at;

    const { closed, effect } = await closeAttendanceAfterSocketLoss(
      database.database,
      attendanceId as MeetingAttendanceId,
      { clock: endClock },
    );
    expect(closed).toBe(false);
    expect(effect.statements).toHaveLength(0);

    // The instant somebody's record already carries is not moved.
    const stays = await listAttendance(database.database, meetingId, {
      limit: MAX_ATTENDANCE_PAGE_SIZE,
    });
    expect(stays[0]?.left_at).toBe(leftAt);
  });
});

describe("the attendance record, one page at a time", () => {
  it("walks the stays oldest first and stops without repeating one", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const ticking = tickingClock();
    // Six stays: three members, each of whom left and came back.
    const members = CROWD.slice(0, 3);
    for (const round of [0, 1]) {
      for (const member of members) {
        await join(database, meetingId, optionsFor(member, ticking));
        if (round === 0) {
          const leaving = await leaveMeeting(
            database.database,
            meetingId,
            optionsFor(member, ticking),
          );
          await commit(database.database, leaving.effect);
        }
      }
    }

    const walked: string[] = [];
    let cursor: { createdAt: string; id: string } | undefined;
    for (let page = 0; page < 10; page += 1) {
      const found = await listAttendance(database.database, meetingId, { cursor, limit: 2 });
      const rows = found.slice(0, 2);
      for (const row of rows) walked.push(row.id);
      if (found.length <= 2) break;
      const last = rows.at(-1);
      cursor = last === undefined ? undefined : { createdAt: last.joined_at, id: last.id };
    }

    const whole = await listAttendance(database.database, meetingId, {
      limit: MAX_ATTENDANCE_PAGE_SIZE,
    });
    expect(whole).toHaveLength(6);
    expect(walked).toEqual(whole.map((row) => row.id));
    expect(new Set(walked).size).toBe(6);
  });
});

describe("the three lists a meetings screen paints", () => {
  /** An extra hearing to hang a meeting on, so a list has more than one row to order. */
  function hearing(
    database: ReturnType<typeof fresh>,
    id: string,
    startsOn: string,
    startsAtTime: string | null,
  ): MatterEventId {
    database.raw.exec(
      `INSERT INTO matter_event (id, matter_id, title, status, starts_on, starts_at_time, ends_at_time, time_zone, recorded_at, recorded_by, created_at, updated_at) ` +
        `VALUES ('${id}', '${MATTER}', 'Hearing', 'scheduled', '${startsOn}', ` +
        `${startsAtTime === null ? "NULL" : `'${startsAtTime}'`}, NULL, 'America/Los_Angeles', ` +
        `'2026-09-01T00:00:00.000Z', '${HOST}', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    );
    return id as MatterEventId;
  }

  it("orders what is ahead by day and then by wall-clock time, and walks it without repeating one", async () => {
    const database = fresh();
    // Deliberately out of order, and two on one day, so a list ordered by anything else shows it.
    const seeded: readonly (readonly [string, string, string | null])[] = [
      ["matterEvent_meetingListLater00", "2026-09-23", "09:00"],
      ["matterEvent_meetingListNoonDay", "2026-09-22", "12:00"],
      ["matterEvent_meetingListAllDay0", "2026-09-22", null],
    ];
    for (const [id, startsOn, at] of seeded) {
      await start(database, "matter", hearing(database, id, startsOn, at));
    }

    const walked: string[] = [];
    let cursor: { createdAt: string; id: string } | undefined;
    for (let page = 0; page < 5; page += 1) {
      const found = await listMeetings(database.database, {
        scope: "upcoming",
        visibility,
        limit: 1,
        cursor,
        today: "2026-09-22",
      });
      const rows = found.slice(0, 1);
      for (const row of rows) walked.push(row.summary.eventId);
      if (found.length <= 1) break;
      const last = rows.at(-1);
      cursor = last === undefined ? undefined : { createdAt: last.sortKey, id: last.summary.id };
    }

    // Soonest first, and an all-day entry sits at the start of its day, which is where somebody
    // reading that day's list expects it.
    expect(walked).toEqual([
      "matterEvent_meetingListAllDay0",
      "matterEvent_meetingListNoonDay",
      "matterEvent_meetingListLater00",
    ]);
  });

  it("leaves out a day already past, measured against the day the CALLER says it is", async () => {
    const database = fresh();
    await start(
      database,
      "matter",
      hearing(database, "matterEvent_meetingListGone0", "2026-09-19", "09:00"),
    );
    await start(
      database,
      "matter",
      hearing(database, "matterEvent_meetingListAhead", "2026-09-25", "09:00"),
    );

    const ahead = await listMeetings(database.database, {
      scope: "upcoming",
      visibility,
      limit: 10,
      today: "2026-09-20",
    });
    expect(ahead.map((row) => row.summary.eventId)).toEqual(["matterEvent_meetingListAhead"]);

    // The same rows, a different caller's day: the one whose evening has not turned over yet still
    // sees the meeting they have tomorrow morning.
    const earlier = await listMeetings(database.database, {
      scope: "upcoming",
      visibility,
      limit: 10,
      today: "2026-09-19",
    });
    expect(earlier).toHaveLength(2);
  });

  it("separates what is live from what has ended, each in its own order", async () => {
    const database = fresh();
    const ticking = tickingClock();
    const live = await start(database, "matter");
    await join(database, live, optionsFor(HOST, ticking));
    const finished = await start(database, "firm", FIRM_EVENT);
    await join(database, finished, optionsFor(HOST, ticking));
    const { effect } = await endMeeting(database.database, finished, optionsFor(HOST, endClock));
    await commit(database.database, effect);

    const inProgress = await listMeetings(database.database, {
      scope: "live",
      visibility,
      limit: 10,
    });
    expect(inProgress.map((row) => row.summary.id)).toEqual([live]);

    const justFinished = await listMeetings(database.database, {
      scope: "recent",
      visibility,
      limit: 10,
      since: "2026-09-01T00:00:00.000Z",
    });
    expect(justFinished.map((row) => row.summary.id)).toEqual([finished]);

    // The window is what makes it "recent" rather than "every meeting this firm ever held".
    const beyondTheWindow = await listMeetings(database.database, {
      scope: "recent",
      visibility,
      limit: 10,
      since: "2026-10-01T00:00:00.000Z",
    });
    expect(beyondTheWindow).toEqual([]);
  });

  it("never lists a room on a matter the member may not see", async () => {
    const database = fresh();
    database.raw.exec(
      `INSERT INTO meeting (id, event_kind, matter_event_id, firm_event_id, status, created_by_user_id, started_at, created_at, updated_at) ` +
        `VALUES ('meeting_walledList00000000', 'matter', '${WALLED_MATTER_EVENT}', NULL, 'live', '${HOST}', ` +
        `'2026-09-18T11:00:00.000Z', '2026-09-18T11:00:00.000Z', '2026-09-18T11:00:00.000Z')`,
    );
    const visible = await start(database, "matter");
    await join(database, visible);

    // The list composes the same gate every id-addressed read composes, so a list can never show a
    // room a direct read would refuse.
    const live = await listMeetings(database.database, { scope: "live", visibility, limit: 10 });
    expect(live.map((row) => row.summary.id)).toEqual([visible]);
  });
});

import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import { runInterleaved } from "@magna-carta/data-access/interleave";
import type { MeetingAttendanceId, MeetingId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { claimHosting, grantHosting, setMeetingLocked } from "../src/hosting-service.ts";
import { readBarredStay, readLiveHostGrants } from "../src/hosting-statements.ts";
import {
  admitParticipants,
  denyParticipants,
  listMeetingLobby,
  setMeetingLobby,
} from "../src/lobby-service.ts";
import { countWaitingAttendance, listWaitingAttendance } from "../src/lobby-statements.ts";
import { MAX_MEETING_LOBBY } from "../src/lobby-types.ts";
import { createMeeting, endMeeting, joinMeeting, leaveMeeting } from "../src/meeting-service.ts";
import {
  countOpenAttendance,
  readMeeting,
  readMeetingSummary,
  readOpenAttendance,
} from "../src/meeting-statements.ts";
import { MAX_MEETING_PARTICIPANTS } from "../src/types.ts";
import { MeetingValidationError } from "../src/validation.ts";
import {
  CROWD,
  GUEST,
  HOST,
  MATTER_EVENT,
  clock,
  commit,
  migratedDatabase,
  options,
  optionsFor,
  seedFirm,
  tickingClock,
  visibility,
} from "./support.ts";

// THE DOOR: arrivals held in a lobby until a host admits them, one lobby per meeting.
//
// What every test here is really asking is one of three things. Does an arrival at the door count as
// somebody in the room — it must not, anywhere: not in the live count, not against the capacity
// guard, not on the roster. Does a host's decision about a named person stay a decision about that
// person — a setting is not an admission, and a batch that half-lands says which half. And does a
// refusal at the door actually bar, because a denial that did not would be a button that does
// nothing.

const THIRD = CROWD[0] as UserId;
const FOURTH = CROWD[1] as UserId;

// An instant after every arrival a test can stage. A stay's span is a CHECK — a departure cannot
// precede the arrival it closes — and the fixture's joins run on a ticking clock, so a denial
// stamped at the fixture's own noon would be refused by the database for a reason that has nothing
// to do with what the test is asking.
const DECIDED_AT = "2026-09-18T13:00:00.000Z";
const decisionClock = { now: () => DECIDED_AT };

/** A host's options, stamped after everybody has knocked — what a decision is composed with. */
function deciding(userId: UserId = HOST) {
  return optionsFor(userId, decisionClock);
}

function fresh() {
  const database = migratedDatabase();
  seedFirm(database.raw);
  return database;
}

async function start(
  database: ReturnType<typeof fresh>,
  lobby: "off" | "on" = "on",
): Promise<MeetingId> {
  const { meetingId, effect } = await createMeeting(
    database.database,
    { eventKind: "matter", eventId: MATTER_EVENT, lobby },
    options,
  );
  await commit(database.database, effect);
  return meetingId;
}

async function join(
  database: ReturnType<typeof fresh>,
  meetingId: MeetingId,
  userId: UserId,
  // A KNOCK AT A NAMED INSTANT, where the queue's order is what a test is asking about. The shared
  // ticking clock starts again on every call, so two arrivals staged with it carry the same instant
  // and the lobby list falls back to the handle — which is random, and a test that asserted an
  // order over it would pass or fail by luck.
  at?: string,
): Promise<{ attendanceId: MeetingAttendanceId; waiting: boolean }> {
  const joined = await joinMeeting(
    database.database,
    meetingId,
    optionsFor(userId, at === undefined ? tickingClock() : { now: () => at }),
  );
  await commit(database.database, joined.effect);
  return { attendanceId: joined.attendanceId, waiting: joined.waiting };
}

/** A lobby-on meeting with the host inside it and one member at the door. */
async function roomWithSomebodyWaiting(
  database: ReturnType<typeof fresh>,
): Promise<{ meetingId: MeetingId; waiting: MeetingAttendanceId }> {
  const meetingId = await start(database);
  await join(database, meetingId, HOST);
  const guest = await join(database, meetingId, GUEST);
  expect(guest.waiting).toBe(true);
  return { meetingId, waiting: guest.attendanceId };
}

async function auditRows(
  database: ReturnType<typeof fresh>,
  meetingId: MeetingId,
): Promise<{ event: string; actor_user_id: string | null; metadata: string | null }[]> {
  const { results } = await database.database
    .prepare(
      "SELECT event, actor_user_id, metadata FROM audit_log WHERE subject_id = ?1 " +
        "ORDER BY created_at ASC, id ASC",
    )
    .bind(meetingId)
    .all<{ event: string; actor_user_id: string | null; metadata: string | null }>();
  return results;
}

async function stayOf(
  database: ReturnType<typeof fresh>,
  attendanceId: MeetingAttendanceId,
): Promise<{
  left_at: string | null;
  ended_reason: string | null;
  waiting_from: string | null;
  admitted_at: string | null;
}> {
  const row = await database.database
    .prepare(
      "SELECT left_at, ended_reason, waiting_from, admitted_at FROM meeting_attendance WHERE id = ?1",
    )
    .bind(attendanceId)
    .first<{
      left_at: string | null;
      ended_reason: string | null;
      waiting_from: string | null;
      admitted_at: string | null;
    }>();
  if (row === null || row === undefined) throw new Error("no such stay");
  return row;
}

function codeOf(caught: unknown): string {
  expect(caught).toBeInstanceOf(MeetingValidationError);
  return (caught as MeetingValidationError).code;
}

describe("the setting", () => {
  it("is off unless the Start asked for it, and a second Start does not change it", async () => {
    const database = fresh();
    const meetingId = await start(database, "off");
    expect((await readMeeting(database.database, meetingId, visibility))?.lobby).toBe("off");

    // One meeting per event, so the first Start decides — the medium's own rule, and the reason a
    // second caller asking differently gets the room that exists.
    const again = await createMeeting(
      database.database,
      { eventKind: "matter", eventId: MATTER_EVENT, lobby: "on" },
      options,
    );
    expect(again.created).toBe(false);
    expect((await readMeeting(database.database, meetingId, visibility))?.lobby).toBe("off");
  });

  it("is on the summary, and a host moves it", async () => {
    const database = fresh();
    const meetingId = await start(database, "off");
    await join(database, meetingId, HOST);

    const opened = await setMeetingLobby(database.database, meetingId, "on", deciding());
    expect(opened.changed).toBe(true);
    await commit(database.database, opened.effect);
    expect((await readMeetingSummary(database.database, meetingId, visibility))?.lobby).toBe("on");

    // Already true: writing it again would move an instant and an actor a record already carries.
    const again = await setMeetingLobby(database.database, meetingId, "on", deciding());
    expect(again.changed).toBe(false);
    expect(again.effect.statements).toHaveLength(0);
    expect(
      (await auditRows(database, meetingId)).filter(
        (row) => row.event === "meetings.meeting.lobbyChanged",
      ),
    ).toHaveLength(1);
  });

  it("is refused to somebody who is not hosting this meeting", async () => {
    const database = fresh();
    const { meetingId } = await roomWithSomebodyWaiting(database);
    const caught = await setMeetingLobby(
      database.database,
      meetingId,
      "off",
      deciding(GUEST),
    ).catch((error: unknown) => error);
    expect(codeOf(caught)).toBe("meeting-not-host");
  });

  it("turning it OFF leaves the people at the door exactly where they are", async () => {
    const database = fresh();
    const { meetingId, waiting } = await roomWithSomebodyWaiting(database);

    const closed = await setMeetingLobby(database.database, meetingId, "off", deciding());
    await commit(database.database, closed.effect);

    // A SETTING IS NOT A DECISION ABOUT A NAMED PERSON. Somebody may be waiting precisely because
    // the host intends to deny them, so flipping a switch must never become an admission nobody
    // made.
    expect(await stayOf(database, waiting)).toMatchObject({ admitted_at: null, left_at: null });
    expect(await countWaitingAttendance(database.database, meetingId)).toBe(1);
    // And the next arrival walks straight in, which is what the setting actually changed.
    expect((await join(database, meetingId, THIRD)).waiting).toBe(false);
  });
});

describe("arriving at a lobby", () => {
  it("opens a stay at the door that counts as nobody in the room", async () => {
    const database = fresh();
    const { meetingId, waiting } = await roomWithSomebodyWaiting(database);

    const stay = await stayOf(database, waiting);
    expect(stay.waiting_from).not.toBeNull();
    expect(stay.admitted_at).toBeNull();
    expect(stay.left_at).toBeNull();

    // THE LIVE COUNT AND THE CAPACITY GUARD BOTH IGNORE THEM. One predicate, one home — both are
    // composed from IN_THE_ROOM_PREDICATE, so the two cannot drift into disagreeing about who is
    // present.
    expect(await countOpenAttendance(database.database, meetingId)).toBe(1);
    expect((await readMeetingSummary(database.database, meetingId, visibility))?.liveCount).toBe(1);
  });

  it("does not make the room live, because nobody has walked into it", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const first = await join(database, meetingId, GUEST);

    expect(first.waiting).toBe(true);
    // A lobby-on room whose host never arrives keeps a record saying exactly that: scheduled, with
    // somebody who waited.
    expect((await readMeeting(database.database, meetingId, visibility))?.status).toBe("scheduled");
    expect((await auditRows(database, meetingId)).map((row) => row.event)).not.toContain(
      "meetings.meeting.started",
    );
  });

  it("hands a browser back the stay it already has, on whichever side of the door", async () => {
    const database = fresh();
    const { meetingId, waiting } = await roomWithSomebodyWaiting(database);

    // A reconnecting waiter keeps their place in the queue rather than going to the back of it.
    const again = await join(database, meetingId, GUEST);
    expect(again.attendanceId).toBe(waiting);
    expect(again.waiting).toBe(true);
    expect(await countWaitingAttendance(database.database, meetingId)).toBe(1);
  });

  it("lets a host and a co-host straight in, and a key-holder without a grant wait", async () => {
    const database = fresh();
    const meetingId = await start(database);
    // The starter holds a grant from the instant the room exists, so they never meet the door.
    expect((await join(database, meetingId, HOST)).waiting).toBe(false);

    const guest = await join(database, meetingId, GUEST);
    expect(guest.waiting).toBe(true);
    const admitted = await admitParticipants(
      database.database,
      meetingId,
      [guest.attendanceId],
      deciding(),
    );
    await commit(database.database, admitted.effect);
    const named = await grantHosting(
      database.database,
      meetingId,
      { userId: GUEST, role: "co-host" },
      deciding(),
    );
    await commit(database.database, named.effect);

    // The co-host's own reconnection does not queue them, and THIRD — who holds the permission key
    // in the fixture and no grant on this room — does. Holding the key is deliberately not enough.
    expect((await join(database, meetingId, THIRD)).waiting).toBe(true);
  });

  it("is refused past MAX_MEETING_LOBBY, with the door's own reason", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);

    for (const userId of CROWD.slice(0, MAX_MEETING_LOBBY)) {
      expect((await join(database, meetingId, userId)).waiting).toBe(true);
    }
    expect(await countWaitingAttendance(database.database, meetingId)).toBe(MAX_MEETING_LOBBY);

    const caught = await joinMeeting(database.database, meetingId, optionsFor(GUEST)).catch(
      (error: unknown) => error,
    );
    // NOT `meeting-room-full`. The two ceilings answer different questions and the remedies differ:
    // a full room needs somebody to leave, a full lobby needs a host to look at the list.
    expect(codeOf(caught)).toBe("meeting-lobby-full");
  });

  it("is refused by the door's guard when the queue filled inside the window", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);
    // From index two, so the two members this test races with are not already at the door.
    for (const userId of CROWD.slice(2, MAX_MEETING_LOBBY + 1)) {
      await join(database, meetingId, userId);
    }
    expect(await countWaitingAttendance(database.database, meetingId)).toBe(MAX_MEETING_LOBBY - 1);

    // THE WINDOW IS REAL: the service's count is a round trip ahead of the insert, so two browsers
    // knocking together both read a free place and both pass. The insert carries the same count in
    // its own WHERE and is guarded, which is what actually holds the ceiling.
    const racing = await runInterleaved({
      database: database.database,
      concurrentWriter: async () => {
        await join(database, meetingId, GUEST);
      },
      operation: async (raced) => {
        const mine = await joinMeeting(raced, meetingId, optionsFor(FOURTH, tickingClock()));
        await commit(raced, mine.effect);
      },
    }).catch((error: unknown) => error);

    expect(racing).toBeInstanceOf(GuardedWriteRefusedError);
    expect(await countWaitingAttendance(database.database, meetingId)).toBe(MAX_MEETING_LOBBY);
  });

  it("is refused by the door's OWN predicate when the lobby is turned on inside the window", async () => {
    const database = fresh();
    const meetingId = await start(database, "off");
    await join(database, meetingId, HOST);

    // THE WINDOW IS THE MOMENT THE CONTROL IS BEING USED. The service reads the lobby setting a
    // round trip before the insert, so a host turning the door on in that instant had the arrival
    // land straight in the room — which is precisely the person the door was opened for, because a
    // host shuts a door because of who is about to arrive.
    const racing = await runInterleaved({
      database: database.database,
      concurrentWriter: async () => {
        const shut = await setMeetingLobby(database.database, meetingId, "on", deciding());
        await commit(database.database, shut.effect);
      },
      operation: async (raced) => {
        const mine = await joinMeeting(raced, meetingId, optionsFor(GUEST, tickingClock()));
        await commit(raced, mine.effect);
      },
    }).catch((error: unknown) => error);

    // The insert carries the door in its own WHERE and is guarded, so the batch rolls back whole
    // and the member is answered with something they can act on — they knock again and wait.
    expect(racing).toBeInstanceOf(GuardedWriteRefusedError);
    expect(await countOpenAttendance(database.database, meetingId)).toBe(1);
  });

  it("is refused by the same predicate when the room is LOCKED inside the window", async () => {
    const database = fresh();
    const meetingId = await start(database, "off");
    await join(database, meetingId, HOST);

    const racing = await runInterleaved({
      database: database.database,
      concurrentWriter: async () => {
        const shut = await setMeetingLocked(database.database, meetingId, true, deciding());
        await commit(database.database, shut.effect);
      },
      operation: async (raced) => {
        const mine = await joinMeeting(raced, meetingId, optionsFor(GUEST, tickingClock()));
        await commit(raced, mine.effect);
      },
    }).catch((error: unknown) => error);

    // A lock read a round trip earlier cannot refuse an arrival that commits after it; the
    // statement's own predicate can, and does.
    expect(racing).toBeInstanceOf(GuardedWriteRefusedError);
    expect(await countOpenAttendance(database.database, meetingId)).toBe(1);
  });

  it("refuses a WAITING stay opened into a room that was locked inside the window", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);

    const racing = await runInterleaved({
      database: database.database,
      concurrentWriter: async () => {
        const shut = await setMeetingLocked(database.database, meetingId, true, deciding());
        await commit(database.database, shut.effect);
      },
      operation: async (raced) => {
        const mine = await joinMeeting(raced, meetingId, optionsFor(GUEST, tickingClock()));
        await commit(raced, mine.effect);
      },
    }).catch((error: unknown) => error);

    // The door's own insert carries the same two conditions, inverted: a queue for a door that will
    // not be answered is worse than a refusal the member can read.
    expect(racing).toBeInstanceOf(GuardedWriteRefusedError);
    expect(await countWaitingAttendance(database.database, meetingId)).toBe(0);
  });

  it("is beaten by the lock: a shut door is shut to everybody", async () => {
    const database = fresh();
    const { meetingId } = await roomWithSomebodyWaiting(database);
    await database.database
      .prepare("UPDATE meeting SET locked_at = ?1, locked_by_user_id = ?2 WHERE id = ?3")
      .bind(DECIDED_AT, HOST, meetingId)
      .run();

    const caught = await joinMeeting(database.database, meetingId, optionsFor(THIRD)).catch(
      (error: unknown) => error,
    );
    // A waiting stay opened here would be somebody standing outside a door that will not be
    // answered.
    expect(codeOf(caught)).toBe("meeting-locked");
  });
});

describe("a host's decision", () => {
  it("admits a stay, which then takes a seat and joins the roster", async () => {
    const database = fresh();
    const { meetingId, waiting } = await roomWithSomebodyWaiting(database);

    const admitted = await admitParticipants(database.database, meetingId, [waiting], deciding());
    expect(admitted.decisions).toEqual([{ participantId: waiting, outcome: "admitted" }]);
    await commit(database.database, admitted.effect);

    expect(await stayOf(database, waiting)).toMatchObject({
      admitted_at: DECIDED_AT,
      left_at: null,
    });
    expect(await countOpenAttendance(database.database, meetingId)).toBe(2);
    expect(await countWaitingAttendance(database.database, meetingId)).toBe(0);
    expect((await auditRows(database, meetingId)).map((row) => row.event)).toContain(
      "meetings.meeting.admitted",
    );
  });

  it("reports one outcome per identifier, including a mixed batch", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);
    const first = await join(database, meetingId, GUEST);
    const second = await join(database, meetingId, THIRD);

    const denied = await denyParticipants(
      database.database,
      meetingId,
      [second.attendanceId],
      deciding(),
    );
    await commit(database.database, denied.effect);

    // One waiting, one denied, one that names nothing at all.
    const stranger = "meetingAttendance_nobodyAtAll" as MeetingAttendanceId;
    const admitted = await admitParticipants(
      database.database,
      meetingId,
      [first.attendanceId, second.attendanceId, stranger],
      deciding(),
    );
    expect(admitted.decisions).toEqual([
      { participantId: first.attendanceId, outcome: "admitted" },
      { participantId: second.attendanceId, outcome: "not-waiting" },
      { participantId: stranger, outcome: "not-waiting" },
    ]);
  });

  it("names the people who did not get a seat rather than refusing the batch", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);

    // Fill the room to one short of its ceiling with stays that walked straight in, which is what
    // the record looks like when a host opens the lobby part-way through a meeting.
    const now = "2026-09-18T12:00:00.000Z";
    for (const [index, userId] of CROWD.slice(2, MAX_MEETING_PARTICIPANTS).entries()) {
      await database.database
        .prepare(
          "INSERT INTO meeting_attendance (id, meeting_id, user_id, joined_at, left_at, " +
            "created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, ?4, ?4)",
        )
        .bind(`meetingAttendance_seated${String(index).padStart(4, "0")}`, meetingId, userId, now)
        .run();
    }
    expect(await countOpenAttendance(database.database, meetingId)).toBe(
      MAX_MEETING_PARTICIPANTS - 1,
    );

    const first = await join(database, meetingId, GUEST);
    const second = await join(database, meetingId, FOURTH);
    const admitted = await admitParticipants(
      database.database,
      meetingId,
      [first.attendanceId, second.attendanceId],
      deciding(),
    );

    // ONE SEAT, TWO PEOPLE. The host learns which of them did not get in rather than meeting one
    // refusal for both.
    expect(admitted.decisions).toEqual([
      { participantId: first.attendanceId, outcome: "admitted" },
      { participantId: second.attendanceId, outcome: "room-full" },
    ]);
    await commit(database.database, admitted.effect);
    expect(await countOpenAttendance(database.database, meetingId)).toBe(MAX_MEETING_PARTICIPANTS);
    expect(await stayOf(database, second.attendanceId)).toMatchObject({ admitted_at: null });
  });

  it("names the same person twice without spending two seats on them", async () => {
    const database = fresh();
    const { meetingId, waiting } = await roomWithSomebodyWaiting(database);

    const admitted = await admitParticipants(
      database.database,
      meetingId,
      [waiting, waiting],
      deciding(),
    );
    expect(admitted.decisions).toEqual([{ participantId: waiting, outcome: "admitted" }]);
    await commit(database.database, admitted.effect);
    expect(await countOpenAttendance(database.database, meetingId)).toBe(2);
  });

  it("denies a stay, bars re-entry, and says so with its own refusal", async () => {
    const database = fresh();
    const { meetingId, waiting } = await roomWithSomebodyWaiting(database);

    const denied = await denyParticipants(database.database, meetingId, [waiting], deciding());
    expect(denied.decisions).toEqual([{ participantId: waiting, outcome: "denied" }]);
    await commit(database.database, denied.effect);

    expect(await stayOf(database, waiting)).toMatchObject({
      ended_reason: "denied",
      left_at: DECIDED_AT,
    });
    // BARRED ENTRY IS ONE RULE WITH TWO LABELS, and the barred-entry read finds both.
    expect((await readBarredStay(database.database, meetingId, GUEST))?.ended_reason).toBe(
      "denied",
    );

    const caught = await joinMeeting(database.database, meetingId, optionsFor(GUEST)).catch(
      (error: unknown) => error,
    );
    // A denial that did not bar would be a button that does nothing: the member presses Join again
    // and is back at the front of the queue.
    expect(codeOf(caught)).toBe("meeting-not-admitted");

    // Two rows, and they record two different facts: the departure every other way of leaving
    // writes, labelled, and the host's act beside it.
    const events = (await auditRows(database, meetingId)).filter((row) =>
      ["meetings.meeting.denied", "meetings.meeting.left"].includes(row.event),
    );
    expect(events.map((row) => row.event)).toEqual(
      expect.arrayContaining(["meetings.meeting.denied", "meetings.meeting.left"]),
    );
    expect(events.find((row) => row.event === "meetings.meeting.left")?.actor_user_id).toBe(GUEST);
    expect(events.find((row) => row.event === "meetings.meeting.denied")?.actor_user_id).toBe(HOST);
  });

  it("is refused to a member who is in the meeting and not running it", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);
    const guest = await join(database, meetingId, GUEST);
    const admitted = await admitParticipants(
      database.database,
      meetingId,
      [guest.attendanceId],
      deciding(),
    );
    await commit(database.database, admitted.effect);
    const third = await join(database, meetingId, THIRD);

    for (const act of [
      admitParticipants(database.database, meetingId, [third.attendanceId], deciding(GUEST)),
      denyParticipants(database.database, meetingId, [third.attendanceId], deciding(GUEST)),
      listMeetingLobby(database.database, meetingId, deciding(GUEST)),
    ]) {
      expect(codeOf(await act.catch((error: unknown) => error))).toBe("meeting-not-host");
    }
  });

  it("rolls the whole batch back when a denial lands inside an admission's window", async () => {
    const database = fresh();
    const { meetingId, waiting } = await roomWithSomebodyWaiting(database);

    // THE WINDOW IS REAL: the admission reads the stay, decides, and commits a round trip later. A
    // denial landing in between closes the stay, so the admission's guarded UPDATE meets a row that
    // is no longer waiting — and an instant on somebody's record is never moved by a second write.
    const racing = await runInterleaved({
      database: database.database,
      concurrentWriter: async () => {
        const denied = await denyParticipants(database.database, meetingId, [waiting], deciding());
        await commit(database.database, denied.effect);
      },
      operation: async (raced) => {
        const admitted = await admitParticipants(raced, meetingId, [waiting], deciding());
        await commit(raced, admitted.effect);
      },
    }).catch((error: unknown) => error);

    expect(racing).toBeInstanceOf(GuardedWriteRefusedError);
    // One decision stands, and it is the one that landed.
    expect(await stayOf(database, waiting)).toMatchObject({
      ended_reason: "denied",
      admitted_at: null,
    });
    expect(
      (await auditRows(database, meetingId)).filter(
        (row) => row.event === "meetings.meeting.admitted",
      ),
    ).toHaveLength(0);
  });
});

describe("the lobby list", () => {
  it("is the people at the door, oldest knock first, with the name the firm holds", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);
    const first = await join(database, meetingId, GUEST, "2026-09-18T12:05:00.000Z");
    const second = await join(database, meetingId, THIRD, "2026-09-18T12:06:00.000Z");

    expect(await listMeetingLobby(database.database, meetingId, deciding())).toEqual([
      {
        participantId: first.attendanceId,
        userId: GUEST,
        displayName: "A Guest",
        waitingFrom: "2026-09-18T12:05:00.000Z",
      },
      {
        participantId: second.attendanceId,
        userId: THIRD,
        displayName: "Attendee 0",
        waitingFrom: "2026-09-18T12:06:00.000Z",
      },
    ]);

    // An admitted stay and a denied one leave the answer the instant the host decides.
    const admitted = await admitParticipants(
      database.database,
      meetingId,
      [first.attendanceId],
      deciding(),
    );
    await commit(database.database, admitted.effect);
    expect(
      (await listWaitingAttendance(database.database, meetingId, MAX_MEETING_LOBBY)).map(
        (entry) => entry.participantId,
      ),
    ).toEqual([second.attendanceId]);
  });
});

describe("the lobby's one deadlock, and its exit", () => {
  it("admits the claimer's own stay in the same batch as the grant", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);
    // The host opens the room and then goes, leaving everybody queued for somebody who will never
    // admit them — which is the state the claim exists to end.
    const waiter = await join(database, meetingId, THIRD);
    expect(waiter.waiting).toBe(true);
    const left = await leaveMeeting(database.database, meetingId, deciding(HOST));
    await commit(database.database, left.effect);

    const claimed = await claimHosting(database.database, meetingId, deciding(THIRD));
    expect(claimed.claimed).toBe(true);
    expect(claimed.admittedAttendanceId).toBe(waiter.attendanceId);
    await commit(database.database, claimed.effect);

    // ONE BATCH, so there is no instant in which somebody is hosting a room they are not in.
    expect(await stayOf(database, waiter.attendanceId)).toMatchObject({ admitted_at: DECIDED_AT });
    expect(
      (await readLiveHostGrants(database.database, meetingId)).map((grant) => [
        grant.user_id,
        grant.role,
      ]),
    ).toEqual([[THIRD, "host"]]);
    // And they can now do the thing the deadlock was stopping.
    const waiting = await listMeetingLobby(database.database, meetingId, deciding(THIRD));
    expect(waiting).toEqual([]);
  });

  it("is refused while somebody holding a grant is actually IN the room", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);
    await join(database, meetingId, THIRD);

    const caught = await claimHosting(database.database, meetingId, deciding(THIRD)).catch(
      (error: unknown) => error,
    );
    expect(codeOf(caught)).toBe("meeting-not-host");
  });
});

describe("what the audit log carries at the door", () => {
  it("is identifiers, instants and closed-vocabulary labels — and nothing else", async () => {
    const database = fresh();
    const { meetingId, waiting } = await roomWithSomebodyWaiting(database);
    const second = await join(database, meetingId, THIRD);

    const opened = await setMeetingLobby(database.database, meetingId, "off", deciding());
    await commit(database.database, opened.effect);
    const admitted = await admitParticipants(database.database, meetingId, [waiting], deciding());
    await commit(database.database, admitted.effect);
    const denied = await denyParticipants(
      database.database,
      meetingId,
      [second.attendanceId],
      deciding(),
    );
    await commit(database.database, denied.effect);

    const rows = await auditRows(database, meetingId);
    expect(rows.map((row) => row.event)).toEqual(
      expect.arrayContaining([
        "meetings.meeting.waiting",
        "meetings.meeting.lobbyChanged",
        "meetings.meeting.admitted",
        "meetings.meeting.denied",
        "meetings.meeting.left",
      ] as string[]),
    );

    // WHAT IS NEVER THERE: a name, a title, a word anybody said. The meeting's own assertion,
    // extended to the events the door added.
    const allowed = new Set([
      "admittedAt",
      "attendanceId",
      "changedAt",
      "deniedAt",
      "eventId",
      "eventKind",
      "joinedAt",
      "leftAt",
      "lobby",
      "matterId",
      "medium",
      "reason",
      "startedAt",
      "userId",
      "waitingFrom",
    ]);
    for (const row of rows) {
      const metadata = JSON.parse(row.metadata ?? "{}") as Record<string, unknown>;
      for (const [key, value] of Object.entries(metadata)) {
        expect(allowed, `${row.event} carries an unexpected field ${key}`).toContain(key);
        expect(
          typeof value === "string" || typeof value === "boolean" || value === null,
          `${row.event}.${key} is not an identifier, an instant, a label or a flag`,
        ).toBe(true);
      }
    }
  });
});

describe("the meeting ending under a door", () => {
  it("closes the waiting stays with it, and refuses every later decision", async () => {
    const database = fresh();
    const { meetingId, waiting } = await roomWithSomebodyWaiting(database);

    const ended = await endMeeting(database.database, meetingId, deciding());
    await commit(database.database, ended.effect);

    // The meeting ended once, so every open stay closes at that one instant — the waiting ones
    // among them, because a waiter's stay is a stay.
    expect(await stayOf(database, waiting)).toMatchObject({ left_at: DECIDED_AT });
    expect(await readOpenAttendance(database.database, meetingId, GUEST)).toBeUndefined();

    for (const act of [
      setMeetingLobby(database.database, meetingId, "off", deciding()),
      admitParticipants(database.database, meetingId, [waiting], deciding()),
      denyParticipants(database.database, meetingId, [waiting], deciding()),
    ]) {
      expect(codeOf(await act.catch((error: unknown) => error))).toBe("meeting-already-ended");
    }
  });
});

describe("a meeting that nobody can reach", () => {
  it("answers every lobby path with the family's one refusal", async () => {
    const database = fresh();
    const unknown = "meeting_nothingAtThisHandle" as MeetingId;
    for (const act of [
      setMeetingLobby(database.database, unknown, "on", optionsFor(HOST, clock)),
      listMeetingLobby(database.database, unknown, optionsFor(HOST, clock)),
      admitParticipants(
        database.database,
        unknown,
        ["meetingAttendance_nobody" as MeetingAttendanceId],
        optionsFor(HOST, clock),
      ),
      denyParticipants(
        database.database,
        unknown,
        ["meetingAttendance_nobody" as MeetingAttendanceId],
        optionsFor(HOST, clock),
      ),
    ]) {
      expect(codeOf(await act.catch((error: unknown) => error))).toBe("meeting-unknown-event");
    }
  });
});

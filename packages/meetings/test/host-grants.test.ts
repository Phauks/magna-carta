import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import { runInterleaved } from "@magna-carta/data-access/interleave";
import type { MeetingAttendanceId, MeetingId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  claimHosting,
  grantHosting,
  removeParticipant,
  requireHostGrant,
  revokeHosting,
  setMeetingLocked,
} from "../src/hosting-service.ts";
import { readBarredStay, readLiveHostGrants } from "../src/hosting-statements.ts";
import { createMeeting, endMeeting, joinMeeting, leaveMeeting } from "../src/meeting-service.ts";
import { readMeeting, readOpenAttendance } from "../src/meeting-statements.ts";
import { MeetingValidationError } from "../src/validation.ts";
import {
  CROWD,
  FIRM_EVENT,
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

// WHO IS RUNNING A MEETING, as a fact on the record rather than a permission key half the firm
// holds.
//
// The thing every test here is really asking is the same one: `meetings:host` says a firm lets a
// member convene meetings, and it cannot say which room they are running, because that changes while
// the meeting runs. So the grant is a row with an interval, the invariants are partial unique
// indexes rather than read-then-write checks, and the acts that could later be asked about are
// audited.

const THIRD = CROWD[0] as UserId;

// AN INSTANT AFTER EVERY ARRIVAL A TEST CAN STAGE. A stay's span is a CHECK — a departure cannot
// precede the arrival it closes — and the fixture's joins run on a ticking clock, so a removal
// stamped at the fixture's own noon would be refused by the database for a reason that has nothing
// to do with what the test is asking.
const REMOVED_AT = "2026-09-18T13:00:00.000Z";
const removalClock = { now: () => REMOVED_AT };

/** The host's options, stamped after everybody has arrived — what a removal is composed with. */
function removing(userId: UserId = HOST) {
  return optionsFor(userId, removalClock);
}

function fresh() {
  const database = migratedDatabase();
  seedFirm(database.raw);
  return database;
}

async function start(
  database: ReturnType<typeof fresh>,
  eventId: string = MATTER_EVENT,
): Promise<MeetingId> {
  const { meetingId, effect } = await createMeeting(
    database.database,
    { eventKind: "matter", eventId },
    options,
  );
  await commit(database.database, effect);
  return meetingId;
}

async function join(
  database: ReturnType<typeof fresh>,
  meetingId: MeetingId,
  userId: UserId,
): Promise<MeetingAttendanceId> {
  const { attendanceId, effect } = await joinMeeting(
    database.database,
    meetingId,
    optionsFor(userId, tickingClock()),
  );
  await commit(database.database, effect);
  return attendanceId;
}

/** A meeting with the starter and one other member in it — the shape most of these tests need. */
async function roomOfTwo(database: ReturnType<typeof fresh>): Promise<MeetingId> {
  const meetingId = await start(database);
  await join(database, meetingId, HOST);
  await join(database, meetingId, GUEST);
  return meetingId;
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

function codeOf(caught: unknown): string {
  expect(caught).toBeInstanceOf(MeetingValidationError);
  return (caught as MeetingValidationError).code;
}

describe("the starter is the host", () => {
  it("holds a host grant the moment the meeting exists", async () => {
    const database = fresh();
    const meetingId = await start(database);

    const grants = await readLiveHostGrants(database.database, meetingId);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.user_id).toBe(HOST);
    expect(grants[0]?.role).toBe("host");
    // Nobody gave it. Pressing Start is how it comes to exist, and attributing it to the starter
    // would be the record claiming they handed the room to themselves.
    expect(grants[0]?.granted_by_user_id).toBeNull();
    expect(grants[0]?.revoked_at).toBeNull();
  });

  it("is a different fact from who opened the room, and the two come apart at the first hand-over", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);

    const handedOver = await grantHosting(
      database.database,
      meetingId,
      { userId: GUEST, role: "host" },
      options,
    );
    await commit(database.database, handedOver.effect);

    const meeting = await readMeeting(database.database, meetingId, visibility);
    // WHO OPENED THE ROOM NEVER CHANGES. A record that read this as the host would answer "who was
    // running the meeting when she was removed" with the name of somebody who had left.
    expect(meeting?.created_by_user_id).toBe(HOST);
    const grants = await readLiveHostGrants(database.database, meetingId);
    // The room is GUEST's now; the starter stays on as a co-host, which is what handing over means.
    expect(grants.filter((grant) => grant.role === "host").map((grant) => grant.user_id)).toEqual([
      GUEST,
    ]);
    expect(
      grants.filter((grant) => grant.role === "co-host").map((grant) => grant.user_id),
    ).toEqual([HOST]);
  });
});

describe("handing the room over", () => {
  it("closes the outgoing grant and opens the incoming one at one instant", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);

    const { effect } = await grantHosting(
      database.database,
      meetingId,
      { userId: GUEST, role: "host" },
      options,
    );
    await commit(database.database, effect);

    const { results } = await database.database
      .prepare(
        "SELECT user_id, role, granted_at, revoked_at, revoked_by_user_id FROM meeting_host " +
          "WHERE meeting_id = ?1 ORDER BY user_id ASC",
      )
      .bind(meetingId)
      .all<{
        user_id: string;
        role: string;
        granted_at: string;
        revoked_at: string | null;
        revoked_by_user_id: string | null;
      }>();
    // The outgoing host now has TWO rows — the host grant that closed, and the co-host grant that
    // opened in the same batch — so the closed one is named by its own revocation rather than by
    // being the only row that member has.
    const outgoing = results.find((row) => row.user_id === HOST && row.revoked_at !== null);
    const incoming = results.find((row) => row.user_id === GUEST);
    // The room changed hands ONCE, so the closing and the opening carry the same instant: an
    // interval that ended a millisecond before the next began would be a gap nobody was hosting in.
    expect(outgoing?.revoked_at).toBe(incoming?.granted_at);
    expect(outgoing?.revoked_by_user_id).toBe(HOST);
    // The old grant is CLOSED, never deleted: the interval is what the record is read for.
    expect(outgoing?.role).toBe("host");
  });

  it("refuses a target who is not in the room", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);

    const caught = await grantHosting(
      database.database,
      meetingId,
      { userId: GUEST, role: "host" },
      options,
    ).catch((error: unknown) => error);
    // A running meeting is not handed to somebody who is not in it: the room would be held by a
    // browser that is not open, and the next act would be a claim.
    expect(codeOf(caught)).toBe("meeting-not-joined");
  });

  it("lets the live-host index settle two hand-overs racing for the room", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    await join(database, meetingId, THIRD);

    // The window is real: the service reads the caller's grant in one round trip and commits in
    // another, so both hand-overs read the same standing host and both compose. What settles it is
    // the partial unique index and the outgoing grant's own guard — never the read.
    const racing = await runInterleaved({
      database: database.database,
      concurrentWriter: async () => {
        const other = await grantHosting(
          database.database,
          meetingId,
          { userId: THIRD, role: "host" },
          options,
        );
        await commit(database.database, other.effect);
      },
      operation: async (raced) => {
        const mine = await grantHosting(raced, meetingId, { userId: GUEST, role: "host" }, options);
        await commit(raced, mine.effect);
      },
    }).catch((error: unknown) => error);

    expect(racing).toBeInstanceOf(GuardedWriteRefusedError);
    const grants = await readLiveHostGrants(database.database, meetingId);
    // ONE live host, whatever the order the two landed in. The outgoing host is beside them as a
    // co-host, which is what a hand-over leaves behind — so the assertion is about the HOST role
    // rather than about how many grants the room holds.
    const hosting = grants.filter((grant) => grant.role === "host");
    expect(hosting).toHaveLength(1);
    expect(hosting[0]?.user_id).toBe(THIRD);
  });
});

describe("a co-host", () => {
  async function roomWithCoHost(database: ReturnType<typeof fresh>): Promise<MeetingId> {
    const meetingId = await roomOfTwo(database);
    const named = await grantHosting(
      database.database,
      meetingId,
      { userId: GUEST, role: "co-host" },
      options,
    );
    await commit(database.database, named.effect);
    return meetingId;
  }

  it("holds a grant of their own", async () => {
    const database = fresh();
    const meetingId = await roomWithCoHost(database);

    const grant = await requireHostGrant(database.database, meetingId, GUEST);
    expect(grant.role).toBe("co-host");
    expect(grant.granted_by_user_id).toBe(HOST);
    // The host keeps theirs: naming a co-host is not handing the room over.
    expect(await readLiveHostGrants(database.database, meetingId)).toHaveLength(2);
  });

  it("may not hand the room over, name another co-host, or withdraw a grant", async () => {
    const database = fresh();
    const meetingId = await roomWithCoHost(database);
    await join(database, meetingId, THIRD);

    const handedOver = await grantHosting(
      database.database,
      meetingId,
      { userId: THIRD, role: "host" },
      optionsFor(GUEST),
    ).catch((error: unknown) => error);
    const named = await grantHosting(
      database.database,
      meetingId,
      { userId: THIRD, role: "co-host" },
      optionsFor(GUEST),
    ).catch((error: unknown) => error);
    // SOMEBODY ELSE'S grant, which is the act a co-host does not have. Their own is a resignation
    // and is theirs to make — see the test below.
    const withdrawn = await revokeHosting(
      database.database,
      meetingId,
      HOST,
      optionsFor(GUEST),
    ).catch((error: unknown) => error);

    // A co-host is running the meeting with the host; they are not running the host.
    for (const refusal of [handedOver, named, withdrawn]) {
      expect(codeOf(refusal)).toBe("meeting-not-host");
    }
  });

  it("may stand down from their own grant without asking the host", async () => {
    const database = fresh();
    const meetingId = await roomWithCoHost(database);

    // A grant nobody but the host could close meant a co-host named for one agenda item carried the
    // mute, the spotlight and the door for the rest of the meeting, and the only way out was asking
    // the host to do it.
    const resigned = await revokeHosting(database.database, meetingId, GUEST, optionsFor(GUEST));
    await commit(database.database, resigned.effect);

    const grants = await readLiveHostGrants(database.database, meetingId);
    expect(grants.map((grant) => grant.user_id)).toEqual([HOST]);
    // Its own event, because both rows carry the caller as the actor: a stream with one name would
    // make "did somebody stand down, or were they stood down" a question you answer by comparing
    // two identifiers.
    const rows = await auditRows(database, meetingId);
    expect(rows.map((row) => row.event)).toContain("meetings.meeting.hostingResigned");
    expect(rows.map((row) => row.event)).not.toContain("meetings.meeting.coHostWithdrawn");
  });

  it("is what a host leaves behind when they hand the room over", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);

    const { effect } = await grantHosting(
      database.database,
      meetingId,
      { userId: GUEST, role: "host" },
      options,
    );
    await commit(database.database, effect);

    // A HAND-OVER IS NOT A WALK-OUT. The outgoing host is still in the meeting and still running it
    // with the person they handed it to; dropping them to an ordinary member would take the mute,
    // the spotlight and the door away from somebody who was hosting a second earlier, with nothing
    // on any screen to say it had happened.
    const grants = await readLiveHostGrants(database.database, meetingId);
    expect(grants.map((grant) => [grant.user_id, grant.role]).toSorted()).toEqual(
      [
        [GUEST, "host"],
        [HOST, "co-host"],
      ].toSorted(),
    );
  });

  it("can stand down even when they are the last grant beside a host who has gone", async () => {
    const database = fresh();
    const meetingId = await roomWithCoHost(database);

    // The host's own grant stands while they are away — hosting does not pass on its own — so this
    // is a co-host resigning out of a room whose only other grant-holder is absent. Allowed: the
    // room is not left with nobody running it, because the host still holds theirs.
    const resigned = await revokeHosting(database.database, meetingId, GUEST, optionsFor(GUEST));
    await commit(database.database, resigned.effect);
    expect(await readLiveHostGrants(database.database, meetingId)).toHaveLength(1);
  });

  it("may not remove the host, and may be withdrawn by them", async () => {
    const database = fresh();
    const meetingId = await roomWithCoHost(database);
    const hostStay = await readOpenAttendance(database.database, meetingId, HOST);

    const caught = await removeParticipant(
      database.database,
      meetingId,
      hostStay?.id as MeetingAttendanceId,
      optionsFor(GUEST),
    ).catch((error: unknown) => error);
    expect(codeOf(caught)).toBe("meeting-not-host");

    const withdrawn = await revokeHosting(database.database, meetingId, GUEST, options);
    await commit(database.database, withdrawn.effect);
    expect(await readLiveHostGrants(database.database, meetingId)).toHaveLength(1);
    // Closed rather than deleted, and the withdrawal says who did it.
    const { results } = await database.database
      .prepare("SELECT revoked_by_user_id FROM meeting_host WHERE meeting_id = ?1 AND user_id = ?2")
      .bind(meetingId, GUEST)
      .all<{ revoked_by_user_id: string | null }>();
    expect(results[0]?.revoked_by_user_id).toBe(HOST);
  });

  it("is refused hosting they never held, without a second interval being opened", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);

    // Nothing to withdraw is a success with nothing written: the caller asked for the member not to
    // be running the room, and they are not.
    const withdrawn = await revokeHosting(database.database, meetingId, GUEST, options);
    expect(withdrawn.effect.statements).toHaveLength(0);
  });
});

describe("claiming a room nobody is running", () => {
  it("is refused from a member who is not in the meeting at all", async () => {
    const database = fresh();
    // The starter holds the grant and nobody has arrived, so there is no other host PRESENT — which
    // used to be the whole of the question.
    const meetingId = await start(database);

    // NOBODY HANDS THIS GRANT OVER, so being in the room is what makes taking it an act of the
    // meeting rather than of the permission key. Without that, any member a firm lets convene
    // meetings could take a live one the minute the host's stay closed, from outside it.
    const caught = await claimHosting(database.database, meetingId, optionsFor(GUEST)).catch(
      (error: unknown) => error,
    );
    expect(codeOf(caught)).toBe("meeting-not-joined");
    // And nothing moved: the grant the meeting opened with is the grant it still has.
    expect(
      (await readLiveHostGrants(database.database, meetingId)).map((one) => one.user_id),
    ).toEqual([HOST]);
  });

  it("is refused from a member whose own stay has closed behind them", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    for (const userId of [HOST, GUEST]) {
      const left = await leaveMeeting(
        database.database,
        meetingId,
        optionsFor(userId, tickingClock()),
      );
      await commit(database.database, left.effect);
    }

    // Having BEEN in the room is not being in it. A member who left an hour ago is as outside the
    // meeting as one who never arrived, and the remedy for both is the same: join.
    const caught = await claimHosting(database.database, meetingId, optionsFor(GUEST)).catch(
      (error: unknown) => error,
    );
    expect(codeOf(caught)).toBe("meeting-not-joined");
  });

  it("is accepted from somebody who is in the room when the host's stay has closed", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    const left = await leaveMeeting(database.database, meetingId, optionsFor(HOST, tickingClock()));
    await commit(database.database, left.effect);

    const claimed = await claimHosting(database.database, meetingId, optionsFor(GUEST));
    expect(claimed.claimed).toBe(true);
    // Nobody was at a door, so the claim admits nothing — it is the grant alone.
    expect(claimed.admittedAttendanceId).toBeNull();
    await commit(database.database, claimed.effect);
    expect(await requireHostGrant(database.database, meetingId, GUEST)).toMatchObject({
      role: "host",
    });
  });

  it("is accepted from somebody at the DOOR, and admits them in the same batch", async () => {
    const database = fresh();
    const { meetingId: lobbyMeeting, effect: opened } = await createMeeting(
      database.database,
      { eventKind: "firm", eventId: FIRM_EVENT, lobby: "on" },
      options,
    );
    await commit(database.database, opened);
    await join(database, lobbyMeeting, HOST);
    // A lobby-on meeting whose host then goes: everybody queued for somebody who will never admit
    // them, which is the deadlock the claim exists to end. The claimer is AT the door rather than in
    // the room, and that counts — a host does not wait in their own lobby.
    const waiting = await joinMeeting(
      database.database,
      lobbyMeeting,
      optionsFor(GUEST, tickingClock()),
    );
    await commit(database.database, waiting.effect);
    expect(waiting.waiting).toBe(true);
    const left = await leaveMeeting(
      database.database,
      lobbyMeeting,
      optionsFor(HOST, tickingClock()),
    );
    await commit(database.database, left.effect);

    const claimed = await claimHosting(database.database, lobbyMeeting, optionsFor(GUEST));
    expect(claimed.claimed).toBe(true);
    expect(claimed.admittedAttendanceId).toBe(waiting.attendanceId);
    await commit(database.database, claimed.effect);

    const stay = await readOpenAttendance(database.database, lobbyMeeting, GUEST);
    expect(stay?.admitted_at).not.toBeNull();
    expect(await requireHostGrant(database.database, lobbyMeeting, GUEST)).toMatchObject({
      role: "host",
    });
  });

  it("is refused while a grant holder is in the room", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);

    const caught = await claimHosting(database.database, meetingId, optionsFor(GUEST)).catch(
      (error: unknown) => error,
    );
    expect(codeOf(caught)).toBe("meeting-not-host");
  });

  it("is accepted once the host has left, and is recorded as a claim rather than a hand-over", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    const left = await leaveMeeting(database.database, meetingId, optionsFor(HOST, tickingClock()));
    await commit(database.database, left.effect);

    // HOSTING DOES NOT PASS ON ITS OWN. The host's grant still stands while they are away — a
    // tunnel that dropped for ninety seconds has not ended anybody's hosting — and what changes the
    // answer is that nobody holding one is in the room.
    const claimed = await claimHosting(database.database, meetingId, optionsFor(GUEST));
    expect(claimed.claimed).toBe(true);
    await commit(database.database, claimed.effect);

    const grants = await readLiveHostGrants(database.database, meetingId);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.user_id).toBe(GUEST);
    // Nobody gave it, and the record says so in both places.
    expect(grants[0]?.granted_by_user_id).toBeNull();
    const events = (await auditRows(database, meetingId)).map((row) => row.event);
    expect(events).toContain("meetings.meeting.hostingClaimed");
    expect(events).not.toContain("meetings.meeting.hostingHandedOver");
  });

  it("lets a co-host alone in an abandoned room take it", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    const named = await grantHosting(
      database.database,
      meetingId,
      { userId: GUEST, role: "co-host" },
      options,
    );
    await commit(database.database, named.effect);
    const left = await leaveMeeting(database.database, meetingId, optionsFor(HOST, tickingClock()));
    await commit(database.database, left.effect);

    // Counting every live grant rather than every OTHER one would refuse the co-host the single act
    // their grant does not carry, and leave the room permanently without a host.
    const claimed = await claimHosting(database.database, meetingId, optionsFor(GUEST));
    await commit(database.database, claimed.effect);
    expect(await requireHostGrant(database.database, meetingId, GUEST)).toMatchObject({
      role: "host",
    });
  });

  it("is not blocked by a SECOND co-host sitting in the room with the first", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    await join(database, meetingId, THIRD);
    for (const userId of [GUEST, THIRD]) {
      const named = await grantHosting(
        database.database,
        meetingId,
        { userId, role: "co-host" },
        options,
      );
      await commit(database.database, named.effect);
    }
    const left = await leaveMeeting(database.database, meetingId, optionsFor(HOST, tickingClock()));
    await commit(database.database, left.effect);

    // TWO CO-HOSTS PRESENT AND THE HOST GONE was the room this refused, and it refused BOTH of
    // them: each saw the other's live grant and neither could take a room nobody was holding, so
    // the meeting stayed permanently without a host. A co-host is running the meeting WITH
    // somebody; they are not the somebody, and only a host in the room answers this question.
    const claimed = await claimHosting(database.database, meetingId, optionsFor(GUEST));
    expect(claimed.claimed).toBe(true);
    await commit(database.database, claimed.effect);

    const grants = await readLiveHostGrants(database.database, meetingId);
    // The claimer is the host and records the role as one; the OTHER co-host keeps theirs, because
    // the claim is about the room having nobody running it rather than about stripping grants on
    // the way past.
    expect(grants.filter((grant) => grant.role === "host").map((grant) => grant.user_id)).toEqual([
      GUEST,
    ]);
    expect(
      grants.filter((grant) => grant.role === "co-host").map((grant) => grant.user_id),
    ).toEqual([THIRD]);
  });

  it("is still refused while the host is present, whatever else the room holds", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    await join(database, meetingId, THIRD);
    const named = await grantHosting(
      database.database,
      meetingId,
      { userId: THIRD, role: "co-host" },
      options,
    );
    await commit(database.database, named.effect);

    // The host is in the room, so there is nothing to claim — the narrowing above is about which
    // grant answers the question, not about loosening it.
    const caught = await claimHosting(database.database, meetingId, optionsFor(GUEST)).catch(
      (error: unknown) => error,
    );
    expect(codeOf(caught)).toBe("meeting-not-host");
  });

  it("gives one claimant the room when two claim at once", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, GUEST);
    await join(database, meetingId, THIRD);

    const racing = await runInterleaved({
      database: database.database,
      concurrentWriter: async () => {
        const theirs = await claimHosting(database.database, meetingId, optionsFor(THIRD));
        await commit(database.database, theirs.effect);
      },
      operation: async (raced) => {
        const mine = await claimHosting(raced, meetingId, optionsFor(GUEST));
        await commit(raced, mine.effect);
      },
    }).catch((error: unknown) => error);

    // Both read a room nobody was running; the live-host index is what decides, and the loser's
    // whole batch rolls back rather than a second host appearing.
    expect(racing).toBeInstanceOf(Error);
    const hosts = (await readLiveHostGrants(database.database, meetingId)).filter(
      (grant) => grant.role === "host",
    );
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.user_id).toBe(THIRD);
  });
});

describe("removing somebody", () => {
  it("closes the stay as removed and bars them from this meeting", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    const stay = await readOpenAttendance(database.database, meetingId, GUEST);

    const removed = await removeParticipant(
      database.database,
      meetingId,
      stay?.id as MeetingAttendanceId,
      removing(),
    );
    expect(removed.userId).toBe(GUEST);
    await commit(database.database, removed.effect);

    const closed = await readBarredStay(database.database, meetingId, GUEST);
    expect(closed?.id).toBe(stay?.id);
    expect(closed?.ended_reason).toBe("removed");
    expect(closed?.left_at).not.toBeNull();

    const rejoined = await joinMeeting(
      database.database,
      meetingId,
      optionsFor(GUEST, tickingClock()),
    ).catch((error: unknown) => error);
    expect(codeOf(rejoined)).toBe("meeting-removed");
  });

  it("bars them from THIS MEETING and from nothing else: another room admits them", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    const stay = await readOpenAttendance(database.database, meetingId, GUEST);
    const removed = await removeParticipant(
      database.database,
      meetingId,
      stay?.id as MeetingAttendanceId,
      removing(),
    );
    await commit(database.database, removed.effect);

    // A SECOND ROOM, and it is on a second event because one meeting per event is held by the
    // database for the life of the record rather than only while the room is open. The bar this
    // asserts is per MEETING: nothing about being removed from one gathering follows the member
    // into another.
    const { meetingId: second, effect: opened } = await createMeeting(
      database.database,
      { eventKind: "firm", eventId: FIRM_EVENT },
      options,
    );
    await commit(database.database, opened);
    const arrived = await joinMeeting(database.database, second, optionsFor(GUEST, tickingClock()));
    await commit(database.database, arrived.effect);
    expect(await readOpenAttendance(database.database, second, GUEST)).toBeDefined();
  });

  it("refuses a caller removing themselves, because leaving is how a person leaves", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    const own = await readOpenAttendance(database.database, meetingId, HOST);

    const caught = await removeParticipant(
      database.database,
      meetingId,
      own?.id as MeetingAttendanceId,
      options,
    ).catch((error: unknown) => error);
    expect(codeOf(caught)).toBe("meeting-not-host");
  });

  it("takes the grant with them, so a removed co-host cannot claim the room back", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    const named = await grantHosting(
      database.database,
      meetingId,
      { userId: GUEST, role: "co-host" },
      options,
    );
    await commit(database.database, named.effect);
    const stay = await readOpenAttendance(database.database, meetingId, GUEST);

    const removed = await removeParticipant(
      database.database,
      meetingId,
      stay?.id as MeetingAttendanceId,
      removing(),
    );
    await commit(database.database, removed.effect);

    expect(await readLiveHostGrants(database.database, meetingId)).toHaveLength(1);
  });

  it("loses the race to a member who left in the window, and says so rather than writing twice", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    const stay = await readOpenAttendance(database.database, meetingId, GUEST);

    const racing = await runInterleaved({
      database: database.database,
      concurrentWriter: async () => {
        const left = await leaveMeeting(
          database.database,
          meetingId,
          optionsFor(GUEST, tickingClock()),
        );
        await commit(database.database, left.effect);
      },
      operation: async (raced) => {
        const removed = await removeParticipant(
          raced,
          meetingId,
          stay?.id as MeetingAttendanceId,
          options,
        );
        await commit(raced, removed.effect);
      },
    }).catch((error: unknown) => error);

    expect(racing).toBeInstanceOf(GuardedWriteRefusedError);
    // The instant already on the record is the member's own leaving, and a removal that lost the
    // race does not move it.
    const { results } = await database.database
      .prepare("SELECT ended_reason FROM meeting_attendance WHERE id = ?1")
      .bind(stay?.id)
      .all<{ ended_reason: string | null }>();
    expect(results[0]?.ended_reason).toBe("left");
  });
});

describe("the door", () => {
  it("refuses an arrival and touches nobody already in the room", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);

    const locked = await setMeetingLocked(database.database, meetingId, true, options);
    expect(locked.changed).toBe(true);
    await commit(database.database, locked.effect);

    const refused = await joinMeeting(
      database.database,
      meetingId,
      optionsFor(THIRD, tickingClock()),
    ).catch((error: unknown) => error);
    expect(codeOf(refused)).toBe("meeting-locked");

    // Nobody in the room is turned out of it, and a member whose browser reconnects gets the stay
    // they already hold rather than meeting the door.
    expect(await readOpenAttendance(database.database, meetingId, GUEST)).toBeDefined();
    const reconnected = await joinMeeting(
      database.database,
      meetingId,
      optionsFor(GUEST, tickingClock()),
    );
    expect(reconnected.effect.statements).toHaveLength(0);
  });

  it("opens again, and a room already in the state asked for writes nothing", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    const shut = await setMeetingLocked(database.database, meetingId, true, options);
    await commit(database.database, shut.effect);

    const again = await setMeetingLocked(database.database, meetingId, true, options);
    expect(again.changed).toBe(false);
    expect(again.effect.statements).toHaveLength(0);

    const opened = await setMeetingLocked(database.database, meetingId, false, options);
    await commit(database.database, opened.effect);
    const meeting = await readMeeting(database.database, meetingId, visibility);
    expect(meeting?.locked_at).toBeNull();
    expect(meeting?.locked_by_user_id).toBeNull();

    const arrived = await joinMeeting(
      database.database,
      meetingId,
      optionsFor(THIRD, tickingClock()),
    );
    await commit(database.database, arrived.effect);
    expect(await readOpenAttendance(database.database, meetingId, THIRD)).toBeDefined();
  });

  it("is a host act, refused to a member who is merely in the room", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);

    const caught = await setMeetingLocked(
      database.database,
      meetingId,
      true,
      optionsFor(GUEST),
    ).catch((error: unknown) => error);
    expect(codeOf(caught)).toBe("meeting-not-host");
  });
});

describe("ending it", () => {
  it("is refused to a key-holder who is not hosting, and allowed once they claim the room", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    const left = await leaveMeeting(database.database, meetingId, optionsFor(HOST, tickingClock()));
    await commit(database.database, left.effect);

    // The behaviour change, asserted deliberately: on the key alone, any member holding
    // `meetings:host` could close any meeting they could see the event for, without being in it.
    const refused = await endMeeting(
      database.database,
      meetingId,
      optionsFor(GUEST, tickingClock()),
    ).catch((error: unknown) => error);
    expect(codeOf(refused)).toBe("meeting-not-host");

    const claimed = await claimHosting(database.database, meetingId, optionsFor(GUEST));
    await commit(database.database, claimed.effect);
    const ended = await endMeeting(database.database, meetingId, optionsFor(GUEST, tickingClock()));
    await commit(database.database, ended.effect);
    expect((await readMeeting(database.database, meetingId, visibility))?.status).toBe("ended");
  });
});

describe("what the audit log carries", () => {
  it("is identifiers, instants and closed-vocabulary labels — and nothing else", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    await join(database, meetingId, THIRD);

    // Composed and committed one at a time, because each reads the state the one before it wrote:
    // a withdrawal composed against a grant that has not landed finds nothing to withdraw.
    const named = await grantHosting(
      database.database,
      meetingId,
      { userId: THIRD, role: "co-host" },
      options,
    );
    await commit(database.database, named.effect);
    const shut = await setMeetingLocked(database.database, meetingId, true, options);
    await commit(database.database, shut.effect);
    const withdrawn = await revokeHosting(database.database, meetingId, THIRD, options);
    await commit(database.database, withdrawn.effect);
    const stay = await readOpenAttendance(database.database, meetingId, GUEST);
    const removed = await removeParticipant(
      database.database,
      meetingId,
      stay?.id as MeetingAttendanceId,
      removing(),
    );
    await commit(database.database, removed.effect);

    const rows = await auditRows(database, meetingId);
    const hosting = rows.filter((row) => row.event.startsWith("meetings.meeting."));
    expect(hosting.map((row) => row.event)).toEqual(
      expect.arrayContaining([
        "meetings.meeting.coHostNamed",
        "meetings.meeting.lockChanged",
        "meetings.meeting.coHostWithdrawn",
        "meetings.meeting.removed",
        "meetings.meeting.left",
      ] as string[]),
    );

    // WHAT IS NEVER THERE: a name, a title, a word anybody said. Every value on every row is an
    // identifier, an instant, a boolean or a label from a closed vocabulary.
    const allowed = new Set([
      "attendanceId",
      "changedAt",
      "eventId",
      "eventKind",
      "grantedAt",
      "joinedAt",
      "leftAt",
      "lobby",
      "locked",
      "matterId",
      "medium",
      "reason",
      "removedAt",
      "revokedAt",
      "role",
      "startedAt",
      "userId",
    ]);
    for (const row of hosting) {
      const metadata = JSON.parse(row.metadata ?? "{}") as Record<string, unknown>;
      for (const [key, value] of Object.entries(metadata)) {
        expect(allowed, `${row.event} carries an unexpected field ${key}`).toContain(key);
        expect(
          typeof value === "string" || typeof value === "boolean" || value === null,
          `${row.event}.${key} is not an identifier, an instant, a label or a flag`,
        ).toBe(true);
      }
    }
    // And the departure the removal wrote is labelled for what it was, on the same event name every
    // other departure uses.
    const departure = rows.find((row) => row.event === "meetings.meeting.left");
    expect(JSON.parse(departure?.metadata ?? "{}")).toMatchObject({ reason: "removed" });
    expect(departure?.actor_user_id).toBe(GUEST);
    // The host's act is the row beside it, and it is the one that carries who did it.
    const act = rows.find((row) => row.event === "meetings.meeting.removed");
    expect(act?.actor_user_id).toBe(HOST);
  });

  it("stamps the clock the caller supplied rather than reading one of its own", async () => {
    const database = fresh();
    const meetingId = await roomOfTwo(database);
    const { effect } = await setMeetingLocked(database.database, meetingId, true, options);
    await commit(database.database, effect);

    const meeting = await readMeeting(database.database, meetingId, visibility);
    expect(meeting?.locked_at).toBe(clock.now());
    expect(meeting?.locked_by_user_id).toBe(HOST);
  });
});

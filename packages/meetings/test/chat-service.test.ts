import { describe, expect, it } from "vitest";
import type { MeetingId, MeetingMessageId } from "@magna-carta/identifiers/types";
import { postMeetingMessage, redactMeetingMessage } from "../src/chat-service.ts";
import { listMeetingMessages, readMeetingMessage } from "../src/chat-statements.ts";
import { MAX_MEETING_MESSAGE_LENGTH } from "../src/chat-types.ts";
import { MeetingChatValidationError } from "../src/chat-validation.ts";
import { createMeeting, joinMeeting, leaveMeeting } from "../src/meeting-service.ts";
import { MeetingValidationError } from "../src/validation.ts";
import {
  GUEST,
  HOST,
  MATTER,
  MATTER_EVENT,
  WALLED_MATTER_EVENT,
  clock,
  commit,
  migratedDatabase,
  options,
  optionsFor,
  seedFirm,
  tickingClock,
} from "./support.ts";

// The chat is the meeting's FIRST STORED CONTENT, so these tests are about the things that would be
// real failures if they stopped holding: that being in the room is what makes a message sayable,
// that taking one back leaves the record saying so, that a transcript reads forwards and walks
// without skipping or repeating, and that a room behind a matter the member may not see is as
// unreachable through the chat as it is through everything else.

function fresh() {
  const database = migratedDatabase();
  seedFirm(database.raw);
  return database;
}

type Database = ReturnType<typeof fresh>;

/**
 * A second visible event, because ONE MEETING PER EVENT is held by the database — a test that needs
 * two rooms needs two events.
 */
function anotherEvent(database: Database, id: string): string {
  database.raw.exec(
    `INSERT INTO matter_event (id, matter_id, title, status, starts_on, starts_at_time, ends_at_time, time_zone, recorded_at, recorded_by, created_at, updated_at) ` +
      `VALUES ('${id}', '${MATTER}', 'Second sitting', 'scheduled', '2026-09-22', '11:00', '12:00', 'America/Los_Angeles', ` +
      `'2026-09-01T00:00:00.000Z', '${HOST}', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  );
  return id;
}

async function startAndJoin(
  database: Database,
  eventId: string = MATTER_EVENT,
): Promise<MeetingId> {
  const { meetingId, effect } = await createMeeting(
    database.database,
    { eventKind: "matter", eventId },
    options,
  );
  await commit(database.database, effect);
  const joined = await joinMeeting(database.database, meetingId, options);
  await commit(database.database, joined.effect);
  return meetingId;
}

/**
 * A room on the platform-owned holding matter's event, seeded directly — the create path refuses it,
 * which is the point: this is what a meeting the reader may not see looks like from the outside.
 */
function walledMeeting(database: Database): MeetingId {
  const meetingId = "meeting_walledChatRoom0000" as MeetingId;
  database.raw.exec(
    `INSERT INTO meeting (id, event_kind, medium, matter_event_id, firm_event_id, status, created_by_user_id, ` +
      `started_at, ended_at, ended_by_user_id, created_at, updated_at) VALUES ` +
      `('${meetingId}', 'matter', 'video', '${WALLED_MATTER_EVENT}', NULL, 'live', '${HOST}', ` +
      `'2026-09-18T11:00:00.000Z', NULL, NULL, '2026-09-18T11:00:00.000Z', '2026-09-18T11:00:00.000Z')`,
  );
  database.raw.exec(
    `INSERT INTO meeting_attendance (id, meeting_id, user_id, joined_at, left_at, created_at, updated_at) ` +
      `VALUES ('meetingAttendance_walled00', '${meetingId}', '${HOST}', '2026-09-18T11:00:00.000Z', NULL, ` +
      `'2026-09-18T11:00:00.000Z', '2026-09-18T11:00:00.000Z')`,
  );
  return meetingId;
}

async function say(
  database: Database,
  meetingId: MeetingId,
  body: string,
  chatOptions = options,
): Promise<MeetingMessageId> {
  const { message, effect } = await postMeetingMessage(
    database.database,
    meetingId,
    { body },
    chatOptions,
  );
  await commit(database.database, effect);
  return message.id;
}

describe("saying something in a meeting", () => {
  it("stores the message against the stay it was said from", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);

    const messageId = await say(database, meetingId, "The exhibits are in the shared folder.");

    const stored = await readMeetingMessage(database.database, meetingId, messageId);
    expect(stored?.body).toBe("The exhibits are in the shared folder.");
    // The MEMBER is resolved through the stay rather than stored beside the message, which is what
    // makes a reconnecting browser's two stays each own the words said from them.
    expect(stored?.userId).toBe(HOST);
    expect(stored?.participantKind).toBe("member");
    expect(stored?.participantId).toMatch(/^meetingAttendance_/);
    expect(stored?.redactedAt).toBeNull();
  });

  it("is refused for a member who has left, and attributed to the new stay when they come back", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const guest = optionsFor(GUEST);
    const joined = await joinMeeting(database.database, meetingId, guest);
    await commit(database.database, joined.effect);

    const left = await leaveMeeting(database.database, meetingId, guest);
    await commit(database.database, left.effect);

    // BEING IN THE ROOM IS WHAT MAKES A MESSAGE SAYABLE, and the answer is the room's own — the
    // same one the signaling socket gives, rather than a second code meaning nearly the same thing.
    await expect(
      postMeetingMessage(database.database, meetingId, { body: "One more thing" }, guest),
    ).rejects.toMatchObject({ code: "meeting-not-joined" });

    const rejoined = await joinMeeting(database.database, meetingId, guest);
    await commit(database.database, rejoined.effect);
    const messageId = await say(database, meetingId, "One more thing", guest);
    const stored = await readMeetingMessage(database.database, meetingId, messageId);
    expect(stored?.userId).toBe(GUEST);
    // The SECOND stay owns it, not the first: two stays are what the record has, and the message
    // belongs to the one it was said from.
    expect(stored?.participantId).toBe(rejoined.attendanceId);
    expect(stored?.participantId).not.toBe(joined.attendanceId);
  });

  it("is refused for a member who never joined at all", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await expect(
      postMeetingMessage(database.database, meetingId, { body: "Hello" }, optionsFor(GUEST)),
    ).rejects.toBeInstanceOf(MeetingValidationError);
  });

  it("refuses a meeting on a matter the member may not see, in the wording of a room that is not there", async () => {
    const database = fresh();
    const walled = walledMeeting(database);

    await expect(
      postMeetingMessage(database.database, walled, { body: "Anything" }, options),
    ).rejects.toMatchObject({ code: "meeting-unknown-event" });
  });

  it("refuses an empty message and one past the ceiling, and trims only the edges", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);

    await expect(
      postMeetingMessage(database.database, meetingId, { body: "   \n  " }, options),
    ).rejects.toMatchObject({ code: "meeting-message-empty" });

    await expect(
      postMeetingMessage(
        database.database,
        meetingId,
        { body: "x".repeat(MAX_MEETING_MESSAGE_LENGTH + 1) },
        options,
      ),
    ).rejects.toBeInstanceOf(MeetingChatValidationError);

    // A message that fits after the trim is stored, and what is INSIDE it is the member's — the
    // blank line between two paragraphs survives.
    const messageId = await say(database, meetingId, "  first\n\nsecond  ");
    expect((await readMeetingMessage(database.database, meetingId, messageId))?.body).toBe(
      "first\n\nsecond",
    );
  });

  it("writes an audit row carrying identifiers and instants, and never the words", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const secret = "Settlement authority is up to ninety thousand.";
    await say(database, meetingId, secret);

    const { results } = await database.database
      .prepare(`SELECT metadata FROM audit_log WHERE event = 'meetings.chat.messageSent'`)
      .all<{ metadata: string }>();
    expect(results).toHaveLength(1);
    const metadata = JSON.parse(results[0]?.metadata ?? "{}") as Record<string, unknown>;
    expect(metadata["bodyLength"]).toBe(secret.length);
    expect(results[0]?.metadata).not.toContain("ninety thousand");
  });
});

describe("taking a message back", () => {
  it("blanks the body, keeps the row, and records who removed it and when", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const messageId = await say(database, meetingId, "Wrong window — ignore that.");

    const { redacted, effect } = await redactMeetingMessage(
      database.database,
      meetingId,
      messageId,
      options,
    );
    expect(redacted).toBe(true);
    await commit(database.database, effect);

    // THE ROW SURVIVES. A transcript with a silent hole in it is a transcript nobody can rely on,
    // so what the reader gets is an empty body beside the pair that says a removal happened.
    const stored = await readMeetingMessage(database.database, meetingId, messageId);
    expect(stored).toBeDefined();
    expect(stored?.body).toBe("");
    expect(stored?.redactedAt).toBe(clock.now());
    expect(stored?.redactedByUserId).toBe(HOST);
    // And it is still in the transcript rather than dropped from it.
    const page = await listMeetingMessages(database.database, meetingId, { limit: 10 });
    expect(page.map((entry) => entry.id)).toEqual([messageId]);
  });

  it("records the removal without recording what was removed", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const messageId = await say(
      database,
      meetingId,
      "The client's home address is on Pine Street.",
    );
    const { effect } = await redactMeetingMessage(database.database, meetingId, messageId, options);
    await commit(database.database, effect);

    const { results } = await database.database
      .prepare(`SELECT metadata FROM audit_log WHERE event = 'meetings.chat.messageRedacted'`)
      .all<{ metadata: string }>();
    expect(results).toHaveLength(1);
    // An audit row that recorded what a redaction removed would be the one place the removed words
    // survived, which is the opposite of what the member asked for.
    expect(results[0]?.metadata).not.toContain("Pine Street");
  });

  it("is refused for a third member, allowed for the author, and allowed for a host", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const guest = optionsFor(GUEST);
    const joined = await joinMeeting(database.database, meetingId, guest);
    await commit(database.database, joined.effect);

    const theirs = await say(database, meetingId, "A guest said this", guest);

    // A member who is neither the author nor hosting moderates nothing.
    await expect(
      redactMeetingMessage(database.database, meetingId, theirs, options),
    ).rejects.toMatchObject({ code: "meeting-message-not-redactable" });

    // The author takes back their own words.
    const own = await redactMeetingMessage(database.database, meetingId, theirs, guest);
    await commit(database.database, own.effect);
    expect((await readMeetingMessage(database.database, meetingId, theirs))?.body).toBe("");

    // And a host moderates the room.
    const mine = await say(database, meetingId, "A guest said this too", guest);
    const hosted = await redactMeetingMessage(database.database, meetingId, mine, {
      ...options,
      mayHost: true,
    });
    await commit(database.database, hosted.effect);
    expect((await readMeetingMessage(database.database, meetingId, mine))?.redactedByUserId).toBe(
      HOST,
    );
  });

  it("is a no-op the second time rather than moving the instant already on the record", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const messageId = await say(database, meetingId, "Said in error");
    const first = await redactMeetingMessage(database.database, meetingId, messageId, options);
    await commit(database.database, first.effect);

    const again = await redactMeetingMessage(database.database, meetingId, messageId, {
      ...options,
      clock: { now: () => "2026-09-19T09:00:00.000Z" },
    });
    expect(again.redacted).toBe(false);
    expect(again.effect.statements).toHaveLength(0);
    expect((await readMeetingMessage(database.database, meetingId, messageId))?.redactedAt).toBe(
      clock.now(),
    );
  });

  it("refuses a message handle from another meeting as one that names nothing", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const other = await startAndJoin(
      database,
      anotherEvent(database, "matterEvent_meetingChatTwo0"),
    );
    const messageId = await say(database, meetingId, "In the first room");

    // Addressed to the other room, so the caller's authorization against THAT room cannot reach a
    // message in this one. It answers as absent rather than as forbidden.
    await expect(
      redactMeetingMessage(database.database, other, messageId, options),
    ).rejects.toMatchObject({ code: "meeting-message-not-found" });

    const unrelated = "meetingMessage_nothingAtAll" as MeetingMessageId;
    await expect(
      redactMeetingMessage(database.database, meetingId, unrelated, options),
    ).rejects.toMatchObject({ code: "meeting-message-not-found" });
  });

  it("is refused outright in a room the member may not see", async () => {
    const database = fresh();
    const walled = walledMeeting(database);
    await expect(
      redactMeetingMessage(
        database.database,
        walled,
        "meetingMessage_whateverAtAll" as MeetingMessageId,
        options,
      ),
    ).rejects.toMatchObject({ code: "meeting-unknown-event" });
  });

  it("can still take back a message after the meeting has ended", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const messageId = await say(database, meetingId, "Regretted immediately");
    database.raw.exec(
      `UPDATE meeting SET status = 'ended', ended_at = '2026-09-18T13:00:00.000Z', ` +
        `ended_by_user_id = '${HOST}' WHERE id = '${meetingId}'`,
    );

    // The words outlive the gathering, so the need to take one back outlives it too — a member must
    // not be trapped by the host closing the room.
    const { redacted, effect } = await redactMeetingMessage(
      database.database,
      meetingId,
      messageId,
      options,
    );
    expect(redacted).toBe(true);
    await commit(database.database, effect);
    expect((await readMeetingMessage(database.database, meetingId, messageId))?.body).toBe("");
  });

  it("refuses a new message in a meeting that has ended", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    database.raw.exec(
      `UPDATE meeting SET status = 'ended', ended_at = '2026-09-18T13:00:00.000Z', ` +
        `ended_by_user_id = '${HOST}' WHERE id = '${meetingId}'`,
    );
    await expect(
      postMeetingMessage(database.database, meetingId, { body: "Late" }, options),
    ).rejects.toMatchObject({ code: "meeting-already-ended" });
  });
});

describe("reading a transcript", () => {
  it("reads forwards and walks the whole of it without skipping or repeating", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    // A ticking clock, because two messages sharing an instant would make the ordering a question
    // about the tiebreak rather than about the sort key.
    const ticking = { ...options, clock: tickingClock() };
    const said: MeetingMessageId[] = [];
    for (let index = 0; index < 7; index += 1) {
      said.push(await say(database, meetingId, `message ${String(index)}`, ticking));
    }

    const first = await listMeetingMessages(database.database, meetingId, { limit: 3 });
    // The read asks for one row past the page, and that row is the has-more probe rather than part
    // of the page.
    expect(first).toHaveLength(4);
    const page = first.slice(0, 3);
    expect(page.map((entry) => entry.id)).toEqual(said.slice(0, 3));

    const last = page[2];
    const second = await listMeetingMessages(database.database, meetingId, {
      limit: 3,
      cursor: { createdAt: last?.sentAt ?? "", id: last?.id ?? "" },
    });
    expect(second.slice(0, 3).map((entry) => entry.id)).toEqual(said.slice(3, 6));

    const third = await listMeetingMessages(database.database, meetingId, {
      limit: 3,
      cursor: {
        createdAt: second[2]?.sentAt ?? "",
        id: second[2]?.id ?? "",
      },
    });
    expect(third.map((entry) => entry.id)).toEqual(said.slice(6));
  });

  it("answers a poller with what has been said since its last instant", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const ticking = { ...options, clock: tickingClock() };
    await say(database, meetingId, "before", ticking);
    const watermark = (await listMeetingMessages(database.database, meetingId, { limit: 10 }))[0]
      ?.sentAt;
    await say(database, meetingId, "after", ticking);

    const fresher = await listMeetingMessages(database.database, meetingId, {
      limit: 10,
      since: watermark,
    });
    expect(fresher.map((entry) => entry.body)).toEqual(["after"]);
  });

  it("hands a poller the second of two messages stamped the same instant", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    // The fixed clock is not a contrivance here — it is the case this exists for. Two people typing
    // together, or one message and the acknowledgement a script sends behind it, land on the same
    // millisecond often enough that a live meeting produces it; what makes it a permanent loss
    // rather than a delay is that a poller continuing from an instant asks for what came strictly
    // after, and the next tick asks from later still.
    await say(database, meetingId, "one");
    await say(database, meetingId, "two");

    const both = await listMeetingMessages(database.database, meetingId, { limit: 10 });
    expect(both).toHaveLength(2);
    const [earlier, later] = both;
    expect(earlier?.sentAt).toBe(later?.sentAt);

    // The instant alone cannot say which of the two the poller has already read, so the strict
    // comparison answers with neither and the second message is gone for that reader.
    const byInstant = await listMeetingMessages(database.database, meetingId, {
      limit: 10,
      since: earlier?.sentAt,
    });
    expect(byInstant).toEqual([]);

    // The instant WITH the handle is a position in the list, and the tiebreak finds the row after it.
    const byPosition = await listMeetingMessages(database.database, meetingId, {
      limit: 10,
      since: earlier?.sentAt,
      sinceId: earlier?.id,
    });
    expect(byPosition.map((entry) => entry.id)).toEqual([later?.id]);
  });

  it("keeps one meeting's messages out of another's", async () => {
    const database = fresh();
    const here = await startAndJoin(database);
    const there = await startAndJoin(
      database,
      anotherEvent(database, "matterEvent_meetingChatSep"),
    );
    await say(database, here, "said here");
    await say(database, there, "said there");

    expect(
      (await listMeetingMessages(database.database, here, { limit: 10 })).map(
        (entry) => entry.body,
      ),
    ).toEqual(["said here"]);
  });
});

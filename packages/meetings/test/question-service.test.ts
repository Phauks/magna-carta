import { describe, expect, it } from "vitest";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import type { MeetingId, MeetingQuestionId } from "@magna-carta/identifiers/types";
import { createMeeting, joinMeeting, leaveMeeting } from "../src/meeting-service.ts";
import {
  ASK_QUESTION_GUARD,
  askMeetingQuestion,
  listMeetingQuestionEntries,
  readMeetingQuestionEntry,
  redactMeetingQuestion,
  setMeetingQuestionAnswered,
  upvoteMeetingQuestion,
  withdrawMeetingQuestionUpvote,
} from "../src/question-service.ts";
import { MAX_MEETING_QUESTIONS, MAX_MEETING_QUESTION_LENGTH } from "../src/question-types.ts";
import {
  FIRST_OF_CROWD,
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
} from "./support.ts";

// THE QUESTION QUEUE IS CONTENT ON CHAT'S TERMS, so these tests hold what would be a real failure if
// it stopped: being in the room is what makes a question askable, a queue cannot grow past its
// ceiling even when two questions race the last seat, an upvote is one per member and a withdrawal
// takes back exactly that one, answering moves both halves of its pair together, a taking-back keeps
// the row and blanks the words, and no audit row ever carries what was asked.

function fresh() {
  const database = migratedDatabase();
  seedFirm(database.raw);
  return database;
}

type Database = ReturnType<typeof fresh>;

async function startAndJoin(database: Database): Promise<MeetingId> {
  const { meetingId, effect } = await createMeeting(
    database.database,
    { eventKind: "matter", eventId: MATTER_EVENT },
    options,
  );
  await commit(database.database, effect);
  const joined = await joinMeeting(database.database, meetingId, options);
  await commit(database.database, joined.effect);
  return meetingId;
}

async function join(database: Database, meetingId: MeetingId, userId = GUEST): Promise<void> {
  const joined = await joinMeeting(database.database, meetingId, optionsFor(userId));
  await commit(database.database, joined.effect);
}

async function ask(
  database: Database,
  meetingId: MeetingId,
  body: string,
  askOptions = options,
): Promise<MeetingQuestionId> {
  const asked = await askMeetingQuestion(database.database, meetingId, { body }, askOptions);
  await commit(database.database, asked.effect);
  return asked.question.id;
}

/** Seeds a queue straight into the table — five hundred asks through the service would be slow. */
function fillQueue(database: Database, meetingId: MeetingId, count: number): void {
  for (let index = 0; index < count; index += 1) {
    database.raw.exec(
      `INSERT INTO meeting_question (id, meeting_id, participant_kind, participant_id, body, asked_at, ` +
        `created_at) VALUES ('meetingQuestion_seeded${String(index).padStart(6, "0")}', '${meetingId}', ` +
        `'member', 'meetingAttendance_seeded', 'Seeded question', '2026-09-18T11:00:00.000Z', ` +
        `'2026-09-18T11:00:00.000Z')`,
    );
  }
}

describe("asking a question", () => {
  it("stores it against the stay it was asked from", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const questionId = await ask(database, meetingId, "  When is the next hearing?\n");

    const stored = await readMeetingQuestionEntry(database.database, meetingId, questionId, HOST);
    expect(stored?.body).toBe("When is the next hearing?");
    expect(stored?.userId).toBe(HOST);
    expect(stored?.participantKind).toBe("member");
    expect(stored?.participantId).toMatch(/^meetingAttendance_/);
    expect(stored?.askedAt).toBe(clock.now());
    expect(stored?.upvotes).toBe(0);
  });

  it("needs an open stay: a member who left is refused with the room's own answer", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await expect(ask(database, meetingId, "Hello?", optionsFor(GUEST))).rejects.toMatchObject({
      code: "meeting-not-joined",
    });
    await join(database, meetingId);
    const left = await leaveMeeting(database.database, meetingId, optionsFor(GUEST));
    await commit(database.database, left.effect);
    await expect(ask(database, meetingId, "Hello?", optionsFor(GUEST))).rejects.toMatchObject({
      code: "meeting-not-joined",
    });
  });

  it("refuses an empty question and one past the ceiling", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await expect(ask(database, meetingId, "   ")).rejects.toMatchObject({
      code: "meeting-question-empty",
    });
    await expect(
      ask(database, meetingId, "q".repeat(MAX_MEETING_QUESTION_LENGTH + 1)),
    ).rejects.toMatchObject({ code: "meeting-question-too-long" });
  });

  it("refuses the five-hundred-and-first, and the insert's own guard holds the ceiling in a race", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    fillQueue(database, meetingId, MAX_MEETING_QUESTIONS - 1);

    // Composed while one seat is left, then the seat is taken: the batch must roll back whole.
    const racing = await askMeetingQuestion(
      database.database,
      meetingId,
      { body: "Late" },
      options,
    );
    await ask(database, meetingId, "The five hundredth");
    await expect(commit(database.database, racing.effect)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GuardedWriteRefusedError && error.guard === ASK_QUESTION_GUARD,
    );

    await expect(ask(database, meetingId, "One too many")).rejects.toMatchObject({
      code: "meeting-question-limit-reached",
    });
  });
});

describe("upvoting", () => {
  it("is one per member, idempotent, and a withdrawal removes exactly that one", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);
    await join(database, meetingId, FIRST_OF_CROWD);
    const questionId = await ask(database, meetingId, "Can we adjourn?");

    const first = await upvoteMeetingQuestion(
      database.database,
      meetingId,
      questionId,
      optionsFor(GUEST),
    );
    expect(first.upvoted).toBe(true);
    await commit(database.database, first.effect);
    const again = await upvoteMeetingQuestion(
      database.database,
      meetingId,
      questionId,
      optionsFor(GUEST),
    );
    expect(again.upvoted).toBe(false);
    expect(again.effect.statements).toHaveLength(0);
    const theirs = await upvoteMeetingQuestion(
      database.database,
      meetingId,
      questionId,
      optionsFor(FIRST_OF_CROWD),
    );
    await commit(database.database, theirs.effect);

    expect(
      (await readMeetingQuestionEntry(database.database, meetingId, questionId, GUEST))?.upvotes,
    ).toBe(2);
    expect(
      (await readMeetingQuestionEntry(database.database, meetingId, questionId, GUEST))
        ?.upvotedByCaller,
    ).toBe(true);

    const withdrawn = await withdrawMeetingQuestionUpvote(
      database.database,
      meetingId,
      questionId,
      optionsFor(GUEST),
    );
    expect(withdrawn.withdrawn).toBe(true);
    await commit(database.database, withdrawn.effect);
    const after = await readMeetingQuestionEntry(database.database, meetingId, questionId, GUEST);
    expect(after?.upvotes).toBe(1);
    expect(after?.upvotedByCaller).toBe(false);
    // The other member's upvote stands.
    expect(
      (await readMeetingQuestionEntry(database.database, meetingId, questionId, FIRST_OF_CROWD))
        ?.upvotedByCaller,
    ).toBe(true);

    const nothing = await withdrawMeetingQuestionUpvote(
      database.database,
      meetingId,
      questionId,
      optionsFor(GUEST),
    );
    expect(nothing.withdrawn).toBe(false);
  });

  it("is not a second vote from a later stay after leaving and rejoining", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);
    const questionId = await ask(database, meetingId, "Can we adjourn?");
    const first = await upvoteMeetingQuestion(
      database.database,
      meetingId,
      questionId,
      optionsFor(GUEST),
    );
    await commit(database.database, first.effect);

    const left = await leaveMeeting(database.database, meetingId, optionsFor(GUEST));
    await commit(database.database, left.effect);
    await join(database, meetingId);
    const second = await upvoteMeetingQuestion(
      database.database,
      meetingId,
      questionId,
      optionsFor(GUEST),
    );
    expect(second.upvoted).toBe(false);
    expect(
      (await readMeetingQuestionEntry(database.database, meetingId, questionId, GUEST))?.upvotes,
    ).toBe(1);
  });
});

describe("marking a question answered", () => {
  it("moves both halves of the pair together, in both directions", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const questionId = await ask(database, meetingId, "Is the bundle filed?");

    const marked = await setMeetingQuestionAnswered(
      database.database,
      meetingId,
      questionId,
      true,
      options,
    );
    expect(marked.changed).toBe(true);
    await commit(database.database, marked.effect);
    let stored = await readMeetingQuestionEntry(database.database, meetingId, questionId, HOST);
    expect(stored?.answeredAt).toBe(clock.now());
    expect(stored?.answeredByUserId).toBe(HOST);

    const same = await setMeetingQuestionAnswered(
      database.database,
      meetingId,
      questionId,
      true,
      options,
    );
    expect(same.changed).toBe(false);

    const unmarked = await setMeetingQuestionAnswered(
      database.database,
      meetingId,
      questionId,
      false,
      options,
    );
    await commit(database.database, unmarked.effect);
    stored = await readMeetingQuestionEntry(database.database, meetingId, questionId, HOST);
    expect(stored?.answeredAt).toBeNull();
    expect(stored?.answeredByUserId).toBeNull();
  });

  it("is a host act", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);
    const questionId = await ask(database, meetingId, "Is the bundle filed?");
    await expect(
      setMeetingQuestionAnswered(database.database, meetingId, questionId, true, optionsFor(GUEST)),
    ).rejects.toMatchObject({ code: "meeting-not-host" });
  });
});

describe("taking a question back", () => {
  it("blanks the body and keeps the row", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const questionId = await ask(database, meetingId, "Wrong window, ignore that.");
    const redaction = await redactMeetingQuestion(
      database.database,
      meetingId,
      questionId,
      options,
    );
    await commit(database.database, redaction.effect);

    const stored = await readMeetingQuestionEntry(database.database, meetingId, questionId, HOST);
    expect(stored?.body).toBe("");
    expect(stored?.redactedAt).toBe(clock.now());
    expect(stored?.redactedByUserId).toBe(HOST);
    const page = await listMeetingQuestionEntries(
      database.database,
      meetingId,
      { limit: 10 },
      options,
    );
    expect(page.map((entry) => entry.id)).toEqual([questionId]);

    const again = await redactMeetingQuestion(database.database, meetingId, questionId, options);
    expect(again.redacted).toBe(false);
  });

  it("is refused for a third member, allowed for the author, and allowed for a host", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);
    await join(database, meetingId, FIRST_OF_CROWD);
    const authors = await ask(database, meetingId, "A member asked this", optionsFor(GUEST));
    const hosts = await ask(database, meetingId, "Another", optionsFor(GUEST));

    await expect(
      redactMeetingQuestion(database.database, meetingId, authors, optionsFor(FIRST_OF_CROWD)),
    ).rejects.toMatchObject({ code: "meeting-question-not-redactable" });

    const own = await redactMeetingQuestion(
      database.database,
      meetingId,
      authors,
      optionsFor(GUEST),
    );
    expect(own.redacted).toBe(true);
    const host = await redactMeetingQuestion(database.database, meetingId, hosts, options);
    expect(host.redacted).toBe(true);
  });
});

describe("the queue", () => {
  it("walks on (asked_at, id), and `since` agrees with the cursor", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const ticking = { ...options, clock: tickingClock() };
    const ids: MeetingQuestionId[] = [];
    for (let index = 0; index < 5; index += 1) {
      ids.push(await ask(database, meetingId, `Question ${String(index)}`, ticking));
    }
    const all = await listMeetingQuestionEntries(
      database.database,
      meetingId,
      { limit: 10 },
      options,
    );
    expect(all.map((entry) => entry.id)).toEqual(ids);

    const third = all[2];
    const following = await listMeetingQuestionEntries(
      database.database,
      meetingId,
      { limit: 10, since: third?.askedAt, sinceId: third?.id },
      options,
    );
    const walked = await listMeetingQuestionEntries(
      database.database,
      meetingId,
      { limit: 10, cursor: { createdAt: third?.askedAt ?? "", id: third?.id ?? "" } },
      options,
    );
    expect(following.map((entry) => entry.id)).toEqual(ids.slice(3));
    expect(walked.map((entry) => entry.id)).toEqual(following.map((entry) => entry.id));
  });
});

describe("the audit rows", () => {
  it("carry identifiers and instants, and never what was asked", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);
    const secret = "Is settlement authority really ninety thousand?";
    const questionId = await ask(database, meetingId, secret, optionsFor(GUEST));
    const upvote = await upvoteMeetingQuestion(database.database, meetingId, questionId, options);
    await commit(database.database, upvote.effect);
    const withdrawal = await withdrawMeetingQuestionUpvote(
      database.database,
      meetingId,
      questionId,
      options,
    );
    await commit(database.database, withdrawal.effect);
    const marked = await setMeetingQuestionAnswered(
      database.database,
      meetingId,
      questionId,
      true,
      options,
    );
    await commit(database.database, marked.effect);
    const redaction = await redactMeetingQuestion(
      database.database,
      meetingId,
      questionId,
      options,
    );
    await commit(database.database, redaction.effect);

    const { results } = await database.database
      .prepare(`SELECT event, metadata FROM audit_log WHERE event LIKE 'meetings.question.%'`)
      .all<{ event: string; metadata: string }>();
    expect(results.map((row) => row.event).toSorted()).toEqual([
      "meetings.question.answered",
      "meetings.question.asked",
      "meetings.question.redacted",
      "meetings.question.upvoteWithdrawn",
      "meetings.question.upvoted",
    ]);
    for (const row of results) {
      expect(row.metadata).not.toContain("ninety thousand");
      const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
      for (const value of Object.values(metadata)) {
        expect(["string", "number", "boolean"]).toContain(typeof value);
        if (typeof value === "string") {
          expect(value).toMatch(/^(meeting[A-Za-z]*_[A-Za-z0-9_-]+|\d{4}-\d{2}-\d{2}T[\d:.]+Z)$/);
        }
      }
    }
  });
});

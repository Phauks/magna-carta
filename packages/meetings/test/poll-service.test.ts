import { describe, expect, it } from "vitest";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import type {
  MeetingId,
  MeetingPollAnswerId,
  MeetingPollId,
  MeetingPollOptionId,
} from "@magna-carta/identifiers/types";
import { createMeeting, joinMeeting, leaveMeeting } from "../src/meeting-service.ts";
import {
  ANSWER_POLL_GUARD,
  answerMeetingPoll,
  closeMeetingPoll,
  listMeetingPollEntries,
  openMeetingPoll,
  readAttributedPollAnswers,
  readMeetingPollEntry,
} from "../src/poll-service.ts";
import { insertAnonymousAnswerStatement } from "../src/poll-statements.ts";
import { MAX_MEETING_POLL_QUESTION_LENGTH } from "../src/poll-types.ts";
import {
  CROWD,
  GUEST,
  HOST,
  MATTER_EVENT,
  WALLED_MATTER_EVENT,
  clock,
  commit,
  migratedDatabase,
  options,
  optionsFor,
  seedFirm,
} from "./support.ts";

// A POLL IS ON THE RECORD FROM THE MOMENT IT OPENS, and these tests are about what would be a real
// failure if it stopped holding: only somebody running the room asks it, only somebody in the room
// answers it, one participation per member however many options it names, an answer that names
// another poll's option is refused by the database itself, a poll that does not show names keeps the
// choice and the chooser in two tables that cannot answer each other's question, and no audit row
// ever carries what was asked or what was chosen.

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

async function open(
  database: Database,
  meetingId: MeetingId,
  input: Partial<{
    question: string;
    options: readonly string[];
    anonymous: boolean;
    maxChoices: number;
  }> = {},
) {
  const opened = await openMeetingPoll(
    database.database,
    meetingId,
    {
      question: input.question ?? "Which date suits for the mediation?",
      options: input.options ?? ["The fourteenth", "The twenty-first", "The twenty-eighth"],
      anonymous: input.anonymous ?? false,
      maxChoices: input.maxChoices ?? 1,
    },
    options,
  );
  await commit(database.database, opened.effect);
  return opened.poll;
}

async function answer(
  database: Database,
  meetingId: MeetingId,
  pollId: MeetingPollId,
  optionIds: readonly string[],
  userId = GUEST,
): Promise<void> {
  const answered = await answerMeetingPoll(
    database.database,
    meetingId,
    pollId,
    { optionIds },
    optionsFor(userId),
  );
  await commit(database.database, answered.effect);
}

function walledMeeting(database: Database): MeetingId {
  const meetingId = "meeting_walledPollRoom0000" as MeetingId;
  database.raw.exec(
    `INSERT INTO meeting (id, event_kind, medium, matter_event_id, firm_event_id, status, created_by_user_id, ` +
      `started_at, ended_at, ended_by_user_id, created_at, updated_at) VALUES ` +
      `('${meetingId}', 'matter', 'video', '${WALLED_MATTER_EVENT}', NULL, 'live', '${HOST}', ` +
      `'2026-09-18T11:00:00.000Z', NULL, NULL, '2026-09-18T11:00:00.000Z', '2026-09-18T11:00:00.000Z')`,
  );
  return meetingId;
}

describe("opening a poll", () => {
  it("opens with its options in position order, on the record at once", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const poll = await open(database, meetingId);

    const stored = await readMeetingPollEntry(database.database, meetingId, poll.id, options);
    expect(stored.question).toBe("Which date suits for the mediation?");
    expect(stored.openedAt).toBe(clock.now());
    expect(stored.closedAt).toBeNull();
    expect(stored.options.map((option) => [option.position, option.label, option.count])).toEqual([
      [0, "The fourteenth", 0],
      [1, "The twenty-first", 0],
      [2, "The twenty-eighth", 0],
    ]);
    expect(stored.respondents).toBe(0);
    expect(stored.answeredByCaller).toBe(false);
  });

  it("is a host act — a member holding no grant on this meeting is refused", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);

    await expect(
      openMeetingPoll(
        database.database,
        meetingId,
        { question: "Lunch?", options: ["Yes", "No"], anonymous: false, maxChoices: 1 },
        optionsFor(GUEST),
      ),
    ).rejects.toMatchObject({ code: "meeting-not-host" });
  });

  it("refuses a body past its ceilings, naming the field that failed", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const cases: readonly (readonly [Parameters<typeof open>[2], string])[] = [
      [{ question: "x".repeat(MAX_MEETING_POLL_QUESTION_LENGTH + 1) }, "question"],
      [{ question: "   " }, "question"],
      [{ options: ["Only one"] }, "options"],
      [
        { options: Array.from({ length: 11 }, (_unused, index) => `Option ${String(index)}`) },
        "options",
      ],
      [{ options: ["Same", "Same"] }, "options"],
      [{ options: ["Fine", "y".repeat(201)] }, "options"],
      [{ maxChoices: 4 }, "maxChoices"],
      [{ maxChoices: 0 }, "maxChoices"],
    ];
    for (const [input, field] of cases) {
      await expect(open(database, meetingId, input)).rejects.toMatchObject({
        code: "meeting-poll-invalid",
        field,
      });
    }
  });

  it("is as unreachable in a walled meeting as the meeting itself", async () => {
    const database = fresh();
    const meetingId = walledMeeting(database);
    await expect(open(database, meetingId)).rejects.toMatchObject({
      code: "meeting-unknown-event",
    });
    await expect(
      listMeetingPollEntries(database.database, meetingId, { limit: 10 }, options),
    ).rejects.toMatchObject({ code: "meeting-unknown-event" });
  });
});

describe("answering a poll", () => {
  it("needs an open stay: a member who never joined, and one who left, are both refused", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const poll = await open(database, meetingId);
    const first = poll.options[0]?.optionId ?? "";

    await expect(answer(database, meetingId, poll.id, [first])).rejects.toMatchObject({
      code: "meeting-not-joined",
    });

    await join(database, meetingId);
    const left = await leaveMeeting(database.database, meetingId, optionsFor(GUEST));
    await commit(database.database, left.effect);
    await expect(answer(database, meetingId, poll.id, [first])).rejects.toMatchObject({
      code: "meeting-not-joined",
    });
  });

  it("is one participation, even when the first used every choice the poll allows", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);
    const poll = await open(database, meetingId, {
      options: ["Alpha", "Bravo", "Charlie", "Delta"],
      maxChoices: 3,
    });
    const [alpha, bravo, charlie, delta] = poll.options.map((option) => option.optionId);

    await answer(database, meetingId, poll.id, [alpha ?? "", bravo ?? "", charlie ?? ""]);
    await expect(answer(database, meetingId, poll.id, [delta ?? ""])).rejects.toMatchObject({
      code: "meeting-poll-already-answered",
    });

    const tally = await readMeetingPollEntry(
      database.database,
      meetingId,
      poll.id,
      optionsFor(GUEST),
    );
    expect(tally.respondents).toBe(1);
    expect(tally.options.map((option) => option.count)).toEqual([1, 1, 1, 0]);
    expect(tally.answeredByCaller).toBe(true);
  });

  it("is refused by the respondent row's own guard when the read could not see the first answer", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);
    const poll = await open(database, meetingId);
    const first = poll.options[0]?.optionId ?? "";

    // Two answers composed from the same state, as two requests racing would be: the second batch
    // must roll back whole rather than put a second participation on the record.
    const one = await answerMeetingPoll(
      database.database,
      meetingId,
      poll.id,
      { optionIds: [first] },
      optionsFor(GUEST),
    );
    const two = await answerMeetingPoll(
      database.database,
      meetingId,
      poll.id,
      { optionIds: [first] },
      optionsFor(GUEST),
    );
    await commit(database.database, one.effect);
    await expect(commit(database.database, two.effect)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GuardedWriteRefusedError && error.guard === ANSWER_POLL_GUARD,
    );
    const entry = await readMeetingPollEntry(database.database, meetingId, poll.id, options);
    expect(entry.respondents).toBe(1);
    expect(entry.options[0]?.count).toBe(1);
  });

  it("is not a second vote from a later stay after leaving and rejoining", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);
    const poll = await open(database, meetingId);
    const [first, second] = poll.options.map((option) => option.optionId);
    await answer(database, meetingId, poll.id, [first ?? ""]);

    const left = await leaveMeeting(database.database, meetingId, optionsFor(GUEST));
    await commit(database.database, left.effect);
    await join(database, meetingId);

    await expect(answer(database, meetingId, poll.id, [second ?? ""])).rejects.toMatchObject({
      code: "meeting-poll-already-answered",
    });
  });

  it("refuses more choices than the poll allows, and an option of another poll", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);
    const poll = await open(database, meetingId);
    const other = await open(database, meetingId, { question: "Another question?" });
    const [first, second] = poll.options.map((option) => option.optionId);

    await expect(
      answer(database, meetingId, poll.id, [first ?? "", second ?? ""]),
    ).rejects.toMatchObject({ code: "meeting-poll-invalid", field: "optionIds" });
    await expect(
      answer(database, meetingId, poll.id, [other.options[0]?.optionId ?? ""]),
    ).rejects.toMatchObject({ code: "meeting-poll-invalid", field: "optionIds" });
  });

  it("fails at the foreign key when an answer names another poll's option, whoever writes it", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const poll = await open(database, meetingId);
    const other = await open(database, meetingId, { question: "Another question?" });

    // Past the service entirely: the database is not only written by this package, and the pair
    // (poll, option) is what the answer's foreign key references.
    await expect(
      commit(database.database, {
        statements: [
          insertAnonymousAnswerStatement(database.database, {
            id: "meetingPollAnswer_crossedPoll0000" as MeetingPollAnswerId,
            pollId: poll.id,
            optionId: (other.options[0]?.optionId ?? "") as MeetingPollOptionId,
          }),
        ],
        outboxMessages: [],
      }),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("is refused once the poll has closed", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);
    const poll = await open(database, meetingId);
    const closed = await closeMeetingPoll(database.database, meetingId, poll.id, options);
    await commit(database.database, closed.effect);

    await expect(
      answer(database, meetingId, poll.id, [poll.options[0]?.optionId ?? ""]),
    ).rejects.toMatchObject({ code: "meeting-poll-closed" });
  });
});

describe("a poll that does not show names", () => {
  it("keeps the choice without the chooser and the chooser without the choice, and the tally agrees", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);
    await join(database, meetingId, CROWD[0]);
    const poll = await open(database, meetingId, { anonymous: true });
    const [first, second] = poll.options.map((option) => option.optionId);

    await answer(database, meetingId, poll.id, [first ?? ""]);
    await answer(database, meetingId, poll.id, [second ?? ""], CROWD[0]);

    const answers = database.raw
      .prepare(`SELECT * FROM meeting_poll_answer WHERE poll_id = ?`)
      .all(poll.id) as Record<string, unknown>[];
    expect(answers).toHaveLength(2);
    for (const row of answers) {
      expect(row["participant_kind"]).toBeNull();
      expect(row["participant_id"]).toBeNull();
      // No instant on the row at all: one would re-link it to the respondent row written beside it.
      expect(Object.keys(row).some((column) => column.endsWith("_at"))).toBe(false);
    }

    const respondents = database.raw
      .prepare(`SELECT * FROM meeting_poll_respondent WHERE poll_id = ?`)
      .all(poll.id) as Record<string, unknown>[];
    expect(respondents).toHaveLength(2);
    for (const row of respondents) {
      expect(row["participant_kind"]).toBe("member");
      expect(String(row["participant_id"])).toMatch(/^meetingAttendance_/);
      expect(row["answered_at"]).toBe(clock.now());
      // And nothing about what was chosen.
      expect(Object.keys(row)).not.toContain("option_id");
    }

    const tally = await readMeetingPollEntry(database.database, meetingId, poll.id, options);
    expect(tally.respondents).toBe(2);
    expect(tally.options.map((option) => option.count)).toEqual([1, 1, 0]);
  });

  it("refuses the attributed read rather than answering it with an empty page", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const poll = await open(database, meetingId, { anonymous: true });
    await expect(
      readAttributedPollAnswers(database.database, meetingId, poll.id, { limit: 10 }, options),
    ).rejects.toMatchObject({ code: "meeting-poll-answers-not-attributed" });
  });
});

describe("a poll that shows names", () => {
  it("answers the attributed read with each participation and what it chose", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);
    const poll = await open(database, meetingId, { maxChoices: 2 });
    const [first, , third] = poll.options.map((option) => option.optionId);
    await answer(database, meetingId, poll.id, [third ?? "", first ?? ""]);

    const page = await readAttributedPollAnswers(
      database.database,
      meetingId,
      poll.id,
      { limit: 10 },
      options,
    );
    expect(page).toHaveLength(1);
    expect(page[0]?.userId).toBe(GUEST);
    expect(page[0]?.participantKind).toBe("member");
    // In the poll's own order, whatever order they were sent in.
    expect(page[0]?.optionIds).toEqual([first, third]);

    // A host read: a member with no grant is refused.
    await expect(
      readAttributedPollAnswers(
        database.database,
        meetingId,
        poll.id,
        { limit: 10 },
        optionsFor(GUEST),
      ),
    ).rejects.toMatchObject({ code: "meeting-not-host" });
  });
});

describe("closing a poll", () => {
  it("writes both halves of the pair, and a second close changes nothing", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const poll = await open(database, meetingId);

    const closed = await closeMeetingPoll(database.database, meetingId, poll.id, options);
    expect(closed.closed).toBe(true);
    await commit(database.database, closed.effect);
    const stored = await readMeetingPollEntry(database.database, meetingId, poll.id, options);
    expect(stored.closedAt).toBe(clock.now());
    expect(stored.closedByUserId).toBe(HOST);

    const again = await closeMeetingPoll(database.database, meetingId, poll.id, options);
    expect(again.closed).toBe(false);
    expect(again.effect.statements).toHaveLength(0);
  });

  it("is a host act", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);
    const poll = await open(database, meetingId);
    await expect(
      closeMeetingPoll(database.database, meetingId, poll.id, optionsFor(GUEST)),
    ).rejects.toMatchObject({ code: "meeting-not-host" });
  });

  it("lists newest first, and walks without skipping or repeating", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    const first = await open(database, meetingId, { question: "First?" });
    const second = await open(database, meetingId, { question: "Second?" });
    const listed = await listMeetingPollEntries(
      database.database,
      meetingId,
      { limit: 10 },
      options,
    );
    // Opened in the same instant, so the handle breaks the tie — descending, like the instant.
    const expected = [first.id, second.id].toSorted().toReversed();
    expect(listed.map((entry) => entry.id)).toEqual(expected);
  });
});

describe("the audit rows", () => {
  it("carry identifiers and instants, and never the question, a label or which option was chosen", async () => {
    const database = fresh();
    const meetingId = await startAndJoin(database);
    await join(database, meetingId);
    const poll = await open(database, meetingId, {
      question: "Should we accept the offer of ninety thousand?",
      options: ["Accept the offer", "Counter at one hundred"],
    });
    const chosen = poll.options[1]?.optionId ?? "";
    await answer(database, meetingId, poll.id, [chosen]);
    const closed = await closeMeetingPoll(database.database, meetingId, poll.id, options);
    await commit(database.database, closed.effect);

    const { results } = await database.database
      .prepare(`SELECT event, metadata FROM audit_log WHERE event LIKE 'meetings.poll.%'`)
      .all<{ event: string; metadata: string }>();
    expect(results.map((row) => row.event).toSorted()).toEqual([
      "meetings.poll.answered",
      "meetings.poll.closed",
      "meetings.poll.opened",
    ]);
    for (const row of results) {
      expect(row.metadata).not.toContain("ninety thousand");
      expect(row.metadata).not.toContain("Accept the offer");
      expect(row.metadata).not.toContain("Counter at one hundred");
      // The explicit case: no answer's option ever reaches an audit row.
      for (const option of poll.options) expect(row.metadata).not.toContain(option.optionId);
      // Every value is an identifier, an instant, a count or a flag — nothing a person typed.
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

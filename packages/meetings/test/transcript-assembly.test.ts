import { describe, expect, it } from "vitest";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import type { MeetingRecordingTrackId, UserId } from "@magna-carta/identifiers/types";
import { createMeeting, joinMeeting } from "../src/meeting-service.ts";
import { startMeetingRecording } from "../src/recording-service.ts";
import { listRecordingTracks, readRecordingById } from "../src/recording-statements.ts";
import type {
  MeetingRecordingCandidateTrack,
  MeetingRecordingRow,
  MeetingRecordingTrackRow,
} from "../src/recording-types.ts";
import {
  compareLines,
  countWords,
  gapsForTracks,
  inReadingOrder,
  placeHeardSegments,
  PROMPT_TAIL_MAXIMUM_CHARACTERS,
  promptTail,
  wholeRecordingGap,
} from "../src/transcript-assembly.ts";
import {
  assembleTranscriptStatements,
  beginTranscriptStatements,
  claimTranscriptWindowEffect,
  cursorOf,
  failTranscriptEffect,
  TRANSCRIPT_CLAIM_GUARD,
  TRANSCRIPT_FAIL_GUARD,
  TRANSCRIPT_PROGRESS_GUARD,
  transcriptProgressEffect,
} from "../src/transcript-service.ts";
import {
  listTranscriptSegments,
  readLastTrackWords,
  readTranscriptById,
} from "../src/transcript-statements.ts";
import {
  CROWD,
  HOST,
  MATTER_EVENT,
  clock,
  commit,
  migratedDatabase,
  options,
  seedFirm,
} from "./support.ts";

// FROM WHAT THE MODEL HEARD TO A TRANSCRIPT. What would be a real failure: a line placed anywhere but
// at its piece's own offset, or spilling outside it; lines from different tracks read in any order but
// when they began, so overlapping speech is not interleaved; a lost track's silence left unsaid, or said
// twice; a recording in which nobody was heard filed as an empty document rather than one that says so;
// a guest's words attributed to anybody but the guest; two consumers both writing a piece; or the
// renumbering failing the unique index on its way to the reading order.

const STARTED_AT = "2026-09-18T12:00:00.000Z";
const STOPPED_AT = "2026-09-18T12:10:00.000Z";

describe("placing what the model heard", () => {
  it("puts each segment at the piece's offset plus its own, inside the piece, and drops empty ones", () => {
    expect(
      placeHeardSegments({
        piece: { startedMs: 60_000, endedMs: 90_000 },
        text: "ignored when there are segments",
        segments: [
          { startSeconds: 0.5, endSeconds: 2.25, text: "  Good\nmorning. " },
          { startSeconds: 3, endSeconds: 3.5, text: "   " },
          // A model running a little past its piece is kept inside it.
          { startSeconds: 29, endSeconds: 31, text: "Thank you." },
        ],
      }),
    ).toEqual([
      { startedMs: 60_500, endedMs: 62_250, text: "Good morning." },
      { startedMs: 89_000, endedMs: 90_000, text: "Thank you." },
    ]);
  });

  it("drops a segment that begins at or past the end of its piece — words reported where nothing was sent", () => {
    expect(
      placeHeardSegments({
        piece: { startedMs: 10_000, endedMs: 12_000 },
        text: "Yes. Thank you for watching.",
        segments: [
          { startSeconds: 0.1, endSeconds: 0.6, text: "Yes." },
          // At the piece's very end, and past it: a hallucinated tail, not a zero-length line.
          { startSeconds: 2, endSeconds: 4, text: "Thank you" },
          { startSeconds: 5, endSeconds: 7, text: "for watching." },
        ],
      }),
    ).toEqual([{ startedMs: 10_100, endedMs: 10_600, text: "Yes." }]);
    // Every segment past the piece: nothing, and the untimed text is NOT used in their place, because
    // the model did report timings and every one of them was somewhere it was sent nothing.
    expect(
      placeHeardSegments({
        piece: { startedMs: 0, endedMs: 1_000 },
        text: "Thank you.",
        segments: [{ startSeconds: 1.5, endSeconds: 2, text: "Thank you." }],
      }),
    ).toEqual([]);
  });

  it("makes one line over the piece when the model gave words and no timings", () => {
    expect(
      placeHeardSegments({ piece: { startedMs: 0, endedMs: 4_000 }, text: " Yes. ", segments: [] }),
    ).toEqual([{ startedMs: 0, endedMs: 4_000, text: "Yes." }]);
    expect(
      placeHeardSegments({ piece: { startedMs: 0, endedMs: 4_000 }, text: "", segments: [] }),
    ).toEqual([]);
  });

  it("prompts the next piece with the end of the last one's words, begun at a word", () => {
    expect(promptTail(null)).toBeNull();
    expect(promptTail("  ")).toBeNull();
    expect(promptTail("Short and sweet.")).toBe("Short and sweet.");
    const long = `${"word ".repeat(100)}final`;
    const tail = promptTail(long)!;
    expect(tail.length).toBeLessThanOrEqual(PROMPT_TAIL_MAXIMUM_CHARACTERS);
    expect(tail.startsWith("word")).toBe(true);
    expect(tail.endsWith("final")).toBe(true);
  });

  it("orders lines by when they began, then ended, then by handle, and counts words", () => {
    const lines = [
      { id: "b", started_ms: 1_000, ended_ms: 5_000 },
      { id: "a", started_ms: 1_000, ended_ms: 5_000 },
      { id: "c", started_ms: 2_000, ended_ms: 3_000 },
      { id: "d", started_ms: 1_000, ended_ms: 2_000 },
    ];
    expect(inReadingOrder(lines).map((line) => line.id)).toEqual(["d", "a", "b", "c"]);
    expect(compareLines(lines[0]!, lines[0]!)).toBe(0);
    expect(countWords(" one  two\nthree ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});

/** A track row as the gap arithmetic reads it. */
function trackRow(overrides: Partial<MeetingRecordingTrackRow>): MeetingRecordingTrackRow {
  return {
    id: "meetingRecordingTrack_0000000000000000000" as MeetingRecordingTrackId,
    recording_id: "meetingRecording_00000000000000000000" as MeetingRecordingRow["id"],
    participant_kind: "member",
    participant_id: "meetingAttendance_0000000000000000000",
    user_id: HOST,
    track_name: "participant:microphone",
    adapter_id: null,
    staging_key: "staged",
    first_frame_at: STARTED_AT,
    last_frame_at: STOPPED_AT,
    segments: null,
    frames_received: 1,
    frames_dropped: 0,
    state: "closed",
    created_at: STARTED_AT,
    updated_at: STOPPED_AT,
    ...overrides,
  };
}

const filedRecording = {
  started_at: STARTED_AT,
  stopped_at: STOPPED_AT,
  updated_at: STOPPED_AT,
  captured_seconds: 600,
} as MeetingRecordingRow;

describe("the gaps a recording's tracks leave", () => {
  it("names a lost track's silence from its last frame, a refused one's from its arrival, and a missing one's span — once each", () => {
    const lost = trackRow({
      id: "meetingRecordingTrack_lost000000000000000" as MeetingRecordingTrackId,
      state: "lost",
      last_frame_at: "2026-09-18T12:04:00.000Z",
    });
    const refused = trackRow({
      id: "meetingRecordingTrack_refused0000000000000" as MeetingRecordingTrackId,
      participant_kind: "guest",
      participant_id: "meetingGuestStay_refused00000000000",
      user_id: null,
      state: "lost",
      staging_key: null,
      first_frame_at: null,
      last_frame_at: null,
      frames_received: 0,
      created_at: "2026-09-18T12:07:00.000Z",
    });
    const missing = trackRow({
      id: "meetingRecordingTrack_missing0000000000000" as MeetingRecordingTrackId,
      staging_key: null,
      first_frame_at: "2026-09-18T12:01:00.000Z",
      last_frame_at: "2026-09-18T12:02:30.000Z",
    });
    const heard = trackRow({
      id: "meetingRecordingTrack_heard00000000000000" as MeetingRecordingTrackId,
    });
    const gaps = gapsForTracks(
      filedRecording,
      [lost, refused, missing, heard],
      new Set([missing.id]),
    );
    expect(gaps.map((gap) => [gap.speaker?.trackId, gap.startedMs, gap.endedMs])).toEqual([
      [lost.id, 240_000, 600_000],
      [refused.id, 420_000, 600_000],
      [missing.id, 60_000, 150_000],
    ]);
    // The guest's gap names the guest's stay, with no member behind it.
    expect(gaps[1]!.speaker).toMatchObject({ participantKind: "guest", userId: null });
  });

  it("names a LOST track whose audio is missing from its first frame to the stop, not from its last frame", () => {
    // Spoke from 12:00 to 12:04, then lost for good — and its staged object was never there to read.
    const lostAndMissing = trackRow({
      id: "meetingRecordingTrack_lostmissing00000000" as MeetingRecordingTrackId,
      state: "lost",
      staging_key: null,
      first_frame_at: STARTED_AT,
      last_frame_at: "2026-09-18T12:04:00.000Z",
    });
    expect(
      gapsForTracks(filedRecording, [lostAndMissing], new Set([lostAndMissing.id])).map((gap) => [
        gap.startedMs,
        gap.endedMs,
      ]),
    ).toEqual([[0, 600_000]]);
  });

  it("is ONE gap over the whole of a recording in which nobody was heard", () => {
    expect(wholeRecordingGap(filedRecording)).toEqual({
      startedMs: 0,
      endedMs: 600_000,
      speaker: null,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The record: claimed windows, provisional lines, and the one renumbering into reading order.
// ---------------------------------------------------------------------------------------------

const GUEST_STAY = "meetingGuestStay_transcript000000000";

function fresh() {
  const database = migratedDatabase();
  seedFirm(database.raw);
  return database;
}

type Database = ReturnType<typeof fresh>;

function memberTrack(index: number): MeetingRecordingCandidateTrack {
  return {
    participantKind: "member",
    participantId: `meetingAttendance_transcript${String(index).padStart(4, "0")}00000`,
    userId: CROWD[index] as UserId,
    trackName: `participant-${String(index)}:microphone`,
    sessionId: `routing-session-${String(index)}`,
  };
}

/** A filed recording of two members and a guest — the guest's stay seeded with the name they typed. */
async function filedRecordingIn(database: Database): Promise<{
  recording: MeetingRecordingRow;
  tracks: readonly MeetingRecordingTrackRow[];
}> {
  const { meetingId, effect } = await createMeeting(
    database.database,
    { eventKind: "matter", eventId: MATTER_EVENT },
    options,
  );
  await commit(database.database, effect);
  await commit(
    database.database,
    (await joinMeeting(database.database, meetingId, options)).effect,
  );
  database.raw.exec(
    `INSERT INTO meeting_guest_invitation (id, meeting_id, entity_kind, entity_id, invited_name, ` +
      `token_secret_hash, issued_by_user_id, expires_at, created_at, updated_at) VALUES ` +
      `('meetingGuestInvitation_transcript00000', '${meetingId}', 'person', 'directoryPerson_x', ` +
      `'Gail Guest', '${"0".repeat(64)}', '${HOST}', '2026-12-31T00:00:00.000Z', '${STARTED_AT}', '${STARTED_AT}')`,
  );
  database.raw.exec(
    `INSERT INTO meeting_guest_stay (id, meeting_id, invitation_id, confirmed_name, joined_at, ` +
      `waiting_from, created_at, updated_at) VALUES ('${GUEST_STAY}', '${meetingId}', ` +
      `'meetingGuestInvitation_transcript00000', 'Gail (typed at the door)', '${STARTED_AT}', ` +
      `'${STARTED_AT}', '${STARTED_AT}', '${STARTED_AT}')`,
  );
  const started = await startMeetingRecording(
    database.database,
    meetingId,
    {
      tracks: [
        memberTrack(0),
        memberTrack(1),
        {
          participantKind: "guest",
          participantId: GUEST_STAY,
          userId: null,
          trackName: "guest:microphone",
          sessionId: "routing-session-guest",
        },
      ],
      ceiling: 11,
    },
    options,
  );
  await commit(database.database, started.effect);
  database.raw.exec(
    `UPDATE meeting_recording SET state = 'filed', stopped_at = '${STOPPED_AT}', ` +
      `stop_reason = 'member', captured_seconds = 600 WHERE id = '${started.recording.id}'`,
  );
  return {
    recording: (await readRecordingById(database.database, started.recording.id))!,
    tracks: await listRecordingTracks(database.database, started.recording.id),
  };
}

async function refusedGuard(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (caught) {
    if (caught instanceof GuardedWriteRefusedError) return caught.guard;
    throw caught;
  }
}

const system = { clock };

describe("a transcript on the record", () => {
  it("writes each track's lines provisionally, then reads them back renumbered in reading order with their speakers", async () => {
    const database = fresh();
    const { recording, tracks } = await filedRecordingIn(database);
    const begun = beginTranscriptStatements(database.database, recording, system);
    await commit(database.database, { statements: begun.statements, outboxMessages: [] });
    let transcript = (await readTranscriptById(database.database, begun.transcriptId))!;
    expect(transcript).toMatchObject({ state: "pending", cursor_track: 0, segments_written: 0 });

    // THE CLAIM is one consumer's: a second delivery reading the same cursor is refused.
    const claimedAt = "2026-09-18T13:00:00.000Z";
    await commit(
      database.database,
      claimTranscriptWindowEffect(database.database, {
        transcript,
        claimedAt,
        leaseMilliseconds: 900_000,
      }),
    );
    expect(
      await refusedGuard(
        commit(
          database.database,
          claimTranscriptWindowEffect(database.database, {
            transcript,
            claimedAt: "2026-09-18T13:00:01.000Z",
            leaseMilliseconds: 900_000,
          }),
        ),
      ),
    ).toBe(TRANSCRIPT_CLAIM_GUARD);

    const speakerOf = (track: MeetingRecordingTrackRow) => ({
      trackId: track.id,
      participantKind: track.participant_kind,
      participantId: track.participant_id,
      userId: track.user_id,
    });
    // Track 0 speaks at 10 s and 40 s; track 1 overlaps it at 12 s; the guest answers at 30 s. Written
    // track by track, as the consumer writes them — not in the order they were said.
    // The tracks are stored in an order of their own handles, so each is found by whose it is.
    const trackOf = (participantId: string) =>
      tracks.find((track) => track.participant_id === participantId)!;
    const first = trackOf(memberTrack(0).participantId);
    const second = trackOf(memberTrack(1).participantId);
    const guest = trackOf(GUEST_STAY);
    const pieces = [
      { track: first, lines: [{ startedMs: 10_000, endedMs: 14_000, text: "First." }] },
      { track: first, lines: [{ startedMs: 40_000, endedMs: 42_000, text: "Last." }] },
      { track: second, lines: [{ startedMs: 12_000, endedMs: 13_000, text: "Overlap." }] },
      { track: guest, lines: [{ startedMs: 30_000, endedMs: 31_000, text: "Guest here." }] },
    ];
    let cursor = cursorOf(transcript);
    for (const [index, piece] of pieces.entries()) {
      await commit(
        database.database,
        transcriptProgressEffect(
          database.database,
          {
            transcriptId: transcript.id,
            claimedAt,
            from: cursor,
            to: { track: index, sample: 48_000 },
            speaker: speakerOf(piece.track),
            lines: piece.lines,
            // A half-second reply: counted as what it was, not rounded to nothing.
            transcribedMilliseconds: 460,
            modelId: "speech-model",
            language: index === 0 ? null : "en",
            releaseClaim: false,
          },
          system,
        ),
      );
      cursor = {
        track: index,
        sample: 48_000,
        segmentsWritten: cursor.segmentsWritten + piece.lines.length,
      };
    }
    // The prompt for track 0's next piece is the LAST thing it said, not the first.
    expect(await readLastTrackWords(database.database, transcript.id, first.id)).toBe("Last.");

    // A consumer that lost its claim writes nothing.
    expect(
      await refusedGuard(
        commit(
          database.database,
          transcriptProgressEffect(
            database.database,
            {
              transcriptId: transcript.id,
              claimedAt: "2026-09-18T13:30:00.000Z",
              from: cursor,
              to: { track: 3, sample: 0 },
              speaker: speakerOf(first),
              lines: [{ startedMs: 0, endedMs: 1, text: "Stray." }],
              transcribedMilliseconds: 1_000,
              modelId: null,
              language: null,
              releaseClaim: false,
            },
            system,
          ),
        ),
      ),
    ).toBe(TRANSCRIPT_PROGRESS_GUARD);

    transcript = (await readTranscriptById(database.database, transcript.id))!;
    expect(transcript).toMatchObject({
      segments_written: 4,
      transcribed_milliseconds: 1_840,
      model_id: "speech-model",
      // The first language the model named.
      language: "en",
    });
    // Nothing reads a pending transcript's provisional lines.
    expect(await listTranscriptSegments(database.database, transcript.id, { limit: 50 })).toEqual(
      [],
    );

    // ASSEMBLED: track 1 was lost at 5 minutes, so it leaves one gap; and the renumbering puts every line
    // in its place under the unique index.
    const lostTrack = {
      ...second,
      state: "lost" as const,
      last_frame_at: "2026-09-18T12:05:00.000Z",
    };
    await commit(database.database, {
      statements: assembleTranscriptStatements(
        database.database,
        {
          transcript,
          claimedAt,
          gaps: gapsForTracks(recording, [first, lostTrack, guest], new Set()),
          uploadSessionId: "uploadSession_transcriptTest0000",
        },
        system,
      ),
      outboxMessages: [],
    });
    const lines = await listTranscriptSegments(database.database, transcript.id, { limit: 50 });
    expect(
      lines.map((line) => [line.ordinal, line.kind, line.started_ms, line.text, line.display_name]),
    ).toEqual([
      [0, "speech", 10_000, "First.", "Attendee 0"],
      [1, "speech", 12_000, "Overlap.", "Attendee 1"],
      [2, "speech", 30_000, "Guest here.", "Gail (typed at the door)"],
      [3, "speech", 40_000, "Last.", "Attendee 0"],
      [4, "gap", 300_000, "", "Attendee 1"],
    ]);
    // The guest's line is the guest's stay, with no member behind it.
    expect(lines[2]).toMatchObject({
      participant_kind: "guest",
      participant_id: GUEST_STAY,
      user_id: null,
    });
    // Paged by ordinal.
    const page = await listTranscriptSegments(database.database, transcript.id, {
      afterOrdinal: 1,
      limit: 2,
    });
    expect(page.map((line) => line.ordinal)).toEqual([2, 3, 4]);

    // A FAILURE THAT READ THE ROW BEFORE THE FILING BEGAN is refused: it knows nothing of the upload
    // session the filing opened, and committing it would leave that session open on the matter.
    expect(
      await refusedGuard(
        commit(
          database.database,
          failTranscriptEffect(
            database.database,
            { transcript, failureErrorId: "error-stale" },
            system,
          ),
        ),
      ),
    ).toBe(TRANSCRIPT_FAIL_GUARD);
    transcript = (await readTranscriptById(database.database, transcript.id))!;
    expect(transcript.upload_session_id).toBe("uploadSession_transcriptTest0000");

    // The sweep's failure is guarded on what it judged stalled: a transcript claimed since is not
    // failed under the consumer now holding it.
    expect(
      await refusedGuard(
        commit(
          database.database,
          failTranscriptEffect(
            database.database,
            {
              transcript,
              failureErrorId: "error-sweep",
              untouched: { progressAt: "2026-09-18T11:00:00.000Z", claimedAt: null },
            },
            system,
          ),
        ),
      ),
    ).toBe(TRANSCRIPT_FAIL_GUARD);

    // Settled once: a failure after the filing began — one that read the session — lands, and once.
    await commit(
      database.database,
      failTranscriptEffect(database.database, { transcript, failureErrorId: "error-one" }, system),
    );
    expect(
      await refusedGuard(
        commit(
          database.database,
          failTranscriptEffect(
            database.database,
            { transcript, failureErrorId: "error-two" },
            system,
          ),
        ),
      ),
    ).toBe(TRANSCRIPT_FAIL_GUARD);
    const failed = await readTranscriptById(database.database, transcript.id);
    expect(failed).toMatchObject({ state: "failed", failure_error_id: "error-one" });
    const audits = database.raw
      .prepare(`SELECT metadata FROM audit_log WHERE event = 'meetings.transcript.failed'`)
      .all() as { metadata: string }[];
    expect(audits).toHaveLength(1);
    // Handles only: nothing anybody said, and no name.
    expect(Object.keys(JSON.parse(audits[0]!.metadata) as object).toSorted()).toEqual([
      "failedAt",
      "failureErrorId",
      "meetingId",
      "recordingId",
    ]);
  });
});

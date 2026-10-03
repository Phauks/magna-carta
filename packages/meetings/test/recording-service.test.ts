import { describe, expect, it } from "vitest";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import type { MeetingId, MeetingRecordingId, UserId } from "@magna-carta/identifiers/types";
import { grantHosting } from "../src/hosting-service.ts";
import {
  createMeeting,
  endScheduledMeetingForCancelledEvent,
  joinMeeting,
} from "../src/meeting-service.ts";
import {
  admitTrackStatements,
  claimComposeWindowEffect,
  COMPOSE_CLAIM_GUARD,
  COMPOSE_PROGRESS_GUARD,
  composeProgressEffect,
  FAIL_COMPOSE_GUARD,
  failComposeEffect,
  recordingFailedAuditStatement,
  recordingNoticeEffect,
  startMeetingRecording,
  STOP_RECORDING_GUARD,
  stopMeetingRecording,
  stopRecordingAfterSinkLoss,
  stopRecordingAfterStartFailure,
  stopRecordingByPlatform,
  stopRecordingForMeetingEnd,
} from "../src/recording-service.ts";
import {
  failRecordingStatement,
  hasRecordingsToTend,
  isRunningRecordingConflict,
  listStalledComposingRecordings,
  listRecordingNotices,
  listRecordingTracks,
  readRecordingStatesOfRooms,
  readRecordingById,
  readRunningRecording,
  readSinkTrackById,
  recordRecorderUnreachableStatement,
  releaseComposeClaimStatement,
  settleTrackStatement,
} from "../src/recording-statements.ts";
import type { MeetingRecordingCandidateTrack } from "../src/recording-types.ts";
import { MeetingRecordingRefusedError, MeetingValidationError } from "../src/validation.ts";
import {
  CROWD,
  FIRM_EVENT,
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

// A RECORDING IS A RECORD OF WHAT IT CAPTURED AND WHO WAS TOLD, and these tests are about what would
// be a real failure if it stopped holding: a firm meeting cannot be recorded because there is no
// matter to file it into, a room past the ceiling is refused before the mark lights, two recordings
// cannot run in one room, a stop closes every open track at one instant and leaves a lost one lost, a
// stop is open to the key-holder and to whoever is running the room but to nobody else, a walled
// matter's meeting is as unreachable to the recording as to everything else, and a notice names a
// guest's stay exactly as it names a member's.

function fresh() {
  const database = migratedDatabase();
  seedFirm(database.raw);
  return database;
}

type Database = ReturnType<typeof fresh>;

async function startedMeeting(database: Database): Promise<MeetingId> {
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

function track(index: number, kind: "member" | "guest" = "member"): MeetingRecordingCandidateTrack {
  const handle = String(index).padStart(4, "0");
  return {
    participantKind: kind,
    participantId:
      kind === "member"
        ? `meetingAttendance_track${handle}000000000`
        : `meetingGuestStay_track${handle}00000000`,
    userId: kind === "member" ? (CROWD[index] ?? null) : null,
    trackName: `participant-${handle}:microphone`,
    sessionId: `routing-session-${handle}`,
  };
}

async function record(
  database: Database,
  meetingId: MeetingId,
  tracks: readonly MeetingRecordingCandidateTrack[] = [track(0), track(1)],
  ceiling = 32,
) {
  const started = await startMeetingRecording(
    database.database,
    meetingId,
    { tracks, ceiling },
    options,
  );
  await commit(database.database, started.effect);
  return started;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (caught) {
    if (
      caught instanceof MeetingRecordingRefusedError ||
      caught instanceof MeetingValidationError
    ) {
      return caught.code;
    }
    throw caught;
  }
  throw new Error("expected a refusal");
}

/** Tracks written in one batch share an instant, so their order is the handle's; sort by name instead. */
function byTrackName<Row extends { readonly track_name: string }>(rows: readonly Row[]): Row[] {
  return rows.toSorted((left, right) => left.track_name.localeCompare(right.track_name));
}

function walledMeeting(database: Database): MeetingId {
  const meetingId = "meeting_walledRecordedRoom" as MeetingId;
  database.raw.exec(
    `INSERT INTO meeting (id, event_kind, medium, matter_event_id, firm_event_id, status, created_by_user_id, ` +
      `started_at, ended_at, ended_by_user_id, created_at, updated_at) VALUES ` +
      `('${meetingId}', 'matter', 'video', '${WALLED_MATTER_EVENT}', NULL, 'live', '${HOST}', ` +
      `'2026-09-18T11:00:00.000Z', NULL, NULL, '2026-09-18T11:00:00.000Z', '2026-09-18T11:00:00.000Z')`,
  );
  return meetingId;
}

describe("starting a recording", () => {
  it("writes the recording, every track the room carries, and one audit row, in one batch", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    const started = await record(database, meetingId, [track(0), track(1, "guest")]);

    const running = await readRunningRecording(database.database, meetingId);
    expect(running?.id).toBe(started.recording.id);
    expect(running?.matter_id).toBe(MATTER);
    expect(running?.breakout_id).toBeNull();
    expect(running?.track_count).toBe(2);

    const tracks = byTrackName(await listRecordingTracks(database.database, started.recording.id));
    expect(tracks.map((one) => [one.participant_kind, one.state, one.user_id])).toEqual([
      ["member", "open", CROWD[0]],
      // A GUEST'S TRACK IS A ROW LIKE ANY OTHER, named by its stay and with no user behind it.
      ["guest", "open", null],
    ]);

    const audit = database.raw
      .prepare(`SELECT event, metadata FROM audit_log WHERE event LIKE 'meetings.recording.%'`)
      .all() as { event: string; metadata: string }[];
    expect(audit.map((row) => row.event)).toEqual(["meetings.recording.started"]);
    expect(JSON.parse(audit[0]?.metadata ?? "{}")).toEqual({
      meetingId,
      startedAt: clock.now(),
      trackCount: 2,
    });
  });

  it("names one track once, however many times the room offers it", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    const started = await record(database, meetingId, [track(0), track(0), track(1)]);
    expect(started.tracks).toHaveLength(2);
  });

  it("refuses a meeting on a firm event, which has no matter to file a recording into", async () => {
    const database = fresh();
    const { meetingId, effect } = await createMeeting(
      database.database,
      { eventKind: "firm", eventId: FIRM_EVENT },
      options,
    );
    await commit(database.database, effect);
    expect(
      await refusal(
        startMeetingRecording(database.database, meetingId, { tracks: [], ceiling: 32 }, options),
      ),
    ).toBe("meeting-recording-needs-matter");
  });

  it("refuses a room carrying more audio tracks than the ceiling, before anything is written", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    const tracks = [track(0), track(1), track(2)];
    expect(
      await refusal(
        startMeetingRecording(database.database, meetingId, { tracks, ceiling: 2 }, options),
      ),
    ).toBe("meeting-recording-too-many-tracks");
    expect(await readRunningRecording(database.database, meetingId)).toBeUndefined();
    // AT the ceiling is not past it.
    await record(database, meetingId, tracks.slice(0, 2), 2);
  });

  it("counts the ceiling by STAY, so a full room where everybody also shares their screen's audio is not refused", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    // Eleven participants, each publishing a microphone AND a screen share's audio: twenty-two tracks,
    // eleven stays. The recorder hears one track per stay, so this room is exactly at a ceiling of
    // eleven, not twice over it.
    const tracks = Array.from({ length: 11 }, (_, index) => {
      const microphone = track(index);
      return [
        microphone,
        { ...microphone, trackName: `participant-${String(index).padStart(4, "0")}:screen-audio` },
      ];
    }).flat();
    const started = await record(database, meetingId, tracks, 11);
    expect(started.tracks).toHaveLength(22);

    // A twelfth STAY is past it, however few tracks it publishes.
    const crowded = fresh();
    const crowdedMeeting = await startedMeeting(crowded);
    expect(
      await refusal(
        startMeetingRecording(
          crowded.database,
          crowdedMeeting,
          { tracks: [...tracks, track(11)], ceiling: 11 },
          options,
        ),
      ),
    ).toBe("meeting-recording-too-many-tracks");
  });

  it("refuses a second recording while one is running — and the database refuses the racing one", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    // Both read "nothing running" before either writes, which is the race the index exists for.
    const first = await startMeetingRecording(
      database.database,
      meetingId,
      { tracks: [], ceiling: 32 },
      options,
    );
    const second = await startMeetingRecording(
      database.database,
      meetingId,
      { tracks: [], ceiling: 32 },
      options,
    );
    await commit(database.database, first.effect);
    let raced: unknown;
    try {
      await commit(database.database, second.effect);
    } catch (caught) {
      raced = caught;
    }
    expect(isRunningRecordingConflict(raced)).toBe(true);

    expect(
      await refusal(
        startMeetingRecording(database.database, meetingId, { tracks: [], ceiling: 32 }, options),
      ),
    ).toBe("meeting-recording-already-running");
  });

  it("refuses a meeting that has ended", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    database.raw.exec(
      `UPDATE meeting SET status = 'ended', ended_at = '2026-09-18T12:10:00.000Z', ended_by_user_id = '${HOST}' WHERE id = '${meetingId}'`,
    );
    expect(
      await refusal(
        startMeetingRecording(database.database, meetingId, { tracks: [], ceiling: 32 }, options),
      ),
    ).toBe("meeting-already-ended");
  });

  it("cannot reach a walled matter's meeting, by the same refusal as a meeting that does not exist", async () => {
    const database = fresh();
    const meetingId = walledMeeting(database);
    expect(
      await refusal(
        startMeetingRecording(database.database, meetingId, { tracks: [], ceiling: 32 }, options),
      ),
    ).toBe("meeting-unknown-event");
    expect(
      await refusal(
        stopMeetingRecording(database.database, meetingId, { mayRecord: true }, options),
      ),
    ).toBe("meeting-unknown-event");
  });
});

describe("stopping a recording", () => {
  it("closes every open track at one instant, and leaves a lost track lost", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    const started = await record(database, meetingId, [track(0), track(1), track(2)]);
    // One socket never came back.
    await database.database
      .prepare(`UPDATE meeting_recording_track SET state = 'lost' WHERE track_name = ?`)
      .bind(track(2).trackName)
      .run();

    const stopClock = { now: () => "2026-09-18T12:20:00.000Z" };
    const stopped = await stopMeetingRecording(
      database.database,
      meetingId,
      { mayRecord: true },
      optionsFor(HOST, stopClock),
    );
    await commit(database.database, stopped.effect);

    expect(stopped.recording.stop_reason).toBe("member");
    expect(await readRunningRecording(database.database, meetingId)).toBeUndefined();
    const tracks = byTrackName(await listRecordingTracks(database.database, started.recording.id));
    expect(tracks.map((one) => one.state)).toEqual(["closed", "closed", "lost"]);
    // ONE INSTANT for every track the stop closed.
    expect(
      new Set(tracks.filter((one) => one.state === "closed").map((one) => one.updated_at)),
    ).toEqual(new Set(["2026-09-18T12:20:00.000Z"]));
    const row = database.raw
      .prepare(`SELECT state, stopped_at, stop_reason, track_count FROM meeting_recording`)
      .get() as Record<string, unknown>;
    expect(row).toEqual({
      state: "composing",
      stopped_at: "2026-09-18T12:20:00.000Z",
      stop_reason: "member",
      track_count: 3,
    });
  });

  it("refuses a stop when nothing is running", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    expect(
      await refusal(
        stopMeetingRecording(database.database, meetingId, { mayRecord: true }, options),
      ),
    ).toBe("meeting-recording-not-running");
  });

  it("lets a member RUNNING THE ROOM stop it without the key, and labels the stop `host`", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    await record(database, meetingId);
    const stopped = await stopMeetingRecording(
      database.database,
      meetingId,
      { mayRecord: false },
      options,
    );
    await commit(database.database, stopped.effect);
    expect(stopped.recording.stop_reason).toBe("host");
  });

  it("refuses a member holding neither the key nor a grant on this meeting", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    const joined = await joinMeeting(database.database, meetingId, optionsFor(GUEST));
    await commit(database.database, joined.effect);
    await record(database, meetingId);
    expect(
      await refusal(
        stopMeetingRecording(database.database, meetingId, { mayRecord: false }, optionsFor(GUEST)),
      ),
    ).toBe("meeting-recording-not-permitted");

    // A co-host is running the room too, and may.
    const granted = await grantHosting(
      database.database,
      meetingId,
      { userId: GUEST, role: "co-host" },
      options,
    );
    await commit(database.database, granted.effect);
    const stopped = await stopMeetingRecording(
      database.database,
      meetingId,
      { mayRecord: false },
      optionsFor(GUEST),
    );
    await commit(database.database, stopped.effect);
    expect(stopped.recording.stopped_by_user_id).toBe(GUEST);
  });

  it("rolls the second of two racing stops back whole rather than moving the first one's instant", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    await record(database, meetingId);
    const ticking = tickingClock();
    const first = await stopMeetingRecording(
      database.database,
      meetingId,
      { mayRecord: true },
      optionsFor(HOST, ticking),
    );
    const second = await stopMeetingRecording(
      database.database,
      meetingId,
      { mayRecord: true },
      optionsFor(HOST, ticking),
    );
    await commit(database.database, first.effect);
    await expect(commit(database.database, second.effect)).rejects.toSatisfy(
      (caught: unknown) =>
        caught instanceof GuardedWriteRefusedError && caught.guard === STOP_RECORDING_GUARD,
    );
    const row = database.raw.prepare(`SELECT stopped_at FROM meeting_recording`).get() as {
      stopped_at: string;
    };
    expect(row.stopped_at).toBe(first.recording.stopped_at);
  });

  it("stops with the meeting, attributed to whoever ended it — and produces nothing when none is running", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    expect(await stopRecordingForMeetingEnd(database.database, meetingId, options)).toBeUndefined();
    await record(database, meetingId);
    const stopped = await stopRecordingForMeetingEnd(database.database, meetingId, options);
    expect(stopped?.recording.stop_reason).toBe("meeting-ended");
    expect(stopped?.recording.stopped_by_user_id).toBe(HOST);
  });

  it("stops as `abandoned` or at the `ceiling` with nobody behind it — closing every open track, with one audit row, once", async () => {
    for (const reason of ["abandoned", "ceiling"] as const) {
      const database = fresh();
      const meetingId = await startedMeeting(database);
      const started = await record(database, meetingId);
      const stopped = await stopRecordingByPlatform(
        database.database,
        started.recording.id,
        reason,
        {
          clock,
        },
      );
      expect(stopped?.recording).toMatchObject({
        state: "composing",
        stop_reason: reason,
        stopped_by_user_id: null,
        track_count: 2,
      });
      await commit(database.database, stopped?.effect ?? { statements: [], outboxMessages: [] });
      const tracks = await listRecordingTracks(database.database, started.recording.id);
      expect(tracks.map((one) => one.state)).toEqual(["closed", "closed"]);
      const audit = database.raw
        .prepare(`SELECT metadata FROM audit_log WHERE event = 'meetings.recording.stopped'`)
        .all() as { metadata: string }[];
      expect(audit.map((row) => JSON.parse(row.metadata).stopReason)).toEqual([reason]);
      // Whichever stop committed first is the one the record keeps.
      expect(
        await stopRecordingByPlatform(database.database, started.recording.id, reason, { clock }),
      ).toBeUndefined();
    }
  });

  it("stops itself when every track is lost, with nobody behind it — once", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    const started = await record(database, meetingId);
    const stopped = await stopRecordingAfterSinkLoss(database.database, started.recording.id, {
      clock,
    });
    expect(stopped?.recording.stop_reason).toBe("sink-lost");
    expect(stopped?.recording.stopped_by_user_id).toBeNull();
    await commit(database.database, stopped?.effect ?? { statements: [], outboxMessages: [] });
    expect(
      await stopRecordingAfterSinkLoss(database.database, started.recording.id, { clock }),
    ).toBeUndefined();
  });
});

describe("tracks and notices", () => {
  it("admits a late track while there is room under the ceiling, and records the overflow as lost", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    const started = await record(database, meetingId, [track(0)], 2);
    // The recorder decides which tracks it will hear; the record is written in the state it decided.
    const admitted = admitTrackStatements(
      database.database,
      started.recording.id,
      track(1),
      "open",
      { clock },
    );
    const overflow = admitTrackStatements(
      database.database,
      started.recording.id,
      track(2),
      "lost",
      { clock },
    );
    expect(admitted.state).toBe("open");
    expect(overflow.state).toBe("lost");
    await commit(database.database, {
      statements: [...admitted.statements, ...overflow.statements],
      outboxMessages: [],
    });
    const tracks = byTrackName(await listRecordingTracks(database.database, started.recording.id));
    expect(tracks.map((one) => [one.state, one.frames_received])).toEqual([
      ["open", 0],
      ["open", 0],
      // THE RECORD SAYS WHO IT COULD NOT HEAR, rather than leaving them out.
      ["lost", 0],
    ]);
    const running = await readRunningRecording(database.database, meetingId);
    expect(running?.track_count).toBe(3);
  });

  it("answers the sink by the track ROW in one read — and nothing for a row under another recording", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    const started = await record(database, meetingId, [track(0)]);
    const [row] = await listRecordingTracks(database.database, started.recording.id);
    expect(await readSinkTrackById(database.database, started.recording.id, row!.id)).toEqual({
      recordingState: "recording",
      trackState: "open",
    });
    // A token naming this row under a recording it does not belong to opens nothing.
    expect(
      await readSinkTrackById(
        database.database,
        "meetingRecording_notThisRecording00000" as MeetingRecordingId,
        row!.id,
      ),
    ).toBeUndefined();
    const stopped = await stopMeetingRecording(
      database.database,
      meetingId,
      { mayRecord: true },
      options,
    );
    await commit(database.database, stopped.effect);
    expect(await readSinkTrackById(database.database, started.recording.id, row!.id)).toEqual({
      recordingState: "composing",
      trackState: "closed",
    });
  });

  it("keeps a lost track lost when the recorder later settles its counts", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    const started = await record(database, meetingId, [track(0)]);
    await database.database.prepare(`UPDATE meeting_recording_track SET state = 'lost'`).run();
    await settleTrackStatement(database.database, {
      recordingId: started.recording.id,
      trackName: track(0).trackName,
      framesReceived: 12,
      framesDropped: 3,
      firstFrameAt: "2026-09-18T12:00:01.000Z",
      lastFrameAt: "2026-09-18T12:00:02.000Z",
      state: "closed",
      now: clock.now(),
    }).run();
    const [settled] = await listRecordingTracks(database.database, started.recording.id);
    expect(settled?.state).toBe("lost");
    expect(settled?.frames_received).toBe(12);
    expect(settled?.frames_dropped).toBe(3);
  });

  it("writes one notice per stay told — a guest's as well as a member's — and ONE audit row with the count", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    const started = await record(database, meetingId);
    const guestStay = "meetingGuestStay_toldAtTheDoor0000";
    await commit(
      database.database,
      recordingNoticeEffect(
        database.database,
        {
          recordingId: started.recording.id,
          meetingId,
          reason: "start",
          deliveredAt: "2026-09-18T12:00:00.500Z",
          recipients: [
            {
              participantKind: "member",
              participantId: "meetingAttendance_toldInTheRoom000",
              userId: HOST,
            },
            { participantKind: "guest", participantId: guestStay, userId: null },
          ],
        },
        { clock },
      ),
    );
    const notices = await listRecordingNotices(database.database, started.recording.id, {
      limit: 10,
    });
    // Delivered at one instant, so the walk's tiebreak is the handle; the assertion is about the set.
    const sorted = notices.toSorted((left, right) =>
      left.participant_kind.localeCompare(right.participant_kind),
    );
    expect(
      sorted.map((notice) => [notice.participant_kind, notice.user_id, notice.reason]),
    ).toEqual([
      ["guest", null, "start"],
      ["member", HOST, "start"],
    ]);
    expect(sorted[1]?.display_name).toBe("A Host");

    const audit = database.raw
      .prepare(`SELECT metadata FROM audit_log WHERE event = 'meetings.recording.noticed'`)
      .all() as { metadata: string }[];
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.metadata ?? "{}")).toMatchObject({
      reason: "start",
      noticeCount: 2,
    });
  });

  it("answers each room's most recent recording state for a page at once, and nothing for a room never recorded", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    const other = "meeting_neverRecordedRoom00" as MeetingId;
    expect((await readRecordingStatesOfRooms(database.database, [meetingId, other])).size).toBe(0);
    await record(database, meetingId);
    const states = await readRecordingStatesOfRooms(database.database, [meetingId, other]);
    expect(states.get(meetingId)).toBe("recording");
    expect(states.has(other)).toBe(false);
  });

  it("never writes a user into a notice it was not handed", () => {
    // The notice is a record of a delivery the ROOM made: the service takes the stays the room sent
    // the frame to and re-reads nothing, so there is no path by which a user id appears that the room
    // did not name.
    const effect = recordingNoticeEffect(
      fresh().database,
      {
        recordingId: "meetingRecording_noticeShape00000" as never,
        meetingId: "meeting_noticeShape00000000" as MeetingId,
        reason: "arrival",
        deliveredAt: clock.now(),
        recipients: [
          { participantKind: "guest", participantId: "x", userId: null as UserId | null },
        ],
      },
      { clock },
    );
    expect(effect.statements).toHaveLength(2);
  });
});

describe("who may start a recording", () => {
  it("refuses a member holding the key but no grant on this meeting, and starts once they hold one", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    const joined = await joinMeeting(database.database, meetingId, optionsFor(GUEST));
    await commit(database.database, joined.effect);
    // The route's chokepoint has already asked the key; what is left is whether this member is
    // running THIS room, and they are not.
    expect(
      await refusal(
        startMeetingRecording(
          database.database,
          meetingId,
          { tracks: [], ceiling: 32 },
          optionsFor(GUEST),
        ),
      ),
    ).toBe("meeting-not-host");
    expect(await readRunningRecording(database.database, meetingId)).toBeUndefined();

    const granted = await grantHosting(
      database.database,
      meetingId,
      { userId: GUEST, role: "co-host" },
      options,
    );
    await commit(database.database, granted.effect);
    const started = await startMeetingRecording(
      database.database,
      meetingId,
      { tracks: [], ceiling: 32 },
      optionsFor(GUEST),
    );
    await commit(database.database, started.effect);
    expect(started.recording.started_by_user_id).toBe(GUEST);
  });
});

describe("a start that could not be carried out", () => {
  it("stops as `start-failed` with nobody behind it, and fails in the record with ONE audit row however many parts give up on it", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    const started = await record(database, meetingId);
    const stopped = await stopRecordingAfterStartFailure(database.database, started.recording.id, {
      clock,
    });
    expect(stopped?.recording.stop_reason).toBe("start-failed");
    expect(stopped?.recording.stopped_by_user_id).toBeNull();

    // The start route gives up first, with the Error ID of what went wrong…
    await commit(database.database, {
      statements: [
        ...(stopped?.effect.statements ?? []),
        failRecordingStatement(database.database, {
          id: started.recording.id,
          failureErrorId: "error_startRouteGaveUp",
          now: clock.now(),
        }),
        recordingFailedAuditStatement(
          database.database,
          {
            recordingId: started.recording.id,
            meetingId,
            failureErrorId: "error_startRouteGaveUp",
          },
          { clock },
        ),
      ],
      outboxMessages: [],
    });
    // …and a recorder that had taken it settles with nothing captured and gives up as well.
    await commit(database.database, {
      statements: [
        failRecordingStatement(database.database, {
          id: started.recording.id,
          failureErrorId: "error_recorderGaveUpToo",
          now: clock.now(),
        }),
        recordingFailedAuditStatement(
          database.database,
          {
            recordingId: started.recording.id,
            meetingId,
            failureErrorId: "error_recorderGaveUpToo",
          },
          { clock },
        ),
      ],
      outboxMessages: [],
    });

    const row = await readRecordingById(database.database, started.recording.id);
    expect(row).toMatchObject({
      state: "failed",
      stop_reason: "start-failed",
      failure_error_id: "error_startRouteGaveUp",
    });
    const audit = database.raw
      .prepare(
        `SELECT actor_user_id, metadata FROM audit_log WHERE event = 'meetings.recording.failed'`,
      )
      .all() as { actor_user_id: string | null; metadata: string }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_user_id).toBeNull();
    expect(JSON.parse(audit[0]?.metadata ?? "{}")).toEqual({
      meetingId,
      failureErrorId: "error_startRouteGaveUp",
    });
  });
});

describe("a stop the recorder did not hear", () => {
  it("carries the Error ID on a composing recording without moving its state — and never over a later outcome", async () => {
    const database = fresh();
    const meetingId = await startedMeeting(database);
    const started = await record(database, meetingId);
    const stopped = await stopMeetingRecording(
      database.database,
      meetingId,
      { mayRecord: true },
      options,
    );
    await commit(database.database, stopped.effect);
    await commit(database.database, {
      statements: [
        recordRecorderUnreachableStatement(database.database, {
          id: started.recording.id,
          failureErrorId: "error_recorderUnreachable",
          now: clock.now(),
        }),
      ],
      outboxMessages: [],
    });
    expect(await readRecordingById(database.database, started.recording.id)).toMatchObject({
      state: "composing",
      failure_error_id: "error_recorderUnreachable",
    });

    // The recorder, settling on its own pass with nothing captured, names the outcome — and its
    // failure is the one the record and the log keep.
    await commit(database.database, {
      statements: [
        failRecordingStatement(database.database, {
          id: started.recording.id,
          failureErrorId: "error_nothingCaptured",
          now: clock.now(),
        }),
        recordingFailedAuditStatement(
          database.database,
          { recordingId: started.recording.id, meetingId, failureErrorId: "error_nothingCaptured" },
          { clock },
        ),
      ],
      outboxMessages: [],
    });
    expect(await readRecordingById(database.database, started.recording.id)).toMatchObject({
      state: "failed",
      failure_error_id: "error_nothingCaptured",
    });
    expect(
      database.raw
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_log WHERE event = 'meetings.recording.failed'`,
        )
        .get(),
    ).toEqual({ count: 1 });
  });
});

describe("a cancelled event's meeting", () => {
  it("stops a recording running in a room nobody walked into, in the cancel's own batch", async () => {
    const database = fresh();
    // Created and never joined: the meeting is still scheduled, which is the only meeting a
    // cancellation closes — and a recording may already be running in it.
    const { meetingId, effect } = await createMeeting(
      database.database,
      { eventKind: "matter", eventId: MATTER_EVENT },
      options,
    );
    await commit(database.database, effect);
    const started = await record(database, meetingId, []);

    const closing = await endScheduledMeetingForCancelledEvent(
      database.database,
      meetingId,
      options,
    );
    expect(closing.stoppedRecordingId).toBe(started.recording.id);
    await commit(database.database, closing.effect);

    expect(await readRunningRecording(database.database, meetingId)).toBeUndefined();
    expect(await readRecordingById(database.database, started.recording.id)).toMatchObject({
      state: "composing",
      stop_reason: "meeting-ended",
      stopped_by_user_id: HOST,
    });
  });

  it("names no recording when none is running", async () => {
    const database = fresh();
    const { meetingId, effect } = await createMeeting(
      database.database,
      { eventKind: "matter", eventId: MATTER_EVENT },
      options,
    );
    await commit(database.database, effect);
    const closing = await endScheduledMeetingForCancelledEvent(
      database.database,
      meetingId,
      options,
    );
    expect(closing.stoppedRecordingId).toBeNull();
  });
});

/** The label of the guarded write that refused, or a failure when none was refused. */
async function guardOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof GuardedWriteRefusedError) return caught.guard;
    throw caught;
  }
  throw new Error("expected a guarded write to be refused");
}

describe("the compose cursor, its claim and its failure", () => {
  /** A recording stopped and handed on to be composed, with nothing composed yet. */
  async function composing(database: Database) {
    const meetingId = await startedMeeting(database);
    const started = await record(database, meetingId, [track(0)]);
    const stopped = await stopMeetingRecording(
      database.database,
      meetingId,
      { mayRecord: true },
      options,
    );
    await commit(database.database, stopped.effect);
    return started.recording.id;
  }

  const claimAt = (recordingId: MeetingRecordingId, partsDone: number, at: string) =>
    claimComposeWindowEffect(database0(), {
      recordingId,
      partsDone,
      claimedAt: at,
      leaseMilliseconds: 15 * 60 * 1000,
    });
  let current: Database | null = null;
  const database0 = () => current!.database;

  it("lets one consumer hold a window, another take it once the lease runs out, and progress let it go", async () => {
    current = fresh();
    const recordingId = await composing(current);
    await commit(database0(), claimAt(recordingId, 0, "2026-09-18T12:00:00.000Z"));
    // A second delivery inside the lease is refused at the claim.
    expect(
      await guardOf(commit(database0(), claimAt(recordingId, 0, "2026-09-18T12:05:00.000Z"))),
    ).toBe(COMPOSE_CLAIM_GUARD);
    // A claim on a cursor that is not where the row is, is refused too.
    expect(
      await guardOf(commit(database0(), claimAt(recordingId, 3, "2026-09-18T12:30:00.000Z"))),
    ).toBe(COMPOSE_CLAIM_GUARD);
    // Past the lease the holder is gone, and the window is somebody else's.
    await commit(database0(), claimAt(recordingId, 0, "2026-09-18T12:20:00.000Z"));
    // Letting go is addressed by the instant it was taken at: the earlier holder releases nothing.
    await releaseComposeClaimStatement(database0(), {
      id: recordingId,
      claimedAt: "2026-09-18T12:00:00.000Z",
    }).run();
    expect((await readRecordingById(database0(), recordingId))?.compose_claimed_at).toBe(
      "2026-09-18T12:20:00.000Z",
    );
    // Progress that hands the next window on lets the claim go, and starts the attempts again.
    current.raw.exec(`UPDATE meeting_recording SET compose_attempts = 2`);
    await commit(
      database0(),
      composeProgressEffect(
        database0(),
        {
          recordingId,
          fromPartsDone: 0,
          parts: [{ partNumber: 1, etag: "etag-one" }],
          releaseClaim: true,
        },
        { clock },
      ),
    );
    const progressed = await readRecordingById(database0(), recordingId);
    expect(progressed).toMatchObject({
      compose_parts_done: 1,
      compose_attempts: 0,
      compose_claimed_at: null,
    });
    // TWO DELIVERIES OF ONE WINDOW never both advance the cursor.
    expect(
      await guardOf(
        commit(
          database0(),
          composeProgressEffect(
            database0(),
            {
              recordingId,
              fromPartsDone: 0,
              parts: [{ partNumber: 1, etag: "etag-again" }],
              releaseClaim: true,
            },
            { clock },
          ),
        ),
      ),
    ).toBe(COMPOSE_PROGRESS_GUARD);
  });

  it("measures a stall from the latest of the stop, the claim and the progress", async () => {
    current = fresh();
    const recordingId = await composing(current);
    // Stopped long ago, but a window was claimed a minute before the sweep looks: not a stall.
    current.raw.exec(
      `UPDATE meeting_recording SET stopped_at = '2026-09-18T10:00:00.000Z', ` +
        `compose_progress_at = '2026-09-18T10:05:00.000Z', compose_claimed_at = '2026-09-18T11:59:00.000Z'`,
    );
    expect(
      (await listStalledComposingRecordings(database0(), "2026-09-18T11:30:00.000Z")).map(
        (row) => row.id,
      ),
    ).toEqual([]);
    current.raw.exec(`UPDATE meeting_recording SET compose_claimed_at = NULL`);
    expect(
      (await listStalledComposingRecordings(database0(), "2026-09-18T11:30:00.000Z")).map(
        (row) => row.id,
      ),
    ).toEqual([recordingId]);
  });

  it("fails a compose only while it is still composing — a failure that lost the race rolls back whole", async () => {
    current = fresh();
    const recordingId = await composing(current);
    const recording = (await readRecordingById(database0(), recordingId))!;
    current.raw.exec(
      `UPDATE meeting_recording SET state = 'failed', failure_error_id = 'error_first'`,
    );
    expect(
      await guardOf(
        commit(
          database0(),
          failComposeEffect(database0(), { recording, failureErrorId: "error_second" }, { clock }),
        ),
      ),
    ).toBe(FAIL_COMPOSE_GUARD);
    expect((await readRecordingById(database0(), recordingId))?.failure_error_id).toBe(
      "error_first",
    );
  });

  it("says a firm has recordings to tend only while one runs, composes, or still names staged audio", async () => {
    current = fresh();
    expect(await hasRecordingsToTend(database0())).toBe(false);
    const recordingId = await composing(current);
    expect(await hasRecordingsToTend(database0())).toBe(true);
    current.raw.exec(
      `UPDATE meeting_recording SET state = 'filed' WHERE id = '${recordingId}'; ` +
        `UPDATE meeting_recording_track SET staging_key = 'meeting-recordings/staged.pcm'`,
    );
    expect(await hasRecordingsToTend(database0())).toBe(true);
    current.raw.exec(`UPDATE meeting_recording_track SET staging_key = NULL`);
    expect(await hasRecordingsToTend(database0())).toBe(false);
  });
});

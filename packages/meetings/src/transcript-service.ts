import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectStatement, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  FileId,
  FileVersionId,
  MeetingRecordingTrackId,
  MeetingTranscriptId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { MeetingRecordingRow } from "./recording-types.ts";
import type { GapLine, PlacedLine } from "./transcript-assembly.ts";
import {
  beginTranscriptFilingStatement,
  claimTranscriptWindowStatement,
  failTranscriptStatement,
  insertTranscriptSegmentStatement,
  insertTranscriptStatement,
  readyTranscriptStatement,
  recordTranscriptProgressStatement,
  recordTranscriptRetryStatement,
  renumberTranscriptSegmentsStatement,
  type TranscriptCursor,
} from "./transcript-statements.ts";
import type { MeetingTranscriptRow } from "./transcript-types.ts";
import type { MeetingContributorKind } from "./types.ts";

// THE TRANSCRIPT'S ACTS ON ITS OWN RECORD — begun when its recording is filed, moved a window at a time,
// assembled and filed, or failed — each an effect for the Worker to commit, every one that can lose a
// race guarded with a label of its own, so a caller tells "somebody got there first" from a fault.
// Nothing here reads a clock, holds a binding or calls the speech model; the consumer does.
//
// THE AUDIT ROWS CARRY HANDLES, COUNTS AND INSTANTS. Never a word of the transcript, never the
// document's name (it is the event's title), never a speaker's name.

/** The labels the transcript's guarded writes carry, exported because a caller matches on them. */
export const TRANSCRIPT_CLAIM_GUARD = "meeting.transcript.claim";
export const TRANSCRIPT_PROGRESS_GUARD = "meeting.transcript.progress";
export const TRANSCRIPT_FILING_GUARD = "meeting.transcript.filing";
export const TRANSCRIPT_READY_GUARD = "meeting.transcript.ready";
export const TRANSCRIPT_FAIL_GUARD = "meeting.transcript.fail";

/** The platform acting on its own record, with nobody behind it. */
export interface MeetingTranscriptSystemOptions {
  readonly clock: { now(): string };
  readonly randomSource?: RandomSource;
}

/**
 * A FILED RECORDING'S TRANSCRIPT, BEGUN: the pending row, composed into the batch that files the
 * recording — so a recording is never filed without one, and a filing that lost its race takes it back
 * with it. Every filed recording has one; there is no setting, because a recording on the matter with
 * no transcript is a record half made.
 */
export function beginTranscriptStatements(
  database: SqlDatabase,
  recording: MeetingRecordingRow,
  options: MeetingTranscriptSystemOptions,
): { readonly transcriptId: MeetingTranscriptId; readonly statements: EffectStatement[] } {
  const transcriptId = newIdentifier("meetingTranscript", options.randomSource);
  return {
    transcriptId,
    statements: [
      insertTranscriptStatement(database, {
        id: transcriptId,
        meetingId: recording.meeting_id,
        recordingId: recording.id,
        now: options.clock.now(),
      }),
    ],
  };
}

/** Where a stored transcript's cursor stands. */
export function cursorOf(transcript: MeetingTranscriptRow): TranscriptCursor {
  return {
    track: transcript.cursor_track,
    sample: transcript.cursor_sample,
    segmentsWritten: transcript.segments_written,
  };
}

/**
 * ONE CONSUMER TAKES THE NEXT WINDOW, or is refused because another holds it, the cursor moved, or the
 * transcript settled. `leaseMilliseconds` is how long a claim holds against another delivery: a queue
 * consumer's own longest run, past which its holder is gone.
 */
export function claimTranscriptWindowEffect(
  database: SqlDatabase,
  input: {
    readonly transcript: MeetingTranscriptRow;
    readonly claimedAt: string;
    readonly leaseMilliseconds: number;
  },
): EffectWrite {
  return {
    statements: [
      guarded(
        claimTranscriptWindowStatement(database, {
          id: input.transcript.id,
          cursor: cursorOf(input.transcript),
          now: input.claimedAt,
          leaseExpiredBefore: new Date(
            Date.parse(input.claimedAt) - input.leaseMilliseconds,
          ).toISOString(),
        }),
        TRANSCRIPT_CLAIM_GUARD,
      ),
    ],
    outboxMessages: [],
  };
}

/** Whose track a run of lines came from: the track and the stay it was. */
export interface TranscriptTrackSpeaker {
  readonly trackId: MeetingRecordingTrackId;
  readonly participantKind: MeetingContributorKind;
  readonly participantId: string;
  readonly userId: UserId | null;
}

/**
 * THE CURSOR MOVES — after a piece the model answered, with the lines it heard, or past audio with
 * nothing in it. The lines take the next provisional ordinals (minus one, minus two, … in the order
 * written) and the cursor's count moves past them, in ONE guarded write with the cursor: two consumers
 * can never both write a piece's lines.
 */
export function transcriptProgressEffect(
  database: SqlDatabase,
  input: {
    readonly transcriptId: MeetingTranscriptId;
    readonly claimedAt: string;
    readonly from: TranscriptCursor;
    readonly to: { readonly track: number; readonly sample: number };
    readonly speaker: TranscriptTrackSpeaker | null;
    readonly lines: readonly PlacedLine[];
    readonly transcribedSeconds: number;
    readonly modelId: string | null;
    readonly language: string | null;
    readonly releaseClaim: boolean;
  },
  options: MeetingTranscriptSystemOptions,
): EffectWrite {
  const now = options.clock.now();
  const speaker = input.speaker;
  const statements: EffectStatement[] =
    speaker === null
      ? []
      : input.lines.map((line, index) =>
          insertTranscriptSegmentStatement(database, {
            id: newIdentifier("meetingTranscriptSegment", options.randomSource),
            transcriptId: input.transcriptId,
            ordinal: -(input.from.segmentsWritten + index + 1),
            kind: "speech",
            trackId: speaker.trackId,
            participantKind: speaker.participantKind,
            participantId: speaker.participantId,
            userId: speaker.userId,
            startedMs: line.startedMs,
            endedMs: line.endedMs,
            text: line.text,
            now,
          }),
        );
  const written = statements.length;
  statements.push(
    guarded(
      recordTranscriptProgressStatement(database, {
        id: input.transcriptId,
        claimedAt: input.claimedAt,
        from: input.from,
        to: {
          track: input.to.track,
          sample: input.to.sample,
          segmentsWritten: input.from.segmentsWritten + written,
        },
        transcribedSeconds: Math.round(input.transcribedSeconds),
        modelId: input.modelId,
        language: input.language,
        releaseClaim: input.releaseClaim,
        now,
      }),
      TRANSCRIPT_PROGRESS_GUARD,
    ),
  );
  return { statements, outboxMessages: [] };
}

/**
 * THE TRANSCRIPT IS ASSEMBLED AND ITS FILING BEGUN, in ONE batch the caller composes beside the upload
 * session: the gap lines written (after every speech line, so they take the next provisional ordinals),
 * every line renumbered into reading order, and the session recorded on the transcript — guarded on no
 * session yet and on this consumer's claim, so it happens exactly once.
 */
export function assembleTranscriptStatements(
  database: SqlDatabase,
  input: {
    readonly transcript: MeetingTranscriptRow;
    readonly claimedAt: string;
    readonly gaps: readonly GapLine[];
    readonly uploadSessionId: string;
  },
  options: MeetingTranscriptSystemOptions,
): EffectStatement[] {
  const now = options.clock.now();
  return [
    ...input.gaps.map((gap, index) =>
      insertTranscriptSegmentStatement(database, {
        id: newIdentifier("meetingTranscriptSegment", options.randomSource),
        transcriptId: input.transcript.id,
        ordinal: -(input.transcript.segments_written + index + 1),
        kind: "gap",
        trackId: gap.speaker?.trackId ?? null,
        participantKind: gap.speaker?.participantKind ?? null,
        participantId: gap.speaker?.participantId ?? null,
        userId: gap.speaker?.userId ?? null,
        startedMs: gap.startedMs,
        endedMs: gap.endedMs,
        text: "",
        now,
      }),
    ),
    renumberTranscriptSegmentsStatement(database, input.transcript.id),
    guarded(
      beginTranscriptFilingStatement(database, {
        id: input.transcript.id,
        uploadSessionId: input.uploadSessionId,
        claimedAt: input.claimedAt,
        now,
      }),
      TRANSCRIPT_FILING_GUARD,
    ),
  ];
}

/**
 * THE TRANSCRIPT IS READY: on the matter beside the audio, with ONE audit row of handles and counts —
 * the meeting, the recording, the document and its version, how many lines and words — and never a
 * word of it or the document's name.
 */
export function readyTranscriptStatements(
  database: SqlDatabase,
  input: {
    readonly transcript: MeetingTranscriptRow;
    readonly fileId: FileId;
    readonly fileVersionId: FileVersionId;
    readonly segmentCount: number;
    readonly wordCount: number;
  },
  options: MeetingTranscriptSystemOptions,
): EffectStatement[] {
  const now = options.clock.now();
  return [
    guarded(
      readyTranscriptStatement(database, {
        id: input.transcript.id,
        fileId: input.fileId,
        fileVersionId: input.fileVersionId,
        segmentCount: input.segmentCount,
        wordCount: input.wordCount,
        now,
      }),
      TRANSCRIPT_READY_GUARD,
    ),
    domainAuditStatement(database, {
      event: "meetings.transcript.ready",
      subjectId: input.transcript.id,
      actorUserId: null,
      clock: { now: () => now },
      randomSource: options.randomSource,
      metadata: {
        meetingId: input.transcript.meeting_id,
        recordingId: input.transcript.recording_id,
        fileId: input.fileId,
        fileVersionId: input.fileVersionId,
        segmentCount: input.segmentCount,
        wordCount: input.wordCount,
        readyAt: now,
      },
    }),
  ];
}

/**
 * A TRANSCRIPT THAT CANNOT BE FINISHED: `failed` with the Error ID, and ONE audit row of handles. The
 * write is guarded on `pending`, so the audit row in the same batch is written only by the failure
 * that the record keeps — a failure that lost its race to a filing, or to another failure, rolls back
 * whole and leaves the log saying it failed once.
 */
export function failTranscriptEffect(
  database: SqlDatabase,
  input: { readonly transcript: MeetingTranscriptRow; readonly failureErrorId: string },
  options: MeetingTranscriptSystemOptions,
): EffectWrite {
  const now = options.clock.now();
  return {
    statements: [
      guarded(
        failTranscriptStatement(database, {
          id: input.transcript.id,
          failureErrorId: input.failureErrorId,
          now,
        }),
        TRANSCRIPT_FAIL_GUARD,
      ),
      domainAuditStatement(database, {
        event: "meetings.transcript.failed",
        subjectId: input.transcript.id,
        actorUserId: null,
        clock: { now: () => now },
        randomSource: options.randomSource,
        metadata: {
          meetingId: input.transcript.meeting_id,
          recordingId: input.transcript.recording_id,
          failureErrorId: input.failureErrorId,
          failedAt: now,
        },
      }),
    ],
    outboxMessages: [],
  };
}

/** A stalled transcript handed on again: one more attempt counted, and the stall measured from now. */
export function transcriptRetryEffect(
  database: SqlDatabase,
  transcriptId: MeetingTranscriptId,
  options: MeetingTranscriptSystemOptions,
): EffectWrite {
  return {
    statements: [
      recordTranscriptRetryStatement(database, { id: transcriptId, now: options.clock.now() }),
    ],
    outboxMessages: [],
  };
}

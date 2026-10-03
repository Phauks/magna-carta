import { env } from "cloudflare:test";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { TranscribeInput, TranscriptionResult } from "@magna-carta/inference/port";
import { createStubInferencePort } from "@magna-carta/inference/stub";
import { ok } from "@magna-carta/integrations/dispatch";
import { beforeAll, describe, expect, it } from "vitest";
import type { Bindings } from "../src/app.ts";
import { splitMeetingRecordingBatch } from "../src/event-dispatch.ts";
import type {
  MeetingRecordingComposeMessage,
  MeetingRecordingQueueMessage,
} from "../src/meetings/meeting-recorder.ts";
import {
  failMeetingTranscript,
  meetingTranscriptQueue,
  TRANSCRIPT_CLAIM_LEASE_MILLISECONDS,
  transcribeWindow,
  type TranscriptionPort,
} from "../src/meetings/transcript-consumer.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  countingStub,
  deliveredAs,
  drain,
  filedRecordingAwaitingTranscript,
  firmDatabase,
  objectsPresent,
  RATE,
  speech,
  stagingStillNamed,
  transcriptLines,
  transcriptRow,
  wavMilliseconds,
} from "./support/meeting-transcript-fixture.ts";
import { seedFirm } from "./support/test-auth.ts";

// THE TRANSCRIPT WHEN THINGS GO WRONG, AND AT THE EDGES OF ITS WINDOWS — against the test pool's own
// bucket, the firm's own database and a speech model the test controls.
//
// What would be a real failure if it stopped holding: a participant who left and came back heard at
// the wrong instant, or a piece of their speech running across the time they were away; a sentence cut
// at a region's edge, or the same audio sent twice; a lost speaker whose audio is missing left without a
// line saying so for the time they were captured; a track whose staging vanished part-way read as if
// it had nothing more to say; a filing resumed after a crash writing its lines or its document twice; a
// failure racing the filing leaving bytes nothing names or a session open on the matter; words the model
// reported where it was sent no audio kept on the record; a redelivery that meets a live lease left for
// the sweep; an ingest hand-on that throws keeping the staging; a half-second "yes" fixing the
// transcript's language, or counted as no audio at all; and a message of a kind neither consumer knows
// acknowledged and lost.

let firmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Transcript Resilience Firm" })).firmId;
});

/** The deployment's bucket with its `put` replaced, every other act passed through. */
function bucketWithPut(
  put: (target: R2Bucket, ...rest: Parameters<R2Bucket["put"]>) => ReturnType<R2Bucket["put"]>,
): R2Bucket {
  return new Proxy(env.R2, {
    get(target, property) {
      if (property === "put") {
        return (...rest: Parameters<R2Bucket["put"]>) => put(target, ...rest);
      }
      const value = Reflect.get(target, property) as unknown;
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/** A model that answers each call with the result the test wrote for it, in order. */
function scriptedPort(
  answers: readonly ((input: TranscribeInput) => Partial<TranscriptionResult>)[],
): { port: TranscriptionPort; calls: TranscribeInput[] } {
  const stub = createStubInferencePort();
  const calls: TranscribeInput[] = [];
  return {
    calls,
    port: {
      transcribe: async (input) => {
        calls.push(input);
        const base = await stub.transcribe(input);
        if (!base.ok) return base;
        const answer = answers[calls.length - 1];
        return ok({ ...base.value, ...(answer === undefined ? {} : answer(input)) });
      },
    },
  };
}

describe("where a piece of speech is heard", () => {
  it("places a participant who left and came back at each stretch's own instant, and never runs a piece across the time away", async () => {
    // Staged: four seconds of audio (speech at 1 s), two seconds of the padding a departure closes a
    // stretch with, then the return — heard twenty seconds into the recording — with speech one second
    // in. A second participant, silent, keeps the recording thirty seconds long.
    const samples = new Int16Array(10 * RATE);
    samples.set(speech(4, [[1, 2]]), 0);
    samples.set(speech(4, [[1, 2]]), 6 * RATE);
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const { message, environment } = await filedRecordingAwaitingTranscript(
      firmId,
      [
        {
          speaker: { kind: "member", name: "Returning Speaker" },
          offsetSeconds: 0,
          samples,
          state: "closed",
          segments: [
            { stagedFromSample: 0, at: startedAt, stagedToSample: 4 * RATE },
            {
              stagedFromSample: 6 * RATE,
              at: new Date(Date.parse(startedAt) + 20_000).toISOString(),
              stagedToSample: null,
            },
          ],
          lastFrameAt: new Date(Date.parse(startedAt) + 24_000).toISOString(),
        },
        {
          speaker: { kind: "member", name: "Quiet Listener" },
          offsetSeconds: 0,
          samples: speech(30, []),
          state: "closed",
        },
      ],
      {},
      startedAt,
    );
    const { port, calls } = countingStub();
    expect(await drain(environment, message, port)).toBe("ready");
    expect(calls).toHaveLength(2);
    const lines = (await transcriptLines(message.transcriptId, firmId)).filter(
      (line) => line.kind === "speech",
    );
    expect(lines).toHaveLength(2);
    // The first stretch's piece ends before the padding begins.
    expect(lines[0]!.started_ms).toBeGreaterThanOrEqual(850);
    expect(lines[0]!.ended_ms).toBeLessThanOrEqual(4_000);
    // The return is heard at its own instant, not after the padding on the track's own timeline.
    expect(lines[1]!.started_ms).toBeGreaterThanOrEqual(20_850);
    expect(lines[1]!.started_ms).toBeLessThanOrEqual(20_950);
  });

  it("hears a sentence across a region's edge as ONE piece, sends no audio twice, and hands each region on", async () => {
    const { message, environment } = await filedRecordingAwaitingTranscript(firmId, [
      {
        speaker: { kind: "member", name: "Edge Speaker" },
        offsetSeconds: 0,
        // Speech from 2.5 s to 3.5 s; the regions are three seconds, so it straddles the first edge.
        samples: speech(12, [[2.5, 3.5]]),
        state: "closed",
      },
    ]);
    const { port, calls } = countingStub();
    let windows = 0;
    for (let delivery = 0; delivery < 20; delivery += 1) {
      windows += 1;
      const outcome = await transcribeWindow(environment, message, {
        port,
        regionSamples: 3 * RATE,
        regionsPerInvocation: 1,
      });
      if (outcome !== "progressed") break;
    }
    expect((await transcriptRow(message.transcriptId, firmId))?.state).toBe("ready");
    // One region per window: the track is crossed in several, each handed on.
    expect(windows).toBeGreaterThan(3);
    // One piece, whole: the region that saw the speech still going at its edge held it back.
    expect(calls).toHaveLength(1);
    const lines = (await transcriptLines(message.transcriptId, firmId)).filter(
      (line) => line.kind === "speech",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.started_ms).toBeGreaterThanOrEqual(2_350);
    expect(lines[0]!.started_ms).toBeLessThanOrEqual(2_450);
    expect(lines[0]!.ended_ms).toBeGreaterThanOrEqual(3_750);
    // What was sent is that one piece's length, not a region's or two pieces' worth.
    expect(wavMilliseconds(calls[0]!.audio)).toBeLessThan(1_600);
  });
});

describe("audio that is not there to read", () => {
  it("says a LOST speaker whose audio is missing was not heard from their first frame, not only after they were lost", async () => {
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const { message, environment, stagingKeys, trackIds } = await filedRecordingAwaitingTranscript(
      firmId,
      [
        {
          speaker: { kind: "member", name: "Heard Speaker" },
          offsetSeconds: 0,
          samples: speech(10, [[1, 2]]),
          state: "closed",
        },
        {
          speaker: { kind: "member", name: "Lost Speaker" },
          offsetSeconds: 0,
          samples: speech(4, [[1, 3]]),
          state: "lost",
        },
      ],
      {},
      startedAt,
    );
    // The lost speaker's staged object is gone before the transcript reads it.
    await env.R2.delete(stagingKeys[1]!);
    const { port, calls } = countingStub();
    expect(await drain(environment, message, port)).toBe("ready");
    expect(calls).toHaveLength(1);
    const gaps = (await transcriptLines(message.transcriptId, firmId)).filter(
      (line) => line.kind === "gap",
    );
    expect(gaps).toHaveLength(1);
    // From when their audio was first captured to the stop — the two seconds they spoke included.
    expect(gaps[0]).toMatchObject({ track_id: trackIds[1], started_ms: 0, ended_ms: 10_000 });
  });

  it("refuses a track whose staging vanished part-way through rather than reading it as finished", async () => {
    const { message, environment, stagingKeys, recordingId } =
      await filedRecordingAwaitingTranscript(firmId);
    const { port, calls } = countingStub();
    // One piece per window: the first of the track's two is transcribed, and the window handed on.
    expect(await transcribeWindow(environment, message, { port, piecesPerInvocation: 1 })).toBe(
      "progressed",
    );
    await env.R2.delete(stagingKeys[0]!);
    expect(await transcribeWindow(environment, message, { port, piecesPerInvocation: 1 })).toBe(
      "failed",
    );
    expect(calls).toHaveLength(1);
    // No gap was written over the line already heard; the transcript says it failed instead.
    const lines = await transcriptLines(message.transcriptId, firmId);
    expect(lines.filter((line) => line.kind === "gap")).toEqual([]);
    expect((await transcriptRow(message.transcriptId, firmId))?.failure_error_id).toMatch(/\S/u);
    // A refusal no retry can change lets go of the staging at once.
    expect(await stagingStillNamed(recordingId, firmId)).toBe(0);
  });
});

describe("the filing", () => {
  it("resumes after a crash with its session begun, writing the lines and the document once", async () => {
    const { message, environment } = await filedRecordingAwaitingTranscript(firmId);
    let puts = 0;
    const crashing = {
      ...environment,
      R2: bucketWithPut(async (target, ...rest) => {
        puts += 1;
        // The first write of the document dies — after the assembly batch committed its session.
        if (puts === 1) throw new Error("the isolate went away");
        return await target.put(...rest);
      }),
    } as Bindings;
    const { port } = countingStub();
    await expect(transcribeWindow(crashing, message, { port })).rejects.toThrow(
      "the isolate went away",
    );
    const begun = await transcriptRow(message.transcriptId, firmId);
    expect(begun).toMatchObject({ state: "pending", claimed_at: null });
    expect(begun?.upload_session_id).not.toBeNull();
    const linesBefore = await transcriptLines(message.transcriptId, firmId);

    expect(await transcribeWindow(crashing, message, { port })).toBe("ready");
    const row = await transcriptRow(message.transcriptId, firmId);
    // The same session, completed once; the same lines, renumbered once.
    expect(row?.upload_session_id).toBe(begun?.upload_session_id);
    expect(await transcriptLines(message.transcriptId, firmId)).toEqual(linesBefore);
    expect(row?.segment_count).toBe(linesBefore.length);
    const sessions = await firmDatabase(firmId)
      .prepare(
        `SELECT upload_session.status AS status FROM upload_session JOIN file_version ` +
          `ON file_version.id = upload_session.file_version_id WHERE file_version.file_id = ?1`,
      )
      .bind(row?.file_id)
      .all<{ status: string }>();
    expect(sessions.results).toEqual([{ status: "completed" }]);
    const ready = await firmDatabase(firmId)
      .prepare(
        `SELECT COUNT(*) AS count FROM audit_log WHERE event = 'meetings.transcript.ready' AND subject_id = ?1`,
      )
      .bind(message.transcriptId)
      .first<{ count: number }>();
    expect(ready?.count).toBe(1);
  });

  it("lets go of the document's bytes and its session when the sweep fails the transcript between the write and `ready`", async () => {
    const { message, environment } = await filedRecordingAwaitingTranscript(firmId);
    let documentKey: string | null = null;
    const racing = {
      ...environment,
      R2: bucketWithPut(async (target, key, ...rest) => {
        documentKey = key;
        // The sweep fails it just as the document is written.
        await failMeetingTranscript(
          environment,
          firmDatabase(firmId),
          message.transcriptId,
          "error-from-the-sweep",
          async () => env.R2,
          { releaseStaging: false },
        );
        return await target.put(key, ...rest);
      }),
    } as Bindings;
    const { port } = countingStub();
    expect(await transcribeWindow(racing, message, { port })).toBe("nothing-to-do");
    const row = await transcriptRow(message.transcriptId, firmId);
    expect(row).toMatchObject({ state: "failed", failure_error_id: "error-from-the-sweep" });
    // Nothing is left at the key, and the session the filing opened is aborted, not open.
    expect(documentKey).not.toBeNull();
    expect(await env.R2.head(documentKey!)).toBeNull();
    const session = await firmDatabase(firmId)
      .prepare(`SELECT status FROM upload_session WHERE id = ?1`)
      .bind(row?.upload_session_id)
      .first<{ status: string }>();
    expect(session?.status).toBe("aborted");
  });

  it("files the transcript and releases the staging even when the ingest hand-on throws", async () => {
    const { message, environment, stagingKeys } = await filedRecordingAwaitingTranscript(
      firmId,
      undefined,
      {
        FILES_INGEST: {
          send: async () => {
            throw new Error("the ingest queue refused");
          },
        } as unknown as Bindings["FILES_INGEST"],
      },
    );
    const { port } = countingStub();
    expect(await drain(environment, message, port)).toBe("ready");
    expect(await objectsPresent(stagingKeys)).toBe(0);
  });
});

describe("what the model answers", () => {
  it("keeps only what it reported inside the piece it was sent, and one line for untimed words", async () => {
    const { message, environment } = await filedRecordingAwaitingTranscript(firmId, [
      {
        speaker: { kind: "member", name: "Odd Answers" },
        offsetSeconds: 0,
        samples: speech(14, [
          [1, 2],
          [5, 6],
          [9, 10],
        ]),
        state: "closed",
      },
    ]);
    const { port } = scriptedPort([
      // Timed words, then a tail reported past the end of what was sent.
      () => ({
        text: "Yes. Thank you for watching.",
        segments: [
          { startSeconds: 0.1, endSeconds: 0.5, text: "Yes." },
          { startSeconds: 4, endSeconds: 6, text: "Thank you for watching." },
        ],
      }),
      // Words with no timings at all.
      () => ({ text: "Untimed words.", segments: [] }),
      // Timed and untimed together: the timed segments are the answer.
      () => ({
        text: "Timed. And more.",
        segments: [{ startSeconds: 0.2, endSeconds: 0.6, text: "Timed." }],
      }),
    ]);
    expect(await drain(environment, message, port)).toBe("ready");
    const lines = (await transcriptLines(message.transcriptId, firmId)).filter(
      (line) => line.kind === "speech",
    );
    expect(lines.map((line) => line.text)).toEqual(["Yes.", "Untimed words.", "Timed."]);
    // The untimed line spans its whole piece rather than a timing made up to fit.
    expect(lines[1]!.started_ms).toBeGreaterThanOrEqual(4_850);
    expect(lines[1]!.ended_ms).toBeGreaterThanOrEqual(6_250);
  });

  it("takes the language from the first piece long enough to name it, and sends it as every later piece's hint", async () => {
    const { message, environment } = await filedRecordingAwaitingTranscript(firmId, [
      {
        speaker: { kind: "member", name: "Bilingual Speaker" },
        offsetSeconds: 0,
        samples: speech(17, [
          [1, 1.5],
          [3, 12],
          [14, 15],
        ]),
        state: "closed",
      },
    ]);
    const { port, calls } = scriptedPort([
      () => ({ language: "fr" }),
      () => ({ language: "en" }),
      () => ({ language: "en" }),
    ]);
    expect(await drain(environment, message, port)).toBe("ready");
    expect(calls.map((call) => call.language)).toEqual([undefined, undefined, "en"]);
    const row = await transcriptRow(message.transcriptId, firmId);
    // The half-second's misreading never reached the record.
    expect(row?.language).toBe("en");
    // Every millisecond sent is counted — none of it rounded away.
    const sent = calls.reduce((sum, call) => sum + wavMilliseconds(call.audio), 0);
    expect(Math.abs((row?.transcribed_milliseconds ?? 0) - sent)).toBeLessThanOrEqual(3);
  });
});

describe("a redelivery that meets a live lease", () => {
  it("is retried once the lease runs out, rather than acknowledged and left for the sweep", async () => {
    const { message, environment } = await filedRecordingAwaitingTranscript(firmId);
    // A consumer claimed this window five minutes ago and was evicted mid-window by a deploy.
    const claimedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await firmDatabase(firmId)
      .prepare(`UPDATE meeting_transcript SET claimed_at = ?1 WHERE id = ?2`)
      .bind(claimedAt, message.transcriptId)
      .run();
    const { port, calls } = countingStub();
    const redelivery = deliveredAs(message, 2);
    await meetingTranscriptQueue(redelivery.batch, environment, { port });
    expect(calls).toEqual([]);
    expect(redelivery.done).toHaveLength(1);
    expect(redelivery.done[0]!.act).toBe("retry");
    const remaining = (TRANSCRIPT_CLAIM_LEASE_MILLISECONDS - 5 * 60 * 1000) / 1000;
    expect(redelivery.done[0]!.delaySeconds).toBeGreaterThan(remaining - 10);
    expect(redelivery.done[0]!.delaySeconds).toBeLessThanOrEqual(remaining + 1);

    // Once the lease has run out, the retry takes the window.
    await firmDatabase(firmId)
      .prepare(`UPDATE meeting_transcript SET claimed_at = ?1 WHERE id = ?2`)
      .bind(
        new Date(Date.now() - TRANSCRIPT_CLAIM_LEASE_MILLISECONDS - 1000).toISOString(),
        message.transcriptId,
      )
      .run();
    const retry = deliveredAs(message, 3);
    await meetingTranscriptQueue(retry.batch, environment, { port });
    expect(retry.done).toEqual([{ act: "ack" }]);
    expect((await transcriptRow(message.transcriptId, firmId))?.state).toBe("ready");
  });
});

describe("the recording queue's two kinds of message", () => {
  it("splits a mixed batch into its two halves and retries a kind neither consumer knows", () => {
    const done: string[] = [];
    const messageOf = (id: string, body: unknown) => ({
      id,
      timestamp: new Date(),
      body,
      attempts: 1,
      ack: () => done.push(`ack ${id}`),
      retry: () => done.push(`retry ${id}`),
    });
    const compose: MeetingRecordingComposeMessage = {
      kind: "meeting-recording-compose",
      firmId,
      meetingId: "meeting_a" as MeetingRecordingComposeMessage["meetingId"],
      recordingId: "meetingRecording_a" as MeetingRecordingComposeMessage["recordingId"],
    };
    const transcript = {
      kind: "meeting-transcript",
      firmId,
      meetingId: compose.meetingId,
      recordingId: compose.recordingId,
      transcriptId: "meetingTranscript_a",
    };
    const batch = {
      queue: "magna-carta-production-meeting-recording-compose",
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      messages: [
        messageOf("one", compose),
        messageOf("two", { kind: "meeting-summary", firmId }),
        messageOf("three", transcript),
        messageOf("four", compose),
      ],
      ackAll: () => done.push("ack all"),
      retryAll: () => done.push("retry all"),
    } as unknown as MessageBatch<MeetingRecordingQueueMessage>;

    const split = splitMeetingRecordingBatch(batch);
    // The unknown kind is retried — read again by a deploy that knows it — and never acknowledged.
    expect(done).toEqual(["retry two"]);
    expect(split.compose?.messages.map((one) => one.id)).toEqual(["one", "four"]);
    expect(split.transcript?.messages.map((one) => one.id)).toEqual(["three"]);
    // Each half acknowledges only its own.
    split.transcript?.ackAll();
    expect(done).toEqual(["retry two", "ack three"]);

    // A batch of one kind has no other half.
    const onlyCompose = splitMeetingRecordingBatch({
      ...batch,
      messages: [messageOf("five", compose)],
    } as unknown as MessageBatch<MeetingRecordingQueueMessage>);
    expect(onlyCompose.transcript).toBeNull();
    expect(onlyCompose.compose?.messages).toHaveLength(1);
  });
});

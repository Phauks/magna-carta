import { env } from "cloudflare:test";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { readTokenUsage } from "@magna-carta/data-access/token-usage-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmId,
  MeetingRecordingId,
  MeetingSummaryId,
  MeetingTranscriptId,
  UserId,
} from "@magna-carta/identifiers/types";
import { PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID } from "@magna-carta/inference/catalog";
import type { ConversationInput, GenerateResult } from "@magna-carta/inference/port";
import {
  aiProcessingEligibilityDefinition,
  primaryReasoningModelDefinition,
} from "@magna-carta/inference/settings";
import { adapterError, ok, type Dispatch } from "@magna-carta/integrations/dispatch";
import { integrationProblem } from "@magna-carta/integrations/problem";
import { summariesEnabledDefinition } from "@magna-carta/meetings/settings";
import {
  SUMMARY_COMBINE_SYSTEM_PROMPT,
  SUMMARY_PART_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
} from "@magna-carta/meetings/summary-prompt";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Bindings } from "../src/app.ts";
import { createApp } from "../src/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import type {
  MeetingRecordingQueueMessage,
  MeetingSummaryMessage,
} from "../src/meetings/meeting-recorder.ts";
import {
  meetingSummaryQueue,
  SUMMARY_MODEL_FAILURE_LIMIT,
  summarizeMeeting,
  type SummaryPort,
} from "../src/meetings/summary-consumer.ts";
import { transcriptModelRetryDelaySeconds } from "../src/meetings/transcript-consumer.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  seedMemberIn,
  seedRecordedMeeting,
  type RecordedMeeting,
} from "./support/meeting-recording-fixture.ts";
import {
  collectingEnvironment,
  countingStub,
  drain,
  filedRecordingAwaitingTranscript,
} from "./support/meeting-transcript-fixture.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// THE SUMMARY OF A READY TRANSCRIPT, against the firm's own database and a scripted reasoning model.
//
// The platform's stub answers a conversation with a fixed sentence, which cannot carry the summary's
// structure, so these tests hand the consumer a port of their own that answers what each test scripts —
// in this file, never in the stub.
//
// What would be a real failure if it stopped holding: a ready transcript with no summary begun; a summary
// written for a firm that has not switched summaries on, or sent to a third-party model the firm has not
// allowed; the firm's own choice of model swapped for another; an owner linked on anything but the exact
// name; a due date the transcript never stated; a long transcript sent whole past the model's context, or
// cut and never combined; tokens spent and not metered; a model outage failing the summary at once, or
// never; two deliveries sending the transcript to a model twice; a re-run that leaves the old action items
// behind; a summary of a walled matter, or of a trashed transcript, readable; a read not audited, or
// audited with a sentence of the summary; an action item made into two tasks, or into one by a member who
// may not; and any of it reaching a task by a path other than the task subsystem's own.

const app = createApp();
const base = "https://example.com";

let firmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;
let billingCookie: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Summary Firm" })).firmId;
  const owner = await seedCredentialedUser("summary-owner@example.com", {
    userName: "Summary Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Summary Owner", firmId);
  ownerCookie = await signInForSessionCookie("summary-owner@example.com");
  const reader = await seedCredentialedUser("summary-reader@example.com", {
    userName: "Summary Reader",
    firmId,
  });
  await mirrorMemberWithRole(reader.userId, "Summary Reader", firmId, "Read-only");
  readOnlyCookie = await signInForSessionCookie("summary-reader@example.com");
  // Billing joins meetings and does not host them: the member who may read a summary and not re-run it.
  const bookkeeper = await seedCredentialedUser("summary-billing@example.com", {
    userName: "Summary Billing",
    firmId,
  });
  await mirrorMemberWithRole(bookkeeper.userId, "Summary Billing", firmId, "Billing");
  billingCookie = await signInForSessionCookie("summary-billing@example.com");
});

function database(inFirm: FirmId = firmId) {
  return firmDatabaseFor(env.FIRM_DATABASE, inFirm);
}

// ---- the firm's settings ----

interface FirmPosture {
  readonly summaries: boolean;
  readonly eligible: boolean;
  // The model the firm has chosen; undefined for a firm that has chosen none.
  readonly chosenModel?: string;
}

async function setPosture(posture: FirmPosture, inFirm: FirmId = firmId): Promise<void> {
  const firm = database(inFirm);
  const now = new Date().toISOString();
  await firm.batch([
    writeFirmSettingStatement(firm, summariesEnabledDefinition, posture.summaries, now),
    writeFirmSettingStatement(firm, aiProcessingEligibilityDefinition, posture.eligible, now),
    posture.chosenModel === undefined
      ? firm.prepare(`DELETE FROM setting WHERE key = ?1`).bind(primaryReasoningModelDefinition.key)
      : writeFirmSettingStatement(firm, primaryReasoningModelDefinition, posture.chosenModel, now),
  ]);
}

beforeEach(async () => {
  await setPosture({ summaries: true, eligible: false });
});

// ---- the scripted model ----

/** A reasoning model that answers what a test scripts, in order, keeping every request it was sent. */
function scriptedModel(
  answers: readonly (string | Dispatch<GenerateResult>)[],
  usage = { inputTokens: 1_000, outputTokens: 200 },
): { port: SummaryPort; calls: ConversationInput[] } {
  const calls: ConversationInput[] = [];
  return {
    calls,
    port: {
      generateConversation: async (input) => {
        calls.push(input);
        const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
        if (answer === undefined) throw new Error("the script has no answer");
        return typeof answer === "string"
          ? ok({ text: answer, usage, snapshotId: `${input.modelId}-snapshot` })
          : answer;
      },
    },
  };
}

function answerOf(value: unknown): string {
  return JSON.stringify(value);
}

const WELL_FORMED = answerOf({
  summary: "The parties agreed the response date and the declaration.",
  actionItems: [
    {
      text: "File the response.",
      owner: "Ana Herrera",
      dueOn: "2026-11-14",
      dueOnStated: "by 14 November",
    },
    { text: "Send the declaration.", owner: "Ana", dueOn: null, dueOnStated: null },
    {
      text: "Call the court clerk.",
      owner: "Gail Guest",
      dueOn: "2026-10-09",
      dueOnStated: "Friday",
    },
  ],
});

// ---- the record ----

interface SeededSummary {
  readonly meeting: RecordedMeeting;
  readonly recordingId: MeetingRecordingId;
  readonly transcriptId: MeetingTranscriptId;
  readonly summaryId: MeetingSummaryId;
  readonly fileId: string;
  readonly fileVersionId: string;
  readonly anaUserId: UserId;
  readonly message: MeetingSummaryMessage;
}

/** One line of speech a test seeds: who, when, what. */
interface SeededLine {
  readonly speaker: "ana" | "guest";
  readonly startedMs: number;
  readonly text: string;
}

const DEFAULT_LINES: readonly SeededLine[] = [
  { speaker: "ana", startedMs: 1_000, text: "We will file the response by 14 November." },
  { speaker: "guest", startedMs: 65_000, text: "I can call the clerk on Friday." },
  { speaker: "ana", startedMs: 3_725_000, text: "And I will send the declaration." },
];

/**
 * A filed recording with a READY transcript of the given lines — spoken by a member, Ana Herrera, and a
 * guest — its WebVTT document a clean, current version on the recording's matter, and its summary
 * pending: what the transcript's settle leaves.
 */
async function readySummaryOf(
  meeting: RecordedMeeting,
  lines: readonly SeededLine[] = DEFAULT_LINES,
): Promise<SeededSummary> {
  const firm = database(meeting.firmId);
  const now = new Date().toISOString();
  const anaUserId = await seedMemberIn(meeting.firmId, "Ana Herrera");
  const anaStay = newIdentifier("meetingAttendance");
  const guestStay = newIdentifier("meetingGuestStay");
  const recordingId = newIdentifier("meetingRecording") as MeetingRecordingId;
  const transcriptId = newIdentifier("meetingTranscript") as MeetingTranscriptId;
  const summaryId = newIdentifier("meetingSummary") as MeetingSummaryId;
  const fileId = newIdentifier("file");
  const fileVersionId = newIdentifier("fileVersion");
  const invitationId = newIdentifier("meetingGuestInvitation");
  await firm.batch([
    firm
      .prepare(
        `INSERT INTO meeting_recording (id, meeting_id, matter_id, state, started_by_user_id, ` +
          `started_at, stopped_at, stop_reason, track_count, captured_seconds, created_at, updated_at) ` +
          `VALUES (?1, ?2, ?3, 'filed', ?4, ?5, ?5, 'member', 2, 60, ?5, ?5)`,
      )
      .bind(recordingId, meeting.meetingId, meeting.matterId, meeting.hostUserId, now),
    firm
      .prepare(
        `INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'x.vtt', ?3, ?3)`,
      )
      .bind(fileId, meeting.matterId, now),
    firm
      .prepare(
        `INSERT INTO file_version (id, file_id, version_number, r2_key, status, scan_verdict, ` +
          `created_at) VALUES (?1, ?2, 1, ?3, 'clean', 'clean', ?4)`,
      )
      .bind(fileVersionId, fileId, `files/${fileVersionId}`, now),
    firm
      .prepare(`UPDATE file SET current_version_id = ?1 WHERE id = ?2`)
      .bind(fileVersionId, fileId),
    firm
      .prepare(
        `INSERT INTO meeting_guest_invitation (id, meeting_id, entity_kind, entity_id, invited_name, ` +
          `token_secret_hash, issued_by_user_id, expires_at, created_at, updated_at) VALUES ` +
          `(?1, ?2, 'person', ?3, 'Gail Guest', ?4, ?5, '2099-01-01T00:00:00.000Z', ?6, ?6)`,
      )
      .bind(
        invitationId,
        meeting.meetingId,
        newIdentifier("directoryPerson"),
        "0".repeat(64),
        meeting.hostUserId,
        now,
      ),
    firm
      .prepare(
        `INSERT INTO meeting_guest_stay (id, meeting_id, invitation_id, confirmed_name, joined_at, ` +
          `waiting_from, created_at, updated_at) VALUES (?1, ?2, ?3, 'Gail Guest', ?4, ?4, ?4, ?4)`,
      )
      .bind(guestStay, meeting.meetingId, invitationId, now),
    firm
      .prepare(
        `INSERT INTO meeting_transcript (id, meeting_id, recording_id, state, segment_count, ` +
          `file_id, file_version_id, created_at, updated_at) VALUES (?1, ?2, ?3, 'ready', ?4, ?5, ?6, ` +
          `?7, ?7)`,
      )
      .bind(transcriptId, meeting.meetingId, recordingId, lines.length, fileId, fileVersionId, now),
    firm
      .prepare(
        `INSERT INTO meeting_summary (id, meeting_id, recording_id, transcript_id, state, ` +
          `progress_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?5, ?5)`,
      )
      .bind(summaryId, meeting.meetingId, recordingId, transcriptId, now),
  ]);
  // In pages, because a Durable Object's SQLite takes a bounded batch.
  for (let from = 0; from < lines.length; from += 200) {
    await firm.batch(
      lines
        .slice(from, from + 200)
        .map((line, index) =>
          firm
            .prepare(
              `INSERT INTO meeting_transcript_segment (id, transcript_id, ordinal, kind, ` +
                `participant_kind, participant_id, user_id, started_ms, ended_ms, text, created_at) ` +
                `VALUES (?1, ?2, ?3, 'speech', ?4, ?5, ?6, ?7, ?7, ?8, ?9)`,
            )
            .bind(
              newIdentifier("meetingTranscriptSegment"),
              transcriptId,
              from + index,
              line.speaker === "ana" ? "member" : "guest",
              line.speaker === "ana" ? anaStay : guestStay,
              line.speaker === "ana" ? anaUserId : null,
              line.startedMs,
              line.text,
              now,
            ),
        ),
    );
  }
  return {
    meeting,
    recordingId,
    transcriptId,
    summaryId,
    fileId,
    fileVersionId,
    anaUserId,
    message: {
      kind: "meeting-summary",
      firmId: meeting.firmId,
      meetingId: meeting.meetingId,
      recordingId,
      transcriptId,
      summaryId,
    },
  };
}

async function summaryRow(summaryId: string, inFirm: FirmId = firmId) {
  return await database(inFirm)
    .prepare(
      `SELECT state, model_id, snapshot_id, summary_text, input_tokens, output_tokens, model_calls, ` +
        `refusal_reason, failure_error_id, model_failures, claimed_at, requested_by_user_id ` +
        `FROM meeting_summary WHERE id = ?1`,
    )
    .bind(summaryId)
    .first<{
      state: string;
      model_id: string | null;
      snapshot_id: string | null;
      summary_text: string | null;
      input_tokens: number;
      output_tokens: number;
      model_calls: number;
      refusal_reason: string | null;
      failure_error_id: string | null;
      model_failures: number;
      claimed_at: string | null;
      requested_by_user_id: string | null;
    }>();
}

async function actionItems(summaryId: string) {
  const { results } = await database()
    .prepare(
      `SELECT id, ordinal, text, owner_user_id, due_on, task_id FROM meeting_summary_action_item ` +
        `WHERE summary_id = ?1 ORDER BY ordinal`,
    )
    .bind(summaryId)
    .all<{
      id: string;
      ordinal: number;
      text: string;
      owner_user_id: string | null;
      due_on: string | null;
      task_id: string | null;
    }>();
  return results;
}

async function audits(event: string, subjectId: string) {
  const { results } = await database()
    .prepare(
      `SELECT actor_user_id, metadata FROM audit_log WHERE event = ?1 AND subject_id = ?2 ` +
        `ORDER BY created_at, id`,
    )
    .bind(event, subjectId)
    .all<{ actor_user_id: string | null; metadata: string }>();
  return results;
}

/** The meter's request count for one model, summed over its days. */
async function meteredRequests(modelId: string, inFirm: FirmId = firmId): Promise<number> {
  const rows = await readTokenUsage(database(inFirm));
  return rows.find((row) => row.modelId === modelId)?.requestCount ?? 0;
}

async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return await app.request(`${base}${path}`, { method: "GET", headers: { cookie } }, env);
}

async function post(
  path: string,
  options: {
    readonly cookie?: string;
    readonly body?: unknown;
    readonly environment?: Bindings;
    readonly idempotencyKey?: string;
  } = {},
): Promise<Response> {
  return await app.request(
    `${base}${path}`,
    {
      method: "POST",
      headers: {
        cookie: options.cookie ?? ownerCookie,
        "content-type": "application/json",
        "idempotency-key": options.idempotencyKey ?? crypto.randomUUID(),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    },
    options.environment ?? env,
  );
}

function summaryPath(seeded: Pick<SeededSummary, "meeting" | "recordingId">): string {
  return `/api/v1/meetings/${seeded.meeting.meetingId}/recordings/${seeded.recordingId}/summary`;
}

interface SummaryView {
  summary: {
    id: string;
    state: string;
    refusalReason: string | null;
    failureErrorId: string | null;
    modelId: string | null;
  };
  text: string | null;
  actionItems: {
    id: string;
    ordinal: number;
    text: string;
    owner: { userId: string; displayName: string } | null;
    dueOn: string | null;
    taskId: string | null;
  }[];
  withheld: string | null;
}

/** A seeded summary, written by the scripted model. */
async function writtenSummary(meeting?: RecordedMeeting): Promise<SeededSummary> {
  const seeded = await readySummaryOf(meeting ?? (await seedRecordedMeeting(firmId)));
  const { port } = scriptedModel([WELL_FORMED]);
  expect(await summarizeMeeting(env, seeded.message, { port })).toBe("ready");
  return seeded;
}

// ---- the tests ----

describe("a ready transcript's summary is begun", () => {
  it("in the batch that makes the transcript ready, with its message sent on the recording queue", async () => {
    const filed = await filedRecordingAwaitingTranscript(firmId);
    const { port } = countingStub();
    expect(await drain(filed.environment, filed.message, port)).toBe("ready");
    const begun = filed.queued.find(
      (one): one is MeetingSummaryMessage => one.kind === "meeting-summary",
    );
    expect(begun).toMatchObject({
      firmId,
      meetingId: filed.meeting.meetingId,
      recordingId: filed.recordingId,
      transcriptId: filed.message.transcriptId,
    });
    expect(await summaryRow(begun!.summaryId)).toMatchObject({
      state: "pending",
      requested_by_user_id: null,
    });
    // The recording list says where the summary stands, beside the transcript.
    const list = await readJson<{
      data: { id: string; summaryState: string | null; summary: unknown }[];
    }>(await get(`/api/v1/meetings/${filed.meeting.meetingId}/recordings`));
    const entry = list.data.find((one) => one.id === filed.recordingId);
    expect(entry?.summaryState).toBe("pending");
    expect(entry?.summary).toEqual({ id: begun!.summaryId, state: "pending", refusalReason: null });
  });
});

describe("whether a summary is written, and by which model", () => {
  it("is refused `disabled` while the firm has not switched summaries on, and no model is asked", async () => {
    await setPosture({ summaries: false, eligible: true });
    const seeded = await readySummaryOf(await seedRecordedMeeting(firmId));
    const { port, calls } = scriptedModel([WELL_FORMED]);
    expect(await summarizeMeeting(env, seeded.message, { port })).toBe("refused");
    expect(calls).toHaveLength(0);
    expect(await summaryRow(seeded.summaryId)).toMatchObject({
      state: "refused",
      refusal_reason: "disabled",
      failure_error_id: null,
      claimed_at: null,
    });
    const [refused] = await audits("meetings.summary.refused", seeded.summaryId);
    expect(JSON.parse(refused!.metadata)).toMatchObject({ reason: "disabled", modelId: null });
  });

  it("is refused `not-eligible` where the firm chose a third-party model it has not allowed — and never swapped for another", async () => {
    await setPosture({
      summaries: true,
      eligible: false,
      chosenModel: "anthropic/claude-opus-4-8",
    });
    const seeded = await readySummaryOf(await seedRecordedMeeting(firmId));
    const { port, calls } = scriptedModel([WELL_FORMED]);
    expect(await summarizeMeeting(env, seeded.message, { port })).toBe("refused");
    expect(calls).toHaveLength(0);
    expect(await summaryRow(seeded.summaryId)).toMatchObject({
      state: "refused",
      refusal_reason: "not-eligible",
      model_id: "anthropic/claude-opus-4-8",
    });
  });

  it("runs on the model hosted on Cloudflare for a firm that chose none, eligible or not", async () => {
    const seeded = await readySummaryOf(await seedRecordedMeeting(firmId));
    const before = await meteredRequests(PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID);
    const { port, calls } = scriptedModel([WELL_FORMED]);
    expect(await summarizeMeeting(env, seeded.message, { port })).toBe("ready");

    // ONE call, the platform's instruction on its own field and the transcript as the one member message.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      modelId: PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID,
      firmId,
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      maximumOutputTokens: 8_192,
    });
    expect(calls[0]!.messages).toEqual([
      {
        role: "member",
        content: [
          "Participants, spelled exactly as the transcript spells them:",
          "- Ana Herrera",
          "- Gail Guest",
          "",
          "Transcript:",
          "00:00:01 Ana Herrera: We will file the response by 14 November.",
          "00:01:05 Gail Guest: I can call the clerk on Friday.",
          "01:02:05 Ana Herrera: And I will send the declaration.",
        ].join("\n"),
      },
    ]);

    expect(await summaryRow(seeded.summaryId)).toMatchObject({
      state: "ready",
      summary_text: "The parties agreed the response date and the declaration.",
      model_id: PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID,
      snapshot_id: `${PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID}-snapshot`,
      input_tokens: 1_000,
      output_tokens: 200,
      model_calls: 1,
      claimed_at: null,
    });
    // An owner only on an exact match to a MEMBER; a date only where the transcript stated it.
    expect(
      (await actionItems(seeded.summaryId)).map((item) => [
        item.ordinal,
        item.text,
        item.owner_user_id,
        item.due_on,
      ]),
    ).toEqual([
      [0, "File the response.", seeded.anaUserId, "2026-11-14"],
      [1, "Send the declaration.", null, null],
      [2, "Call the court clerk.", null, null],
    ]);
    // The provider's own usage is on the firm's meter.
    expect(await meteredRequests(PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID)).toBe(before + 1);
    // The audit row carries handles and counts — never a sentence of the summary or an item.
    const [ready] = await audits("meetings.summary.ready", seeded.summaryId);
    expect(JSON.parse(ready!.metadata)).toMatchObject({
      transcriptId: seeded.transcriptId,
      modelCalls: 1,
      actionItemCount: 3,
      ownedActionItemCount: 1,
      datedActionItemCount: 1,
    });
    expect(ready!.metadata).not.toContain("response");
    expect(ready!.metadata).not.toContain("declaration");
  });

  it("runs on the firm's chosen third-party model where its eligibility allows", async () => {
    await setPosture({
      summaries: true,
      eligible: true,
      chosenModel: "anthropic/claude-sonnet-4-6",
    });
    const seeded = await readySummaryOf(await seedRecordedMeeting(firmId));
    const { port, calls } = scriptedModel([WELL_FORMED]);
    expect(await summarizeMeeting(env, seeded.message, { port })).toBe("ready");
    expect(calls.map((call) => call.modelId)).toEqual(["anthropic/claude-sonnet-4-6"]);
    expect(await meteredRequests("anthropic/claude-sonnet-4-6")).toBeGreaterThanOrEqual(1);
  });

  it("is refused `transcript-empty` for a transcript in which nobody was heard", async () => {
    const seeded = await readySummaryOf(await seedRecordedMeeting(firmId), []);
    // Only a gap line: nothing anybody said.
    await database()
      .prepare(
        `INSERT INTO meeting_transcript_segment (id, transcript_id, ordinal, kind, started_ms, ` +
          `ended_ms, text, created_at) VALUES (?1, ?2, 0, 'gap', 0, 60000, '', ?3)`,
      )
      .bind(
        newIdentifier("meetingTranscriptSegment"),
        seeded.transcriptId,
        new Date().toISOString(),
      )
      .run();
    const { port, calls } = scriptedModel([WELL_FORMED]);
    expect(await summarizeMeeting(env, seeded.message, { port })).toBe("refused");
    expect(calls).toHaveLength(0);
    expect(await summaryRow(seeded.summaryId)).toMatchObject({
      state: "refused",
      refusal_reason: "transcript-empty",
    });
  });
});

describe("a transcript too long for one call", () => {
  it("is summarized a part at a time inside the model's context, and the parts combined", async () => {
    // About 400 kB of transcript, past the 362 kB one call to the model hosted on Cloudflare may carry.
    const lines: SeededLine[] = Array.from({ length: 400 }, (_, index) => ({
      speaker: index % 2 === 0 ? "ana" : "guest",
      startedMs: index * 30_000,
      text: `Point ${String(index)}. ${"discussion ".repeat(90)}`,
    }));
    const seeded = await readySummaryOf(await seedRecordedMeeting(firmId), lines);
    const part = (index: number) =>
      answerOf({
        summary: `Part ${String(index)} covered points.`,
        actionItems: [
          {
            text: `Follow up on part ${String(index)}.`,
            owner: "Ana Herrera",
            dueOn: null,
            dueOnStated: null,
          },
        ],
      });
    const { port, calls } = scriptedModel([part(1), part(2), WELL_FORMED]);
    expect(await summarizeMeeting(env, seeded.message, { port })).toBe("ready");

    expect(calls.map((call) => call.systemPrompt)).toEqual([
      SUMMARY_PART_SYSTEM_PROMPT,
      SUMMARY_PART_SYSTEM_PROMPT,
      SUMMARY_COMBINE_SYSTEM_PROMPT,
    ]);
    expect(calls.map((call) => call.maximumOutputTokens)).toEqual([4_096, 4_096, 8_192]);
    const sent = calls.map((call) => call.messages[0]!.content);
    expect(sent[0]).toContain("Transcript, part 1 of 2:");
    expect(sent[1]).toContain("Transcript, part 2 of 2:");
    // Every line went to exactly one part, in order, and each part fits the model's context.
    const linesSent = [sent[0]!, sent[1]!].flatMap((message) =>
      message.split("\n").filter((line) => /^\d\d:\d\d:\d\d /u.test(line)),
    );
    expect(linesSent).toHaveLength(400);
    expect(linesSent[0]).toMatch(/^00:00:00 Ana Herrera: Point 0\./u);
    for (const message of [sent[0]!, sent[1]!]) {
      expect(new TextEncoder().encode(message).byteLength).toBeLessThan((131_000 - 8_192) * 3);
    }
    // The combining call reads each part's answer as the structure it was read into.
    expect(sent[2]).toContain("The summaries of the 2 parts, in order:");
    expect(sent[2]).toContain('"summary":"Part 1 covered points."');
    expect(sent[2]).toContain('"summary":"Part 2 covered points."');

    expect(await summaryRow(seeded.summaryId)).toMatchObject({
      state: "ready",
      model_calls: 3,
      input_tokens: 3_000,
      output_tokens: 600,
    });
  });
});

describe("a model that will not answer, or answers badly", () => {
  it("is outlasted: each refusal counted and the run sent again after the transcript's doubling delay — and only a run of them fails it", async () => {
    const seeded = await readySummaryOf(await seedRecordedMeeting(firmId));
    const { environment, sends } = collectingEnvironment();
    const busy = scriptedModel([
      adapterError(integrationProblem("upstream", 503, "The model is busy")),
    ]);
    const delays: (number | undefined)[] = [];
    for (let refusal = 1; refusal < SUMMARY_MODEL_FAILURE_LIMIT; refusal += 1) {
      expect(await summarizeMeeting(environment, seeded.message, { port: busy.port })).toBe(
        "retrying",
      );
      delays.push(sends.at(-1)?.delaySeconds);
      expect(sends.at(-1)?.message).toEqual(seeded.message);
      expect(await summaryRow(seeded.summaryId)).toMatchObject({
        state: "pending",
        model_failures: refusal,
        claimed_at: null,
      });
    }
    expect(delays).toEqual(delays.map((_, index) => transcriptModelRetryDelaySeconds(index + 1)));
    expect(await summarizeMeeting(environment, seeded.message, { port: busy.port })).toBe("failed");
    const failed = await summaryRow(seeded.summaryId);
    expect(failed).toMatchObject({ state: "failed", claimed_at: null });
    expect(failed?.failure_error_id).toMatch(/\S/u);
    expect(await audits("meetings.summary.failed", seeded.summaryId)).toHaveLength(1);
  });

  it("fails at once, with an Error ID and no action items, on an answer that is not the documented structure", async () => {
    const seeded = await readySummaryOf(await seedRecordedMeeting(firmId));
    const before = await meteredRequests(PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID);
    const { port } = scriptedModel(["Here is a summary of the meeting: it went well."]);
    expect(await summarizeMeeting(env, seeded.message, { port })).toBe("failed");
    const failed = await summaryRow(seeded.summaryId);
    expect(failed).toMatchObject({ state: "failed", summary_text: null, model_calls: 1 });
    expect(failed?.failure_error_id).toMatch(/\S/u);
    expect(await actionItems(seeded.summaryId)).toEqual([]);
    // The call it spent is still metered.
    expect(await meteredRequests(PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID)).toBe(before + 1);
    // The audit row names the failure and never the answer.
    const [audit] = await audits("meetings.summary.failed", seeded.summaryId);
    expect(audit!.metadata).not.toContain("went well");
  });
});

describe("two deliveries of one summary's message", () => {
  it("send the transcript to a model once: the second finds a live claim and is retried after it", async () => {
    const seeded = await readySummaryOf(await seedRecordedMeeting(firmId));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scripted = scriptedModel([WELL_FORMED]);
    const slow: SummaryPort = {
      generateConversation: async (input) => {
        await gate;
        return await scripted.port.generateConversation(input);
      },
    };
    const first = summarizeMeeting(env, seeded.message, { port: slow });
    // Wait for the first delivery's claim to land before the second arrives.
    for (
      let wait = 0;
      wait < 50 && (await summaryRow(seeded.summaryId))?.claimed_at === null;
      wait += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const done: { act: string; delaySeconds?: number }[] = [];
    const batch = {
      queue: "magna-carta-production-meeting-recording-compose",
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      messages: [
        {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          body: seeded.message,
          attempts: 1,
          ack: () => done.push({ act: "ack" }),
          retry: (options?: { readonly delaySeconds?: number }) =>
            done.push({ act: "retry", delaySeconds: options?.delaySeconds }),
        },
      ],
      ackAll: () => done.push({ act: "ack" }),
      retryAll: () => done.push({ act: "retry" }),
    } as unknown as MessageBatch<MeetingSummaryMessage>;
    await meetingSummaryQueue(batch, env, { port: slow });
    expect(done).toHaveLength(1);
    expect(done[0]!.act).toBe("retry");
    expect(done[0]!.delaySeconds).toBeGreaterThan(0);

    release();
    expect(await first).toBe("ready");
    expect(scripted.calls).toHaveLength(1);
    // The retry, when it comes, has nothing to do.
    expect(await summarizeMeeting(env, seeded.message, { port: scripted.port })).toBe(
      "nothing-to-do",
    );
    expect(scripted.calls).toHaveLength(1);
    expect(await actionItems(seeded.summaryId)).toHaveLength(3);
  });
});

describe("asking for a summary again", () => {
  it("replaces a written summary's text and action items, records who asked, and sends the run on", async () => {
    const seeded = await writtenSummary();
    const { environment, queued } = collectingEnvironment();
    const asked = await post(summaryPath(seeded), { environment });
    expect(asked.status).toBe(202);
    const view = await readJson<SummaryView>(asked);
    expect(view).toMatchObject({
      summary: { id: seeded.summaryId, state: "pending", refusalReason: null },
      text: null,
      actionItems: [],
    });
    expect(await actionItems(seeded.summaryId)).toEqual([]);
    const row = await summaryRow(seeded.summaryId);
    expect(row).toMatchObject({ state: "pending", summary_text: null, model_calls: 0 });
    expect(row?.requested_by_user_id).not.toBeNull();
    expect(queued).toEqual([seeded.message] as MeetingRecordingQueueMessage[]);
    expect(await audits("meetings.summary.requested", seeded.summaryId)).toHaveLength(1);

    // Asking while it is being written writes nothing more.
    const again = await post(summaryPath(seeded), { environment });
    expect(again.status).toBe(202);
    expect(await audits("meetings.summary.requested", seeded.summaryId)).toHaveLength(1);

    // The run writes the new answer.
    const { port } = scriptedModel([answerOf({ summary: "A second account.", actionItems: [] })]);
    expect(await summarizeMeeting(env, seeded.message, { port })).toBe("ready");
    expect(await summaryRow(seeded.summaryId)).toMatchObject({
      state: "ready",
      summary_text: "A second account.",
    });
  });

  it("begins one for a ready transcript that has none, and refuses a transcript that is not ready", async () => {
    const seeded = await readySummaryOf(await seedRecordedMeeting(firmId));
    await database()
      .prepare(`DELETE FROM meeting_summary WHERE id = ?1`)
      .bind(seeded.summaryId)
      .run();
    const { environment, queued } = collectingEnvironment();
    const asked = await post(summaryPath(seeded), { environment });
    expect(asked.status).toBe(202);
    const view = await readJson<SummaryView>(asked);
    expect(view.summary.state).toBe("pending");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ kind: "meeting-summary", summaryId: view.summary.id });

    await database()
      .prepare(`UPDATE meeting_transcript SET state = 'pending', file_id = NULL WHERE id = ?1`)
      .bind(seeded.transcriptId)
      .run();
    const refused = await post(summaryPath(seeded), { environment });
    expect(refused.status).toBe(409);
    expect((await readJson<{ type: string }>(refused)).type).toContain(
      "meeting-transcript-not-ready",
    );
  });

  it("is a host's act: a member without meetings:host is refused", async () => {
    const seeded = await writtenSummary();
    expect((await post(summaryPath(seeded), { cookie: billingCookie })).status).toBe(403);
    expect(await summaryRow(seeded.summaryId)).toMatchObject({ state: "ready" });
  });
});

describe("reading a summary", () => {
  it("answers the text and the action items with their owners' names, and audits the read with identifiers only", async () => {
    const seeded = await writtenSummary();
    const response = await get(summaryPath(seeded));
    expect(response.status).toBe(200);
    const view = await readJson<SummaryView>(response);
    expect(view.summary).toMatchObject({ id: seeded.summaryId, state: "ready" });
    expect(view.text).toBe("The parties agreed the response date and the declaration.");
    expect(view.withheld).toBeNull();
    expect(
      view.actionItems.map((item) => [item.text, item.owner, item.dueOn, item.taskId]),
    ).toEqual([
      [
        "File the response.",
        { userId: seeded.anaUserId, displayName: "Ana Herrera" },
        "2026-11-14",
        null,
      ],
      ["Send the declaration.", null, null, null],
      ["Call the court clerk.", null, null, null],
    ]);
    // Read by a member who joins meetings and does not host them, too — and by nobody without the key.
    expect((await get(summaryPath(seeded), billingCookie)).status).toBe(200);
    expect((await get(summaryPath(seeded), readOnlyCookie)).status).toBe(403);
    const reads = await audits("meetings.summary.read", seeded.summaryId);
    expect(reads).toHaveLength(2);
    expect(reads.every((read) => read.actor_user_id !== null)).toBe(true);
    expect(JSON.parse(reads[0]!.metadata)).toEqual({
      meetingId: seeded.meeting.meetingId,
      recordingId: seeded.recordingId,
      transcriptId: seeded.transcriptId,
      actionItemCount: 3,
    });
  });

  it("answers a summary not yet written with its header alone, and writes no audit row", async () => {
    const seeded = await readySummaryOf(await seedRecordedMeeting(firmId));
    const view = await readJson<SummaryView>(await get(summaryPath(seeded)));
    expect(view).toMatchObject({ summary: { state: "pending" }, text: null, actionItems: [] });
    expect(await audits("meetings.summary.read", seeded.summaryId)).toEqual([]);
  });

  it("withholds the words of a summary whose transcript's document is in the trash, held, or gone", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const trashed = await writtenSummary(meeting);
    const held = await writtenSummary(meeting);
    const purged = await writtenSummary(meeting);
    await database()
      .prepare(`UPDATE file SET deleted_at = ?1 WHERE id = ?2`)
      .bind(new Date().toISOString(), trashed.fileId)
      .run();
    await database()
      .prepare(`UPDATE file_version SET status = 'quarantined' WHERE id = ?1`)
      .bind(held.fileVersionId)
      .run();
    await database()
      .prepare(`UPDATE meeting_transcript SET file_version_id = NULL WHERE id = ?1`)
      .bind(purged.transcriptId)
      .run();
    for (const [seeded, reason] of [
      [trashed, "removed"],
      [held, "held"],
      [purged, "unavailable"],
    ] as const) {
      const view = await readJson<SummaryView>(await get(summaryPath(seeded)));
      expect(view).toMatchObject({
        summary: { state: "ready" },
        text: null,
        actionItems: [],
        withheld: reason,
      });
      expect(await audits("meetings.summary.read", seeded.summaryId)).toEqual([]);
      // Nor can its action items be made into tasks.
      const [item] = await actionItems(seeded.summaryId);
      const refused = await post(`${summaryPath(seeded)}/action-items/${item!.id}/task`, {
        body: {},
      });
      expect(refused.status).toBe(409);
    }
  });

  it("does not reach a summary on a walled matter, under another meeting, or in another firm", async () => {
    const seeded = await writtenSummary();
    const other = await seedRecordedMeeting(firmId);
    expect(
      (await get(`/api/v1/meetings/${other.meetingId}/recordings/${seeded.recordingId}/summary`))
        .status,
    ).toBe(404);
    await database()
      .prepare(`UPDATE matter SET system_key = 'custody-holding' WHERE id = ?1`)
      .bind(seeded.meeting.matterId)
      .run();
    expect((await get(summaryPath(seeded))).status).toBe(404);
    expect((await post(summaryPath(seeded))).status).toBe(404);

    const otherFirm = (await seedFirm({ name: "Another Summary Firm" })).firmId;
    await setPosture({ summaries: true, eligible: false }, otherFirm);
    const elsewhere = await readySummaryOf(await seedRecordedMeeting(otherFirm));
    const { port } = scriptedModel([WELL_FORMED]);
    expect(await summarizeMeeting(env, elsewhere.message, { port })).toBe("ready");
    expect((await get(summaryPath(elsewhere))).status).toBe(404);
  });
});

describe("an action item made into a task", () => {
  it("goes through the task subsystem's own create path — on the matter, in the owner's name, due in the meeting's zone — once", async () => {
    const seeded = await writtenSummary();
    const [first] = await actionItems(seeded.summaryId);
    const path = `${summaryPath(seeded)}/action-items/${first!.id}/task`;
    const created = await post(path, { body: {} });
    expect(created.status).toBe(201);
    const body = await readJson<{ taskId: string; actionItem: SummaryView["actionItems"][number] }>(
      created,
    );
    expect(body.actionItem).toMatchObject({ id: first!.id, taskId: body.taskId });

    const task = await database()
      .prepare(
        `SELECT matter_id, title, body, assignee_user_id, due_on, time_zone FROM matter_task WHERE id = ?1`,
      )
      .bind(body.taskId)
      .first<Record<string, string | null>>();
    expect(task).toEqual({
      matter_id: seeded.meeting.matterId,
      title: "File the response.",
      body: null,
      assignee_user_id: seeded.anaUserId,
      due_on: "2026-11-14",
      time_zone: "America/Los_Angeles",
    });
    // The task subsystem's own audit row, and the summary's — identifiers only.
    expect(await audits("tasks.task.created", body.taskId)).toHaveLength(1);
    const [tasked] = await audits("meetings.summary.actionItemTasked", seeded.summaryId);
    expect(JSON.parse(tasked!.metadata)).toEqual({
      meetingId: seeded.meeting.meetingId,
      recordingId: seeded.recordingId,
      actionItemId: first!.id,
      taskId: body.taskId,
    });

    // A second press — a fresh request, not a retry — makes no second task.
    const again = await post(path, { body: {} });
    expect(again.status).toBe(409);
    expect((await readJson<{ type: string }>(again)).type).toContain(
      "meeting-summary-action-item-tasked",
    );
    const { results } = await database()
      .prepare(`SELECT id FROM matter_task WHERE matter_id = ?1 AND title = 'File the response.'`)
      .bind(seeded.meeting.matterId)
      .all();
    expect(results).toHaveLength(1);
  });

  it("leaves an unowned item's task unassigned, and refuses a member who may not write tasks", async () => {
    const seeded = await writtenSummary();
    const items = await actionItems(seeded.summaryId);
    const unowned = items[1]!;
    const path = `${summaryPath(seeded)}/action-items/${unowned.id}/task`;
    expect((await post(path, { cookie: readOnlyCookie, body: {} })).status).toBe(403);
    const created = await readJson<{ taskId: string }>(await post(path, { body: {} }));
    const task = await database()
      .prepare(`SELECT assignee_user_id, due_on FROM matter_task WHERE id = ?1`)
      .bind(created.taskId)
      .first<{ assignee_user_id: string | null; due_on: string | null }>();
    expect(task).toEqual({ assignee_user_id: null, due_on: null });
    // An item of a summary that is not ready cannot be made a task, and one that is not there is 404.
    expect(
      (
        await post(
          `${summaryPath(seeded)}/action-items/${newIdentifier("meetingSummaryActionItem")}/task`,
          {
            body: {},
          },
        )
      ).status,
    ).toBe(404);
  });
});

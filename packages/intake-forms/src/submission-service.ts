import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { IntakeFormSubmissionId, UserId } from "@magna-carta/identifiers/types";
import {
  countSubmissionsSince,
  insertSubmissionStatement,
  readForm,
  readSubmission,
  recordTriageStatement,
  type IntakeFormRow,
} from "./form-statements.ts";
import { isTriageState, type IntakeSubmissionTriageState } from "./types.ts";
import {
  IntakeFormValidationError,
  normalizeTriageNote,
  validateSubmissionAnswers,
  type AnswerableField,
} from "./validation.ts";

// WHAT A STRANGER SENT, AND WHAT A MEMBER DID ABOUT IT.
//
// The write half of this file runs on the anonymous path and is the most constrained code in the
// platform. Three rules, and none is a matter of style:
//
// 1. IT PERFORMS NO LOOKUP AGAINST FIRM DATA. Not the Directory, not matters, not conflicts. Every
//    one of those is a read whose duration varies with what the visitor typed, and a form that
//    answers measurably slower for a name the firm already knows hands a probing script an oracle
//    from the clock. The budget count below is the one read, and it is keyed by the FORM — the same
//    cost for every submission through it, whatever the submission says.
// 2. IT CREATES NOTHING BUT A ROW. No person, no organization, no matter, no intake. That is what
//    keeps a spam run out of the firm's corpus no matter how much of it gets past the rate limit and
//    the challenge: the worst outcome is a queue a member clears.
// 3. IT WRITES NO AUDIT ROW. Every other write in the platform names its actor, and here there is
//    none — an audit row whose actor is "somebody on the internet" says nothing the submission does
//    not already say, and would double the write cost of the one endpoint an attacker can call for
//    free. The submission IS the record. Triage, which has an actor, audits normally.

export interface SubmissionServiceOptions {
  readonly clock: { now(): string };
  readonly randomSource?: RandomSource;
}

export interface TriageServiceOptions extends SubmissionServiceOptions {
  readonly actorUserId: UserId;
}

/** Why a submission was refused, where the reason is about the FORM rather than about the answers. */
export type SubmissionRefusal = "form-unreachable" | "budget-exhausted";

export class SubmissionRefusedError extends Error {
  readonly refusal: SubmissionRefusal;
  constructor(refusal: SubmissionRefusal, message: string) {
    super(message);
    this.name = "SubmissionRefusedError";
    this.refusal = refusal;
  }
}

/**
 * The start of the day a submission is being counted against, as an ISO instant.
 *
 * UTC rather than the firm's own zone, deliberately: the budget is an abuse control, not a report,
 * and it must not have a per-firm boundary a flood could aim at. A firm reading its own numbers gets
 * them from the queue, which carries real instants.
 */
export function budgetWindowStart(now: string): string {
  return `${now.slice(0, 10)}T00:00:00.000Z`;
}

/**
 * Record what one stranger sent.
 *
 * `fields` comes from the version the visitor was actually served, read by the caller before this
 * runs; validation against it is local computation (see `validateSubmissionAnswers`). The budget
 * check is the only database read here, and it is deliberately last-but-one: a submission that fails
 * validation costs no read at all.
 */
export async function recordSubmission(
  database: SqlDatabase,
  input: {
    readonly form: IntakeFormRow;
    readonly fields: readonly AnswerableField[];
    readonly answers: Readonly<Record<string, string>>;
  },
  options: SubmissionServiceOptions,
): Promise<{ readonly submissionId: IntakeFormSubmissionId; readonly effect: EffectWrite }> {
  if (input.form.status !== "published" || input.form.published_version_id === null) {
    // Reached only by a caller that did not use readPublishedFormByToken. The public route cannot
    // provoke it, and it is here so a future caller cannot accidentally serve a closed form.
    throw new SubmissionRefusedError("form-unreachable", "this form is not accepting submissions");
  }

  const answers = validateSubmissionAnswers(input.fields, input.answers);
  const now = options.clock.now();

  if (input.form.submission_budget_per_day !== null) {
    const taken = await countSubmissionsSince(database, input.form.id, budgetWindowStart(now));
    if (taken >= input.form.submission_budget_per_day) {
      throw new SubmissionRefusedError(
        "budget-exhausted",
        "this form is not accepting submissions right now",
      );
    }
  }

  const submissionId = newIdentifier("intakeFormSubmission", options.randomSource);
  return {
    submissionId,
    effect: {
      statements: [
        insertSubmissionStatement(database, {
          id: submissionId,
          formVersionId: input.form.published_version_id,
          answersJson: JSON.stringify(answers),
          now,
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Record a member's decision about one submission.
 *
 * ACCEPTING CREATES NOTHING. It records that a member looked and decided to take it further, and
 * stops there — turning an accepted submission into a Directory entity and an intake is a separate
 * act with its own preconditions in the Directory, the conflicts engine and the matter lifecycle.
 * What ships here is the fact the firm needs first, and the one the anonymous path is forbidden from
 * producing: that a person made a decision, and which person.
 *
 * A decision can be changed. A submission marked spam that turns out to be a real enquiry is exactly
 * the mistake a queue produces, and making the first decision final would mean the firm's record of
 * what it did is a record of what it did first.
 */
export async function recordTriageDecision(
  database: SqlDatabase,
  input: {
    readonly submissionId: IntakeFormSubmissionId;
    readonly state: string;
    readonly note?: string | null;
  },
  options: TriageServiceOptions,
): Promise<EffectWrite> {
  const submission = await readSubmission(database, input.submissionId);
  if (submission === undefined) {
    throw new IntakeFormValidationError(
      "form-unknown",
      `no such submission: ${input.submissionId}`,
    );
  }
  if (!isTriageState(input.state) || input.state === "new") {
    // "new" is the state a submission is BORN in, not one a member may return it to: a member who
    // has looked cannot un-look, and a queue that can be reset is a queue whose count means nothing.
    throw new IntakeFormValidationError(
      "triage-unknown-state",
      `${JSON.stringify(input.state)} is not a decision a member can record`,
    );
  }

  const state: IntakeSubmissionTriageState = input.state;
  const note = normalizeTriageNote(input.note);

  return {
    statements: [
      recordTriageStatement(database, {
        id: input.submissionId,
        state,
        note,
        triagedBy: options.actorUserId,
        now: options.clock.now(),
      }),
      domainAuditStatement(database, {
        event: "intakeFormSubmission.triaged",
        subjectId: input.submissionId,
        actorUserId: options.actorUserId,
        clock: options.clock,
        randomSource: options.randomSource,
        // The decision and nothing the stranger wrote. An audit row is read by people who are not
        // reading the submission, and their account of their problem is not audit metadata.
        metadata: { state },
      }),
    ],
    outboxMessages: [],
  };
}

/** Read a form for the staff side, where a refusal may name what is missing. */
export async function requireFormForStaff(
  database: SqlDatabase,
  formId: IntakeFormRow["id"],
): Promise<IntakeFormRow> {
  const form = await readForm(database, formId);
  if (form === undefined) {
    throw new IntakeFormValidationError("form-unknown", `no such intake form: ${formId}`);
  }
  return form;
}

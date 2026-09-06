import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { IntakeProcedureStepId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { readMatterAnchor } from "./checklist.ts";
import {
  readProcedure,
  readProcedureStep,
  type IntakeProcedureStepRow,
} from "./procedure-statements.ts";
import {
  insertStepRecordStatement,
  readLiveStepRecords,
  supersedeLiveStepRecordStatement,
} from "./record-statements.ts";
import { INTAKE_STEP_KIND_PROFILES } from "./types.ts";
import { IntakeValidationError, normalizeNote, normalizeRationale } from "./validation.ts";

// A member's answer to one step on one consultation: that they completed it, that they waive it,
// or that an earlier answer no longer stands.
//
// EVERY WRITE HERE IS A PERSON'S. There is no queue consumer, no scheduled handler and no rule that
// records a step, and the audit row names the member — because the record is the firm's evidence
// that it did what its own procedure requires before it acted, and evidence nobody signed is not
// evidence. The fitness scan in test/ holds that no automated path imports this module.
//
// APPEND-AND-FLIP. Recording over an existing answer supersedes it in the same batch and writes a
// new row; reopening supersedes and writes nothing. The history read keeps every answer, so a step
// that was recorded, reopened and recorded again reads as three facts in order.

export interface RecordServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
}

function audit(
  database: SqlDatabase,
  options: RecordServiceOptions,
  event: string,
  subjectId: string,
  metadata: unknown,
) {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
    metadata,
  });
}

// The step must be a live step of an active procedure that binds THIS matter's type. A step from a
// procedure bound to another kind of matter is refused rather than recorded: a record that answers a
// question the matter was never asked would satisfy nothing and confuse everything.
async function requireBoundStep(
  database: SqlDatabase,
  matterId: MatterId,
  stepId: IntakeProcedureStepId,
): Promise<IntakeProcedureStepRow> {
  const matter = await readMatterAnchor(database, matterId);
  if (matter === undefined) {
    throw new IntakeValidationError("matter-unknown", `no such matter: ${matterId}`);
  }
  if (matter.status !== "intake") {
    throw new IntakeValidationError(
      "matter-not-intake",
      `matter ${matterId} is ${matter.status}; the intake procedure is answered while the matter is in intake, before it becomes a consultation`,
    );
  }
  const step = await readProcedureStep(database, stepId);
  if (step === undefined || step.active !== 1) {
    throw new IntakeValidationError("step-unknown", `no such intake procedure step: ${stepId}`);
  }
  const procedure = await readProcedure(database, step.procedure_id);
  const bound =
    procedure !== undefined &&
    procedure.active === 1 &&
    (procedure.matter_type_id === null || procedure.matter_type_id === matter.matter_type_id);
  if (!bound) {
    throw new IntakeValidationError(
      "step-not-bound",
      `intake step ${stepId} is not part of a procedure that binds matter ${matterId}`,
    );
  }
  return step;
}

export interface RecordStepInput {
  readonly matterId: MatterId;
  readonly stepId: IntakeProcedureStepId;
  readonly note?: string | null;
}

export async function recordStepCompleted(
  database: SqlDatabase,
  input: RecordStepInput,
  options: RecordServiceOptions,
): Promise<{ recordId: string; effect: EffectWrite }> {
  const step = await requireBoundStep(database, input.matterId, input.stepId);
  if (!INTAKE_STEP_KIND_PROFILES[step.kind].recordable) {
    throw new IntakeValidationError(
      "step-not-recordable",
      `a ${step.kind} step is answered by the platform's own record of it and cannot be recorded complete by hand; it can be waived`,
    );
  }
  const note = normalizeNote(input.note);
  const now = options.clock.now();
  const recordId = newIdentifier("matterIntakeStepRecord", options.randomSource);
  return {
    recordId,
    effect: {
      statements: [
        supersedeLiveStepRecordStatement(database, {
          matterId: input.matterId,
          procedureStepId: input.stepId,
          supersededBy: options.actorUserId,
          now,
        }),
        insertStepRecordStatement(database, {
          id: recordId,
          matterId: input.matterId,
          procedureStepId: input.stepId,
          outcome: "completed",
          rationale: null,
          note,
          recordedBy: options.actorUserId,
          now,
        }),
        audit(database, options, "intake.step.completed", recordId, {
          matterId: input.matterId,
          stepId: input.stepId,
          kind: step.kind,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface WaiveStepInput {
  readonly matterId: MatterId;
  readonly stepId: IntakeProcedureStepId;
  readonly rationale: string;
}

// A waiver is the recorded override of an opening requirement: a named member, a mandatory
// rationale, an audit row. It is permitted on every kind, including the kinds no member may record
// complete, because that is exactly the case it exists for — the firm deciding to act without a fact
// the platform would otherwise wait for, and saying why.
export async function waiveStep(
  database: SqlDatabase,
  input: WaiveStepInput,
  options: RecordServiceOptions,
): Promise<{ recordId: string; effect: EffectWrite }> {
  const step = await requireBoundStep(database, input.matterId, input.stepId);
  const rationale = normalizeRationale(input.rationale);
  const now = options.clock.now();
  const recordId = newIdentifier("matterIntakeStepRecord", options.randomSource);
  return {
    recordId,
    effect: {
      statements: [
        supersedeLiveStepRecordStatement(database, {
          matterId: input.matterId,
          procedureStepId: input.stepId,
          supersededBy: options.actorUserId,
          now,
        }),
        insertStepRecordStatement(database, {
          id: recordId,
          matterId: input.matterId,
          procedureStepId: input.stepId,
          outcome: "waived",
          rationale,
          note: null,
          recordedBy: options.actorUserId,
          now,
        }),
        audit(database, options, "intake.step.waived", recordId, {
          matterId: input.matterId,
          stepId: input.stepId,
          kind: step.kind,
          required: step.required === 1,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface ReopenStepInput {
  readonly matterId: MatterId;
  readonly stepId: IntakeProcedureStepId;
}

// Reopening supersedes the live answer and writes no new one: the step goes back to being answered
// by its subsystem, or by nobody. Refused when nothing is live, because a reopen that changed
// nothing would still leave an audit row saying somebody reopened something.
export async function reopenStep(
  database: SqlDatabase,
  input: ReopenStepInput,
  options: RecordServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const step = await requireBoundStep(database, input.matterId, input.stepId);
  const live = (await readLiveStepRecords(database, input.matterId)).find(
    (record) => record.procedure_step_id === input.stepId,
  );
  if (live === undefined) {
    throw new IntakeValidationError(
      "record-none-live",
      `intake step ${input.stepId} has no live record on matter ${input.matterId} to reopen`,
    );
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        supersedeLiveStepRecordStatement(database, {
          matterId: input.matterId,
          procedureStepId: input.stepId,
          supersededBy: options.actorUserId,
          now,
        }),
        audit(database, options, "intake.step.reopened", live.id, {
          matterId: input.matterId,
          stepId: input.stepId,
          kind: step.kind,
          previousOutcome: live.outcome,
        }),
      ],
      outboxMessages: [],
    },
  };
}

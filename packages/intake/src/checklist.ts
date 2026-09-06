import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId, MatterTypeId } from "@magna-carta/identifiers/types";
import {
  readProceduresBinding,
  readStepsOfProcedures,
  type IntakeProcedureStepRow,
} from "./procedure-statements.ts";
import { readLiveStepRecords, type MatterIntakeStepRecordRow } from "./record-statements.ts";
import {
  INTAKE_STEP_KIND_PROFILES,
  MAX_PROCEDURE_PAGE_SIZE,
  type IntakeRecordOutcome,
  type IntakeStepKind,
} from "./types.ts";
import { IntakeValidationError } from "./validation.ts";

// Where a consultation stands against the procedure that binds it — the read every intake surface
// and the opening gate share.
//
// THE CHECKLIST IS DERIVED, NEVER STORED. It is the active procedures binding the matter's type,
// their active steps, and for each step the answer of whoever owns the fact: a subsystem reader for
// the kinds a subsystem can answer, and a member's live record otherwise. Nothing here writes, and
// nothing caches a subsystem's answer onto the matter — a step cannot say "done" after the fact it
// stood on has changed, and raising the firm's requirements changes every open checklist at once.
//
// THE READER SEAM. A reader is a function per step kind, registered by the composition root and
// never imported here. That is what lets a kind exist ahead of the subsystem that will answer it: an
// identity-verification step is a member's record today and a verification port's answer the day one
// is built, with no change to this read, to the schema, or to a firm's procedures. A reader may also
// decline a particular step (a document step naming no template has nothing to look for) by
// returning null, and the step is then answered as a member's record or not at all.

export interface StepReadContext {
  readonly database: SqlDatabase;
  readonly matterId: MatterId;
  readonly step: IntakeProcedureStepRow;
}

// What a subsystem found. `satisfied` is whether the fact the step asks for is in place; `statement`
// is one sentence saying what was found, in the subsystem's own vocabulary — the checklist repeats
// it and never summarises it into a word of its own.
export interface StepReading {
  readonly satisfied: boolean;
  readonly statement: string;
}

export type IntakeStepReader = (context: StepReadContext) => Promise<StepReading | null>;
export type IntakeStepReaders = Partial<Record<IntakeStepKind, IntakeStepReader>>;

// Who answered a step. Three values on purpose: a subsystem's answer and a member's record are
// different kinds of evidence, and "nobody" is a real state the gate refuses on rather than a blank.
export type StepAnsweredBy = "subsystem" | "record" | "nobody";

export interface StepStanding {
  readonly satisfied: boolean;
  readonly answeredBy: StepAnsweredBy;
  readonly statement: string;
}

export interface ChecklistRecord {
  readonly id: string;
  readonly outcome: IntakeRecordOutcome;
  readonly rationale: string | null;
  readonly note: string | null;
  readonly recordedBy: string;
  readonly recordedAt: string;
}

export interface ChecklistStep {
  readonly stepId: string;
  readonly procedureId: string;
  readonly procedureName: string;
  readonly kind: IntakeStepKind;
  readonly title: string;
  readonly instructions: string | null;
  readonly required: boolean;
  readonly referenceId: string | null;
  readonly position: number;
  // Whether a member may record this step completed by hand (types.ts holds the reasoning).
  readonly recordable: boolean;
  readonly standing: StepStanding;
  readonly record: ChecklistRecord | null;
}

export interface IntakeChecklist {
  readonly matterId: string;
  readonly matterStatus: "intake" | "consultation" | "open" | "closed";
  readonly procedures: readonly { readonly id: string; readonly name: string }[];
  readonly steps: readonly ChecklistStep[];
  // How many REQUIRED steps have no satisfying answer — the number the opening gate refuses on and
  // the one number worth showing, because it is a fact about the firm's own procedure.
  readonly outstandingRequired: number;
}

interface MatterAnchorRow {
  readonly id: MatterId;
  readonly status: "intake" | "consultation" | "open" | "closed";
  readonly matter_type_id: MatterTypeId | null;
}

export async function readMatterAnchor(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<MatterAnchorRow | undefined> {
  const { results } = await database
    .prepare(`SELECT id, status, matter_type_id FROM matter WHERE id = ?1 AND system_key IS NULL`)
    .bind(matterId)
    .all<MatterAnchorRow>();
  return results[0];
}

function recordStanding(record: MatterIntakeStepRecordRow): StepStanding {
  return {
    satisfied: true,
    answeredBy: "record",
    statement:
      record.outcome === "waived"
        ? `Waived: ${record.rationale ?? ""}`
        : record.note === null
          ? "Recorded as completed."
          : `Recorded as completed: ${record.note}`,
  };
}

const NOBODY: StepStanding = {
  satisfied: false,
  answeredBy: "nobody",
  statement: "Not yet recorded.",
};

// The standing of one step. A member's live record wins — a waiver is the firm's decision to open
// without the fact, and a completion on a recordable kind is the firm's own evidence — and a
// subsystem reader answers the rest. Readings are memoised per kind and reference within one
// checklist read, so two steps asking the same subsystem the same question cost one read.
async function standingOf(
  context: StepReadContext,
  record: MatterIntakeStepRecordRow | undefined,
  readers: IntakeStepReaders,
  memo: Map<string, Promise<StepReading | null>>,
): Promise<StepStanding> {
  if (record !== undefined) return recordStanding(record);
  const reader = readers[context.step.kind];
  if (reader === undefined) return NOBODY;
  const key = `${context.step.kind} ${context.step.reference_id ?? ""}`;
  let reading = memo.get(key);
  if (reading === undefined) {
    reading = reader(context);
    memo.set(key, reading);
  }
  const answer = await reading;
  if (answer === null) return NOBODY;
  return { satisfied: answer.satisfied, answeredBy: "subsystem", statement: answer.statement };
}

export async function readIntakeChecklist(
  database: SqlDatabase,
  matterId: MatterId,
  readers: IntakeStepReaders,
): Promise<IntakeChecklist> {
  const matter = await readMatterAnchor(database, matterId);
  if (matter === undefined) {
    throw new IntakeValidationError("matter-unknown", `no such matter: ${matterId}`);
  }
  const procedures = await readProceduresBinding(
    database,
    matter.matter_type_id,
    MAX_PROCEDURE_PAGE_SIZE,
  );
  const steps = await readStepsOfProcedures(
    database,
    procedures.map((procedure) => procedure.id),
  );
  const records = await readLiveStepRecords(database, matterId);
  const recordByStep = new Map(records.map((record) => [record.procedure_step_id, record]));
  const procedureName = new Map(procedures.map((procedure) => [procedure.id, procedure.name]));
  const memo = new Map<string, Promise<StepReading | null>>();

  const listed: ChecklistStep[] = [];
  for (const step of steps) {
    const record = recordByStep.get(step.id);
    const standing = await standingOf({ database, matterId, step }, record, readers, memo);
    listed.push({
      stepId: step.id,
      procedureId: step.procedure_id,
      procedureName: procedureName.get(step.procedure_id) ?? "",
      kind: step.kind,
      title: step.title,
      instructions: step.instructions,
      required: step.required === 1,
      referenceId: step.reference_id,
      position: step.position,
      recordable: INTAKE_STEP_KIND_PROFILES[step.kind].recordable,
      standing,
      record:
        record === undefined
          ? null
          : {
              id: record.id,
              outcome: record.outcome,
              rationale: record.rationale,
              note: record.note,
              recordedBy: record.recorded_by,
              recordedAt: record.recorded_at,
            },
    });
  }
  return {
    matterId: matter.id,
    matterStatus: matter.status,
    procedures: procedures.map((procedure) => ({ id: procedure.id, name: procedure.name })),
    steps: listed,
    outstandingRequired: listed.filter((step) => step.required && !step.standing.satisfied).length,
  };
}

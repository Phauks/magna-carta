import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  IntakeProcedureId,
  IntakeProcedureStepId,
  MatterTypeId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  countProcedureSteps,
  insertProcedureStatement,
  insertProcedureStepStatement,
  readProcedure,
  readProcedureIdByName,
  readProcedureStep,
  setProcedureActiveStatement,
  setProcedureStepActiveStatement,
  updateProcedureStatement,
  updateProcedureStepStatement,
} from "./procedure-statements.ts";
import { INTAKE_STEP_KIND_PROFILES, MAX_PROCEDURE_STEPS, type IntakeStepKind } from "./types.ts";
import {
  IntakeValidationError,
  normalizeProcedureDescription,
  normalizeProcedureName,
  normalizeStepInstructions,
  normalizeStepKind,
  normalizeStepTitle,
} from "./validation.ts";

// Authoring the intake procedure: the firm's own account of what a kind of matter must clear before
// it opens.
//
// NOTHING HERE TOUCHES A MATTER. A procedure is firm configuration, and editing one changes what the
// checklist DERIVES on every consultation of its kind from that moment — deliberately, and this is
// the one place intake departs from the matter plan's "nothing reconciles". A plan's tasks are the
// firm's account of work already accepted, so a template edit reaching into them would move a due
// date nobody authorised. A procedure is the firm's CURRENT policy on what it requires before it
// acts, and the conflicts floor already set the precedent: raising the firm's floor fails the gate on
// every affected matter immediately, with no sweep and no write, because a matter that opens tomorrow
// should clear today's requirements. A member's records survive the edit untouched — a record names
// the step it answered, and a retired step's record stays readable as history.

export interface ProcedureServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
}

export interface ProcedureInput {
  readonly name: string;
  readonly description?: string | null;
  // Null binds the procedure to every kind of matter.
  readonly matterTypeId: MatterTypeId | null;
}

export interface ProcedureStepInput {
  readonly kind: string;
  readonly title: string;
  readonly instructions?: string | null;
  readonly required?: boolean | null;
  readonly referenceId?: string | null;
  readonly position?: number | null;
}

function audit(
  database: SqlDatabase,
  options: ProcedureServiceOptions,
  event: string,
  subjectId: string,
  metadata?: unknown,
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

async function refuseTakenName(
  database: SqlDatabase,
  name: string,
  except: IntakeProcedureId | null,
): Promise<void> {
  const holder = await readProcedureIdByName(database, name);
  if (holder !== undefined && holder !== except) {
    throw new IntakeValidationError(
      "procedure-name-taken",
      `another procedure is already called "${name}"`,
    );
  }
}

async function requireProcedure(database: SqlDatabase, id: IntakeProcedureId) {
  const procedure = await readProcedure(database, id);
  if (procedure === undefined) {
    throw new IntakeValidationError("procedure-unknown", `no such intake procedure: ${id}`);
  }
  return procedure;
}

// A reference is validated for SHAPE against the kind — a kind that is about nothing refuses one —
// and never for existence: this package does not know what a document template or a custom field
// is, and the reader for the kind resolves the handle at the moment of reading.
function normalizeReference(kind: IntakeStepKind, referenceId: string | null | undefined) {
  const trimmed = referenceId?.trim() ?? "";
  if (trimmed === "") return null;
  if (INTAKE_STEP_KIND_PROFILES[kind].reference === null) {
    throw new IntakeValidationError(
      "step-reference-not-applicable",
      `a ${kind} step is not about any one thing and takes no reference`,
    );
  }
  return trimmed;
}

export async function createProcedure(
  database: SqlDatabase,
  input: ProcedureInput,
  options: ProcedureServiceOptions,
): Promise<{ procedureId: IntakeProcedureId; effect: EffectWrite }> {
  const name = normalizeProcedureName(input.name);
  const description = normalizeProcedureDescription(input.description);
  await refuseTakenName(database, name, null);
  const now = options.clock.now();
  const procedureId = newIdentifier("intakeProcedure", options.randomSource);
  return {
    procedureId,
    effect: {
      statements: [
        insertProcedureStatement(database, {
          id: procedureId,
          name,
          description,
          matterTypeId: input.matterTypeId,
          createdBy: options.actorUserId,
          now,
        }),
        // A procedure's name is firm configuration rather than anything about a client, but it is
        // still text a member typed and the audit log carries identifiers and enums; the matter
        // type is an identifier and says which procedure this was without repeating its name.
        audit(database, options, "intake.procedure.created", procedureId, {
          matterTypeId: input.matterTypeId,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export async function editProcedure(
  database: SqlDatabase,
  procedureId: IntakeProcedureId,
  input: ProcedureInput,
  options: ProcedureServiceOptions,
): Promise<{ effect: EffectWrite }> {
  await requireProcedure(database, procedureId);
  const name = normalizeProcedureName(input.name);
  const description = normalizeProcedureDescription(input.description);
  await refuseTakenName(database, name, procedureId);
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        updateProcedureStatement(database, {
          id: procedureId,
          name,
          description,
          matterTypeId: input.matterTypeId,
          now,
        }),
        audit(database, options, "intake.procedure.edited", procedureId, {
          matterTypeId: input.matterTypeId,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Deactivating stops the procedure binding any consultation from this moment; it changes no record
// on any matter and the procedure stays readable. Reactivating binds it again.
export async function setProcedureActive(
  database: SqlDatabase,
  procedureId: IntakeProcedureId,
  active: boolean,
  options: ProcedureServiceOptions,
): Promise<{ effect: EffectWrite }> {
  await requireProcedure(database, procedureId);
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        setProcedureActiveStatement(database, procedureId, active, now),
        audit(
          database,
          options,
          active ? "intake.procedure.activated" : "intake.procedure.deactivated",
          procedureId,
        ),
      ],
      outboxMessages: [],
    },
  };
}

export async function addProcedureStep(
  database: SqlDatabase,
  procedureId: IntakeProcedureId,
  input: ProcedureStepInput,
  options: ProcedureServiceOptions,
): Promise<{ stepId: IntakeProcedureStepId; effect: EffectWrite }> {
  const procedure = await requireProcedure(database, procedureId);
  if (procedure.active !== 1) {
    throw new IntakeValidationError(
      "procedure-inactive",
      `intake procedure ${procedureId} is deactivated; reactivate it before adding steps`,
    );
  }
  const kind = normalizeStepKind(input.kind);
  const title = normalizeStepTitle(input.title);
  const instructions = normalizeStepInstructions(input.instructions);
  const referenceId = normalizeReference(kind, input.referenceId);
  const count = await countProcedureSteps(database, procedureId);
  if (count >= MAX_PROCEDURE_STEPS) {
    throw new IntakeValidationError(
      "step-too-many",
      `a procedure holds at most ${String(MAX_PROCEDURE_STEPS)} steps`,
    );
  }
  const now = options.clock.now();
  const stepId = newIdentifier("intakeProcedureStep", options.randomSource);
  const required = input.required ?? true;
  return {
    stepId,
    effect: {
      statements: [
        insertProcedureStepStatement(database, {
          id: stepId,
          procedureId,
          kind,
          title,
          instructions,
          required,
          referenceId,
          position: input.position ?? count,
          now,
        }),
        audit(database, options, "intake.procedure.step.added", stepId, {
          procedureId,
          kind,
          required,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// The kind is not editable (procedure-statements.ts says why); everything else is replaced.
export async function editProcedureStep(
  database: SqlDatabase,
  stepId: IntakeProcedureStepId,
  input: Omit<ProcedureStepInput, "kind">,
  options: ProcedureServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const step = await readProcedureStep(database, stepId);
  if (step === undefined) {
    throw new IntakeValidationError("step-unknown", `no such intake procedure step: ${stepId}`);
  }
  if (step.active !== 1) {
    throw new IntakeValidationError("step-inactive", `intake step ${stepId} has been retired`);
  }
  const title = normalizeStepTitle(input.title);
  const instructions = normalizeStepInstructions(input.instructions);
  const referenceId = normalizeReference(step.kind, input.referenceId);
  const now = options.clock.now();
  const required = input.required ?? true;
  return {
    effect: {
      statements: [
        updateProcedureStepStatement(database, {
          id: stepId,
          title,
          instructions,
          required,
          referenceId,
          position: input.position ?? step.position,
          now,
        }),
        audit(database, options, "intake.procedure.step.edited", stepId, {
          procedureId: step.procedure_id,
          required,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Retiring is soft: the step stops being asked from this moment, and every record that answered it
// on a matter keeps resolving to it.
export async function retireProcedureStep(
  database: SqlDatabase,
  stepId: IntakeProcedureStepId,
  options: ProcedureServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const step = await readProcedureStep(database, stepId);
  if (step === undefined) {
    throw new IntakeValidationError("step-unknown", `no such intake procedure step: ${stepId}`);
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        setProcedureStepActiveStatement(database, stepId, false, now),
        audit(database, options, "intake.procedure.step.retired", stepId, {
          procedureId: step.procedure_id,
        }),
      ],
      outboxMessages: [],
    },
  };
}

/*
 * The intake procedure's response shapes and calls. Mirrors the `intake.*` operations in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 *
 * A procedure is the firm's own account of what a kind of matter must clear before it opens. A
 * consultation's CHECKLIST is derived from the procedures binding its kind at the moment it is read,
 * and every answer on it is the subsystem's own or a member's record — reading it writes nothing.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** What a step is, and therefore who answers it. The catalog is the server's; this list mirrors it. */
export const INTAKE_STEP_KINDS = [
  "identity-verification",
  "conflicts-check",
  "fee-agreement",
  "engagement-letter",
  "client-forms",
  "retainer",
  "payment",
  "document",
  "questionnaire",
  "acknowledgement",
] as const;
export type IntakeStepKind = (typeof INTAKE_STEP_KINDS)[number];

export type IntakeRecordOutcome = "completed" | "waived";

export interface IntakeProcedureStep {
  id: string;
  kind: IntakeStepKind;
  title: string;
  instructions: string | null;
  required: boolean;
  /** The template or custom field the step is about, where its kind is about one thing. */
  referenceId: string | null;
  position: number;
}

export interface IntakeProcedure {
  id: string;
  name: string;
  description: string | null;
  /** Null binds the procedure to every kind of matter. */
  matterTypeId: string | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Present on the single-procedure read, absent on the list. */
  steps?: IntakeProcedureStep[];
}

export interface IntakeProcedureInput {
  name: string;
  description?: string | null;
  matterTypeId: string | null;
}

export interface IntakeProcedureStepInput {
  kind: IntakeStepKind;
  title: string;
  instructions?: string | null;
  required?: boolean | null;
  referenceId?: string | null;
  position?: number | null;
}

/** Whose evidence a step's answer is: the subsystem that owns the fact, a member's record, or nobody's. */
export type IntakeAnsweredBy = "subsystem" | "record" | "nobody";

export interface IntakeStanding {
  satisfied: boolean;
  answeredBy: IntakeAnsweredBy;
  /** What was found, in the words of whoever found it. Repeated, never summarised. */
  statement: string;
}

export interface IntakeRecord {
  id: string;
  outcome: IntakeRecordOutcome;
  rationale: string | null;
  note: string | null;
  recordedBy: string;
  recordedAt: string;
}

export interface IntakeChecklistStep {
  stepId: string;
  procedureId: string;
  procedureName: string;
  kind: IntakeStepKind;
  title: string;
  instructions: string | null;
  required: boolean;
  referenceId: string | null;
  position: number;
  /** Whether a member may record this step completed by hand. */
  recordable: boolean;
  standing: IntakeStanding;
  record: IntakeRecord | null;
}

export interface IntakeHistoryRecord extends IntakeRecord {
  stepId: string;
  supersededAt: string | null;
  supersededBy: string | null;
}

export interface IntakeChecklist {
  matterId: string;
  matterStatus: "intake" | "consultation" | "open" | "hold" | "closed";
  procedures: { id: string; name: string }[];
  steps: IntakeChecklistStep[];
  /** Required steps with no satisfying answer: what stands between the consultation and opening. */
  outstandingRequired: number;
  history: IntakeHistoryRecord[];
}

export function listIntakeProcedures(
  fetchImpl: typeof fetch,
  includeInactive = false,
): Promise<ApiOutcome<{ data: IntakeProcedure[] }>> {
  const suffix = includeInactive ? "?includeInactive=true" : "";
  return requestJson(fetchImpl, `/api/v1/intake-procedures${suffix}`);
}

export function readIntakeProcedure(
  fetchImpl: typeof fetch,
  procedureId: string,
): Promise<ApiOutcome<IntakeProcedure>> {
  return requestJson(fetchImpl, `/api/v1/intake-procedures/${encodeURIComponent(procedureId)}`);
}

export function createIntakeProcedure(
  fetchImpl: typeof fetch,
  procedure: IntakeProcedureInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, "/api/v1/intake-procedures", {
    method: "POST",
    body: procedure,
    idempotencyKey,
  });
}

export function editIntakeProcedure(
  fetchImpl: typeof fetch,
  procedureId: string,
  procedure: IntakeProcedureInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ acknowledged: true }>> {
  return requestJson(fetchImpl, `/api/v1/intake-procedures/${encodeURIComponent(procedureId)}`, {
    method: "PATCH",
    body: procedure,
    idempotencyKey,
  });
}

/** Stops a procedure gating consultations, or starts it again. Changes no record on any matter. */
export function setIntakeProcedureActive(
  fetchImpl: typeof fetch,
  procedureId: string,
  active: boolean,
  idempotencyKey: string,
): Promise<ApiOutcome<{ acknowledged: true }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/intake-procedures/${encodeURIComponent(procedureId)}/active`,
    { method: "PUT", body: { active }, idempotencyKey },
  );
}

export function addIntakeProcedureStep(
  fetchImpl: typeof fetch,
  procedureId: string,
  step: IntakeProcedureStepInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/intake-procedures/${encodeURIComponent(procedureId)}/steps`,
    { method: "POST", body: step, idempotencyKey },
  );
}

export function editIntakeProcedureStep(
  fetchImpl: typeof fetch,
  stepId: string,
  step: Omit<IntakeProcedureStepInput, "kind">,
  idempotencyKey: string,
): Promise<ApiOutcome<{ acknowledged: true }>> {
  return requestJson(fetchImpl, `/api/v1/intake-procedure-steps/${encodeURIComponent(stepId)}`, {
    method: "PATCH",
    body: step,
    idempotencyKey,
  });
}

/** Retires a step: it stops being asked. Records that answered it keep naming it. */
export function retireIntakeProcedureStep(
  fetchImpl: typeof fetch,
  stepId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ acknowledged: true }>> {
  return requestJson(fetchImpl, `/api/v1/intake-procedure-steps/${encodeURIComponent(stepId)}`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/** Where the matter stands against the procedures binding its kind. A read; nothing is written. */
export function readIntakeChecklist(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<IntakeChecklist>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/intake`);
}

export function recordIntakeStep(
  fetchImpl: typeof fetch,
  matterId: string,
  stepId: string,
  note: string | null,
  idempotencyKey: string,
): Promise<ApiOutcome<{ recordId: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/intake/steps/${encodeURIComponent(stepId)}/completion`,
    { method: "POST", body: { note }, idempotencyKey },
  );
}

export function waiveIntakeStep(
  fetchImpl: typeof fetch,
  matterId: string,
  stepId: string,
  rationale: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ recordId: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/intake/steps/${encodeURIComponent(stepId)}/waiver`,
    { method: "POST", body: { rationale }, idempotencyKey },
  );
}

export function reopenIntakeStep(
  fetchImpl: typeof fetch,
  matterId: string,
  stepId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ acknowledged: true }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/intake/steps/${encodeURIComponent(stepId)}/record`,
    { method: "DELETE", idempotencyKey },
  );
}

/** The permissions the endpoints name. A member without one is refused server-side. */
export const READ_INTAKE_PERMISSION = "intake:read";
export const RECORD_INTAKE_PERMISSION = "intake:record";
export const WAIVE_INTAKE_PERMISSION = "intake:waive";
export const MANAGE_INTAKE_PROCEDURES_PERMISSION = "intake:manageProcedures";

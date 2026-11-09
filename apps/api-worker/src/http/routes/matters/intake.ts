import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  IntakeProcedureId,
  IntakeProcedureStepId,
  MatterId,
  MatterTypeId,
  UserId,
} from "@magna-carta/identifiers/types";
import { readIntakeChecklist, type IntakeStepReaders } from "@magna-carta/intake/checklist";
import { MAX_DESK_PAGE_SIZE, readIntakeDesk } from "@magna-carta/intake/desk";
import {
  addProcedureStep,
  createProcedure,
  editProcedure,
  editProcedureStep,
  retireProcedureStep,
  setProcedureActive,
} from "@magna-carta/intake/procedure-service";
import {
  readProcedure,
  readProcedureSteps,
  selectProceduresStatement,
  type IntakeProcedureRow,
  type IntakeProcedureStepRow,
} from "@magna-carta/intake/procedure-statements";
import { BUILT_STEP_READERS } from "@magna-carta/intake/readers";
import { recordStepCompleted, reopenStep, waiveStep } from "@magna-carta/intake/record-service";
import { readStepRecordHistory } from "@magna-carta/intake/record-statements";
import {
  INTAKE_RECORD_OUTCOMES,
  INTAKE_STEP_KINDS,
  MAX_PROCEDURE_DESCRIPTION_LENGTH,
  MAX_PROCEDURE_NAME_LENGTH,
  MAX_PROCEDURE_PAGE_SIZE,
  MAX_RECORD_NOTE_LENGTH,
  MAX_RECORD_RATIONALE_LENGTH,
  MAX_STEP_INSTRUCTIONS_LENGTH,
  MAX_STEP_TITLE_LENGTH,
} from "@magna-carta/intake/types";
import { IntakeValidationError } from "@magna-carta/intake/validation";
import { staleConsultationAgeDaysDefinition } from "@magna-carta/matters/settings";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { identifierField } from "@magna-carta/identifiers/field";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// The intake procedure's HTTP surface over @magna-carta/intake.
//
// Two halves. AUTHORING is firm configuration behind intake:manageProcedures and binds resource:
// "firm", the matter-plan posture. THE CHECKLIST is one consultation's standing against the
// procedure binding it, behind intake:read, and the three acts on it — record, waive, reopen — bind
// resource: "matter", because a record IS one matter's record.
//
// THE CHECKLIST IS A GET THAT WRITES NOTHING, and its answers are the subsystems' own: the readers
// registered here are the same registry the opening gate in matters.ts runs, so the screen and the
// gate cannot disagree about whether a matter may open.

const MANAGE = "intake:manageProcedures" as const;
const READ = "intake:read" as const;
const RECORD = "intake:record" as const;
const WAIVE = "intake:waive" as const;

// The readers this deployment answers steps with. One registry, shared with the opening gate.
export const INTAKE_STEP_READERS: IntakeStepReaders = BUILT_STEP_READERS;

// ---- contracts ----

const ProcedureRequest = z
  .object({
    name: z.string().min(1).max(MAX_PROCEDURE_NAME_LENGTH),
    description: z.string().max(MAX_PROCEDURE_DESCRIPTION_LENGTH).nullable().optional(),
    // Null binds the procedure to every kind of matter.
    matterTypeId: identifierField("matterType").nullable(),
  })
  .openapi("IntakeProcedureRequest");

const ProcedureStepRequest = z
  .object({
    kind: z.enum(INTAKE_STEP_KINDS),
    title: z.string().min(1).max(MAX_STEP_TITLE_LENGTH),
    instructions: z.string().max(MAX_STEP_INSTRUCTIONS_LENGTH).nullable().optional(),
    // A required step refuses the opening while unanswered; an optional one merely shows.
    required: z.boolean().nullable().optional(),
    // What the step is about, where its kind is about one thing: the document template a document
    // or engagement-letter step expects assembled, the custom field a questionnaire step expects
    // answered. Refused on a kind that is about nothing.
    referenceId: z.string().min(1).max(200).nullable().optional(),
    position: z.number().int().min(0).nullable().optional(),
  })
  .openapi("IntakeProcedureStepRequest");

const ProcedureStepEditRequest = ProcedureStepRequest.omit({ kind: true }).openapi(
  "IntakeProcedureStepEditRequest",
);

const ProcedureStep = z
  .object({
    id: z.string(),
    kind: z.enum(INTAKE_STEP_KINDS),
    title: z.string(),
    instructions: z.string().nullable(),
    required: z.boolean(),
    referenceId: z.string().nullable(),
    position: z.number().int(),
  })
  .openapi("IntakeProcedureStep");

const Procedure = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    matterTypeId: z.string().nullable(),
    active: z.boolean(),
    createdBy: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    // Present on the single-procedure read, absent on the list.
    steps: z.array(ProcedureStep).optional(),
  })
  .openapi("IntakeProcedure");

const ChecklistRecord = z
  .object({
    id: z.string(),
    outcome: z.enum(INTAKE_RECORD_OUTCOMES),
    rationale: z.string().nullable(),
    note: z.string().nullable(),
    recordedBy: z.string(),
    recordedAt: z.string(),
  })
  .openapi("IntakeChecklistRecord");

// Where one step stands. `answeredBy` says whose evidence it is — the subsystem that owns the fact,
// a member's record, or nobody — and `statement` repeats that evidence in its own words. There is
// deliberately no summary word beyond `satisfied`, which is the one fact the gate reads.
const ChecklistStanding = z
  .object({
    satisfied: z.boolean(),
    answeredBy: z.enum(["subsystem", "record", "nobody"]),
    statement: z.string(),
  })
  .openapi("IntakeChecklistStanding");

const ChecklistStep = z
  .object({
    stepId: z.string(),
    procedureId: z.string(),
    procedureName: z.string(),
    kind: z.enum(INTAKE_STEP_KINDS),
    title: z.string(),
    instructions: z.string().nullable(),
    required: z.boolean(),
    referenceId: z.string().nullable(),
    position: z.number().int(),
    recordable: z.boolean(),
    standing: ChecklistStanding,
    record: ChecklistRecord.nullable(),
  })
  .openapi("IntakeChecklistStep");

const HistoryRecord = ChecklistRecord.extend({
  stepId: z.string(),
  supersededAt: z.string().nullable(),
  supersededBy: z.string().nullable(),
}).openapi("IntakeChecklistHistoryRecord");

const Checklist = z
  .object({
    matterId: z.string(),
    matterStatus: z.enum(["intake", "consultation", "open", "hold", "closed"]),
    procedures: z.array(z.object({ id: z.string(), name: z.string() })),
    steps: z.array(ChecklistStep),
    outstandingRequired: z.number().int(),
    // Every answer ever recorded on this matter, oldest first, superseded ones included: the
    // history the append-and-flip rule exists to keep.
    history: z.array(HistoryRecord),
  })
  .openapi("IntakeChecklist");

// One intake in flight on the desk: the consultation, who it is for and who carries it, where it
// stands against the procedure binding its kind (counts only — the checklist read holds the words),
// and whether the consultation itself is on the calendar yet.
const DeskChecklist = z
  .object({
    bound: z.boolean(),
    steps: z.number().int(),
    answered: z.number().int(),
    outstandingRequired: z.number().int(),
  })
  .openapi("IntakeDeskChecklist");

const DeskConsultationSetting = z
  .object({
    eventId: z.string(),
    title: z.string(),
    startsOn: z.string(),
    startsAtTime: z.string().nullable(),
    timeZone: z.string(),
  })
  .openapi("IntakeDeskConsultationSetting");

const DeskRow = z
  .object({
    matterId: z.string(),
    title: z.string(),
    // Which rung: an intake still clearing its procedure, or a consultation awaiting its meeting.
    status: z.enum(["intake", "consultation"]),
    consultationNumber: z.string().nullable(),
    // On an intake still clearing its procedure this is the only number the row has.
    intakeNumber: z.string().nullable(),
    matterTypeId: z.string().nullable(),
    matterTypeName: z.string().nullable(),
    responsibleMemberId: z.string(),
    responsibleMemberName: z.string().nullable(),
    clientEntityId: z.string().nullable(),
    clientDisplayName: z.string().nullable(),
    createdAt: z.string(),
    isStale: z.boolean(),
    checklist: DeskChecklist,
    nextConsultation: DeskConsultationSetting.nullable(),
  })
  .openapi("IntakeDeskRow");

const DeskList = z
  .object({ data: z.array(DeskRow), nextCursor: z.string().nullable() })
  .openapi("IntakeDeskList");

const RecordStepRequest = z
  .object({ note: z.string().max(MAX_RECORD_NOTE_LENGTH).nullable().optional() })
  .openapi("IntakeRecordStepRequest");

const WaiveStepRequest = z
  .object({ rationale: z.string().min(1).max(MAX_RECORD_RATIONALE_LENGTH) })
  .openapi("IntakeWaiveStepRequest");

const ProcedureList = z.object({ data: z.array(Procedure) }).openapi("IntakeProcedureList");
const CreatedResponse = z.object({ id: z.string() }).openapi("CreatedIntakeProcedure");
const AcknowledgedResponse = z
  .object({ acknowledged: z.literal(true) })
  .openapi("IntakeAcknowledged");
const RecordedResponse = z.object({ recordId: z.string() }).openapi("IntakeStepRecorded");

const procedureIdParam = z.object({
  procedureId: identifierPathParam("intakeProcedure", "procedureId"),
});
const stepIdParam = z.object({ stepId: identifierPathParam("intakeProcedureStep", "stepId") });
const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const matterStepParams = z.object({
  matterId: identifierPathParam("matter", "matterId"),
  stepId: identifierPathParam("intakeProcedureStep", "stepId"),
});

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the record is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is still in progress, or the record is not in a state this change applies to",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The request body is not a shape this operation accepts",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limited",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

function intakeErrorResponse(
  c: Context,
  caught: IntakeValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "procedure-unknown":
    case "step-unknown":
    case "matter-unknown":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    // Well-formed request, changed or unsuitable record: the procedure was deactivated, the step
    // retired, the name taken, the matter already open, or the step one this matter is not asked.
    case "procedure-inactive":
    case "procedure-name-taken":
    case "step-inactive":
    case "matter-not-intake":
    case "step-not-bound":
    case "step-not-recordable":
    case "record-none-live":
      return problemJson(c, {
        type: "conflict",
        title: "That record is not in a state this change applies to",
        status: 409,
        detail: caught.message,
      });
    default:
      return problemJson(c, {
        type: "validation",
        title: "Intake request invalid",
        status: 422,
        detail: caught.message,
      });
  }
}

function notFound(c: Context, detail: string): ProblemResponse<404> {
  return problemJson(c, { type: "not-found", title: "Not found", status: 404, detail });
}

// Authoring binds resource: "firm" — a procedure belongs to no matter and is firm configuration,
// the posture the matter-plan and matter-type catalogs already take.
function manageMeta(action: string, mutating: boolean): RouteMeta {
  return {
    operationId: `intake.${action}`,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: mutating,
    idempotency: mutating ? "required" : "optional",
    ...(mutating ? { idempotencyStore: "firm" as const } : {}),
    rateLimit: "default",
  };
}

// The matter side binds resource: "matter": a record is one matter's record and cannot exist
// without one.
function matterMeta(
  action: string,
  permission: RouteMeta["permission"],
  mutating: boolean,
): RouteMeta {
  return {
    operationId: `intake.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "matter",
    audited: mutating,
    idempotency: mutating ? "required" : "optional",
    ...(mutating ? { idempotencyStore: "firm" as const } : {}),
    rateLimit: "default",
  };
}

// The desk is a firm-wide read behind the checklist's own permission: it lists consultations and
// where each stands, which is exactly what intake:read lets a member see one matter at a time.
function firmReadMeta(action: string, permission: RouteMeta["permission"]): RouteMeta {
  return {
    operationId: `intake.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

const listDeskRoute = defineOpenAPIRoute(firmReadMeta("listConsultations", READ), {
  method: "get",
  path: "/api/v1/intake/consultations",
  description:
    "The intake desk: every consultation the firm has in flight, newest first, with the client, " +
    "the responsible member, the matter type, where it stands against the intake procedure binding " +
    "its kind (how many steps, how many answered, how many required ones outstanding), whether it " +
    "has sat past the firm's stale-consultation age, and the next scheduled event on it. A " +
    "consultation leaves the desk when it opens or closes. Cursor-paginated; the page is capped " +
    "at fifty because each row's standing is derived from the subsystems that own its facts.",
  request: {
    query: z.object({
      search: z.string().optional(),
      cursor: z.string().optional(),
      pageSize: z.coerce.number().int().positive().max(MAX_DESK_PAGE_SIZE).optional(),
    }),
  },
  responses: {
    200: {
      description: "A page of the desk",
      content: { "application/json": { schema: DeskList } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listProceduresRoute = defineOpenAPIRoute(manageMeta("listProcedures", false), {
  method: "get",
  path: "/api/v1/intake-procedures",
  description:
    "The firm's intake procedures. Deactivated procedures are left out unless asked for; a " +
    "procedure is never deleted, because a member's record on a matter names the step it answered " +
    "and a firm asking what its old procedure required needs it to still be there.",
  request: {
    query: z.object({ includeInactive: z.enum(["true", "false"]).optional() }),
  },
  responses: {
    200: {
      description: "The firm's procedures",
      content: { "application/json": { schema: ProcedureList } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const readProcedureRoute = defineOpenAPIRoute(manageMeta("readProcedure", false), {
  method: "get",
  path: "/api/v1/intake-procedures/{procedureId}",
  description: "One procedure and its steps, in the order the firm listed them.",
  request: { params: procedureIdParam },
  responses: {
    200: { description: "The procedure", content: { "application/json": { schema: Procedure } } },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const createProcedureRoute = defineOpenAPIRoute(manageMeta("createProcedure", true), {
  method: "post",
  path: "/api/v1/intake-procedures",
  description:
    "Creates a procedure. Bind it to a matter type to gate consultations of that kind, or leave " +
    "the type null to gate every consultation. A new procedure asks for nothing until steps are " +
    "added to it. Magna Carta ships no procedures of its own: what a firm requires before it acts " +
    "is the firm's own statement.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: ProcedureRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The procedure",
      content: { "application/json": { schema: CreatedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const editProcedureRoute = defineOpenAPIRoute(manageMeta("editProcedure", true), {
  method: "patch",
  path: "/api/v1/intake-procedures/{procedureId}",
  description:
    "Changes a procedure's name, description, or the matter type it binds. The change reaches " +
    "every consultation of that kind at once: a checklist is derived from the procedure at the " +
    "moment it is read, so what the firm requires today is what every consultation must clear " +
    "today. Records already made on a matter are untouched.",
  request: {
    headers: idempotencyKeyHeader,
    params: procedureIdParam,
    body: { content: { "application/json": { schema: ProcedureRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The procedure was changed",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const setProcedureActiveRoute = defineOpenAPIRoute(manageMeta("setProcedureActive", true), {
  method: "put",
  path: "/api/v1/intake-procedures/{procedureId}/active",
  description:
    "Stops a procedure gating consultations, or starts it again. Deactivating changes no record on " +
    "any matter; from that moment its steps are simply no longer asked.",
  request: {
    headers: idempotencyKeyHeader,
    params: procedureIdParam,
    body: {
      content: { "application/json": { schema: z.object({ active: z.boolean() }) } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The procedure's standing was changed",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const addStepRoute = defineOpenAPIRoute(manageMeta("addStep", true), {
  method: "post",
  path: "/api/v1/intake-procedures/{procedureId}/steps",
  description:
    "Adds a step. Its kind decides who answers it: a conflicts-check step is answered by the " +
    "matter's conflicts posture, a fee-agreement step by the billing arrangement in force, a " +
    "document or engagement-letter step by an assembly of the named template landing on the " +
    "matter, a retainer step by the matter's trust position, a questionnaire step by the named " +
    "custom field's value; an identity-verification or acknowledgement step is answered by a " +
    "member recording that they did it, and every kind also accepts a member's record where the " +
    "platform could not see the fact. A required step refuses the opening while unanswered.",
  request: {
    headers: idempotencyKeyHeader,
    params: procedureIdParam,
    body: { content: { "application/json": { schema: ProcedureStepRequest } }, required: true },
  },
  responses: {
    201: { description: "The step", content: { "application/json": { schema: CreatedResponse } } },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const editStepRoute = defineOpenAPIRoute(manageMeta("editStep", true), {
  method: "patch",
  path: "/api/v1/intake-procedure-steps/{stepId}",
  description:
    "Changes a step. Every field but the kind is replaced, so send the ones to keep as well; a " +
    "step's kind decides who answers it and a different kind is a new step.",
  request: {
    headers: idempotencyKeyHeader,
    params: stepIdParam,
    body: {
      content: { "application/json": { schema: ProcedureStepEditRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The step was changed",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const retireStepRoute = defineOpenAPIRoute(
  {
    ...manageMeta("retireStep", true),
    reversal: {
      kind: "none",
      reason:
        "The step is kept so every record that answered it still says what it answered, but no " +
        "route puts a retired step back into the asking. Adding it again mints a new step, which " +
        "the matters that answered the old one do not point at.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/intake-procedure-steps/{stepId}",
    description:
      "Retires a step: it stops being asked from this moment. The step is kept rather than deleted, " +
      "so every record that answered it on a matter still says what it answered.",
    request: { headers: idempotencyKeyHeader, params: stepIdParam },
    responses: {
      200: {
        description: "The step was retired",
        content: { "application/json": { schema: AcknowledgedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

// ---- the matter's checklist ----

const readChecklistRoute = defineOpenAPIRoute(matterMeta("readChecklist", READ, false), {
  method: "get",
  path: "/api/v1/matters/{matterId}/intake",
  description:
    "Where this matter stands against the intake procedures binding its kind: every step, who " +
    "answered it, and what they found, in the words of the subsystem that owns the fact. Reading " +
    "this writes nothing and caches nothing; a step whose fact has changed reads as it stands now. " +
    "outstandingRequired is the number of required steps with no satisfying answer, which is what " +
    "stands between a consultation and opening.",
  request: { params: matterIdParam },
  responses: {
    200: {
      description: "The checklist",
      content: { "application/json": { schema: Checklist } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const recordStepRoute = defineOpenAPIRoute(matterMeta("recordStep", RECORD, true), {
  method: "post",
  path: "/api/v1/matters/{matterId}/intake/steps/{stepId}/completion",
  description:
    "Records, under your name, that this step was completed on this consultation. Refused on a " +
    "kind the platform answers itself (a conflicts check, a fee agreement): those are read from " +
    "their own record and can only be waived. Recording over an earlier answer keeps the earlier " +
    "one in the history.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterStepParams,
    body: { content: { "application/json": { schema: RecordStepRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The record",
      content: { "application/json": { schema: RecordedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const waiveStepRoute = defineOpenAPIRoute(matterMeta("waiveStep", WAIVE, true), {
  method: "post",
  path: "/api/v1/matters/{matterId}/intake/steps/{stepId}/waiver",
  description:
    "Waives this step on this consultation, under your name and with the reason, so the matter " +
    "may open without it. A waiver is recorded as a waiver and never as a completion, so it is " +
    "never mistaken for the fact it stands in for.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterStepParams,
    body: { content: { "application/json": { schema: WaiveStepRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The record",
      content: { "application/json": { schema: RecordedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const reopenStepRoute = defineOpenAPIRoute(
  {
    ...matterMeta("reopenStep", RECORD, true),
    reversal: { kind: "inverse", by: "intake.recordStep" },
  },
  {
    method: "delete",
    path: "/api/v1/matters/{matterId}/intake/steps/{stepId}/record",
    description:
      "Sets aside the live answer on this step, so it is answered again by its own subsystem or by " +
      "nobody. The earlier answer stays in the history. Refused when nothing is recorded.",
    request: { headers: idempotencyKeyHeader, params: matterStepParams },
    responses: {
      200: {
        description: "The step was reopened",
        content: { "application/json": { schema: AcknowledgedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

// ---- handler plumbing ----

function serviceOptions(userId: UserId) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId,
    randomSource: cryptoRandomSource,
  };
}

function procedureJson(row: IntakeProcedureRow): z.infer<typeof Procedure> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    matterTypeId: row.matter_type_id,
    active: row.active === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stepJson(row: IntakeProcedureStepRow): z.infer<typeof ProcedureStep> {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    instructions: row.instructions,
    required: row.required === 1,
    referenceId: row.reference_id,
    position: row.position,
  };
}

type EffectOutcome =
  | { committed: true; body: unknown; replayed: boolean }
  | {
      committed: false;
      problem: ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422>;
    };

async function commitEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  responseCode: number,
  call: () => Promise<{ body: unknown; effect: EffectWrite }>,
): Promise<EffectOutcome> {
  const now = () => new Date().toISOString();
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => {
        const { body, effect } = await call();
        return {
          write: effect,
          responseCode,
          // The stored body IS the wire body: a retried record answers with the same handle rather
          // than minting a second row.
          responseBody: canonicalJsonStringify(body as Record<string, unknown>),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof IntakeValidationError) {
      return { committed: false, problem: intakeErrorResponse(c, caught) };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { committed: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  return {
    committed: true,
    body: JSON.parse(result.responseBody ?? "{}") as unknown,
    replayed: result.kind === "replayed",
  };
}

export function registerIntakeRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/intake-procedures
  app.openapi(
    { ...listProceduresRoute, middleware: chokepointMiddleware(chokepoint, listProceduresRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { includeInactive } = c.req.valid("query");
      const { results } = await selectProceduresStatement(firm.firmDatabase, {
        limit: MAX_PROCEDURE_PAGE_SIZE,
        includeInactive: includeInactive === "true",
      }).all<IntakeProcedureRow>();
      return c.json({ data: results.map(procedureJson) }, 200);
    },
  );

  // GET /api/v1/intake-procedures/{procedureId}
  app.openapi(
    { ...readProcedureRoute, middleware: chokepointMiddleware(chokepoint, readProcedureRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { procedureId } = c.req.valid("param");
      const procedure = await readProcedure(firm.firmDatabase, procedureId as IntakeProcedureId);
      if (procedure === undefined) {
        return notFound(c, "That procedure is not a procedure in this firm.");
      }
      const steps = await readProcedureSteps(firm.firmDatabase, procedure.id);
      return c.json({ ...procedureJson(procedure), steps: steps.map(stepJson) }, 200);
    },
  );

  // POST /api/v1/intake-procedures
  app.openapi(
    { ...createProcedureRoute, middleware: chokepointMiddleware(chokepoint, createProcedureRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const created = await createProcedure(
          firm.firmDatabase,
          { ...request, matterTypeId: request.matterTypeId as MatterTypeId | null },
          serviceOptions(userId),
        );
        return { body: { id: created.procedureId }, effect: created.effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body as { id: string }, 201);
    },
  );

  // PATCH /api/v1/intake-procedures/{procedureId}
  app.openapi(
    { ...editProcedureRoute, middleware: chokepointMiddleware(chokepoint, editProcedureRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { procedureId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await editProcedure(
          firm.firmDatabase,
          procedureId as IntakeProcedureId,
          { ...request, matterTypeId: request.matterTypeId as MatterTypeId | null },
          serviceOptions(userId),
        );
        return { body: { acknowledged: true }, effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ acknowledged: true } as const, 200);
    },
  );

  // PUT /api/v1/intake-procedures/{procedureId}/active
  app.openapi(
    {
      ...setProcedureActiveRoute,
      middleware: chokepointMiddleware(chokepoint, setProcedureActiveRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { procedureId } = c.req.valid("param");
      const { active } = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await setProcedureActive(
          firm.firmDatabase,
          procedureId as IntakeProcedureId,
          active,
          serviceOptions(userId),
        );
        return { body: { acknowledged: true }, effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ acknowledged: true } as const, 200);
    },
  );

  // POST /api/v1/intake-procedures/{procedureId}/steps
  app.openapi(
    { ...addStepRoute, middleware: chokepointMiddleware(chokepoint, addStepRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { procedureId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const added = await addProcedureStep(
          firm.firmDatabase,
          procedureId as IntakeProcedureId,
          request,
          serviceOptions(userId),
        );
        return { body: { id: added.stepId }, effect: added.effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body as { id: string }, 201);
    },
  );

  // PATCH /api/v1/intake-procedure-steps/{stepId}
  app.openapi(
    { ...editStepRoute, middleware: chokepointMiddleware(chokepoint, editStepRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { stepId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await editProcedureStep(
          firm.firmDatabase,
          stepId as IntakeProcedureStepId,
          request,
          serviceOptions(userId),
        );
        return { body: { acknowledged: true }, effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ acknowledged: true } as const, 200);
    },
  );

  // DELETE /api/v1/intake-procedure-steps/{stepId}
  app.openapi(
    { ...retireStepRoute, middleware: chokepointMiddleware(chokepoint, retireStepRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { stepId } = c.req.valid("param");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await retireProcedureStep(
          firm.firmDatabase,
          stepId as IntakeProcedureStepId,
          serviceOptions(userId),
        );
        return { body: { acknowledged: true }, effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ acknowledged: true } as const, 200);
    },
  );

  // GET /api/v1/intake/consultations — the desk
  app.openapi(
    { ...listDeskRoute, middleware: chokepointMiddleware(chokepoint, listDeskRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const staleAgeDays = await readFirmSetting(
        firm.firmDatabase,
        staleConsultationAgeDaysDefinition,
      );
      const page = await readIntakeDesk(firm.firmDatabase, INTAKE_STEP_READERS, {
        search: query.search,
        cursor: query.cursor,
        pageSize: query.pageSize,
        now: new Date().toISOString(),
        staleAgeDays,
      });
      return c.json(page as z.infer<typeof DeskList>, 200);
    },
  );

  // GET /api/v1/matters/{matterId}/intake
  app.openapi(
    { ...readChecklistRoute, middleware: chokepointMiddleware(chokepoint, readChecklistRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      try {
        const checklist = await readIntakeChecklist(
          firm.firmDatabase,
          matterId as MatterId,
          INTAKE_STEP_READERS,
        );
        const history = await readStepRecordHistory(firm.firmDatabase, matterId as MatterId);
        // Mapped field by field: the wire shape is its own contract.
        return c.json(
          {
            matterId: checklist.matterId,
            matterStatus: checklist.matterStatus,
            procedures: checklist.procedures.map((procedure) => ({
              id: procedure.id,
              name: procedure.name,
            })),
            steps: checklist.steps.map((step) => ({
              stepId: step.stepId,
              procedureId: step.procedureId,
              procedureName: step.procedureName,
              kind: step.kind,
              title: step.title,
              instructions: step.instructions,
              required: step.required,
              referenceId: step.referenceId,
              position: step.position,
              recordable: step.recordable,
              standing: {
                satisfied: step.standing.satisfied,
                answeredBy: step.standing.answeredBy,
                statement: step.standing.statement,
              },
              record:
                step.record === null
                  ? null
                  : {
                      id: step.record.id,
                      outcome: step.record.outcome,
                      rationale: step.record.rationale,
                      note: step.record.note,
                      recordedBy: step.record.recordedBy,
                      recordedAt: step.record.recordedAt,
                    },
            })),
            outstandingRequired: checklist.outstandingRequired,
            history: history.map((record) => ({
              id: record.id,
              stepId: record.procedure_step_id,
              outcome: record.outcome,
              rationale: record.rationale,
              note: record.note,
              recordedBy: record.recorded_by,
              recordedAt: record.recorded_at,
              supersededAt: record.superseded_at,
              supersededBy: record.superseded_by,
            })),
          } satisfies z.infer<typeof Checklist>,
          200,
        );
      } catch (caught) {
        if (caught instanceof IntakeValidationError) return notFound(c, caught.message);
        throw caught;
      }
    },
  );

  // POST /api/v1/matters/{matterId}/intake/steps/{stepId}/completion
  app.openapi(
    { ...recordStepRoute, middleware: chokepointMiddleware(chokepoint, recordStepRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { matterId, stepId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const recorded = await recordStepCompleted(
          firm.firmDatabase,
          {
            matterId: matterId as MatterId,
            stepId: stepId as IntakeProcedureStepId,
            note: request.note,
          },
          serviceOptions(userId),
        );
        return { body: { recordId: recorded.recordId }, effect: recorded.effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body as { recordId: string }, 201);
    },
  );

  // POST /api/v1/matters/{matterId}/intake/steps/{stepId}/waiver
  app.openapi(
    { ...waiveStepRoute, middleware: chokepointMiddleware(chokepoint, waiveStepRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { matterId, stepId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const waived = await waiveStep(
          firm.firmDatabase,
          {
            matterId: matterId as MatterId,
            stepId: stepId as IntakeProcedureStepId,
            rationale: request.rationale,
          },
          serviceOptions(userId),
        );
        return { body: { recordId: waived.recordId }, effect: waived.effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body as { recordId: string }, 201);
    },
  );

  // DELETE /api/v1/matters/{matterId}/intake/steps/{stepId}/record
  app.openapi(
    { ...reopenStepRoute, middleware: chokepointMiddleware(chokepoint, reopenStepRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { matterId, stepId } = c.req.valid("param");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await reopenStep(
          firm.firmDatabase,
          { matterId: matterId as MatterId, stepId: stepId as IntakeProcedureStepId },
          serviceOptions(userId),
        );
        return { body: { acknowledged: true }, effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ acknowledged: true } as const, 200);
    },
  );
}

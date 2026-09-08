import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import {
  assemblePage,
  decodeCursor,
  encodeCursor,
} from "@magna-carta/data-access/cursor-pagination";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type {
  IntakeFormFieldId,
  IntakeFormId,
  IntakeFormSubmissionId,
} from "@magna-carta/identifiers/types";
import {
  addField,
  createForm,
  editField,
  editForm,
  publishForm,
  removeField,
  reorderFields,
  rotatePublicToken,
  setFormClosed,
} from "@magna-carta/intake-forms/form-service";
import {
  readDraftVersion,
  readFields,
  readForm,
  readSubmission,
  readWaitingCounts,
  selectFormsStatement,
  selectSubmissionsStatement,
  type IntakeFormFieldRow,
  type IntakeFormRow,
  type IntakeFormSubmissionRow,
} from "@magna-carta/intake-forms/form-statements";
import { resolvePublicForm } from "@magna-carta/intake-forms/public-read";
import {
  recordSubmission,
  recordTriageDecision,
  SubmissionRefusedError,
} from "@magna-carta/intake-forms/submission-service";
import {
  INTAKE_FORM_FIELD_KINDS,
  INTAKE_SUBMISSION_TRIAGE_STATES,
  MAX_ANSWER_LENGTH,
  MAX_FIELD_HELP_TEXT_LENGTH,
  MAX_FIELD_LABEL_LENGTH,
  MAX_FIELD_OPTION_LENGTH,
  MAX_FIELD_OPTIONS,
  MAX_FORM_CONFIRMATION_LENGTH,
  MAX_FORM_INTRODUCTION_LENGTH,
  MAX_FORM_NAME_LENGTH,
  MAX_FORM_PAGE_SIZE,
  MAX_FORM_TITLE_LENGTH,
  MAX_SUBMISSION_PAGE_SIZE,
  MAX_TRIAGE_NOTE_LENGTH,
} from "@magna-carta/intake-forms/types";
import { IntakeFormValidationError } from "@magna-carta/intake-forms/validation";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField, identifierPathParam } from "../contracts/common.ts";
import { cursorQuery, paginated } from "../contracts/pagination.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import {
  enforceHumanVerification,
  humanVerificationTokenHeader,
} from "../human-verification/human-verification-gate.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// THE PUBLIC INTAKE FORM'S HTTP SURFACE.
//
// Two halves that share a package and almost nothing else.
//
// THE FIRM'S HALF is ordinary: authenticated, permissioned, idempotent, firm-scoped through the
// chokepoint like every other configuration surface.
//
// THE ANONYMOUS HALF is the only place in this platform where an unauthenticated caller reaches a
// firm's own database, and it is arranged around one rule: EVERY OUTCOME THAT IS NOT ABOUT THE
// CALLER'S OWN BUDGET OR CHALLENGE ANSWERS IDENTICALLY. A wrong token, a form still in draft, a form
// the firm closed, and a firm that does not exist all answer the same 404 with the same body; a
// submission from a name the firm already represents and one from a stranger both answer 202. The
// difference is never observable, and it is enforced by construction rather than by discipline — the
// resolver filters on status inside its SQL, and the submission path performs no lookup against firm
// data at all, because a read whose duration varies with what the visitor typed hands a probing
// script an oracle from the clock.
//
// HOW AN ANONYMOUS REQUEST REACHES A FIRM DATABASE. The chokepoint resolves a firm from a session and
// there is no session here, so these two routes address the FirmDatabase Durable Object directly by
// the id in their own path — the same `firmDatabaseFor` the queue consumers and the cron already use
// with no session at all. The chokepoint still owns the rate-limit gate on them, which is the whole
// enforcement a public route wants from it.

const MANAGE = "intakeForms:manage" as const;
const READ_SUBMISSIONS = "intakeForms:readSubmissions" as const;

// ---- contracts ----

const FieldKind = z.enum(INTAKE_FORM_FIELD_KINDS).openapi({
  description:
    "What a question collects. A CLOSED platform vocabulary, and the closure is the point: a " +
    "public form's questions never come from the firm's custom-field definitions, because those " +
    "can reference a directory record and a form that could bind one would let a stranger point a " +
    "value at somebody in the firm's directory. A firm widens its form with `question` (free text) " +
    "or `choice` (its own list), neither of which can address anything the firm holds.",
});

const TriageState = z.enum(INTAKE_SUBMISSION_TRIAGE_STATES).openapi({
  description:
    "What a member decided about a submission. `new` is the state it arrives in and is not a " +
    "decision anyone can record — a member who has looked cannot un-look. Nothing reads this as a " +
    "gate; it records what a person did and permits nothing.",
});

const FormRequest = z
  .object({
    name: z.string().min(1).max(MAX_FORM_NAME_LENGTH).openapi({
      description: "What the firm calls this form internally. A visitor never sees it.",
    }),
    title: z.string().min(1).max(MAX_FORM_TITLE_LENGTH).openapi({
      description: "What a visitor reads at the top of the page.",
    }),
    introduction: z.string().max(MAX_FORM_INTRODUCTION_LENGTH).nullable().optional(),
    confirmationMessage: z
      .string()
      .max(MAX_FORM_CONFIRMATION_LENGTH)
      .nullable()
      .optional()
      .openapi({
        description:
          "What the visitor is told after submitting. Keep it as uninformative as the status " +
          'code: "we have received your enquiry and someone will be in touch" is right, and ' +
          "naming a practice area or a person is not, because that is a routing decision the form " +
          "did not make. Not validated — this is prose, and a rule pretending to enforce it " +
          "would be theatre.",
      }),
    submissionBudgetPerDay: z
      .int()
      .positive()
      .nullable()
      .optional()
      .openapi({
        description:
          "An optional ceiling on submissions accepted through this form in a day, so a firm being " +
          "flooded can throttle ONE form without touching its others or its authenticated surface. " +
          "Absent means the platform's own rate limit is the only ceiling.",
      }),
  })
  .openapi("IntakeFormRequest");

const FieldRequest = z
  .object({
    kind: FieldKind,
    label: z.string().min(1).max(MAX_FIELD_LABEL_LENGTH),
    helpText: z
      .string()
      .max(MAX_FIELD_HELP_TEXT_LENGTH)
      .nullable()
      .optional()
      .openapi({
        description:
          "Shown under the field and left standing there — never as ghost text inside it, which " +
          "disappears exactly when somebody starts typing and therefore at the moment an " +
          "instruction is needed.",
      }),
    required: z.boolean().optional(),
    options: z
      .array(z.string().min(1).max(MAX_FIELD_OPTION_LENGTH))
      .max(MAX_FIELD_OPTIONS)
      .nullable()
      .optional()
      .openapi({
        description:
          "The choices, for a `choice` question and nothing else. Required on one, refused on " +
          "every other kind — a choice with no options renders a picker nobody can answer, and " +
          "options on a telephone field are an authoring mistake that would sit unnoticed.",
      }),
  })
  .openapi("IntakeFormFieldRequest");

const FormField = z
  .object({
    id: z.string(),
    kind: FieldKind,
    label: z.string(),
    helpText: z.string().nullable(),
    required: z.boolean(),
    options: z.array(z.string()).nullable(),
    position: z.int(),
  })
  .openapi("IntakeFormField");

const FormSummary = z
  .object({
    id: z.string(),
    name: z.string(),
    title: z.string(),
    status: z.enum(["draft", "published", "closed"]),
    publicToken: z.string(),
    publishedVersionId: z.string().nullable(),
    submissionBudgetPerDay: z.int().nullable(),
    hasUnpublishedChanges: z.boolean(),
    waitingSubmissions: z.int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("IntakeFormSummary");

const FormPage = paginated(FormSummary).openapi("IntakeFormPage");

const FormDetail = FormSummary.extend({
  introduction: z.string().nullable(),
  confirmationMessage: z.string().nullable(),
  fields: z.array(FormField),
}).openapi("IntakeFormDetail");

const SubmissionSummary = z
  .object({
    id: z.string(),
    submittedAt: z.string(),
    triageState: TriageState,
    triagedAt: z.string().nullable(),
    triagedBy: z.string().nullable(),
    triageNote: z.string().nullable(),
  })
  .openapi("IntakeFormSubmissionSummary");

const SubmissionPage = paginated(SubmissionSummary).openapi("IntakeFormSubmissionPage");

const SubmissionDetail = SubmissionSummary.extend({
  // The answers BESIDE the questions as they were asked, read from the submission's own version.
  // Sending the answers alone would make the firm read them against whatever the form asks today.
  answers: z.array(
    z.object({
      fieldId: z.string(),
      label: z.string(),
      kind: FieldKind,
      value: z.string().nullable(),
    }),
  ),
}).openapi("IntakeFormSubmissionDetail");

const PublicFormResponse = z
  .object({
    title: z.string(),
    introduction: z.string().nullable(),
    humanVerificationSiteKey: z
      .string()
      .nullable()
      .openapi({
        description:
          "The public half of the human-verification widget, or null where none is provisioned. " +
          "Served here rather than built into the page so activation is a runtime act: set the site " +
          "key and the secret on the worker and the challenge appears, with no rebuild. Null means " +
          "the page renders no challenge at all — an honest nothing rather than a box that verifies " +
          "nothing, which would tell a firm it was protected when it is not.",
      }),
    fields: z.array(
      z.object({
        fieldId: z.string(),
        kind: FieldKind,
        label: z.string(),
        helpText: z.string().nullable(),
        required: z.boolean(),
        options: z.array(z.string()).nullable(),
      }),
    ),
  })
  .openapi("PublicIntakeForm");

const PublicSubmissionRequest = z
  .object({
    answers: z.record(z.string(), z.string().max(MAX_ANSWER_LENGTH)).openapi({
      description:
        "The answers, keyed by the `fieldId` the form served. Keyed by id rather than by label " +
        "so a submission still renders against the right question if a later version reuses a " +
        "label for a different one.",
    }),
  })
  .openapi("PublicIntakeSubmissionRequest");

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
    description:
      "The session member lacks the required permission, or the human-verification challenge was not solved",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description:
      "The firm is unreachable, the member is deactivated, or the record is unknown. On the public routes this is ALSO the answer for a form in draft, a form the firm has closed, and a token that was rotated away — the cases are deliberately not distinguished",
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
  503: {
    description: "Human verification is provisioned but could not be reached; retryable",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

// ---- meta ----

function manageMeta(action: string, mutating: boolean): RouteMeta {
  return {
    operationId: `intakeForms.${action}`,
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

function submissionsMeta(action: string, mutating: boolean): RouteMeta {
  return {
    operationId: `intakeForms.${action}`,
    surface: "app",
    authenticated: true,
    permission: READ_SUBMISSIONS,
    resource: "firm",
    audited: mutating,
    idempotency: mutating ? "required" : "optional",
    ...(mutating ? { idempotencyStore: "firm" as const } : {}),
    rateLimit: "default",
  };
}

/**
 * The anonymous surface's posture — the registration route's exact shape, for the same reason.
 *
 * `rateLimit: "auth"` is the tightest bucket the platform has and is what makes the dormant human
 * verification survivable: it is sized to stand alone. `resource: "platform"` because the tenancy
 * root is the path rather than a session. `idempotency: "optional"` because a stranger's browser
 * mints no key, and requiring one would make the form unusable from a plain post; a double
 * submission is a duplicate row that triage dismisses, which is far cheaper than deduplicating by
 * content — that would be exactly the firm-data read the disclosure rule forbids.
 */
function publicMeta(action: string, mutating: boolean): RouteMeta {
  return {
    operationId: `intakeForms.${action}`,
    surface: "public",
    authenticated: false,
    permission: null,
    // "firm" like the registration route's own public meta. The chokepoint skips its session, firm
    // and RBAC gates on a public surface entirely, so this names the tenancy the route is ABOUT — and
    // the route resolves that firm from its own path, since there is no session to resolve one from.
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "auth",
  };
}

// ---- the firm's routes ----

const listFormsRoute = defineOpenAPIRoute(manageMeta("list", false), {
  method: "get",
  path: "/api/v1/intake-forms",
  description:
    "A page of the public intake forms this firm has authored, newest first, each with its status, " +
    "its live link, whether it has unpublished changes, and how many submissions are waiting on a " +
    "member.",
  request: { query: cursorQuery },
  responses: {
    200: {
      description: "The firm's forms.",
      content: { "application/json": { schema: FormPage } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
  },
});

const readFormRoute = defineOpenAPIRoute(manageMeta("read", false), {
  method: "get",
  path: "/api/v1/intake-forms/{formId}",
  description:
    "One form with the questions on its WORKING DRAFT — what the builder edits. A form with no " +
    "unpublished changes shows the questions it currently serves.",
  request: { params: z.object({ formId: identifierPathParam("intakeForm", "formId") }) },
  responses: {
    200: {
      description: "The form and its draft questions.",
      content: { "application/json": { schema: FormDetail } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
  },
});

const createFormRoute = defineOpenAPIRoute(manageMeta("create", true), {
  method: "post",
  path: "/api/v1/intake-forms",
  description:
    "Author a new form. It is created in draft with a working version and a freshly minted public " +
    "token, and is unreachable from the internet until it is published.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: FormRequest } }, required: true },
  },
  responses: {
    201: {
      description: "Created.",
      content: { "application/json": { schema: z.object({ id: z.string() }) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
  },
});

const editFormRoute = defineOpenAPIRoute(manageMeta("edit", true), {
  method: "patch",
  path: "/api/v1/intake-forms/{formId}",
  description:
    "Change a form's own settings — its name, its title, its introduction, what a visitor is told " +
    "afterwards, its daily budget. These are NOT part of the frozen version: they are not " +
    "questions, so nothing answered them, and a firm fixing a typo in its own title should not " +
    "have to republish.",
  request: {
    params: z.object({ formId: identifierPathParam("intakeForm", "formId") }),
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: FormRequest } }, required: true },
  },
  responses: {
    200: {
      description: "Changed.",
      content: { "application/json": { schema: z.object({ acknowledged: z.boolean() }) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
  },
});

const addFieldRoute = defineOpenAPIRoute(manageMeta("addField", true), {
  method: "post",
  path: "/api/v1/intake-forms/{formId}/fields",
  description:
    "Add a question to the form's working draft. If the form's last version was published, this " +
    "opens a NEW draft seeded with a copy of the published questions — editing one question on a " +
    "live form must not silently drop the others.",
  request: {
    params: z.object({ formId: identifierPathParam("intakeForm", "formId") }),
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: FieldRequest } }, required: true },
  },
  responses: {
    201: {
      description: "Added.",
      content: { "application/json": { schema: z.object({ acknowledged: z.boolean() }) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
  },
});

const editFieldRoute = defineOpenAPIRoute(manageMeta("editField", true), {
  method: "patch",
  path: "/api/v1/intake-forms/{formId}/fields/{fieldId}",
  description:
    "Change a question on the working draft. A question on a PUBLISHED version is refused: people " +
    "answered it, and their answers name it.",
  request: {
    params: z.object({
      formId: identifierPathParam("intakeForm", "formId"),
      fieldId: identifierPathParam("intakeFormField", "fieldId"),
    }),
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: FieldRequest } }, required: true },
  },
  responses: {
    200: {
      description: "Changed.",
      content: { "application/json": { schema: z.object({ acknowledged: z.boolean() }) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
  },
});

const removeFieldRoute = defineOpenAPIRoute(
  {
    ...manageMeta("removeField", true),
    reversal: {
      kind: "none",
      reason:
        "A question can only be removed from a working draft, which has never been served to " +
        "anybody and which no submission can name. Removing one and adding it back is the same " +
        "form; there is nothing to restore because nothing answered it. A question on a published " +
        "version cannot be removed at all — publishing a new version without it is how a firm " +
        "stops asking something, and the old version stays readable beside the answers it took.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/intake-forms/{formId}/fields/{fieldId}",
    description:
      "Remove a question from the working draft, closing the gap it leaves so the order stays dense.",
    request: {
      params: z.object({
        formId: identifierPathParam("intakeForm", "formId"),
        fieldId: identifierPathParam("intakeFormField", "fieldId"),
      }),
      headers: idempotencyKeyHeader,
    },
    responses: {
      200: {
        description: "Removed.",
        content: { "application/json": { schema: z.object({ acknowledged: z.boolean() }) } },
      },
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
    },
  },
);

const reorderFieldsRoute = defineOpenAPIRoute(manageMeta("reorderFields", true), {
  method: "put",
  path: "/api/v1/intake-forms/{formId}/field-order",
  description: "Set the order of the working draft's questions, as the order of the ids sent.",
  request: {
    params: z.object({ formId: identifierPathParam("intakeForm", "formId") }),
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z.object({ fieldIds: z.array(identifierField("intakeFormField")) }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Reordered.",
      content: { "application/json": { schema: z.object({ acknowledged: z.boolean() }) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
  },
});

const publishFormRoute = defineOpenAPIRoute(manageMeta("publish", true), {
  method: "post",
  path: "/api/v1/intake-forms/{formId}/publication",
  description:
    "Publish the working draft: freeze its questions and point the form's public link at them. A " +
    "form with no questions is refused — a published form nobody can answer collects empty " +
    "submissions. After this the form is reachable by anyone holding its link.",
  request: {
    params: z.object({ formId: identifierPathParam("intakeForm", "formId") }),
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: {
      description: "Published.",
      content: { "application/json": { schema: z.object({ acknowledged: z.boolean() }) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
  },
});

const setClosedRoute = defineOpenAPIRoute(manageMeta("setClosed", true), {
  method: "put",
  path: "/api/v1/intake-forms/{formId}/closed",
  description:
    "Close a form, or reopen a closed one. Closing takes it off the internet and keeps everything " +
    "— its questions, its versions, and the submissions people already sent it. There is no " +
    "delete: those submissions are the firm's record of people who asked it for help.",
  request: {
    params: z.object({ formId: identifierPathParam("intakeForm", "formId") }),
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: z.object({ closed: z.boolean() }) } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Changed.",
      content: { "application/json": { schema: z.object({ acknowledged: z.boolean() }) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
  },
});

const rotateTokenRoute = defineOpenAPIRoute(manageMeta("rotateToken", true), {
  method: "post",
  path: "/api/v1/intake-forms/{formId}/token-rotations",
  description:
    "Mint a new public token for the form. EVERY LINK ALREADY HANDED OUT STOPS WORKING, which is " +
    "the point: this is what a firm does when its link has been scraped and is being flooded. The " +
    "form, its versions and its submissions all stand.",
  request: {
    params: z.object({ formId: identifierPathParam("intakeForm", "formId") }),
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: {
      description: "Rotated.",
      content: { "application/json": { schema: z.object({ publicToken: z.string() }) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
  },
});

const listSubmissionsRoute = defineOpenAPIRoute(submissionsMeta("listSubmissions", false), {
  method: "get",
  path: "/api/v1/intake-forms/{formId}/submissions",
  description:
    "What strangers sent this form, newest first, across every version of it — a firm reading its " +
    "queue wants what arrived, not what arrived through the questions it happens to ask this week.",
  request: {
    params: z.object({ formId: identifierPathParam("intakeForm", "formId") }),
    query: cursorQuery.extend({ state: TriageState.optional() }),
  },
  responses: {
    200: {
      description: "The queue.",
      content: { "application/json": { schema: SubmissionPage } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
  },
});

const readSubmissionRoute = defineOpenAPIRoute(submissionsMeta("readSubmission", false), {
  method: "get",
  path: "/api/v1/intake-forms/{formId}/submissions/{submissionId}",
  description:
    "One submission, with each answer beside the question AS IT WAS ASKED — read from the version " +
    "the submission arrived through, never from what the form asks today.",
  request: {
    params: z.object({
      formId: identifierPathParam("intakeForm", "formId"),
      submissionId: identifierPathParam("intakeFormSubmission", "submissionId"),
    }),
  },
  responses: {
    200: {
      description: "The submission.",
      content: { "application/json": { schema: SubmissionDetail } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
  },
});

const triageRoute = defineOpenAPIRoute(submissionsMeta("triage", true), {
  method: "put",
  path: "/api/v1/intake-forms/{formId}/submissions/{submissionId}/triage",
  description:
    "Record what a member decided about a submission. ACCEPTING CREATES NOTHING — no person, no " +
    "organization, no matter, no intake. It records that a member looked and decided to take it " +
    "further; turning that into a directory record is a separate act with its own preconditions. A " +
    "decision can be changed, because a submission marked spam that turns out to be a real enquiry " +
    "is exactly the mistake a queue produces.",
  request: {
    params: z.object({
      formId: identifierPathParam("intakeForm", "formId"),
      submissionId: identifierPathParam("intakeFormSubmission", "submissionId"),
    }),
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            state: TriageState,
            note: z.string().max(MAX_TRIAGE_NOTE_LENGTH).nullable().optional(),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Recorded.",
      content: { "application/json": { schema: z.object({ acknowledged: z.boolean() }) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
  },
});

// ---- the anonymous routes ----

const readPublicFormRoute = defineOpenAPIRoute(publicMeta("readPublic", false), {
  method: "get",
  path: "/api/v1/public/intake-forms/{firmId}/{publicToken}",
  description:
    "The questions a firm's published form asks, for rendering. Answers 404 — with one body — for " +
    "a token that never existed, a token that was rotated away, a form still in draft, and a form " +
    "the firm has closed. The cases are not distinguished, deliberately: separate answers would " +
    "make this endpoint an index of which forms a firm has and what state each is in.",
  request: {
    params: z.object({
      firmId: identifierPathParam("firm", "firmId"),
      publicToken: z.string().min(1).max(200),
    }),
  },
  responses: {
    200: {
      description: "The form.",
      content: { "application/json": { schema: PublicFormResponse } },
    },
    404: authErrors[404],
    429: authErrors[429],
  },
});

const submitPublicFormRoute = defineOpenAPIRoute(publicMeta("submitPublic", true), {
  method: "post",
  path: "/api/v1/public/intake-forms/{firmId}/{publicToken}/submissions",
  description:
    "Send a completed form. Answers 202 with one body for EVERY submission it accepts, whatever it " +
    "contains: a name the firm already represents, a name adverse to a current client, an unknown " +
    "name and a fifth submission from the same person are one answer, because anything else makes " +
    "this endpoint a directory of who the firm acts for. The submission is stored and nothing else " +
    "happens — no person, no matter and no intake is created, and no conflicts check runs. A " +
    "member decides all of that afterwards, where the reveal is authorised.",
  request: {
    params: z.object({
      firmId: identifierPathParam("firm", "firmId"),
      publicToken: z.string().min(1).max(200),
    }),
    headers: humanVerificationTokenHeader,
    body: { content: { "application/json": { schema: PublicSubmissionRequest } }, required: true },
  },
  responses: {
    202: {
      description: "Received.",
      content: {
        "application/json": {
          schema: z.object({ received: z.literal(true), message: z.string() }),
        },
      },
    },
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
    503: authErrors[503],
  },
});

// ---- presenters ----

function fieldJson(row: IntakeFormFieldRow): z.infer<typeof FormField> {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    helpText: row.help_text,
    required: row.required === 1,
    options: parseOptionsJson(row.options_json),
    position: row.position,
  };
}

function parseOptionsJson(optionsJson: string | null): string[] | null {
  if (optionsJson === null) return null;
  try {
    const parsed: unknown = JSON.parse(optionsJson);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((option): option is string => typeof option === "string");
  } catch {
    return null;
  }
}

function submissionSummaryJson(row: IntakeFormSubmissionRow): z.infer<typeof SubmissionSummary> {
  return {
    id: row.id,
    submittedAt: row.submitted_at,
    triageState: row.triage_state,
    triagedAt: row.triaged_at,
    triagedBy: row.triaged_by,
    triageNote: row.triage_note,
  };
}

// ---- refusal mapping ----

function formErrorResponse(
  c: Context,
  caught: IntakeFormValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "form-unknown":
    case "field-unknown":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    // Well-formed request, wrong state: the version is published and frozen, there is nothing to
    // publish, or the form has no questions yet.
    case "form-not-draftable":
    case "form-no-fields":
      return problemJson(c, {
        type: "conflict",
        title: "That form is not in a state this change applies to",
        status: 409,
        detail: caught.message,
      });
    default:
      return problemJson(c, {
        type: "validation",
        title: "That is not something this form can be asked",
        status: 422,
        detail: caught.message,
      });
  }
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
          responseBody: canonicalJsonStringify(body as Record<string, unknown>),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof IntakeFormValidationError) {
      return { committed: false, problem: formErrorResponse(c, caught) };
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

function serviceOptions(userId: string) {
  return { clock: { now: () => new Date().toISOString() }, actorUserId: userId as never };
}

function notFound(c: Context, detail: string) {
  return problemJson(c, { type: "not-found", title: "Not found", status: 404, detail });
}

/**
 * The ONE answer every unresolvable public case gets.
 *
 * One helper rather than four call sites, so a future case cannot be given its own wording by
 * accident. The detail says nothing about which case it was — that is the entire discipline.
 */
function publicNotFound(c: Context) {
  return problemJson(c, {
    type: "not-found",
    title: "Not found",
    status: 404,
    detail: "This form is not available.",
  });
}

export function registerIntakeFormRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // ---- the firm's half ----

  app.openapi(
    { ...listFormsRoute, middleware: chokepointMiddleware(chokepoint, listFormsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { cursor } = c.req.valid("query");
      const { results } = await selectFormsStatement(firm.firmDatabase, {
        limit: MAX_FORM_PAGE_SIZE,
        cursor: decodeCursor(cursor),
      }).all<IntakeFormRow>();
      // One row past the page was fetched; trim before the per-row reads so a page never pays for
      // the row that only exists to answer "is there more".
      const hasMore = results.length > MAX_FORM_PAGE_SIZE;
      const page = hasMore ? results.slice(0, MAX_FORM_PAGE_SIZE) : results;
      const last = page.at(-1);
      const waiting = await readWaitingCounts(firm.firmDatabase);
      const data = await Promise.all(
        page.map(async (row) => {
          const draft = await readDraftVersion(firm.firmDatabase, row.id);
          return {
            id: row.id,
            name: row.name,
            title: row.title,
            status: row.status,
            publicToken: row.public_token,
            publishedVersionId: row.published_version_id,
            submissionBudgetPerDay: row.submission_budget_per_day,
            // A form has unpublished changes when a draft exists that is not simply the untouched
            // first version of a form nobody has published yet.
            hasUnpublishedChanges: draft !== undefined && row.published_version_id !== null,
            waitingSubmissions: waiting.get(row.id) ?? 0,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        }),
      );
      return c.json(
        {
          data,
          nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
        },
        200,
      );
    },
  );

  app.openapi(
    { ...readFormRoute, middleware: chokepointMiddleware(chokepoint, readFormRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { formId } = c.req.valid("param");
      const form = await readForm(firm.firmDatabase, formId as IntakeFormId);
      if (form === undefined) return notFound(c, "That form is not a form in this firm.");

      // The builder edits the DRAFT. A form with no draft is one whose last version is published, so
      // it shows what it currently serves — which is what the firm expects to see before it edits.
      const draft = await readDraftVersion(firm.firmDatabase, form.id);
      const versionId = draft?.id ?? form.published_version_id;
      const fields =
        versionId === null || versionId === undefined
          ? []
          : await readFields(firm.firmDatabase, versionId);
      const waiting = await readWaitingCounts(firm.firmDatabase);

      return c.json(
        {
          id: form.id,
          name: form.name,
          title: form.title,
          introduction: form.introduction,
          confirmationMessage: form.confirmation_message,
          status: form.status,
          publicToken: form.public_token,
          publishedVersionId: form.published_version_id,
          submissionBudgetPerDay: form.submission_budget_per_day,
          hasUnpublishedChanges: draft !== undefined && form.published_version_id !== null,
          waitingSubmissions: waiting.get(form.id) ?? 0,
          fields: fields.map(fieldJson),
          createdAt: form.created_at,
          updatedAt: form.updated_at,
        },
        200,
      );
    },
  );

  app.openapi(
    { ...createFormRoute, middleware: chokepointMiddleware(chokepoint, createFormRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const created = await createForm(firm.firmDatabase, request, serviceOptions(userId));
        return { body: { id: created.formId }, effect: created.effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body as { id: string }, 201);
    },
  );

  app.openapi(
    { ...editFormRoute, middleware: chokepointMiddleware(chokepoint, editFormRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { formId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const effect = await editForm(
          firm.firmDatabase,
          formId as IntakeFormId,
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

  app.openapi(
    { ...addFieldRoute, middleware: chokepointMiddleware(chokepoint, addFieldRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { formId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const effect = await addField(
          firm.firmDatabase,
          formId as IntakeFormId,
          request,
          serviceOptions(userId),
        );
        return { body: { acknowledged: true }, effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ acknowledged: true } as const, 201);
    },
  );

  app.openapi(
    { ...editFieldRoute, middleware: chokepointMiddleware(chokepoint, editFieldRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { formId, fieldId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const effect = await editField(
          firm.firmDatabase,
          formId as IntakeFormId,
          fieldId as IntakeFormFieldId,
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

  app.openapi(
    { ...removeFieldRoute, middleware: chokepointMiddleware(chokepoint, removeFieldRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { formId, fieldId } = c.req.valid("param");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const effect = await removeField(
          firm.firmDatabase,
          formId as IntakeFormId,
          fieldId as IntakeFormFieldId,
          serviceOptions(userId),
        );
        return { body: { acknowledged: true }, effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ acknowledged: true } as const, 200);
    },
  );

  app.openapi(
    { ...reorderFieldsRoute, middleware: chokepointMiddleware(chokepoint, reorderFieldsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { formId } = c.req.valid("param");
      const { fieldIds } = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const effect = await reorderFields(
          firm.firmDatabase,
          formId as IntakeFormId,
          fieldIds as IntakeFormFieldId[],
          serviceOptions(userId),
        );
        return { body: { acknowledged: true }, effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ acknowledged: true } as const, 200);
    },
  );

  app.openapi(
    { ...publishFormRoute, middleware: chokepointMiddleware(chokepoint, publishFormRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { formId } = c.req.valid("param");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const effect = await publishForm(
          firm.firmDatabase,
          formId as IntakeFormId,
          serviceOptions(userId),
        );
        return { body: { acknowledged: true }, effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ acknowledged: true } as const, 200);
    },
  );

  app.openapi(
    { ...setClosedRoute, middleware: chokepointMiddleware(chokepoint, setClosedRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { formId } = c.req.valid("param");
      const { closed } = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const effect = await setFormClosed(
          firm.firmDatabase,
          formId as IntakeFormId,
          closed,
          serviceOptions(userId),
        );
        return { body: { acknowledged: true }, effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ acknowledged: true } as const, 200);
    },
  );

  app.openapi(
    { ...rotateTokenRoute, middleware: chokepointMiddleware(chokepoint, rotateTokenRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { formId } = c.req.valid("param");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const rotated = await rotatePublicToken(
          firm.firmDatabase,
          formId as IntakeFormId,
          serviceOptions(userId),
        );
        return { body: { publicToken: rotated.publicToken }, effect: rotated.effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body as { publicToken: string }, 200);
    },
  );

  app.openapi(
    { ...listSubmissionsRoute, middleware: chokepointMiddleware(chokepoint, listSubmissionsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { formId } = c.req.valid("param");
      const { state, cursor } = c.req.valid("query");
      const form = await readForm(firm.firmDatabase, formId as IntakeFormId);
      if (form === undefined) return notFound(c, "That form is not a form in this firm.");
      const { results } = await selectSubmissionsStatement(firm.firmDatabase, {
        formId: form.id,
        state: state ?? null,
        limit: MAX_SUBMISSION_PAGE_SIZE,
        cursor: decodeCursor(cursor),
      }).all<IntakeFormSubmissionRow>();
      // Copied into a mutable array because the response schema owns the wire contract; the
      // helper's page is readonly so nothing downstream edits a page in place.
      const page = assemblePage(results, MAX_SUBMISSION_PAGE_SIZE, submissionSummaryJson);
      return c.json({ data: [...page.data], nextCursor: page.nextCursor }, 200);
    },
  );

  app.openapi(
    { ...readSubmissionRoute, middleware: chokepointMiddleware(chokepoint, readSubmissionRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { formId, submissionId } = c.req.valid("param");
      const form = await readForm(firm.firmDatabase, formId as IntakeFormId);
      if (form === undefined) return notFound(c, "That form is not a form in this firm.");
      const submission = await readSubmission(
        firm.firmDatabase,
        submissionId as IntakeFormSubmissionId,
      );
      if (submission === undefined) {
        return notFound(c, "That submission is not a submission on this form.");
      }

      // The questions AS THEY WERE ASKED, from the submission's own version. Reading today's
      // questions instead would caption somebody's answers with a question they never saw.
      const fields = await readFields(firm.firmDatabase, submission.form_version_id);
      const answers = parseAnswers(submission.answers_json);

      return c.json(
        {
          ...submissionSummaryJson(submission),
          answers: fields.map((field) => ({
            fieldId: field.id,
            label: field.label,
            kind: field.kind,
            value: answers[field.id] ?? null,
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    { ...triageRoute, middleware: chokepointMiddleware(chokepoint, triageRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { formId, submissionId } = c.req.valid("param");
      const request = c.req.valid("json");
      const form = await readForm(firm.firmDatabase, formId as IntakeFormId);
      if (form === undefined) return notFound(c, "That form is not a form in this firm.");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const effect = await recordTriageDecision(
          firm.firmDatabase,
          { submissionId: submissionId as IntakeFormSubmissionId, ...request },
          serviceOptions(userId),
        );
        return { body: { acknowledged: true }, effect };
      });
      if (!outcome.committed) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ acknowledged: true } as const, 200);
    },
  );

  // ---- the anonymous half ----

  app.openapi(
    { ...readPublicFormRoute, middleware: chokepointMiddleware(chokepoint, readPublicFormRoute) },
    async (c) => {
      const { firmId, publicToken } = c.req.valid("param");
      // Addressed by the id in the path, because there is no session to resolve a firm from — the
      // same seam the queue consumers and the cron use.
      const database = firmDatabaseFor(c.env.FIRM_DATABASE, firmId);
      const resolved = await resolvePublicForm(database, publicToken);
      if (resolved === undefined) return publicNotFound(c);
      // Copied into mutable shapes because the response schema owns the wire contract; the package's
      // own view is readonly so nothing downstream can edit a form's questions in place.
      return c.json(
        {
          title: resolved.view.title,
          introduction: resolved.view.introduction,
          humanVerificationSiteKey: c.env.TURNSTILE_SITE_KEY ?? null,
          fields: resolved.view.fields.map((field) => ({
            fieldId: field.fieldId,
            kind: field.kind,
            label: field.label,
            helpText: field.helpText,
            required: field.required,
            options: field.options === null ? null : [...field.options],
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    {
      ...submitPublicFormRoute,
      middleware: chokepointMiddleware(chokepoint, submitPublicFormRoute),
    },
    async (c) => {
      const { firmId, publicToken } = c.req.valid("param");
      const { answers } = c.req.valid("json");

      const database = firmDatabaseFor(c.env.FIRM_DATABASE, firmId);
      const resolved = await resolvePublicForm(database, publicToken);
      // Resolved BEFORE the challenge, so an unresolvable form costs no outbound verification call —
      // and it is safe in that order because the resolution's cost does not vary with the submission.
      if (resolved === undefined) return publicNotFound(c);

      const refusal = await enforceHumanVerification(c);
      if (refusal !== null) return refusal;

      let effect: EffectWrite;
      try {
        const recorded = await recordSubmission(
          database,
          { form: resolved.form, fields: resolved.answerable, answers },
          { clock: { now: () => new Date().toISOString() } },
        );
        effect = recorded.effect;
      } catch (caught) {
        if (caught instanceof IntakeFormValidationError) {
          // A fact about what THEY typed — too long, a required answer missing, a choice not on the
          // list. Safe to report, and the only thing on this path that is.
          return problemJson(c, {
            type: "validation",
            title: "That could not be sent",
            status: 422,
            detail: caught.message,
          });
        }
        if (caught instanceof SubmissionRefusedError) {
          // The form's own budget, or a form that stopped being reachable between the resolve and
          // the write. Neither says anything about the submission, and both wear the one 404 rather
          // than a code that would distinguish a throttled form from an absent one.
          return publicNotFound(c);
        }
        throw caught;
      }

      await commitEffectBatch(database, effect, { now: () => new Date().toISOString() });

      return c.json(
        {
          received: true as const,
          // The firm's own words, or the platform's if it wrote none. Deliberately incurious either
          // way: it must say no more than the status code does.
          message:
            resolved.form.confirmation_message ??
            "Thank you. We have received your enquiry and someone will be in touch.",
        },
        202,
      );
    },
  );
}

function parseAnswers(answersJson: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(answersJson);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

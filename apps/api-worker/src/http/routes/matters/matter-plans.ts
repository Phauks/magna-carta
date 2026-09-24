import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { WALL_CLOCK_TIME_PATTERN } from "@magna-carta/civil-time/wall-clock";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  MatterId,
  MatterPlanTaskTemplateId,
  MatterPlanTemplateId,
  MatterTypeId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  acceptMatterPlan,
  addPlanTaskTemplate,
  createPlanTemplate,
  editPlanTaskTemplate,
  editPlanTemplate,
  plansOfferedForMatter,
  proposeMatterPlan,
  removePlanTaskTemplate,
  setPlanTemplateActive,
} from "@magna-carta/tasks/plan-service";
import {
  readPlanTaskTemplates,
  selectPlanTemplatesStatement,
  type MatterPlanTemplateRow,
} from "@magna-carta/tasks/plan-statements";
import {
  MAX_PLAN_DESCRIPTION_LENGTH,
  MAX_PLAN_NAME_LENGTH,
  MAX_PLAN_TEMPLATE_PAGE_SIZE,
  MAX_TASK_BODY_LENGTH,
  MAX_TASK_TITLE_LENGTH,
  PLAN_DUE_ANCHORS,
  TASK_PRIORITIES,
} from "@magna-carta/tasks/types";
import { TaskValidationError } from "@magna-carta/tasks/validation";
import type { Context } from "hono";
import type { Permission } from "@magna-carta/access-control/registry";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointPermissions,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import {
  idempotencyKeyHeader,
  identifierField,
  identifierPathParam,
} from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// The matter plan's HTTP surface over @magna-carta/tasks.
//
// A plan is a firm's own account of the work a kind of matter takes. Opening a matter whose type
// carries one OFFERS its tasks; nothing is written until somebody accepts.
//
// THE PROPOSAL IS A GET. That is not a stylistic choice: it is how the surface says out loud that
// reviewing a plan writes nothing. Acceptance is the POST, and it is the only route here that puts a
// task on a matter.
//
// Authoring is separated from doing. `tasks:managePlans` governs what the firm says the work IS;
// accepting a proposal creates tasks and rides the keys that already govern that.

const MANAGE = "tasks:managePlans" as const;
const READ = "tasks:read" as const;
const WRITE = "tasks:write" as const;
const ASSIGN = "tasks:assign" as const;

const CIVIL_DATE = CIVIL_DATE_PATTERN;
const WALL_CLOCK_TIME = WALL_CLOCK_TIME_PATTERN;

// ---- contracts ----

const PlanTemplateRequest = z
  .object({
    name: z.string().min(1).max(MAX_PLAN_NAME_LENGTH),
    description: z.string().max(MAX_PLAN_DESCRIPTION_LENGTH).nullable().optional(),
    // Null offers the plan on every matter type, which is the right shape for a firm whose opening
    // steps do not vary by matter.
    matterTypeId: identifierField("matterType").nullable(),
  })
  .openapi("MatterPlanTemplateRequest");

const PlanTaskTemplateRequest = z
  .object({
    title: z.string().min(1).max(MAX_TASK_TITLE_LENGTH),
    body: z.string().max(MAX_TASK_BODY_LENGTH).nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).nullable().optional(),
    // A ROLE, matched against the matter's team when the plan is proposed. Never a member: a template
    // that named one would be wrong the moment that member's matters were reassigned.
    defaultAssigneeRole: z.string().max(120).nullable().optional(),
    dueAnchor: z.enum(PLAN_DUE_ANCHORS).nullable().optional(),
    offsetDays: z.number().int().nullable().optional(),
    blockedByTemplateTaskId: identifierField("matterPlanTaskTemplate").nullable().optional(),
    position: z.number().int().min(0).nullable().optional(),
  })
  .openapi("MatterPlanTaskTemplateRequest");

const PlanTaskTemplate = z
  .object({
    id: z.string(),
    title: z.string(),
    body: z.string().nullable(),
    priority: z.enum(TASK_PRIORITIES),
    defaultAssigneeRole: z.string().nullable(),
    dueAnchor: z.enum(PLAN_DUE_ANCHORS),
    offsetDays: z.number().int().nullable(),
    blockedByTemplateTaskId: z.string().nullable(),
    position: z.number().int(),
  })
  .openapi("MatterPlanTaskTemplate");

const PlanTemplate = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    matterTypeId: z.string().nullable(),
    active: z.boolean(),
    createdBy: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    // Present on the single-plan read, absent on the list.
    tasks: z.array(PlanTaskTemplate).optional(),
  })
  .openapi("MatterPlanTemplate");

const ProposedTask = z
  .object({
    taskTemplateId: z.string(),
    title: z.string(),
    body: z.string().nullable(),
    priority: z.enum(TASK_PRIORITIES),
    dueAnchor: z.enum(PLAN_DUE_ANCHORS),
    offsetDays: z.number().int().nullable(),
    // What the plan WOULD set. Null where the step carries no anchor, and null where the matter
    // records no opened date — never a date computed from today, which would invent a schedule out
    // of a missing fact.
    dueOn: z.string().nullable(),
    timeZone: z.string().nullable(),
    // The role the step names and who it resolved to. A role that resolved to nobody arrives named
    // with a null member, so the reviewer sees which one could not be filled.
    defaultAssigneeRole: z.string().nullable(),
    assigneeUserId: z.string().nullable(),
    blockedByTemplateTaskId: z.string().nullable(),
    position: z.number().int(),
  })
  .openapi("ProposedMatterPlanTask");

const PlanProposal = z
  .object({
    templateId: z.string(),
    templateName: z.string(),
    matterId: z.string(),
    tasks: z.array(ProposedTask),
    // True where the matter records no opened date, so every anchored step proposes none. Surfaced
    // rather than absorbed: a reviewer seeing eleven undated steps should know why.
    anchorUnavailable: z.boolean(),
  })
  .openapi("MatterPlanProposal");

const AcceptPlanRequest = z
  .object({
    // Only the steps the reviewer kept, each as they left it. An omitted field takes what the
    // proposal offered; a present one overrides it, which is the whole purpose of the review.
    accepted: z
      .array(
        z.object({
          taskTemplateId: identifierField("matterPlanTaskTemplate"),
          title: z.string().min(1).max(MAX_TASK_TITLE_LENGTH).optional(),
          body: z.string().max(MAX_TASK_BODY_LENGTH).nullable().optional(),
          priority: z.enum(TASK_PRIORITIES).nullable().optional(),
          dueOn: z.string().regex(CIVIL_DATE).nullable().optional(),
          dueAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
          timeZone: z.string().min(1).max(120).nullable().optional(),
          assigneeUserId: identifierField("user").nullable().optional(),
        }),
      )
      .min(1),
  })
  .openapi("AcceptMatterPlanRequest");

const PlanList = z.object({ data: z.array(PlanTemplate) }).openapi("MatterPlanTemplateList");
const CreatedResponse = z.object({ id: z.string() }).openapi("CreatedMatterPlan");
const AcknowledgedResponse = z.object({ ok: z.literal(true) }).openapi("MatterPlanAcknowledged");
const AcceptedResponse = z
  .object({ taskIds: z.array(z.string()) })
  .openapi("AcceptedMatterPlanTasks");

const planIdParam = z.object({ planId: identifierPathParam("matterPlanTemplate", "planId") });
const stepIdParam = z.object({ stepId: identifierPathParam("matterPlanTaskTemplate", "stepId") });
const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const matterPlanParams = z.object({
  matterId: identifierPathParam("matter", "matterId"),
  planId: identifierPathParam("matterPlanTemplate", "planId"),
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
    description: "The firm is unreachable, the member is deactivated, or the plan is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is still in progress",
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

function planErrorResponse(
  c: Context,
  caught: TaskValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "plan-unknown":
    case "plan-unknown-task-template":
    case "task-unknown":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    // The plan moved under the request: somebody deactivated it, or the step being accepted is no
    // longer one this plan proposes. Well-formed request, changed record.
    case "plan-inactive":
    case "plan-task-template-mismatch":
      return problemJson(c, {
        type: "conflict",
        title: "That plan is not in a state this change applies to",
        status: 409,
        detail: caught.message,
      });
    default:
      return problemJson(c, {
        type: "validation",
        title: "Matter plan request invalid",
        status: 422,
        detail: caught.message,
      });
  }
}

// The two READS answer a narrower set than the writes, and their contracts say so. Mapping them
// through the shared writer's mapper would let a route declare responses it cannot produce and
// produce ones it did not declare — which the conformance check exists to catch, and which is worth
// catching rather than papering over by widening every contract to the union.
function notFound(c: Context, caught: TaskValidationError): ProblemResponse<404> {
  return problemJson(c, {
    type: "not-found",
    title: "Not found",
    status: 404,
    detail: caught.message,
  });
}

function proposalErrorResponse(
  c: Context,
  caught: TaskValidationError,
): ProblemResponse<404> | ProblemResponse<409> {
  // A plan somebody deactivated between the offer and the proposal is a changed record rather than
  // a bad request: the caller asked correctly and the answer moved.
  if (caught.code === "plan-inactive") {
    return problemJson(c, {
      type: "conflict",
      title: "That plan is no longer offered",
      status: 409,
      detail: caught.message,
    });
  }
  return notFound(c, caught);
}

// Authoring binds resource: "firm" — a plan belongs to no matter and is firm configuration, the
// posture the matter-type catalog already takes.
function manageMeta(action: string, mutating: boolean): RouteMeta {
  return {
    operationId: `matterPlans.${action}`,
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

const listPlansRoute = defineOpenAPIRoute(manageMeta("listPlans", false), {
  method: "get",
  path: "/api/v1/matter-plans",
  description:
    "The firm's matter plans. Deactivated plans are left out unless asked for; a plan is never " +
    "deleted, because tasks accepted from it name it and a firm asking which matters came off the " +
    "old intake plan needs it to still be there.",
  request: {
    query: z.object({ includeInactive: z.enum(["true", "false"]).optional() }),
  },
  responses: {
    200: { description: "The firm's plans", content: { "application/json": { schema: PlanList } } },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const readPlanRoute = defineOpenAPIRoute(manageMeta("readPlan", false), {
  method: "get",
  path: "/api/v1/matter-plans/{planId}",
  description: "One plan and the tasks it proposes, in the order it proposes them.",
  request: { params: planIdParam },
  responses: {
    200: { description: "The plan", content: { "application/json": { schema: PlanTemplate } } },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const createPlanRoute = defineOpenAPIRoute(manageMeta("createPlan", true), {
  method: "post",
  path: "/api/v1/matter-plans",
  description:
    "Creates a plan. Bind it to a matter type to offer it when a matter of that kind opens, or " +
    "leave the type null to offer it on every matter. A new plan proposes nothing until you add " +
    "steps to it.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: PlanTemplateRequest } }, required: true },
  },
  responses: {
    201: { description: "The plan", content: { "application/json": { schema: CreatedResponse } } },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const editPlanRoute = defineOpenAPIRoute(manageMeta("editPlan", true), {
  method: "patch",
  path: "/api/v1/matter-plans/{planId}",
  description:
    "Changes a plan's name, description, or the matter type it is offered on. Tasks already " +
    "accepted from this plan onto a matter are NOT touched and never will be: they were reviewed " +
    "and accepted as they stood, and changing a plan does not reach into open matters.",
  request: {
    headers: idempotencyKeyHeader,
    params: planIdParam,
    body: { content: { "application/json": { schema: PlanTemplateRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The plan was changed",
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

const setPlanActiveRoute = defineOpenAPIRoute(manageMeta("setPlanActive", true), {
  method: "put",
  path: "/api/v1/matter-plans/{planId}/active",
  description:
    "Stops a plan being offered, or offers it again. Deactivating changes no matter and no task; " +
    "it only stops the plan appearing when a new matter of its type opens.",
  request: {
    headers: idempotencyKeyHeader,
    params: planIdParam,
    body: {
      content: { "application/json": { schema: z.object({ active: z.boolean() }) } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The plan's availability was changed",
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

const addStepRoute = defineOpenAPIRoute(manageMeta("addPlanStep", true), {
  method: "post",
  path: "/api/v1/matter-plans/{planId}/steps",
  description:
    "Adds a step to a plan. A step carries a due-date ANCHOR and a number of days rather than a " +
    "date, and a ROLE rather than a member, because both are resolved against the matter when the " +
    "plan is proposed. The days are plain calendar days: no weekend skip and no holiday calendar, " +
    "so a step can propose a date that falls on a Sunday and the person reviewing it moves it.",
  request: {
    headers: idempotencyKeyHeader,
    params: planIdParam,
    body: { content: { "application/json": { schema: PlanTaskTemplateRequest } }, required: true },
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

const editStepRoute = defineOpenAPIRoute(manageMeta("editPlanStep", true), {
  method: "patch",
  path: "/api/v1/matter-plan-steps/{stepId}",
  description:
    "Changes a step. Every field is replaced, so send the ones to keep as well. Tasks already " +
    "accepted from this step are not touched.",
  request: {
    headers: idempotencyKeyHeader,
    params: stepIdParam,
    body: { content: { "application/json": { schema: PlanTaskTemplateRequest } }, required: true },
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

const removeStepRoute = defineOpenAPIRoute(
  {
    ...manageMeta("removePlanStep", true),
    reversal: { kind: "inverse", by: "matterPlans.addPlanStep" },
  },
  {
    method: "delete",
    path: "/api/v1/matter-plan-steps/{stepId}",
    description:
      "Removes a step from a plan. Any step that waited on it stops waiting. Tasks already accepted " +
      "from it onto a matter are untouched.",
    request: { headers: idempotencyKeyHeader, params: stepIdParam },
    responses: {
      200: {
        description: "The step was removed",
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

// ---- proposing and accepting, on the matter ----

const offeredPlansRoute = defineOpenAPIRoute(
  {
    operationId: "matterPlans.listOffered",
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "get",
    path: "/api/v1/matters/{matterId}/plans",
    description:
      "The plans offered on this matter: those bound to its type, plus those bound to no type at " +
      "all. Reading this writes nothing.",
    request: { params: matterIdParam },
    responses: {
      200: {
        description: "The plans offered",
        content: { "application/json": { schema: PlanList } },
      },
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      429: authErrors[429],
    },
  },
);

const proposeRoute = defineOpenAPIRoute(
  {
    operationId: "matterPlans.propose",
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "get",
    path: "/api/v1/matters/{matterId}/plans/{planId}/proposal",
    description:
      "What this plan would put on this matter: each step with the date it computes from the " +
      "matter's opened day and the member its role resolves to. NOTHING IS WRITTEN. A step whose " +
      "role matches nobody on the matter comes back named but unassigned, and a step the matter " +
      "cannot date comes back with no date rather than one computed from today.",
    request: { params: matterPlanParams },
    responses: {
      200: {
        description: "What the plan proposes",
        content: { "application/json": { schema: PlanProposal } },
      },
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      429: authErrors[429],
    },
  },
);

const acceptRoute = defineOpenAPIRoute(
  {
    operationId: "matterPlans.accept",
    surface: "app",
    authenticated: true,
    // Accepting CREATES TASKS, so it rides the key that governs creating them rather than the one
    // that governs authoring plans. A member who may run the firm's intake plan need not be somebody
    // who may rewrite it.
    permission: WRITE,
    resource: "firm",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  },
  {
    method: "post",
    path: "/api/v1/matters/{matterId}/plans/{planId}/acceptance",
    description:
      "Puts the steps you kept onto the matter as tasks, in one go. Send only what you kept, each " +
      "as you left it: a date you changed, a member you filled in. Anything you leave out takes " +
      "what the proposal offered. Declining a plan needs no request at all — it is simply not " +
      "sending this one.",
    request: {
      headers: idempotencyKeyHeader,
      params: matterPlanParams,
      body: { content: { "application/json": { schema: AcceptPlanRequest } }, required: true },
    },
    responses: {
      201: {
        description: "The tasks that were added",
        content: { "application/json": { schema: AcceptedResponse } },
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

function planOptions(userId: UserId) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId,
    randomSource: cryptoRandomSource,
  };
}

function planTemplateJson(row: MatterPlanTemplateRow): z.infer<typeof PlanTemplate> {
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

type PlanEffectOutcome =
  | { ok: true; body: unknown; replayed: boolean }
  | { ok: false; problem: ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> };

async function commitPlanEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  responseCode: number,
  call: () => Promise<{ body: unknown; effect: EffectWrite }>,
): Promise<PlanEffectOutcome> {
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
          // The stored body IS the wire body: the idempotency gate replays it verbatim, so a retried
          // acceptance answers with the SAME task handles rather than minting a second set.
          responseBody: canonicalJsonStringify(body as Record<string, unknown>),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof TaskValidationError) {
      return { ok: false, problem: planErrorResponse(c, caught) };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  return {
    ok: true,
    body: JSON.parse(result.responseBody ?? "{}") as unknown,
    replayed: result.kind === "replayed",
  };
}

export function registerMatterPlanRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/matter-plans
  app.openapi(
    { ...listPlansRoute, middleware: chokepointMiddleware(chokepoint, listPlansRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { includeInactive } = c.req.valid("query");
      const { results } = await selectPlanTemplatesStatement(firm.firmDatabase, {
        limit: MAX_PLAN_TEMPLATE_PAGE_SIZE,
        includeInactive: includeInactive === "true",
      }).all<MatterPlanTemplateRow>();
      return c.json({ data: results.map(planTemplateJson) }, 200);
    },
  );

  // GET /api/v1/matter-plans/{planId}
  app.openapi(
    { ...readPlanRoute, middleware: chokepointMiddleware(chokepoint, readPlanRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { planId } = c.req.valid("param");
      const { results } = await selectPlanTemplatesStatement(firm.firmDatabase, {
        limit: MAX_PLAN_TEMPLATE_PAGE_SIZE,
        includeInactive: true,
      }).all<MatterPlanTemplateRow>();
      const plan = results.find((row) => row.id === planId);
      if (plan === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "That plan is not a plan in this firm.",
        });
      }
      const steps = await readPlanTaskTemplates(firm.firmDatabase, planId as MatterPlanTemplateId);
      return c.json(
        {
          ...planTemplateJson(plan),
          tasks: steps.map((step) => ({
            id: step.id,
            title: step.title,
            body: step.body,
            priority: step.priority,
            defaultAssigneeRole: step.default_assignee_role,
            dueAnchor: step.due_anchor,
            offsetDays: step.offset_days,
            blockedByTemplateTaskId: step.blocked_by_template_task_id,
            position: step.position,
          })),
        },
        200,
      );
    },
  );

  // POST /api/v1/matter-plans
  app.openapi(
    { ...createPlanRoute, middleware: chokepointMiddleware(chokepoint, createPlanRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const outcome = await commitPlanEffect(c, firm.firmDatabase, idempotency, 201, () => {
        const created = createPlanTemplate(
          firm.firmDatabase,
          { ...request, matterTypeId: request.matterTypeId as MatterTypeId | null },
          planOptions(userId),
        );
        return Promise.resolve({ body: { id: created.templateId }, effect: created.effect });
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body as { id: string }, 201);
    },
  );

  // PATCH /api/v1/matter-plans/{planId}
  app.openapi(
    { ...editPlanRoute, middleware: chokepointMiddleware(chokepoint, editPlanRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { planId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitPlanEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await editPlanTemplate(
          firm.firmDatabase,
          planId as MatterPlanTemplateId,
          { ...request, matterTypeId: request.matterTypeId as MatterTypeId | null },
          planOptions(userId),
        );
        return { body: { ok: true }, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // PUT /api/v1/matter-plans/{planId}/active
  app.openapi(
    { ...setPlanActiveRoute, middleware: chokepointMiddleware(chokepoint, setPlanActiveRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { planId } = c.req.valid("param");
      const { active } = c.req.valid("json");
      const outcome = await commitPlanEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await setPlanTemplateActive(
          firm.firmDatabase,
          planId as MatterPlanTemplateId,
          active,
          planOptions(userId),
        );
        return { body: { ok: true }, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/matter-plans/{planId}/steps
  app.openapi(
    { ...addStepRoute, middleware: chokepointMiddleware(chokepoint, addStepRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { planId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitPlanEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const added = await addPlanTaskTemplate(
          firm.firmDatabase,
          planId as MatterPlanTemplateId,
          {
            ...request,
            blockedByTemplateTaskId: (request.blockedByTemplateTaskId ??
              null) as MatterPlanTaskTemplateId | null,
          },
          planOptions(userId),
        );
        return { body: { id: added.taskTemplateId }, effect: added.effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body as { id: string }, 201);
    },
  );

  // PATCH /api/v1/matter-plan-steps/{stepId}
  app.openapi(
    { ...editStepRoute, middleware: chokepointMiddleware(chokepoint, editStepRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { stepId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitPlanEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await editPlanTaskTemplate(
          firm.firmDatabase,
          stepId as MatterPlanTaskTemplateId,
          {
            ...request,
            blockedByTemplateTaskId: (request.blockedByTemplateTaskId ??
              null) as MatterPlanTaskTemplateId | null,
          },
          planOptions(userId),
        );
        return { body: { ok: true }, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // DELETE /api/v1/matter-plan-steps/{stepId}
  app.openapi(
    { ...removeStepRoute, middleware: chokepointMiddleware(chokepoint, removeStepRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { stepId } = c.req.valid("param");
      const outcome = await commitPlanEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await removePlanTaskTemplate(
          firm.firmDatabase,
          stepId as MatterPlanTaskTemplateId,
          planOptions(userId),
        );
        return { body: { ok: true }, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // GET /api/v1/matters/{matterId}/plans
  app.openapi(
    { ...offeredPlansRoute, middleware: chokepointMiddleware(chokepoint, offeredPlansRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      try {
        const offered = await plansOfferedForMatter(
          firm.firmDatabase,
          matterId as MatterId,
          visibleMatterPredicate(),
        );
        return c.json({ data: offered.map(planTemplateJson) }, 200);
      } catch (caught) {
        if (caught instanceof TaskValidationError) return notFound(c, caught);
        throw caught;
      }
    },
  );

  // GET /api/v1/matters/{matterId}/plans/{planId}/proposal
  app.openapi(
    { ...proposeRoute, middleware: chokepointMiddleware(chokepoint, proposeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId, planId } = c.req.valid("param");
      try {
        const proposal = await proposeMatterPlan(
          firm.firmDatabase,
          matterId as MatterId,
          planId as MatterPlanTemplateId,
          { clock: { now: () => new Date().toISOString() }, visibility: visibleMatterPredicate() },
        );
        // Mapped field by field rather than returned whole: the wire shape is its own contract, and
        // handing the domain object straight out would make every later field a silent addition to it.
        return c.json(
          {
            templateId: proposal.templateId,
            templateName: proposal.templateName,
            matterId: proposal.matterId,
            anchorUnavailable: proposal.anchorUnavailable,
            tasks: proposal.tasks.map((task) => ({
              taskTemplateId: task.taskTemplateId,
              title: task.title,
              body: task.body,
              priority: task.priority,
              dueAnchor: task.dueAnchor,
              offsetDays: task.offsetDays,
              dueOn: task.dueOn,
              timeZone: task.timeZone,
              defaultAssigneeRole: task.defaultAssigneeRole,
              assigneeUserId: task.assigneeUserId,
              blockedByTemplateTaskId: task.blockedByTemplateTaskId,
              position: task.position,
            })),
          },
          200,
        );
      } catch (caught) {
        if (caught instanceof TaskValidationError) return proposalErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // POST /api/v1/matters/{matterId}/plans/{planId}/acceptance
  app.openapi(
    { ...acceptRoute, middleware: chokepointMiddleware(chokepoint, acceptRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { matterId, planId } = c.req.valid("param");
      const request = c.req.valid("json");
      // A plan that puts work in somebody else's name needs the key that governs that, the same
      // check the ordinary create route makes. A member accepting a plan entirely for themselves
      // does not.
      const assignsOthers = request.accepted.some(
        (line) => line.assigneeUserId != null && line.assigneeUserId !== userId,
      );
      if (assignsOthers && !requireChokepointPermissions(c).has(ASSIGN as unknown as Permission)) {
        return problemJson(c, {
          type: "permission-denied",
          title: "Forbidden",
          status: 403,
          detail: "Putting a task in another member's name needs the assign permission.",
        });
      }
      const outcome = await commitPlanEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const accepted = await acceptMatterPlan(
          firm.firmDatabase,
          {
            matterId: matterId as MatterId,
            templateId: planId as MatterPlanTemplateId,
            accepted: request.accepted.map((line) => ({
              ...line,
              taskTemplateId: line.taskTemplateId as MatterPlanTaskTemplateId,
              assigneeUserId: line.assigneeUserId as UserId | null | undefined,
            })),
          },
          { ...planOptions(userId), visibility: visibleMatterPredicate() },
        );
        return { body: { taskIds: accepted.taskIds }, effect: accepted.effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body as { taskIds: string[] }, 201);
    },
  );
}

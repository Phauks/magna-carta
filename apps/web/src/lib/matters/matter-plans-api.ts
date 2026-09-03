/*
 * The matter plan's response shapes and calls. Mirrors the `matterPlans.*` operations in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 *
 * A plan is a firm's own account of the work a kind of matter takes. READING what it proposes writes
 * nothing — the proposal is a GET, and declining is simply not sending the acceptance.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";
import type { TaskPriority } from "$lib/matters/tasks-api.ts";

/** What a step's due date hangs off. Two values, and the vocabulary is deliberately almost empty. */
export const PLAN_DUE_ANCHORS = ["matter_opened", "none"] as const;
export type PlanDueAnchor = (typeof PLAN_DUE_ANCHORS)[number];

export interface PlanStep {
  id: string;
  title: string;
  body: string | null;
  priority: TaskPriority;
  /** A role matched against the matter's team when the plan is proposed. Never a member. */
  defaultAssigneeRole: string | null;
  dueAnchor: PlanDueAnchor;
  /** Plain calendar days from the anchor. Null exactly when the anchor is `none`. */
  offsetDays: number | null;
  blockedByTemplateTaskId: string | null;
  position: number;
}

export interface MatterPlan {
  id: string;
  name: string;
  description: string | null;
  /** Null offers the plan on every matter type. */
  matterTypeId: string | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Present on the single-plan read, absent on the list. */
  tasks?: PlanStep[];
}

export interface ProposedPlanTask {
  taskTemplateId: string;
  title: string;
  body: string | null;
  priority: TaskPriority;
  dueAnchor: PlanDueAnchor;
  offsetDays: number | null;
  /** What the plan WOULD set. Null where it carries no anchor, or the matter cannot date it. */
  dueOn: string | null;
  timeZone: string | null;
  /** The role named, and who it resolved to. A role that matched nobody arrives named with a null. */
  defaultAssigneeRole: string | null;
  assigneeUserId: string | null;
  blockedByTemplateTaskId: string | null;
  position: number;
}

export interface PlanProposal {
  templateId: string;
  templateName: string;
  matterId: string;
  tasks: ProposedPlanTask[];
  /** True where the matter records no opened day, so every anchored step proposes no date. */
  anchorUnavailable: boolean;
}

export interface PlanInput {
  name: string;
  description?: string | null;
  matterTypeId: string | null;
}

export interface PlanStepInput {
  title: string;
  body?: string | null;
  priority?: TaskPriority | null;
  defaultAssigneeRole?: string | null;
  dueAnchor?: PlanDueAnchor | null;
  offsetDays?: number | null;
  blockedByTemplateTaskId?: string | null;
  position?: number | null;
}

export function listPlans(
  fetchImpl: typeof fetch,
  includeInactive = false,
): Promise<ApiOutcome<{ data: MatterPlan[] }>> {
  const suffix = includeInactive ? "?includeInactive=true" : "";
  return requestJson(fetchImpl, `/api/v1/matter-plans${suffix}`);
}

export function readPlan(fetchImpl: typeof fetch, planId: string): Promise<ApiOutcome<MatterPlan>> {
  return requestJson(fetchImpl, `/api/v1/matter-plans/${encodeURIComponent(planId)}`);
}

export function createPlan(
  fetchImpl: typeof fetch,
  plan: PlanInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, "/api/v1/matter-plans", {
    method: "POST",
    body: plan,
    idempotencyKey,
  });
}

export function editPlan(
  fetchImpl: typeof fetch,
  planId: string,
  plan: PlanInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/matter-plans/${encodeURIComponent(planId)}`, {
    method: "PATCH",
    body: plan,
    idempotencyKey,
  });
}

/** Stops a plan being offered, or offers it again. Changes no matter and no task. */
export function setPlanActive(
  fetchImpl: typeof fetch,
  planId: string,
  active: boolean,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/matter-plans/${encodeURIComponent(planId)}/active`, {
    method: "PUT",
    body: { active },
    idempotencyKey,
  });
}

export function addPlanStep(
  fetchImpl: typeof fetch,
  planId: string,
  step: PlanStepInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/matter-plans/${encodeURIComponent(planId)}/steps`, {
    method: "POST",
    body: step,
    idempotencyKey,
  });
}

export function editPlanStep(
  fetchImpl: typeof fetch,
  stepId: string,
  step: PlanStepInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/matter-plan-steps/${encodeURIComponent(stepId)}`, {
    method: "PATCH",
    body: step,
    idempotencyKey,
  });
}

export function removePlanStep(
  fetchImpl: typeof fetch,
  stepId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/matter-plan-steps/${encodeURIComponent(stepId)}`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/** The plans offered on this matter. A read. */
export function plansOfferedFor(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<{ data: MatterPlan[] }>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/plans`);
}

/** What the plan would put on the matter. NOTHING IS WRITTEN by this call. */
export function proposePlan(
  fetchImpl: typeof fetch,
  matterId: string,
  planId: string,
): Promise<ApiOutcome<PlanProposal>> {
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/plans/${encodeURIComponent(planId)}/proposal`,
  );
}

export interface AcceptedPlanTask {
  taskTemplateId: string;
  title?: string;
  body?: string | null;
  priority?: TaskPriority | null;
  dueOn?: string | null;
  dueAtTime?: string | null;
  timeZone?: string | null;
  assigneeUserId?: string | null;
}

/** Puts the kept steps onto the matter, in one go. This is the write. */
export function acceptPlan(
  fetchImpl: typeof fetch,
  matterId: string,
  planId: string,
  accepted: readonly AcceptedPlanTask[],
  idempotencyKey: string,
): Promise<ApiOutcome<{ taskIds: string[] }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/plans/${encodeURIComponent(planId)}/acceptance`,
    { method: "POST", body: { accepted }, idempotencyKey },
  );
}

/** How a step's timing reads in a list, without repeating the arithmetic. */
export function describeAnchor(step: {
  dueAnchor: PlanDueAnchor;
  offsetDays: number | null;
}): string {
  if (step.dueAnchor === "none" || step.offsetDays === null) return "No date";
  if (step.offsetDays === 0) return "The day the matter opens";
  const days = Math.abs(step.offsetDays);
  const unit = days === 1 ? "day" : "days";
  return step.offsetDays > 0
    ? `${String(days)} ${unit} after the matter opens`
    : `${String(days)} ${unit} before the matter opens`;
}

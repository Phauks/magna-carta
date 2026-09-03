import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  MatterId,
  MatterPlanTaskTemplateId,
  MatterPlanTemplateId,
  MatterTaskId,
  MatterTypeId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  clearTemplateBlockedByStatement,
  countPlanTaskTemplates,
  deletePlanTaskTemplateStatement,
  insertPlanTaskTemplateStatement,
  insertPlanTemplateStatement,
  readMatterAnchor,
  readPlanTaskTemplate,
  readPlanTaskTemplates,
  readPlanTemplate,
  readPlansOfferedFor,
  resolveAssignmentRole,
  setPlanTemplateActiveStatement,
  templateChainReaches,
  updatePlanTaskTemplateStatement,
  updatePlanTemplateStatement,
  type MatterPlanTaskTemplateRow,
  type MatterPlanTemplateRow,
} from "./plan-statements.ts";
import { insertMatterTaskStatement } from "./task-statements.ts";
import {
  DEFAULT_TASK_PRIORITY,
  MAX_PLAN_TASK_TEMPLATES,
  MAX_PLAN_TEMPLATE_PAGE_SIZE,
  MAX_TEMPLATE_CHAIN_DEPTH,
  type PlanDueAnchor,
  type TaskPriority,
} from "./types.ts";
import {
  TaskValidationError,
  addCalendarDays,
  normalizePlanDescription,
  normalizePlanDue,
  normalizePlanName,
  normalizeTaskBody,
  normalizeTaskPriority,
  normalizeTaskTitle,
} from "./validation.ts";

// The matter plan: authoring a firm's own account of how a kind of matter runs, and the
// propose-and-confirm instantiation that offers it when such a matter opens.
//
// TWO THINGS THIS FILE REFUSES TO DO, and they are the whole design.
//
// It NEVER WRITES A TASK WITHOUT SOMEBODY ACCEPTING IT. `proposeMatterPlan` is a pure read that
// returns what the plan would put on the matter and commits nothing; `acceptMatterPlan` writes only
// the subset a member kept. Writing them outright was the obvious reading, and the owner narrowed it
// on 2026-09-01, because a plan's offset is plain calendar-day addition that can land a task on
// Christmas Day, a role can resolve to nobody on a matter opened before it is staffed, and
// assignment notifies — so writing silently would tell somebody they own work on a matter they have
// never heard of, chosen by a template rather than a colleague.
//
// And NOTHING RECONCILES. A task accepted from a plan carries the two handles as PROVENANCE and
// never as a live link: editing a template does not touch it, deactivating one does not touch it,
// there is no drift report and no "your plan has changed" prompt. Both would be the live link
// wearing a disguise, and a template edit that silently moved a due date on an open matter would be
// a docketing change nobody authorized and nobody saw.

export interface PlanServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
}

// ---- authoring the plan ----

export interface CreatePlanTemplateInput {
  readonly name: string;
  readonly description?: string | null;
  // Null offers the plan on every matter type. A firm whose intake steps do not vary by matter should
  // not have to author the same plan once per type.
  readonly matterTypeId: MatterTypeId | null;
}

export function createPlanTemplate(
  database: SqlDatabase,
  input: CreatePlanTemplateInput,
  options: PlanServiceOptions,
): { templateId: MatterPlanTemplateId; effect: EffectWrite } {
  const name = normalizePlanName(input.name);
  const description = normalizePlanDescription(input.description);
  const now = options.clock.now();
  const templateId = newIdentifier("matterPlanTemplate", options.randomSource);
  return {
    templateId,
    effect: {
      statements: [
        insertPlanTemplateStatement(database, {
          id: templateId,
          name,
          description,
          matterTypeId: input.matterTypeId,
          createdBy: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          event: "tasks.plan.created",
          subjectId: templateId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // A plan's name is firm configuration rather than anything about a client, so unlike a
          // task title it is not privileged — but it is still text a member typed, and the audit log
          // carries identifiers and enums. The matter type is an identifier and says which plan this
          // was without repeating what it is called.
          metadata: { matterTypeId: input.matterTypeId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export async function editPlanTemplate(
  database: SqlDatabase,
  templateId: MatterPlanTemplateId,
  input: CreatePlanTemplateInput,
  options: PlanServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const name = normalizePlanName(input.name);
  const description = normalizePlanDescription(input.description);
  await requireTemplate(database, templateId);
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        updatePlanTemplateStatement(database, {
          id: templateId,
          name,
          description,
          matterTypeId: input.matterTypeId,
          now,
        }),
        domainAuditStatement(database, {
          event: "tasks.plan.edited",
          subjectId: templateId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterTypeId: input.matterTypeId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Deactivating and reactivating. There is no delete: a plan that stops being offered still has to
// exist, because tasks accepted from it name its handle and a firm asking which matters came off the
// old intake plan needs the row to answer.
export async function setPlanTemplateActive(
  database: SqlDatabase,
  templateId: MatterPlanTemplateId,
  active: boolean,
  options: PlanServiceOptions,
): Promise<{ effect: EffectWrite }> {
  await requireTemplate(database, templateId);
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        setPlanTemplateActiveStatement(database, { id: templateId, active, now }),
        domainAuditStatement(database, {
          event: active ? "tasks.plan.reactivated" : "tasks.plan.deactivated",
          subjectId: templateId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {},
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface PlanTaskTemplateInput {
  readonly title: string;
  readonly body?: string | null;
  readonly priority?: string | null;
  // Matched against matter_assignment.assignment_role at instantiation. A template that named a
  // member would be wrong the moment that member's matters were reassigned.
  readonly defaultAssigneeRole?: string | null;
  readonly dueAnchor?: string | null;
  readonly offsetDays?: number | null;
  readonly blockedByTemplateTaskId?: MatterPlanTaskTemplateId | null;
  readonly position?: number | null;
}

export async function addPlanTaskTemplate(
  database: SqlDatabase,
  templateId: MatterPlanTemplateId,
  input: PlanTaskTemplateInput,
  options: PlanServiceOptions,
): Promise<{ taskTemplateId: MatterPlanTaskTemplateId; effect: EffectWrite }> {
  const title = normalizeTaskTitle(input.title);
  const body = normalizeTaskBody(input.body);
  const priority: TaskPriority = normalizeTaskPriority(input.priority) ?? DEFAULT_TASK_PRIORITY;
  const due = normalizePlanDue(input);
  await requireTemplate(database, templateId);
  if ((await countPlanTaskTemplates(database, templateId)) >= MAX_PLAN_TASK_TEMPLATES) {
    throw new TaskValidationError(
      "plan-too-many-task-templates",
      `a plan proposes at most ${String(MAX_PLAN_TASK_TEMPLATES)} tasks; a longer one is a document rather than a checklist`,
    );
  }
  const blockedBy = input.blockedByTemplateTaskId ?? null;
  if (blockedBy !== null) await assertTemplatePredecessor(database, blockedBy, templateId, null);

  const now = options.clock.now();
  const taskTemplateId = newIdentifier("matterPlanTaskTemplate", options.randomSource);
  return {
    taskTemplateId,
    effect: {
      statements: [
        insertPlanTaskTemplateStatement(database, {
          id: taskTemplateId,
          templateId,
          title,
          body,
          priority,
          defaultAssigneeRole: normalizeRole(input.defaultAssigneeRole),
          dueAnchor: due.anchor,
          offsetDays: due.offsetDays,
          blockedByTemplateTaskId: blockedBy,
          position: input.position ?? 0,
          now,
        }),
        domainAuditStatement(database, {
          event: "tasks.plan.taskAdded",
          subjectId: templateId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            taskTemplateId,
            priority,
            dueAnchor: due.anchor,
            offsetDays: due.offsetDays,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export async function editPlanTaskTemplate(
  database: SqlDatabase,
  taskTemplateId: MatterPlanTaskTemplateId,
  input: PlanTaskTemplateInput,
  options: PlanServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const title = normalizeTaskTitle(input.title);
  const body = normalizeTaskBody(input.body);
  const due = normalizePlanDue(input);
  const existing = await readPlanTaskTemplate(database, taskTemplateId);
  if (existing === undefined) {
    throw new TaskValidationError(
      "plan-unknown-task-template",
      "that step is not part of a plan in this firm",
    );
  }
  const priority: TaskPriority = normalizeTaskPriority(input.priority) ?? existing.priority;
  const blockedBy = input.blockedByTemplateTaskId ?? null;
  if (blockedBy !== null && blockedBy !== existing.blocked_by_template_task_id) {
    await assertTemplatePredecessor(database, blockedBy, existing.template_id, taskTemplateId);
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        updatePlanTaskTemplateStatement(database, {
          id: taskTemplateId,
          title,
          body,
          priority,
          defaultAssigneeRole: normalizeRole(input.defaultAssigneeRole),
          dueAnchor: due.anchor,
          offsetDays: due.offsetDays,
          blockedByTemplateTaskId: blockedBy,
          position: input.position ?? existing.position,
          now,
        }),
        domainAuditStatement(database, {
          event: "tasks.plan.taskEdited",
          subjectId: existing.template_id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            taskTemplateId,
            priority,
            dueAnchor: due.anchor,
            offsetDays: due.offsetDays,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Removing a step. A real delete, unlike deactivating the plan: a step is a line in a document the
// firm is still writing, and tasks already accepted from it hold their own copy of what it said.
export async function removePlanTaskTemplate(
  database: SqlDatabase,
  taskTemplateId: MatterPlanTaskTemplateId,
  options: PlanServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readPlanTaskTemplate(database, taskTemplateId);
  if (existing === undefined) {
    throw new TaskValidationError(
      "plan-unknown-task-template",
      "that step is not part of a plan in this firm",
    );
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        // Whatever waited on it stops waiting, first: nothing in SQLite enforces the self-reference,
        // so a pointer left behind would name a step that no longer exists.
        clearTemplateBlockedByStatement(database, { taskTemplateId, now }),
        deletePlanTaskTemplateStatement(database, taskTemplateId),
        domainAuditStatement(database, {
          event: "tasks.plan.taskRemoved",
          subjectId: existing.template_id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { taskTemplateId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// ---- proposing ----

// One task a plan would put on the matter, as the person reviewing it sees it. Nothing here has been
// written; every field is what WOULD be written if this line is kept.
export interface ProposedTask {
  readonly taskTemplateId: MatterPlanTaskTemplateId;
  readonly title: string;
  readonly body: string | null;
  readonly priority: TaskPriority;
  readonly dueAnchor: PlanDueAnchor;
  readonly offsetDays: number | null;
  // The rendered civil date, or null where the anchor is `none` OR where the matter cannot answer the
  // anchor — a matter with no opened date proposes no date rather than a date computed from today,
  // which would be the platform inventing a deadline out of an absence.
  readonly dueOn: string | null;
  readonly timeZone: string | null;
  // The role the template names, and who it resolved to. A role that resolved to nobody arrives as a
  // named role with a null member, so the reviewer sees WHICH role could not be filled rather than an
  // unexplained blank.
  readonly defaultAssigneeRole: string | null;
  readonly assigneeUserId: UserId | null;
  readonly blockedByTemplateTaskId: MatterPlanTaskTemplateId | null;
  readonly position: number;
}

export interface PlanProposal {
  readonly templateId: MatterPlanTemplateId;
  readonly templateName: string;
  readonly matterId: MatterId;
  readonly tasks: readonly ProposedTask[];
  // True where the matter records no opened date, so every `matter_opened` step proposes no date.
  // Surfaced rather than silently absorbed: a reviewer seeing eleven undated steps should know why.
  readonly anchorUnavailable: boolean;
}

// WHICH PLANS a matter is offered. A read and nothing more.
export async function plansOfferedForMatter(
  database: SqlDatabase,
  matterId: MatterId,
  visibility: VisibleMatterPredicate,
): Promise<readonly MatterPlanTemplateRow[]> {
  const matter = await requireVisibleMatter(database, matterId, visibility);
  return readPlansOfferedFor(database, matter.matter_type_id, MAX_PLAN_TEMPLATE_PAGE_SIZE);
}

// WHAT THE PLAN WOULD PUT ON THE MATTER. Pure: it reads, it computes, and it writes nothing. A
// proposal that is never accepted leaves the database exactly as it found it.
export async function proposeMatterPlan(
  database: SqlDatabase,
  matterId: MatterId,
  templateId: MatterPlanTemplateId,
  options: { readonly clock: { now(): string }; readonly visibility: VisibleMatterPredicate },
): Promise<PlanProposal> {
  const matter = await requireVisibleMatter(database, matterId, options.visibility);
  const template = await requireTemplate(database, templateId);
  if (template.active !== 1) {
    throw new TaskValidationError("plan-inactive", "that plan is no longer offered");
  }
  const steps = await readPlanTaskTemplates(database, templateId);
  const now = options.clock.now();
  // The office's zone, or the platform's where the office records none — the same fallback
  // packages/document-assembly/src/resolve.ts makes, so a plan and a document agree about the day.
  const timeZone =
    matter.time_zone === null || matter.time_zone.length === 0 ? "UTC" : matter.time_zone;
  const anchorDate = matter.opened_on;

  const tasks: ProposedTask[] = [];
  for (const step of steps) {
    const dueOn = renderProposedDate(step, anchorDate);
    tasks.push({
      taskTemplateId: step.id,
      title: step.title,
      body: step.body,
      priority: step.priority,
      dueAnchor: step.due_anchor,
      offsetDays: step.offset_days,
      dueOn,
      // A task with a date needs a zone and a task without one must not carry it — the same shape
      // rule the task record holds, applied to the proposal so an accepted line is already valid.
      timeZone: dueOn === null ? null : timeZone,
      defaultAssigneeRole: step.default_assignee_role,
      assigneeUserId:
        step.default_assignee_role === null
          ? null
          : await resolveAssignmentRole(database, matterId, step.default_assignee_role, now),
      blockedByTemplateTaskId: step.blocked_by_template_task_id,
      position: step.position,
    });
  }

  return {
    templateId,
    templateName: template.name,
    matterId,
    tasks,
    anchorUnavailable:
      anchorDate === null && steps.some((step) => step.due_anchor === "matter_opened"),
  };
}

// The one call that adds days to a date, and it goes through the single named exception in
// validation.ts rather than doing the arithmetic here.
function renderProposedDate(
  step: MatterPlanTaskTemplateRow,
  anchorDate: string | null,
): string | null {
  if (step.due_anchor === "none" || step.offset_days === null) return null;
  // A matter that records no opened date cannot answer this anchor. No date is proposed — never
  // today's, which would invent a schedule out of a missing fact.
  if (anchorDate === null) return null;
  return addCalendarDays(anchorDate, step.offset_days);
}

// ---- accepting ----

// One line the reviewer kept, as they left it. Every field is optional and overrides what the
// proposal offered, because the review's whole purpose is that a person can fix a date the template
// could not know was a Sunday and fill a role that resolved to nobody.
export interface AcceptedTask {
  readonly taskTemplateId: MatterPlanTaskTemplateId;
  readonly title?: string;
  readonly body?: string | null;
  readonly priority?: string | null;
  readonly dueOn?: string | null;
  readonly dueAtTime?: string | null;
  readonly timeZone?: string | null;
  readonly assigneeUserId?: UserId | null;
}

// ACCEPTANCE IS THE WRITE. Everything before this point committed nothing.
//
// The accepted lines are written in ONE batch, so a plan lands entirely or not at all — a matter
// carrying six of eleven steps because a batch failed halfway is worse than one carrying none.
export async function acceptMatterPlan(
  database: SqlDatabase,
  input: {
    readonly matterId: MatterId;
    readonly templateId: MatterPlanTemplateId;
    readonly accepted: readonly AcceptedTask[];
  },
  options: PlanServiceOptions & { readonly visibility: VisibleMatterPredicate },
): Promise<{ taskIds: readonly MatterTaskId[]; effect: EffectWrite }> {
  if (input.accepted.length === 0) {
    throw new TaskValidationError(
      "plan-nothing-accepted",
      "no step was kept, so there is nothing to add. Declining a plan writes nothing and needs no request",
    );
  }
  const proposal = await proposeMatterPlan(database, input.matterId, input.templateId, {
    clock: options.clock,
    visibility: options.visibility,
  });
  const offered = new Map(proposal.tasks.map((task) => [task.taskTemplateId, task]));

  const now = options.clock.now();
  const statements: SqlStatement[] = [];
  const taskIds: MatterTaskId[] = [];
  // The handle a template step maps to, so a kept step that waited on another kept step still waits
  // on it — resolved against the ids minted in THIS batch rather than looked up afterwards. Every id
  // is minted before any statement is composed, because a predecessor may appear after its successor
  // in the accepted list and the second pass needs both handles to exist.
  const mintedFor = new Map<MatterPlanTaskTemplateId, MatterTaskId>();
  for (const line of input.accepted) {
    if (!offered.has(line.taskTemplateId)) {
      throw new TaskValidationError(
        "plan-task-template-mismatch",
        "that step is not one this plan proposes for this matter",
      );
    }
    mintedFor.set(line.taskTemplateId, newIdentifier("matterTask", options.randomSource));
  }

  for (const line of input.accepted) {
    const proposed = offered.get(line.taskTemplateId);
    const taskId = mintedFor.get(line.taskTemplateId);
    if (proposed === undefined || taskId === undefined) continue;
    taskIds.push(taskId);
    const dueOn = line.dueOn === undefined ? proposed.dueOn : line.dueOn;
    const dueAtTime = line.dueAtTime ?? null;
    const timeZone = dueOn === null ? null : (line.timeZone ?? proposed.timeZone ?? "UTC");
    const predecessor = proposed.blockedByTemplateTaskId;
    statements.push(
      insertMatterTaskStatement(database, {
        id: taskId,
        matterId: input.matterId,
        title: normalizeTaskTitle(line.title ?? proposed.title),
        body: normalizeTaskBody(line.body === undefined ? proposed.body : line.body),
        assigneeUserId:
          line.assigneeUserId === undefined ? proposed.assigneeUserId : line.assigneeUserId,
        createdBy: options.actorUserId,
        priority: normalizeTaskPriority(line.priority) ?? proposed.priority,
        due: { dueOn, dueAtTime, timeZone },
        // A step that waited on a step the reviewer DROPPED waits on nothing rather than on a task
        // that was never created. Dropping a predecessor is a decision the reviewer made.
        blockedByTaskId: predecessor === null ? null : (mintedFor.get(predecessor) ?? null),
        triggerEventId: null,
        deadlineId: null,
        // The provenance, and the only thing that ever names the template from a task row.
        planTemplateId: input.templateId,
        planTaskTemplateId: line.taskTemplateId,
        now,
      }),
    );
  }

  statements.push(
    domainAuditStatement(database, {
      event: "tasks.plan.accepted",
      subjectId: input.templateId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      // How much of the plan was kept, which is the fact a firm reviewing its own plans wants: a plan
      // whose steps are routinely dropped is a plan that needs editing.
      metadata: {
        matterId: input.matterId,
        acceptedCount: input.accepted.length,
        offeredCount: proposal.tasks.length,
      },
    }),
  );

  return { taskIds, effect: { statements, outboxMessages: [] } };
}

// ---- shared preconditions ----

async function requireTemplate(
  database: SqlDatabase,
  templateId: MatterPlanTemplateId,
): Promise<MatterPlanTemplateRow> {
  const template = await readPlanTemplate(database, templateId);
  if (template === undefined) {
    throw new TaskValidationError("plan-unknown", "that plan is not a plan in this firm");
  }
  return template;
}

async function requireVisibleMatter(
  database: SqlDatabase,
  matterId: MatterId,
  visibility: VisibleMatterPredicate,
) {
  const matter = await readMatterAnchor(database, matterId);
  if (matter === undefined) {
    throw new TaskValidationError("task-unknown", "that matter is not a matter in this firm");
  }
  // The predicate is composed over a bound parameter rather than a column, which is what lets one
  // matter be tested without a correlated reference the fragment's own subquery would shadow.
  const { results } = await database
    .prepare(`SELECT 1 AS present WHERE ${visibility.fragmentFor("?")}`)
    .bind(matterId, ...visibility.bindings)
    .all<{ present: number }>();
  if (results.length === 0) {
    throw new TaskValidationError("task-unknown", "that matter is not a matter in this firm");
  }
  return matter;
}

// A predecessor within the SAME plan, with no cycle. Refused at authoring time, where the graph is
// small and static, rather than at instantiation where a firm would meet the refusal with a matter
// half open in front of them.
async function assertTemplatePredecessor(
  database: SqlDatabase,
  predecessorId: MatterPlanTaskTemplateId,
  templateId: MatterPlanTemplateId,
  taskTemplateId: MatterPlanTaskTemplateId | null,
): Promise<void> {
  const predecessor = await readPlanTaskTemplate(database, predecessorId);
  if (predecessor === undefined || predecessor.template_id !== templateId) {
    throw new TaskValidationError(
      "plan-unknown-task-template",
      "a step waits only on another step in the same plan",
    );
  }
  if (taskTemplateId !== null) {
    if (predecessorId === taskTemplateId) {
      throw new TaskValidationError("plan-blocking-cycle", "a step cannot wait on itself");
    }
    if (
      await templateChainReaches(database, predecessorId, taskTemplateId, MAX_TEMPLATE_CHAIN_DEPTH)
    ) {
      throw new TaskValidationError(
        "plan-blocking-cycle",
        "that would make a loop: this step is already somewhere behind the one you named",
      );
    }
  }
}

// A role as it will be stored: trimmed, and absent where empty. An empty-string role would resolve
// against nothing forever while looking like a configured one.
function normalizeRole(role: string | null | undefined): string | null {
  if (role === null || role === undefined) return null;
  const normalized = role.trim();
  return normalized.length === 0 ? null : normalized;
}

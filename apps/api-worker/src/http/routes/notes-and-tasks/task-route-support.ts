import { z } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { TaskDetail } from "@magna-carta/tasks/contract";
import {
  readTaskAssignees,
  readTaskChecklistItems,
  readTaskLinks,
  readTaskWatchers,
  type MatterTaskAssigneeRow,
  type MatterTaskChecklistItemRow,
  type MatterTaskLinkRow,
  type MatterTaskWatcherRow,
} from "@magna-carta/tasks/organisation-statements";
import {
  readMatterTaskDocuments,
  type MatterTaskDocumentRow,
  type MatterTaskRow,
} from "@magna-carta/tasks/task-statements";
import {
  readExternalLinksForTasks,
  type MatterTaskExternalLinkRow,
} from "@magna-carta/tasks/sync-statements";
import { rungOf } from "@magna-carta/tasks/types";
import { TaskValidationError } from "@magna-carta/tasks/validation";
import { readTaskTimeSummaries, NO_TIME_LOGGED } from "@magna-carta/timekeeping/task-time";
import type { Context } from "hono";
import type { Permission } from "@magna-carta/access-control/registry";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointPermissions,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { identifierPathParam } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import type { RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { taskErrorResponse } from "../shared/task-error-response.ts";

// What every task route module shares: the permissions, the route metas, the error mapping, the
// idempotent write, and how a task row becomes the task the wire carries. One home, so the task
// routes, the list and team routes and the routes for a task's own parts cannot drift apart on any
// of it.

export const READ = "tasks:read" as const;
// Not this route file's own permission — the task routes are gated on the three above. This one is
// read in the time handler to decide WHOSE time the summary counts, which is the same line My Day
// draws: with it, the task's whole time; without it, the reader's own and nobody else's.
const VIEW_FIRM_TIME = "time:viewFirm" as const;
export const WRITE = "tasks:write" as const;
export const ASSIGN = "tasks:assign" as const;
// Shaping how the firm organises its task work — its lists, their statuses and flow, its teams — is
// the same authority as authoring the firm's matter plans: it changes every member's screen at once.
export const MANAGE_TASK_ORGANISATION = "tasks:managePlans" as const;

export const CreatedResponse = z.object({ id: z.string() }).openapi("CreatedMatterTask");
export const AcknowledgedResponse = z
  .object({ ok: z.literal(true) })
  .openapi("MatterTaskAcknowledged");

export const taskIdParam = z.object({ taskId: identifierPathParam("matterTask", "taskId") });

export const authErrors = {
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
    description: "The firm is unreachable, the member is deactivated, or the task is unknown",
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

// ---- error mapping ----

export { taskErrorResponse };

// ---- route metas ----

// Every task route binds resource: "firm" rather than "matter", including the matter-scoped list.
// A task's matter is nullable, so a matter cannot be the tenancy root of a record that need not have
// one — the firm is. What the matter-scoped list narrows by is a filter, and the visible-matter
// predicate still decides what it may return.
export function readMeta(action: string): RouteMeta {
  return {
    operationId: `tasks.${action}`,
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

export function writeMeta(
  action: string,
  permission: typeof WRITE | typeof ASSIGN | typeof MANAGE_TASK_ORGANISATION = WRITE,
): RouteMeta {
  return {
    operationId: `tasks.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: true,
    // Required. A retried create must not put a second copy of the same task on somebody's list,
    // and a duplicate task is worse than a duplicate read: two identical obligations, one of which
    // somebody will complete and the other of which will sit there looking undone.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

export function serviceOptions(userId: UserId) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId,
    randomSource: cryptoRandomSource,
    visibility: visibleMatterPredicate(),
  };
}

interface TaskParts {
  readonly documents: readonly MatterTaskDocumentRow[];
  readonly externalLinks: readonly MatterTaskExternalLinkRow[];
  readonly assignees: readonly MatterTaskAssigneeRow[];
  readonly watchers: readonly MatterTaskWatcherRow[];
  readonly checklist: readonly MatterTaskChecklistItemRow[];
  readonly links: readonly MatterTaskLinkRow[];
}

function taskDetail(
  row: MatterTaskRow,
  parts: TaskParts,
  timeLogged: z.infer<typeof TaskDetail>["timeLogged"],
): z.infer<typeof TaskDetail> {
  const { documents, externalLinks } = parts;
  return {
    id: row.id,
    matterId: row.matter_id,
    title: row.title,
    body: row.body,
    assigneeUserId: row.assignee_user_id,
    createdBy: row.created_by,
    priority: row.priority,
    dueOn: row.due_on,
    dueAtTime: row.due_at_time,
    timeZone: row.time_zone,
    rung: rungOf({ state: row.state, progress: row.progress }),
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
    archiveReason: row.archive_reason,
    blockedByTaskId: row.blocked_by_task_id,
    triggerEventId: row.trigger_event_id,
    deadlineId: row.deadline_id,
    listId: row.list_id,
    statusId: row.status_id,
    parentTaskId: row.parent_task_id,
    startsOn: row.starts_on,
    location: row.location,
    assignees: parts.assignees
      .filter((assignee) => assignee.task_id === row.id)
      .map((assignee) => ({ id: assignee.id, userId: assignee.user_id, teamId: assignee.team_id })),
    watcherUserIds: parts.watchers
      .filter((watcher) => watcher.task_id === row.id)
      .map((watcher) => watcher.user_id),
    checklist: parts.checklist
      .filter((item) => item.task_id === row.id)
      .map((item) => ({
        id: item.id,
        text: item.text,
        doneAt: item.done_at,
        doneBy: item.done_by,
      })),
    links: parts.links
      .filter((link) => link.task_id === row.id)
      .map((link) => ({ id: link.id, url: link.url, label: link.label })),
    documents: documents
      .filter((document) => document.task_id === row.id)
      .map((document) => ({
        id: document.id,
        fileId: document.file_id,
        fileName: document.file_name,
        contentType: document.content_type,
        linkedAt: document.linked_at,
        linkedBy: document.linked_by,
      })),
    externalLinks: externalLinks
      .filter((link) => link.task_id === row.id)
      .map((link) => ({
        id: link.id,
        system: link.system,
        externalId: link.external_id,
        externalUrl: link.external_url,
        remoteRevision: link.remote_revision,
        lastSyncedAt: link.last_synced_at,
      })),
    timeLogged,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

// Whether this reader may see other timekeepers' time. Not one of this file's own permissions — the
// task routes ride the three above — and it gates nothing: it decides WHOSE time the page counts,
// so a member without it gets their own entries rather than an error or a blank.
export function seesFirmTime(c: Context): boolean {
  return requireChokepointPermissions(c).has(VIEW_FIRM_TIME as unknown as Permission);
}

// Tasks as the wire carries them, with everything each one holds read in one bounded query per kind
// keyed by the tasks in hand — never one read per task.
export async function projectTasks(
  database: SqlDatabase,
  rows: readonly MatterTaskRow[],
  viewerUserId: UserId,
  seesFirmTime: boolean,
): Promise<z.infer<typeof TaskDetail>[]> {
  const taskIds = rows.map((row) => row.id);
  const documents = await readMatterTaskDocuments(
    database,
    taskIds,
    visibleMatterPredicate(),
    viewerUserId,
  );
  // Whose time it counts is the reader's `time:viewFirm` answer, which is the line My Day already
  // draws: with it, what the task cost the firm; without it, what this member put into it and
  // nobody else's.
  const timeByTask = await readTaskTimeSummaries(database, {
    taskIds,
    onlyTimekeeperUserId: seesFirmTime ? null : viewerUserId,
  });
  // Empty for every firm that has connected nothing, which is every firm the platform ships to —
  // an IN over an indexed column against no rows costs nothing.
  const externalLinks = await readExternalLinksForTasks(database, taskIds);
  const parts: TaskParts = {
    documents,
    externalLinks,
    assignees: await readTaskAssignees(database, taskIds),
    watchers: await readTaskWatchers(database, taskIds),
    checklist: await readTaskChecklistItems(database, taskIds),
    links: await readTaskLinks(database, taskIds),
  };
  const scope = seesFirmTime ? ("firm" as const) : ("own" as const);
  return rows.map((row) =>
    taskDetail(row, parts, { ...(timeByTask.get(row.id) ?? NO_TIME_LOGGED), scope }),
  );
}

export type TaskEffectOutcome =
  | { ok: true; id: string; replayed: boolean }
  | { ok: false; problem: ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> };

export async function commitTaskEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  responseCode: number,
  call: () => Promise<{ id: string; effect: EffectWrite }>,
): Promise<TaskEffectOutcome> {
  const now = () => new Date().toISOString();
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => {
        const { id, effect } = await call();
        return {
          write: effect,
          responseCode,
          // The stored body IS the wire body: the idempotency gate replays it verbatim.
          responseBody: canonicalJsonStringify({ id }),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof TaskValidationError) {
      return { ok: false, problem: taskErrorResponse(c, caught) };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  const stored = JSON.parse(result.responseBody ?? "{}") as { id: string };
  return { ok: true, id: stored.id, replayed: result.kind === "replayed" };
}

// The response sets a write route declares: a write that answers "done", and one that answers with
// the id of what it made.
export const acknowledgedResponses = {
  200: { description: "Done", content: { "application/json": { schema: AcknowledgedResponse } } },
  ...authErrors,
} as const;

export const createdResponses = {
  201: {
    description: "The new record's id",
    content: { "application/json": { schema: CreatedResponse } },
  },
  ...authErrors,
} as const;

type Write = (
  database: BatchDatabase,
  options: ReturnType<typeof serviceOptions>,
) => Promise<{ readonly effect: EffectWrite }>;

type Creation = (
  database: BatchDatabase,
  options: ReturnType<typeof serviceOptions>,
) => Promise<{ readonly id: string; readonly effect: EffectWrite }>;

// One idempotent write answering { ok: true }, for the routes whose whole job is a single service
// call. The handler reads its own parameters and body, which stay typed by its route.
export async function acknowledgeWrite(c: Context, write: Write) {
  const firm = requireChokepointFirmContext(c);
  const options = serviceOptions(requireChokepointUserId(c));
  const outcome = await commitTaskEffect(
    c,
    firm.firmDatabase,
    requireChokepointIdempotency(c),
    200,
    async () => ({ id: "", effect: (await write(firm.firmDatabase, options)).effect }),
  );
  if (!outcome.ok) return outcome.problem;
  if (outcome.replayed) c.header("Idempotency-Replayed", "true");
  return c.json({ ok: true } as const, 200);
}

// One idempotent write answering with the id of what it made.
export async function createWrite(c: Context, create: Creation) {
  const firm = requireChokepointFirmContext(c);
  const options = serviceOptions(requireChokepointUserId(c));
  const outcome = await commitTaskEffect(
    c,
    firm.firmDatabase,
    requireChokepointIdempotency(c),
    201,
    () => create(firm.firmDatabase, options),
  );
  if (!outcome.ok) return outcome.problem;
  if (outcome.replayed) c.header("Idempotency-Replayed", "true");
  return c.json({ id: outcome.id }, 201);
}

export function hasPermission(c: Context, permission: string): boolean {
  return requireChokepointPermissions(c).has(permission as unknown as Permission);
}

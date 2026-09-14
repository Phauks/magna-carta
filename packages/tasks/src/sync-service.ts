import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  MatterTaskExternalLinkId,
  MatterTaskId,
  UserId,
} from "@magna-carta/identifiers/types";
import { readMatterTask } from "./task-statements.ts";
import {
  deleteExternalLinkStatement,
  insertExternalLinkStatement,
  readExternalLink,
  readExternalLinksForTask,
  readTaskIdForExternalId,
  updateExternalLinkStatement,
  type MatterTaskExternalLinkRow,
} from "./sync-statements.ts";
import type { TaskServiceOptions } from "./task-service.ts";
import { TaskValidationError } from "./validation.ts";

// WHAT AN ADDON WRITES THROUGH, and it is deliberately small.
//
// The platform integrates with nothing. It does not know what ClickUp is, it schedules no sync, it
// resolves no conflict and it maps no vocabulary — every one of those is a decision about somebody
// else's product and belongs to the adapter that knows it. What lives here is the part the platform
// cannot delegate: remembering that a task IS some object elsewhere, and doing so under rules that
// survive two syncs racing.
//
// Everything below composes statements for the caller to commit, like every other service in this
// package. A link write rides the same batch discipline as a task write, so a sync that half-failed
// leaves no half-link.

// The length cap is a sanity bound rather than a schema fact. A remote handle is opaque here and a
// firm may connect a system whose ids are long, so the ceiling is generous — what it stops is a
// caller putting a document in the column.
export const MAX_EXTERNAL_SYSTEM_LENGTH = 64;
export const MAX_EXTERNAL_ID_LENGTH = 512;
export const MAX_EXTERNAL_URL_LENGTH = 2048;
export const MAX_REMOTE_REVISION_LENGTH = 512;

function normalizeSystem(raw: string): string {
  // Lower-cased and trimmed, because "ClickUp" and "clickup" are the same system and the uniqueness
  // rules are indexes that would not know it. Normalizing here means the rule holds however the
  // caller spells it.
  const system = raw.trim().toLowerCase();
  if (system.length === 0) {
    throw new TaskValidationError("external-system-required", "an external link names a system");
  }
  if (system.length > MAX_EXTERNAL_SYSTEM_LENGTH) {
    throw new TaskValidationError(
      "external-system-too-long",
      `a system name is at most ${String(MAX_EXTERNAL_SYSTEM_LENGTH)} characters`,
    );
  }
  return system;
}

function normalizeExternalId(raw: string): string {
  // Trimmed and otherwise UNTOUCHED. It is the remote's own key: this platform never parses it,
  // never orders by it, and never assumes a shape, so lower-casing it would be the platform
  // deciding that somebody else's identifiers are case-insensitive.
  const externalId = raw.trim();
  if (externalId.length === 0) {
    throw new TaskValidationError(
      "external-id-required",
      "an external link names the object it points at",
    );
  }
  if (externalId.length > MAX_EXTERNAL_ID_LENGTH) {
    throw new TaskValidationError(
      "external-id-too-long",
      `an external id is at most ${String(MAX_EXTERNAL_ID_LENGTH)} characters`,
    );
  }
  return externalId;
}

function normalizeOptional(
  raw: string | null | undefined,
  cap: number,
  code: "external-url-too-long" | "remote-revision-too-long",
  what: string,
): string | null {
  if (raw === undefined || raw === null) return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  if (value.length > cap) {
    throw new TaskValidationError(code, `${what} is at most ${String(cap)} characters`);
  }
  return value;
}

export interface LinkTaskToExternalSystemInput {
  readonly taskId: MatterTaskId;
  readonly system: string;
  readonly externalId: string;
  readonly externalUrl?: string | null;
  readonly remoteRevision?: string | null;
  readonly lastSyncedAt?: string | null;
}

// Record that this task IS that object over there.
//
// The two uniqueness rules are held by indexes, so this pre-check is a courtesy that turns the
// common case into a readable refusal rather than an aborted batch — it is NOT the enforcement, and
// it must not be mistaken for it. Two syncs racing both pass this read and one of them loses at the
// index, which is the outcome that keeps a remote object from mapping to two tasks.
export async function linkTaskToExternalSystem(
  database: SqlDatabase,
  input: LinkTaskToExternalSystemInput,
  options: TaskServiceOptions,
): Promise<{ linkId: MatterTaskExternalLinkId; effect: EffectWrite }> {
  const task = await readMatterTask(
    database,
    input.taskId,
    options.visibility,
    options.actorUserId,
  );
  if (task === undefined) {
    throw new TaskValidationError("task-unknown", `no such task: ${input.taskId}`);
  }
  const system = normalizeSystem(input.system);
  const externalId = normalizeExternalId(input.externalId);

  const claimed = await readTaskIdForExternalId(database, system, externalId);
  if (claimed !== undefined) {
    throw new TaskValidationError(
      "external-object-already-linked",
      `${system} object ${externalId} is already linked to task ${claimed.task_id}`,
    );
  }
  const existing = await readExternalLinksForTask(database, input.taskId);
  if (existing.some((link) => link.system === system)) {
    throw new TaskValidationError(
      "task-already-linked",
      `this task already has a ${system} identity`,
    );
  }

  const now = options.clock.now();
  const linkId = newIdentifier("matterTaskExternalLink", options.randomSource);
  return {
    linkId,
    effect: {
      statements: [
        insertExternalLinkStatement(database, {
          id: linkId,
          taskId: input.taskId,
          system,
          externalId,
          externalUrl: normalizeOptional(
            input.externalUrl,
            MAX_EXTERNAL_URL_LENGTH,
            "external-url-too-long",
            "an external URL",
          ),
          remoteRevision: normalizeOptional(
            input.remoteRevision,
            MAX_REMOTE_REVISION_LENGTH,
            "remote-revision-too-long",
            "a remote revision",
          ),
          lastSyncedAt: input.lastSyncedAt ?? null,
          createdBy: options.actorUserId,
          now,
        }),
        // The audit row carries the system and the remote id, which are identifiers rather than
        // words — the same rule every other audit row in this package follows.
        domainAuditStatement(database, {
          event: "tasks.externalLink.created",
          subjectId: linkId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { taskId: input.taskId, system, externalId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// What an addon writes after a round trip: where it lives now, what the remote looked like when the
// two sides agreed, and when they agreed. The IDENTITY is immutable — a link that could be
// repointed at a different remote object would quietly hand one task's history to another, and the
// honest way to change what a task mirrors is to unlink and link again, which leaves both acts in
// the audit trail.
export async function recordExternalSync(
  database: SqlDatabase,
  linkId: MatterTaskExternalLinkId,
  input: {
    readonly externalUrl?: string | null;
    readonly remoteRevision?: string | null;
    readonly syncedAt?: string | null;
  },
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const link = await requireVisibleLink(database, linkId, options);
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        updateExternalLinkStatement(database, {
          id: linkId,
          externalUrl:
            input.externalUrl === undefined
              ? link.external_url
              : normalizeOptional(
                  input.externalUrl,
                  MAX_EXTERNAL_URL_LENGTH,
                  "external-url-too-long",
                  "an external URL",
                ),
          remoteRevision:
            input.remoteRevision === undefined
              ? link.remote_revision
              : normalizeOptional(
                  input.remoteRevision,
                  MAX_REMOTE_REVISION_LENGTH,
                  "remote-revision-too-long",
                  "a remote revision",
                ),
          // A sync with no instant of its own is stamped now: the field answers "when did the two
          // sides last agree", and the answer is this moment.
          lastSyncedAt: input.syncedAt ?? now,
          now,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Stop mirroring. The TASK is untouched — unlinking is a statement about the correspondence and
// never about the work, so nothing here completes, archives or deletes anything.
export async function unlinkTaskFromExternalSystem(
  database: SqlDatabase,
  linkId: MatterTaskExternalLinkId,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const link = await requireVisibleLink(database, linkId, options);
  return {
    effect: {
      statements: [
        deleteExternalLinkStatement(database, linkId),
        domainAuditStatement(database, {
          event: "tasks.externalLink.removed",
          subjectId: linkId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            taskId: link.task_id,
            system: link.system,
            externalId: link.external_id,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// A link is reachable exactly when its task is. The link table carries no visibility of its own and
// must not grow one: two answers to "may this member see this task" is the failure the one shared
// fragment exists to prevent.
async function requireVisibleLink(
  database: SqlDatabase,
  linkId: MatterTaskExternalLinkId,
  options: TaskServiceOptions,
): Promise<MatterTaskExternalLinkRow> {
  const link = await readExternalLink(database, linkId);
  if (link === undefined) {
    throw new TaskValidationError("external-link-not-found", `no such external link: ${linkId}`);
  }
  const task = await readMatterTask(
    database,
    link.task_id,
    options.visibility,
    options.actorUserId,
  );
  if (task === undefined) {
    throw new TaskValidationError("external-link-not-found", `no such external link: ${linkId}`);
  }
  return link;
}

// The lookup an addon makes before it creates anything: "do I already know this remote object?"
// Returns the task it corresponds to, or undefined. Visibility applies — a principal that cannot see
// the task is told nothing about it, including that the correspondence exists.
export async function findTaskByExternalId(
  database: SqlDatabase,
  system: string,
  externalId: string,
  options: { readonly visibility: TaskServiceOptions["visibility"]; readonly viewerUserId: UserId },
): Promise<{ taskId: MatterTaskId; link: MatterTaskExternalLinkRow } | undefined> {
  const link = await readTaskIdForExternalId(
    database,
    normalizeSystem(system),
    normalizeExternalId(externalId),
  );
  if (link === undefined) return undefined;
  const task = await readMatterTask(
    database,
    link.task_id,
    options.visibility,
    options.viewerUserId,
  );
  if (task === undefined) return undefined;
  return { taskId: link.task_id, link };
}

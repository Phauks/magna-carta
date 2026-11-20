import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import {
  guarded,
  type EffectStatement,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  DirectoryPersonId,
  FileVersionId,
  MatterId,
  ShareId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  insertShareStatement,
  readActiveShare,
  readActiveShareFor,
  revokeShareStatement,
  updateShareStatement,
} from "./share-statements.ts";
import {
  SHARE_ROLES,
  SHARE_SIGN_INS,
  type ShareRole,
  type ShareSignIn,
  type ShareTarget,
} from "./types.ts";

// The staff side's writes: share, change, stop. Each returns an effect the route commits in one
// batch with its audit rows. Nothing here reads a clock or holds a binding; the route hands in the
// clock, the acting member, and the visible-matter predicate.
//
// Whether the acting member may share at all (files:share) is the chokepoint's question, answered
// before any of this runs. What is checked here is that the things and the people are what they
// claim to be: every item is on the named matter and live, and every person is a live Directory
// person who is not a member of the firm.

export class ShareValidationError extends Error {
  constructor(
    readonly code:
      | "matter-unknown"
      | "item-unknown"
      | "version-unknown"
      | "person-unknown"
      | "person-is-member"
      | "nothing-to-share"
      | "too-many"
      | "role-unknown"
      | "sign-in-unknown"
      | "ends-on-invalid"
      | "share-unknown",
    message: string,
  ) {
    super(message);
    this.name = "ShareValidationError";
  }
}

// One write may share at most this many items with this many people. A screen shares a selection,
// and a selection of hundreds is a folder that should be shared as a folder.
export const MAXIMUM_SHARES_PER_WRITE = 500;

/*
 * The most live shares one matter may hold. The staff list reads a matter's shares whole, because
 * every row mark, the Shared With column and the Sharing view are derived from the one list, so the
 * list has to have an end. Two thousand is far past any real matter (a folder share already covers
 * every file inside it); a firm that reaches it shares folders instead of files.
 */
export const MAXIMUM_ACTIVE_SHARES_PER_MATTER = 2000;

export interface ShareServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
  readonly visibility: VisibleMatterPredicate;
}

export interface ShareSettings {
  readonly role: ShareRole;
  readonly allowDownload: boolean;
  readonly signIn: ShareSignIn;
  readonly endsOn: string | null;
}

export interface ShareItemsInput extends Partial<Omit<ShareSettings, "role">> {
  readonly matterId: MatterId;
  readonly items: readonly ShareTarget[];
  readonly people: readonly { readonly entityId: DirectoryPersonId; readonly role: ShareRole }[];
}

function validateSettings(settings: Partial<ShareSettings>): void {
  if (settings.role !== undefined && !SHARE_ROLES.includes(settings.role)) {
    throw new ShareValidationError("role-unknown", "the role must be viewer, commenter or editor");
  }
  if (settings.signIn !== undefined && !SHARE_SIGN_INS.includes(settings.signIn)) {
    throw new ShareValidationError(
      "sign-in-unknown",
      "the sign-in must be link, emailCode or twoStep",
    );
  }
  if (
    settings.endsOn !== undefined &&
    settings.endsOn !== null &&
    !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u.test(settings.endsOn)
  ) {
    throw new ShareValidationError(
      "ends-on-invalid",
      "the end date must be a date like 2026-12-31",
    );
  }
}

async function assertMatterVisible(
  database: SqlDatabase,
  matterId: MatterId,
  visibility: VisibleMatterPredicate,
): Promise<void> {
  const { results } = await database
    .prepare(
      `SELECT matter.id FROM matter WHERE matter.id = ?1 AND ${visibility.fragmentFor("matter.id")}`,
    )
    .bind(matterId, ...visibility.bindings)
    .all();
  if (results.length === 0)
    throw new ShareValidationError("matter-unknown", "that matter is not a matter in this firm");
}

async function assertItemOnMatter(
  database: SqlDatabase,
  matterId: MatterId,
  item: ShareTarget,
): Promise<void> {
  if (item.scope === "matter") return;
  if (item.scope === "folder") {
    const { results } = await database
      .prepare(`SELECT id FROM folder WHERE id = ?1 AND matter_id = ?2`)
      .bind(item.folderId, matterId)
      .all();
    if (results.length === 0)
      throw new ShareValidationError("item-unknown", "a folder to share is not on this matter");
    return;
  }
  const { results } = await database
    .prepare(`SELECT id FROM file WHERE id = ?1 AND matter_id = ?2 AND deleted_at IS NULL`)
    .bind(item.fileId, matterId)
    .all();
  if (results.length === 0)
    throw new ShareValidationError("item-unknown", "a file to share is not on this matter");
  if (item.fileVersionId !== undefined && item.fileVersionId !== null) {
    const versions = await database
      .prepare(`SELECT id FROM file_version WHERE id = ?1 AND file_id = ?2 AND status = 'clean'`)
      .bind(item.fileVersionId, item.fileId)
      .all();
    if (versions.results.length === 0) {
      throw new ShareValidationError(
        "version-unknown",
        "the version to hold is not a clean version of that file",
      );
    }
  }
}

async function assertPersonShareable(
  database: SqlDatabase,
  entityId: DirectoryPersonId,
): Promise<void> {
  const { results } = await database
    .prepare(
      `SELECT member_id FROM directory_person WHERE id = ?1 AND status = 'active' AND deleted_at IS NULL`,
    )
    .bind(entityId)
    .all<{ member_id: string | null }>();
  const person = results[0];
  if (person === undefined) {
    throw new ShareValidationError(
      "person-unknown",
      "a person to share with is not in the Directory",
    );
  }
  // A colleague already sees the matter as a member; a share would give them a second, weaker door.
  if (person.member_id !== null) {
    throw new ShareValidationError(
      "person-is-member",
      "a person to share with is a member of the firm",
    );
  }
}

function targetIdOf(matterId: MatterId, item: ShareTarget): string {
  if (item.scope === "file") return item.fileId;
  if (item.scope === "folder") return item.folderId;
  return matterId;
}

// Sharing a selection with one or more people. Where a person already has one of the items, their
// share is changed to the settings given rather than doubled, so "share again as editor" is how a
// role is raised from the screen that made the share.
export async function shareItems(
  database: SqlDatabase,
  input: ShareItemsInput,
  options: ShareServiceOptions,
): Promise<{ shareIds: ShareId[]; effect: EffectWrite }> {
  if (input.items.length === 0 || input.people.length === 0) {
    throw new ShareValidationError("nothing-to-share", "name at least one item and one person");
  }
  if (input.items.length * input.people.length > MAXIMUM_SHARES_PER_WRITE) {
    throw new ShareValidationError(
      "too-many",
      `share at most ${MAXIMUM_SHARES_PER_WRITE} items at once`,
    );
  }
  validateSettings({ signIn: input.signIn, endsOn: input.endsOn });
  for (const person of input.people) validateSettings({ role: person.role });
  await assertMatterVisible(database, input.matterId, options.visibility);
  for (const item of input.items) await assertItemOnMatter(database, input.matterId, item);
  for (const person of input.people) await assertPersonShareable(database, person.entityId);
  const held = await countActiveShares(database, input.matterId);

  const now = options.clock.now();
  const statements: EffectStatement[] = [];
  const shareIds: ShareId[] = [];
  let added = 0;
  for (const person of input.people) {
    for (const item of input.items) {
      const targetId = targetIdOf(input.matterId, item);
      const existing = await readActiveShareFor(database, person.entityId, targetId);
      const settings: ShareSettings = {
        role: person.role,
        allowDownload:
          input.allowDownload ?? (existing === undefined ? true : existing.allow_download === 1),
        signIn: input.signIn ?? existing?.sign_in ?? "emailCode",
        endsOn: input.endsOn !== undefined ? input.endsOn : (existing?.ends_on ?? null),
      };
      if (existing !== undefined) {
        shareIds.push(existing.id);
        statements.push(
          guarded(
            updateShareStatement(database, {
              id: existing.id,
              ...settings,
              sharedByUserId: options.actorUserId,
              now,
            }),
            "share.active",
          ),
          auditStatement(
            database,
            "sharing.share.changed",
            existing.id,
            input.matterId,
            settings,
            options,
          ),
        );
        continue;
      }
      const id = newIdentifier("share", options.randomSource);
      shareIds.push(id);
      added += 1;
      statements.push(
        insertShareStatement(database, {
          id,
          matterId: input.matterId,
          scope: item.scope,
          folderId: item.scope === "folder" ? item.folderId : null,
          fileId: item.scope === "file" ? item.fileId : null,
          fileVersionId: item.scope === "file" ? (item.fileVersionId ?? null) : null,
          recipientEntityId: person.entityId,
          ...settings,
          sharedByUserId: options.actorUserId,
          now,
        }),
        auditStatement(database, "sharing.share.created", id, input.matterId, settings, options, {
          scope: item.scope,
          targetId,
          recipientEntityId: person.entityId,
        }),
      );
    }
  }
  if (held + added > MAXIMUM_ACTIVE_SHARES_PER_MATTER) {
    throw new ShareValidationError(
      "too-many",
      `a matter holds at most ${MAXIMUM_ACTIVE_SHARES_PER_MATTER} shares; share a folder instead of its files`,
    );
  }
  return { shareIds, effect: { statements, outboxMessages: [] } };
}

async function countActiveShares(database: SqlDatabase, matterId: MatterId): Promise<number> {
  const { results } = await database
    .prepare(`SELECT count(*) AS held FROM share WHERE matter_id = ?1 AND status = 'active'`)
    .bind(matterId)
    .all<{ held: number }>();
  return results[0]?.held ?? 0;
}

export async function changeShare(
  database: SqlDatabase,
  shareId: ShareId,
  changes: Partial<ShareSettings>,
  options: ShareServiceOptions,
): Promise<{ effect: EffectWrite }> {
  validateSettings(changes);
  const existing = await readActiveShare(database, shareId, options.visibility);
  if (existing === undefined)
    throw new ShareValidationError(
      "share-unknown",
      "that share is not an active share in this firm",
    );
  const settings: ShareSettings = {
    role: changes.role ?? existing.role,
    allowDownload: changes.allowDownload ?? existing.allow_download === 1,
    signIn: changes.signIn ?? existing.sign_in,
    endsOn: changes.endsOn !== undefined ? changes.endsOn : existing.ends_on,
  };
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        // Stopped by someone else since it was read: the change is refused, never applied to a
        // share nobody can see any more.
        guarded(
          updateShareStatement(database, {
            id: shareId,
            ...settings,
            sharedByUserId: options.actorUserId,
            now,
          }),
          "share.active",
        ),
        auditStatement(
          database,
          "sharing.share.changed",
          shareId,
          existing.matter_id,
          settings,
          options,
        ),
      ],
      outboxMessages: [],
    },
  };
}

// Stopping a share. The row stays, revoked, so who could see what and until when stays answerable;
// the next request the person makes is refused.
export async function revokeShare(
  database: SqlDatabase,
  shareId: ShareId,
  options: ShareServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readActiveShare(database, shareId, options.visibility);
  if (existing === undefined)
    throw new ShareValidationError(
      "share-unknown",
      "that share is not an active share in this firm",
    );
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(
          revokeShareStatement(database, {
            id: shareId,
            revokedByUserId: options.actorUserId,
            now,
          }),
          "share.active",
        ),
        domainAuditStatement(database, {
          event: "sharing.share.revoked",
          subjectId: shareId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            matterId: existing.matter_id,
            recipientEntityId: existing.recipient_entity_id,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// The audit row names the share, the matter, the person and the settings: identifiers and words
// from a fixed vocabulary, never a file's name or contents.
function auditStatement(
  database: SqlDatabase,
  event: "sharing.share.created" | "sharing.share.changed",
  shareId: ShareId,
  matterId: MatterId,
  settings: ShareSettings,
  options: ShareServiceOptions,
  extra: Record<string, string> = {},
): SqlStatement {
  return domainAuditStatement(database, {
    event,
    subjectId: shareId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
    metadata: {
      matterId,
      role: settings.role,
      allowDownload: settings.allowDownload,
      signIn: settings.signIn,
      endsOn: settings.endsOn,
      ...extra,
    },
  });
}

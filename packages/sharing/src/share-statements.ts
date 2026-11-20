import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type {
  DirectoryPersonId,
  FileId,
  FileVersionId,
  FolderId,
  MatterId,
  ShareId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { ShareRole, ShareScope, ShareSignIn } from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const SHARE_TABLE = "share";

export interface ShareRow {
  readonly id: ShareId;
  readonly matter_id: MatterId;
  readonly scope: ShareScope;
  readonly folder_id: FolderId | null;
  readonly file_id: FileId | null;
  readonly file_version_id: FileVersionId | null;
  readonly target_id: string;
  readonly recipient_entity_id: DirectoryPersonId;
  readonly role: ShareRole;
  readonly allow_download: number;
  readonly sign_in: ShareSignIn;
  readonly ends_on: string | null;
  readonly status: "active" | "revoked";
  readonly shared_by_user_id: UserId;
  readonly created_at: string;
  readonly updated_at: string;
}

export const SHARE_COLUMNS = [
  "id",
  "matter_id",
  "scope",
  "folder_id",
  "file_id",
  "file_version_id",
  "target_id",
  "recipient_entity_id",
  "role",
  "allow_download",
  "sign_in",
  "ends_on",
  "status",
  "shared_by_user_id",
  "created_at",
  "updated_at",
]
  .map((column) => `share.${column}`)
  .join(", ");

/*
 * THE THREE CONDITIONS EVERY SHARE MUST MEET TO OPEN, written once and composed by every read that
 * answers a person outside the firm.
 *
 *   - It is active and its end date, if any, is today or later. `today` is the firm's civil date and
 *     the caller supplies it; nothing here reads a clock. A share past its end date refuses whether
 *     or not anything has swept it, so a missed sweep can never extend access.
 *   - The member who made it can still share: they are active and hold files:share through a role or
 *     an unexpired direct grant. A share never outlives its sharer's own right to make it.
 *   - Its matter is visible (never the platform-owned holding matter), and its person is a live
 *     Directory row.
 *
 * Bindings: ?1 is today's civil date, ?2 is now as an instant (for direct-grant expiry).
 */
export function openShareCondition(visibility: VisibleMatterPredicate): string {
  return [
    `share.status = 'active'`,
    `(share.ends_on IS NULL OR share.ends_on >= ?1)`,
    sharerCanShareCondition(),
    visibility.fragmentFor("share.matter_id"),
    `EXISTS (SELECT 1 FROM directory_person AS share_recipient WHERE share_recipient.id = share.recipient_entity_id AND share_recipient.deleted_at IS NULL AND share_recipient.status = 'active')`,
  ].join(" AND ");
}

export function sharerCanShareCondition(): string {
  return `EXISTS (SELECT 1 FROM member AS sharer WHERE sharer.user_id = share.shared_by_user_id AND sharer.status = 'active' AND (
    EXISTS (SELECT 1 FROM member_role AS sharer_role JOIN role_permission AS sharer_permission ON sharer_permission.role_id = sharer_role.role_id WHERE sharer_role.member_user_id = sharer.user_id AND sharer_permission.permission = 'files:share')
    OR EXISTS (SELECT 1 FROM direct_grant AS sharer_grant WHERE sharer_grant.member_user_id = sharer.user_id AND sharer_grant.permission = 'files:share' AND (sharer_grant.expires_at IS NULL OR sharer_grant.expires_at > ?2))
  ))`;
}

export interface InsertShareInput {
  readonly id: ShareId;
  readonly matterId: MatterId;
  readonly scope: ShareScope;
  readonly folderId: FolderId | null;
  readonly fileId: FileId | null;
  readonly fileVersionId: FileVersionId | null;
  readonly recipientEntityId: DirectoryPersonId;
  readonly role: ShareRole;
  readonly allowDownload: boolean;
  readonly signIn: ShareSignIn;
  readonly endsOn: string | null;
  readonly sharedByUserId: UserId;
  readonly now: string;
}

export function insertShareStatement(database: SqlDatabase, input: InsertShareInput): SqlStatement {
  const targetId = input.fileId ?? input.folderId ?? input.matterId;
  return database
    .prepare(
      `INSERT INTO ${SHARE_TABLE} (id, matter_id, scope, folder_id, file_id, file_version_id, target_id, recipient_entity_id, role, allow_download, sign_in, ends_on, status, shared_by_user_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'active', ?13, ?14, ?14)`,
    )
    .bind(
      input.id,
      input.matterId,
      input.scope,
      input.folderId,
      input.fileId,
      input.fileVersionId,
      targetId,
      input.recipientEntityId,
      input.role,
      input.allowDownload ? 1 : 0,
      input.signIn,
      input.endsOn,
      input.sharedByUserId,
      input.now,
    );
}

export interface UpdateShareInput {
  readonly id: ShareId;
  readonly role: ShareRole;
  readonly allowDownload: boolean;
  readonly signIn: ShareSignIn;
  readonly endsOn: string | null;
  // Whoever changes a share becomes the member it answers to, so a share a departed colleague made
  // can be taken over by changing it, and keeps opening.
  readonly sharedByUserId: UserId;
  readonly now: string;
}

export function updateShareStatement(database: SqlDatabase, input: UpdateShareInput): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SHARE_TABLE} SET role = ?2, allow_download = ?3, sign_in = ?4, ends_on = ?5, shared_by_user_id = ?6, updated_at = ?7 WHERE id = ?1 AND status = 'active'`,
    )
    .bind(
      input.id,
      input.role,
      input.allowDownload ? 1 : 0,
      input.signIn,
      input.endsOn,
      input.sharedByUserId,
      input.now,
    );
}

export function revokeShareStatement(
  database: SqlDatabase,
  input: { readonly id: ShareId; readonly revokedByUserId: UserId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SHARE_TABLE} SET status = 'revoked', revoked_by_user_id = ?2, revoked_at = ?3, updated_at = ?3 WHERE id = ?1 AND status = 'active'`,
    )
    .bind(input.id, input.revokedByUserId, input.now);
}

export async function readActiveShare(
  database: SqlDatabase,
  id: ShareId,
  visibility: VisibleMatterPredicate,
): Promise<ShareRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${SHARE_COLUMNS} FROM ${SHARE_TABLE} WHERE share.id = ?1 AND share.status = 'active' AND ${visibility.fragmentFor("share.matter_id")}`,
    )
    .bind(id, ...visibility.bindings)
    .all<ShareRow>();
  return results[0];
}

export async function readActiveShareFor(
  database: SqlDatabase,
  recipientEntityId: DirectoryPersonId,
  targetId: string,
): Promise<ShareRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${SHARE_COLUMNS} FROM ${SHARE_TABLE} WHERE share.recipient_entity_id = ?1 AND share.target_id = ?2 AND share.status = 'active'`,
    )
    .bind(recipientEntityId, targetId)
    .all<ShareRow>();
  return results[0];
}

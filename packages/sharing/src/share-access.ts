import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { visibleMatterPredicate, type VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { zonedReading } from "@magna-carta/civil-time/time-zone";
import type {
  DirectoryPersonId,
  FileId,
  FileVersionId,
  FolderId,
  MatterId,
  ShareId,
} from "@magna-carta/identifiers/types";
import { SHARE_COLUMNS, SHARE_TABLE, openShareCondition, type ShareRow } from "./share-statements.ts";
import {
  SHARE_SIGN_INS,
  roleAllows,
  roleRank,
  type ShareCapability,
  type ShareRole,
  type ShareScope,
  type ShareSignIn,
} from "./types.ts";

// THE READS A PERSON OUTSIDE THE FIRM IS ANSWERED BY. The portal's handlers call these and nothing
// else to decide what a person may see; every one composes the same open-share condition, so a
// revoked share, a share past its end date and a share whose sharer can no longer share all refuse
// on the very next request.
//
// None of these reads a clock. The caller passes the firm's civil date (for end dates) and the
// instant (for the sharer's direct-grant expiry).

export interface ShareReadContext {
  readonly today: string;
  readonly now: string;
  readonly visibility: VisibleMatterPredicate;
}

// THE DAY AN END DATE IS READ AGAINST. A share that ends on the 30th opens until the 30th is over
// everywhere, so "today" is read in the last place on Earth still on a given day (UTC-12). The
// person outside the firm may be anywhere, and a share that closed at four in the afternoon in Reno
// because it was already midnight in London would end a day early for the people it was made for.
// The cost is that it can stay open a few hours past midnight where the firm sits, which is the
// lenient side of an end date the firm chose.
export const END_DATE_TIME_ZONE = "Etc/GMT+12";

export function shareReadContext(atMilliseconds: number): ShareReadContext {
  return {
    today: zonedReading(atMilliseconds, END_DATE_TIME_ZONE).civilDate,
    now: new Date(atMilliseconds).toISOString(),
    visibility: visibleMatterPredicate(),
  };
}

function bindingsFor(context: ShareReadContext, ...rest: unknown[]): unknown[] {
  return [context.today, context.now, ...rest, ...context.visibility.bindings];
}

/** One thing shared with the person, as their portal lists it. */
export interface SharedItem {
  readonly shareId: ShareId;
  readonly matterId: MatterId;
  readonly matterTitle: string;
  readonly scope: ShareScope;
  readonly folderId: FolderId | null;
  readonly fileId: FileId | null;
  readonly fileVersionId: FileVersionId | null;
  // The file's or folder's name; for the matter's top level, the matter's title.
  readonly name: string;
  readonly role: ShareRole;
  readonly allowDownload: boolean;
  readonly signIn: ShareSignIn;
  readonly endsOn: string | null;
  readonly sharedAt: string;
}

interface SharedItemRow extends ShareRow {
  readonly matter_title: string;
  readonly item_name: string | null;
}

// Everything shared with one person in this firm, newest first. A file share whose file has been
// deleted is left out rather than listed as a name that opens nothing.
export async function listSharedItems(
  database: SqlDatabase,
  recipientEntityId: DirectoryPersonId,
  context: ShareReadContext,
): Promise<SharedItem[]> {
  const { results } = await database
    .prepare(
      `SELECT ${SHARE_COLUMNS}, shared_matter.title AS matter_title,
         CASE share.scope WHEN 'file' THEN shared_file.name WHEN 'folder' THEN shared_folder.name ELSE shared_matter.title END AS item_name
       FROM ${SHARE_TABLE}
       JOIN matter AS shared_matter ON shared_matter.id = share.matter_id
       LEFT JOIN file AS shared_file ON shared_file.id = share.file_id
       LEFT JOIN folder AS shared_folder ON shared_folder.id = share.folder_id
       WHERE share.recipient_entity_id = ?3
         AND (share.scope <> 'file' OR shared_file.deleted_at IS NULL)
         AND ${openShareCondition(context.visibility)}
       ORDER BY share.created_at DESC, share.id DESC`,
    )
    .bind(...bindingsFor(context, recipientEntityId))
    .all<SharedItemRow>();
  return results.map((row) => ({
    shareId: row.id,
    matterId: row.matter_id,
    matterTitle: row.matter_title,
    scope: row.scope,
    folderId: row.folder_id,
    fileId: row.file_id,
    fileVersionId: row.file_version_id,
    name: row.item_name ?? "",
    role: row.role,
    allowDownload: row.allow_download === 1,
    signIn: row.sign_in,
    endsOn: row.ends_on,
    sharedAt: row.created_at,
  }));
}

/** A file inside a shared folder (or at a shared matter's top level). */
export interface SharedFolderFile {
  readonly fileId: FileId;
  readonly name: string;
  readonly currentVersionId: FileVersionId | null;
  readonly updatedAt: string;
}

// The files directly inside a shared folder or a shared matter's top level, by name. Folders inside
// it are not listed: each is shared on its own or not at all. Only a share this person holds and that
// still opens answers; any other share id reads as empty, the same as a share that does not exist.
export async function listSharedFolderFiles(
  database: SqlDatabase,
  recipientEntityId: DirectoryPersonId,
  shareId: ShareId,
  context: ShareReadContext,
): Promise<SharedFolderFile[]> {
  const { results } = await database
    .prepare(
      `SELECT shared_file.id AS file_id, shared_file.name AS name, shared_file.current_version_id AS current_version_id, shared_file.updated_at AS updated_at
       FROM ${SHARE_TABLE}
       JOIN file AS shared_file ON shared_file.matter_id = share.matter_id
         AND shared_file.deleted_at IS NULL
         AND ((share.scope = 'folder' AND shared_file.folder_id = share.folder_id)
           OR (share.scope = 'matter' AND shared_file.folder_id IS NULL))
       WHERE share.recipient_entity_id = ?3 AND share.id = ?4
         AND ${openShareCondition(context.visibility)}
       ORDER BY shared_file.name COLLATE NOCASE, shared_file.id`,
    )
    .bind(...bindingsFor(context, recipientEntityId, shareId))
    .all<{ file_id: FileId; name: string; current_version_id: FileVersionId | null; updated_at: string }>();
  return results.map((row) => ({
    fileId: row.file_id,
    name: row.name,
    currentVersionId: row.current_version_id,
    updatedAt: row.updated_at,
  }));
}

/** What a person may do with one file, folded over every share that reaches it. */
export type FileAccess =
  | {
      readonly allowed: true;
      readonly matterId: MatterId;
      // The strongest role among the shares that reach the file.
      readonly role: ShareRole;
      // Allowed when any share reaching the file allows it.
      readonly allowDownload: boolean;
      // The strongest sign-in among the shares, so a file reached two ways asks for the stricter.
      readonly signIn: ShareSignIn;
      // The version to show. A file share that holds one version still answers with it; reached
      // only through a folder or the matter's top level, the person sees the current version (null).
      readonly fileVersionId: FileVersionId | null;
      readonly shareIds: readonly ShareId[];
    }
  | { readonly allowed: false };

export async function readFileAccess(
  database: SqlDatabase,
  recipientEntityId: DirectoryPersonId,
  fileId: FileId,
  context: ShareReadContext,
): Promise<FileAccess> {
  const { results } = await database
    .prepare(
      `SELECT ${SHARE_COLUMNS}
       FROM ${SHARE_TABLE}
       JOIN file AS shared_file ON shared_file.id = ?4 AND shared_file.deleted_at IS NULL AND shared_file.matter_id = share.matter_id
       WHERE share.recipient_entity_id = ?3
         AND ((share.scope = 'file' AND share.file_id = shared_file.id)
           OR (share.scope = 'folder' AND share.folder_id = shared_file.folder_id)
           OR (share.scope = 'matter' AND shared_file.folder_id IS NULL))
         AND ${openShareCondition(context.visibility)}`,
    )
    .bind(...bindingsFor(context, recipientEntityId, fileId))
    .all<ShareRow>();
  return foldAccess(results);
}

export function foldAccess(rows: readonly ShareRow[]): FileAccess {
  const first = rows[0];
  if (first === undefined) return { allowed: false };
  let role: ShareRole = first.role;
  let signIn: ShareSignIn = first.sign_in;
  let allowDownload = false;
  let pinned: FileVersionId | null = null;
  let reachedLive = false;
  for (const row of rows) {
    if (roleRank(row.role) > roleRank(role)) role = row.role;
    if (SHARE_SIGN_INS.indexOf(row.sign_in) > SHARE_SIGN_INS.indexOf(signIn)) signIn = row.sign_in;
    if (row.allow_download === 1) allowDownload = true;
    if (row.scope === "file" && row.file_version_id !== null) pinned = row.file_version_id;
    else reachedLive = true;
  }
  return {
    allowed: true,
    matterId: first.matter_id,
    role,
    allowDownload,
    signIn,
    // A live share (a folder, or a file share with no version held) shows the current version; a
    // version held still by a file share wins only when nothing live reaches the file.
    fileVersionId: reachedLive ? null : pinned,
    shareIds: rows.map((row) => row.id),
  };
}

export async function canAccess(
  database: SqlDatabase,
  recipientEntityId: DirectoryPersonId,
  fileId: FileId,
  capability: ShareCapability,
  context: ShareReadContext,
): Promise<boolean> {
  const access = await readFileAccess(database, recipientEntityId, fileId, context);
  if (!access.allowed) return false;
  if (capability === "download") return access.allowDownload;
  return roleAllows(access.role, capability);
}

// Whether the person may add a file to a folder (null: the matter's top level). Only an editor of
// that folder or top level may; what they add waits for the firm to accept it, which the upload path
// owns, so this answers only "may they hand a file over here at all".
export async function canAddFiles(
  database: SqlDatabase,
  recipientEntityId: DirectoryPersonId,
  matterId: MatterId,
  folderId: FolderId | null,
  context: ShareReadContext,
): Promise<boolean> {
  const { results } = await database
    .prepare(
      `SELECT share.id FROM ${SHARE_TABLE}
       WHERE share.recipient_entity_id = ?3 AND share.matter_id = ?4 AND share.target_id = ?5
         AND share.scope IN ('folder', 'matter') AND share.role = 'editor'
         AND ${openShareCondition(context.visibility)}
       LIMIT 1`,
    )
    .bind(...bindingsFor(context, recipientEntityId, matterId, folderId ?? matterId))
    .all<{ id: ShareId }>();
  return results.length > 0;
}

import { guarded, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MagnusConversationId, MagnusFolderId, UserId } from "@magna-carta/identifiers/types";
import {
  conversationShelvedAudit,
  folderCreatedAudit,
  folderDeletedAudit,
  folderRenamedAudit,
  type MagnusWriteContext,
} from "./audit.ts";

// A member's own shelf for their conversations: the folders they make, and where they keep each
// conversation they can read (a folder, or General when none) and whether they have pinned it.
//
// The shelf is the READER's, not the conversation's. It decides nothing about who may read a
// conversation (the matter it is kept on does that) and no other member sees it. That is why both
// tables are keyed by the member, and why moving a conversation into a folder needs only that the
// member can read it.
//
// General is not a folder. A conversation with no shelf row, or a row whose folder is null, is in
// General, so the default needs no row and a member who never makes a folder has none.

export const MAGNUS_FOLDER_TABLE = "magnus_folder";
export const MAGNUS_CONVERSATION_SHELF_TABLE = "magnus_conversation_shelf";

// A folder's name is a label in a narrow rail, not a description.
export const FOLDER_NAME_MAX_LENGTH = 80;
// A member's folders are read whole into the rail, so how many there may be is capped where they
// are made rather than paged where they are read.
export const MEMBER_FOLDERS_MAX = 100;

export interface FolderRow {
  readonly id: MagnusFolderId;
  readonly memberId: UserId;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface FolderDatabaseRow {
  id: string;
  member_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

function toFolderRow(row: FolderDatabaseRow): FolderRow {
  return {
    id: row.id as MagnusFolderId,
    memberId: row.member_id as UserId,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// One member's folders, by name. Bounded by the cap above, plus one so a caller can tell a full
// shelf from an exactly-full one.
export async function listFolders(
  database: SqlDatabase,
  memberId: UserId,
): Promise<readonly FolderRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, member_id, name, created_at, updated_at FROM ${MAGNUS_FOLDER_TABLE} WHERE member_id = ?1 ORDER BY lower(name) ASC, id ASC LIMIT ?2`,
    )
    .bind(memberId, MEMBER_FOLDERS_MAX + 1)
    .all<FolderDatabaseRow>();
  return results.map(toFolderRow);
}

export async function countFolders(database: SqlDatabase, memberId: UserId): Promise<number> {
  const { results } = await database
    .prepare(`SELECT COUNT(*) AS count FROM ${MAGNUS_FOLDER_TABLE} WHERE member_id = ?1`)
    .bind(memberId)
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}

// One folder, whoever's it is. The caller compares the member: another member's folder is reported
// as absent, never as forbidden.
export async function readFolder(
  database: SqlDatabase,
  id: MagnusFolderId,
): Promise<FolderRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, member_id, name, created_at, updated_at FROM ${MAGNUS_FOLDER_TABLE} WHERE id = ?1 LIMIT 1`,
    )
    .bind(id)
    .all<FolderDatabaseRow>();
  const row = results[0];
  return row === undefined ? undefined : toFolderRow(row);
}

export interface ShelfRow {
  readonly folderId: MagnusFolderId | null;
  readonly pinnedAt: string | null;
}

// Where one member keeps one conversation. No row reads as General and unpinned.
export async function readShelf(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
  memberId: UserId,
): Promise<ShelfRow> {
  const { results } = await database
    .prepare(
      `SELECT folder_id, pinned_at FROM ${MAGNUS_CONVERSATION_SHELF_TABLE} WHERE conversation_id = ?1 AND member_id = ?2 LIMIT 1`,
    )
    .bind(conversationId, memberId)
    .all<{ folder_id: string | null; pinned_at: string | null }>();
  const row = results[0];
  return {
    folderId: (row?.folder_id ?? null) as MagnusFolderId | null,
    pinnedAt: row?.pinned_at ?? null,
  };
}

function insertMagnusFolderStatement(
  database: SqlDatabase,
  row: { id: MagnusFolderId; memberId: UserId; name: string; now: string },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MAGNUS_FOLDER_TABLE} (id, member_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)`,
    )
    .bind(row.id, row.memberId, row.name, row.now);
}

function renameMagnusFolderStatement(
  database: SqlDatabase,
  row: { id: MagnusFolderId; memberId: UserId; name: string; now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MAGNUS_FOLDER_TABLE} SET name = ?3, updated_at = ?4 WHERE id = ?1 AND member_id = ?2`,
    )
    .bind(row.id, row.memberId, row.name, row.now);
}

// What was in a folder goes back to General: removing a folder never removes a conversation.
function emptyMagnusFolderStatement(
  database: SqlDatabase,
  row: { id: MagnusFolderId; memberId: UserId; now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MAGNUS_CONVERSATION_SHELF_TABLE} SET folder_id = NULL, updated_at = ?3 WHERE member_id = ?2 AND folder_id = ?1`,
    )
    .bind(row.id, row.memberId, row.now);
}

function deleteMagnusFolderStatement(
  database: SqlDatabase,
  row: { id: MagnusFolderId; memberId: UserId },
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MAGNUS_FOLDER_TABLE} WHERE id = ?1 AND member_id = ?2`)
    .bind(row.id, row.memberId);
}

// One statement for both halves of the shelf, so a move and a pin can never be half-applied. A pin
// keeps the instant it was first pinned while it stays pinned, because the pinned list reads newest
// pin first and moving a pinned conversation between folders is not pinning it again.
function shelveStatement(
  database: SqlDatabase,
  row: {
    conversationId: MagnusConversationId;
    memberId: UserId;
    folderId: MagnusFolderId | null;
    pinned: boolean;
    now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MAGNUS_CONVERSATION_SHELF_TABLE} (conversation_id, member_id, folder_id, pinned_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, CASE WHEN ?4 = 1 THEN ?5 ELSE NULL END, ?5) ` +
        `ON CONFLICT(conversation_id, member_id) DO UPDATE SET folder_id = excluded.folder_id, ` +
        `pinned_at = CASE WHEN ?4 = 1 THEN COALESCE(${MAGNUS_CONVERSATION_SHELF_TABLE}.pinned_at, excluded.pinned_at) ELSE NULL END, ` +
        `updated_at = excluded.updated_at`,
    )
    .bind(row.conversationId, row.memberId, row.folderId, row.pinned ? 1 : 0, row.now);
}

// A deleted conversation leaves nobody's shelf holding it.
export function deleteConversationShelvesStatement(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MAGNUS_CONVERSATION_SHELF_TABLE} WHERE conversation_id = ?1`)
    .bind(conversationId);
}

export interface CreatedFolder {
  readonly folderId: MagnusFolderId;
  readonly effect: EffectWrite;
}

export function createFolder(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly memberId: UserId; readonly name: string },
): CreatedFolder {
  const folderId = newIdentifier("magnusFolder", context.randomSource);
  return {
    folderId,
    effect: {
      statements: [
        insertMagnusFolderStatement(database, {
          id: folderId,
          memberId: input.memberId,
          name: input.name,
          now: context.clock.now(),
        }),
        folderCreatedAudit(database, context, { folderId }),
      ],
      outboxMessages: [],
    },
  };
}

export function renameFolder(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly folderId: MagnusFolderId; readonly memberId: UserId; readonly name: string },
): EffectWrite {
  return {
    statements: [
      guarded(
        renameMagnusFolderStatement(database, {
          id: input.folderId,
          memberId: input.memberId,
          name: input.name,
          now: context.clock.now(),
        }),
        "folder.rename",
      ),
      folderRenamedAudit(database, context, { folderId: input.folderId }),
    ],
    outboxMessages: [],
  };
}

export function deleteFolder(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly folderId: MagnusFolderId; readonly memberId: UserId },
): EffectWrite {
  const now = context.clock.now();
  return {
    statements: [
      emptyMagnusFolderStatement(database, { id: input.folderId, memberId: input.memberId, now }),
      guarded(
        deleteMagnusFolderStatement(database, { id: input.folderId, memberId: input.memberId }),
        "folder.delete",
      ),
      folderDeletedAudit(database, context, { folderId: input.folderId }),
    ],
    outboxMessages: [],
  };
}

export function shelveConversation(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly memberId: UserId;
    readonly folderId: MagnusFolderId | null;
    readonly pinned: boolean;
  },
): EffectWrite {
  return {
    statements: [
      shelveStatement(database, { ...input, now: context.clock.now() }),
      conversationShelvedAudit(database, context, {
        conversationId: input.conversationId,
        folderId: input.folderId,
        pinned: input.pinned,
      }),
    ],
    outboxMessages: [],
  };
}

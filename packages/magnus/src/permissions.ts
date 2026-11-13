import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MagnusConversationId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { conversationPermissionAudit, type MagnusWriteContext } from "./audit.ts";
import { MAGNUS_CONVERSATION_TABLE, readRecentTurns } from "./statements.ts";
import type { TurnRow } from "./types.ts";

// What Magnus may read beyond the conversation itself, granted per conversation by its author.
//
// Every permission is OFF until the author turns it on, for that one conversation; a row is a
// permission turned on. The attached files of a matter are not here: attaching a file is already
// the member choosing what Magnus reads. Each permission that is here is a change to what Magnus
// can see, which is why each arrives with a bump of the disclosure (disclosure.ts).

export const MAGNUS_CONVERSATION_PERMISSION_TABLE = "magnus_conversation_permission";

// `own-matter-conversations`: the author's own other conversations kept on the same matter. Only the
// author's, because a transcript is read by its author and by the supervisory permission and by
// nobody else; Magnus reading a colleague's would hand its words to someone who cannot open it.
export const CONVERSATION_PERMISSIONS = ["own-matter-conversations"] as const;
export type ConversationPermission = (typeof CONVERSATION_PERMISSIONS)[number];

// How much of the author's other conversations one question may carry: the most recent few, each
// as its last turns. A matter's long history is what search is for, not a transcript dump.
export const EARLIER_CONVERSATIONS_MAX = 5;
export const EARLIER_CONVERSATION_TURNS_MAX = 20;

export function isConversationPermission(value: string): value is ConversationPermission {
  return (CONVERSATION_PERMISSIONS as readonly string[]).includes(value);
}

export async function listConversationPermissions(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
): Promise<readonly ConversationPermission[]> {
  const { results } = await database
    .prepare(
      `SELECT permission FROM ${MAGNUS_CONVERSATION_PERMISSION_TABLE} WHERE conversation_id = ?1 ORDER BY permission`,
    )
    .bind(conversationId)
    .all<{ permission: string }>();
  return results.map((row) => row.permission).filter(isConversationPermission);
}

function grantStatement(
  database: SqlDatabase,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly permission: ConversationPermission;
    readonly grantedBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  // Turning on a permission already on changes nothing, so a repeated press is not a refusal.
  return database
    .prepare(
      `INSERT INTO ${MAGNUS_CONVERSATION_PERMISSION_TABLE} (conversation_id, permission, granted_by, granted_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(conversation_id, permission) DO NOTHING`,
    )
    .bind(input.conversationId, input.permission, input.grantedBy, input.now);
}

function revokeStatement(
  database: SqlDatabase,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly permission: ConversationPermission;
  },
): SqlStatement {
  // fitness:unguarded-write — turning off a permission already off changes nothing, so zero rows is a wanted outcome rather than a refusal.
  return database
    .prepare(
      `DELETE FROM ${MAGNUS_CONVERSATION_PERMISSION_TABLE} WHERE conversation_id = ?1 AND permission = ?2`,
    )
    .bind(input.conversationId, input.permission);
}

// A deleted conversation takes its permissions with it.
export function deleteConversationPermissionsStatement(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MAGNUS_CONVERSATION_PERMISSION_TABLE} WHERE conversation_id = ?1`)
    .bind(conversationId);
}

// Turns one permission on or off for one conversation, audited by name.
export function setConversationPermission(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly permission: ConversationPermission;
    readonly granted: boolean;
    readonly memberId: UserId;
  },
): EffectWrite {
  const now = context.clock.now();
  return {
    statements: [
      input.granted
        ? grantStatement(database, {
            conversationId: input.conversationId,
            permission: input.permission,
            grantedBy: input.memberId,
            now,
          })
        : revokeStatement(database, input),
      conversationPermissionAudit(database, context, input),
    ],
    outboxMessages: [],
  };
}

export interface EarlierConversation {
  readonly id: MagnusConversationId;
  readonly title: string | null;
  readonly turns: readonly TurnRow[];
}

// The author's own other conversations on a matter, the most recently active first, each as its
// last turns oldest-first. Deleted conversations are left out; removed and set-aside turns are left
// for the window to drop, which is the one place that decides what the model may read.
export async function readEarlierConversations(
  database: SqlDatabase,
  input: {
    readonly matterId: MatterId;
    readonly authorUserId: UserId;
    readonly excludeConversationId: MagnusConversationId;
  },
): Promise<readonly EarlierConversation[]> {
  const { results } = await database
    .prepare(
      `SELECT id, title FROM ${MAGNUS_CONVERSATION_TABLE} WHERE matter_id = ?1 AND created_by = ?2 AND id <> ?3 AND state <> 'deleted' ORDER BY updated_at DESC, id DESC LIMIT ?4`,
    )
    .bind(
      input.matterId,
      input.authorUserId,
      input.excludeConversationId,
      EARLIER_CONVERSATIONS_MAX,
    )
    .all<{ id: MagnusConversationId; title: string | null }>();
  return Promise.all(
    results.map(async (row) => ({
      id: row.id,
      title: row.title,
      turns: await readRecentTurns(database, row.id, EARLIER_CONVERSATION_TURNS_MAX),
    })),
  );
}

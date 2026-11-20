import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";
import {
  SHARE_COLUMNS,
  SHARE_TABLE,
  sharerCanShareCondition,
  type ShareRow,
} from "./share-statements.ts";
import type { ShareReadContext } from "./share-access.ts";
import { MAXIMUM_ACTIVE_SHARES_PER_MATTER } from "./share-service.ts";
import type { ShareRecord } from "./types.ts";

// THE STAFF SIDE'S ONE READ: every live share on a matter, with the person's name. The File Manager
// derives everything it draws from this one list: the shared mark on a row, the Shared With column,
// the Sharing tab in the right-hand pane, and the Sharing view that reviews a person's access across
// the matter's folders. One read, so the four can never disagree about who sees what.
//
// A share that is recorded as active but no longer opens is RETURNED, marked dormant, rather than
// hidden: staff need to see "this ended on the 3rd" and "the colleague who shared this has left" to
// act on it, and hiding it would make it look as though nothing had ever been shared.

const PERSON_NAME = `COALESCE(NULLIF(trim(share_person.display_name), ''), NULLIF(trim(COALESCE(share_person.name_given, '') || ' ' || COALESCE(share_person.name_family, '')), ''))`;

interface MatterShareRow extends ShareRow {
  readonly recipient_name: string | null;
  readonly sharer_can_share: number;
}

export async function listMatterShares(
  database: SqlDatabase,
  matterId: MatterId,
  context: ShareReadContext,
): Promise<ShareRecord[]> {
  const { results } = await database
    .prepare(
      `SELECT ${SHARE_COLUMNS}, ${PERSON_NAME} AS recipient_name,
         CASE WHEN ${sharerCanShareCondition()} THEN 1 ELSE 0 END AS sharer_can_share
       FROM ${SHARE_TABLE}
       LEFT JOIN directory_person AS share_person ON share_person.id = share.recipient_entity_id
       LEFT JOIN file AS shared_file ON shared_file.id = share.file_id
       WHERE share.matter_id = ?3 AND share.status = 'active'
         AND (share.scope <> 'file' OR shared_file.deleted_at IS NULL)
         AND ${context.visibility.fragmentFor("share.matter_id")}
       ORDER BY recipient_name COLLATE NOCASE, share.recipient_entity_id, share.created_at
       LIMIT ${MAXIMUM_ACTIVE_SHARES_PER_MATTER}`,
    )
    .bind(context.today, context.now, matterId, ...context.visibility.bindings)
    .all<MatterShareRow>();
  return results.map((row) => ({
    id: row.id,
    matterId: row.matter_id,
    scope: row.scope,
    folderId: row.folder_id,
    fileId: row.file_id,
    fileVersionId: row.file_version_id,
    recipientEntityId: row.recipient_entity_id,
    recipientName: row.recipient_name,
    role: row.role,
    allowDownload: row.allow_download === 1,
    signIn: row.sign_in,
    endsOn: row.ends_on,
    sharedByUserId: row.shared_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dormant:
      row.ends_on !== null && row.ends_on < context.today
        ? "ended"
        : row.sharer_can_share === 1
          ? null
          : "needsNewSharer",
  }));
}

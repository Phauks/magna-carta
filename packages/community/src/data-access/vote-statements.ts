import type {
  CommunityPostId,
  CommunityProfileId,
  CommunityVoteId,
  FirmId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "../sql.ts";
import { COMMUNITY_VOTE_TABLE } from "./tables.ts";

// One account, one vote, enforced by the unique index rather than by a read-then-write in a
// handler. A losing concurrent insert aborts its own batch, which is what makes the counters
// recomputed from these rows trustworthy.
//
// The firm identifier is captured here and is the reason this table exists in the shape it does:
// ranking counts DISTINCT firms, so a forty-seat firm cannot out-vote forty single-seat firms. It
// is never read back as "which firms", only as "how many", and it reaches no response.

export function insertVoteStatement(
  database: SqlDatabase,
  input: {
    readonly id: CommunityVoteId;
    readonly postId: CommunityPostId;
    readonly profileId: CommunityProfileId;
    readonly userId: UserId;
    readonly firmId: FirmId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${COMMUNITY_VOTE_TABLE} (id, post_id, profile_id, user_id, firm_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (post_id, user_id) DO NOTHING`,
    )
    .bind(input.id, input.postId, input.profileId, input.userId, input.firmId, input.now);
}

export function deleteVoteStatement(
  database: SqlDatabase,
  input: { readonly postId: CommunityPostId; readonly userId: UserId },
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${COMMUNITY_VOTE_TABLE} WHERE post_id = ?1 AND user_id = ?2`)
    .bind(input.postId, input.userId);
}

// Whether the signed-in reader has voted, which is the only per-reader fact any board response
// carries. It says nothing about anybody else.
export function selectViewerVoteStatement(
  database: SqlDatabase,
  input: { readonly postId: CommunityPostId; readonly userId: UserId },
): SqlStatement {
  return database
    .prepare(`SELECT id FROM ${COMMUNITY_VOTE_TABLE} WHERE post_id = ?1 AND user_id = ?2`)
    .bind(input.postId, input.userId);
}

// Which of a page of posts the signed-in reader has voted for, in one read rather than one per row.
export function selectViewerVotesForPostsStatement(
  database: SqlDatabase,
  input: { readonly postIds: readonly CommunityPostId[]; readonly userId: UserId },
): SqlStatement {
  const placeholders = input.postIds.map((_, index) => `?${index + 2}`).join(", ");
  return database
    .prepare(
      `SELECT post_id FROM ${COMMUNITY_VOTE_TABLE} WHERE user_id = ?1 AND post_id IN (${placeholders})`,
    )
    .bind(input.userId, ...input.postIds);
}

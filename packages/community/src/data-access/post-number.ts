// Drawing a post's public number.
//
// The number goes in a permanent URL, so it cannot be the row identifier — a row identifier in a
// public URL publishes how many rows there are, which is how much traffic the board has, and a URL
// cannot be taken back once somebody has bookmarked it.
//
// The mechanism is a counter row plus an allocation row, and the subtlety is that the guarded
// increment is NOT the guard: a zero-row UPDATE is not an error in SQLite, so a drawer that loses
// the race commits happily having changed nothing and walks away believing it holds the same number
// as the winner. The ALLOCATION row's uniqueness is what aborts the loser's whole batch, at which
// point the caller re-reads the advanced counter and draws again.

import type { CommunityPostId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "../sql.ts";
import {
  COMMUNITY_POST_NUMBER_ALLOCATION_TABLE,
  COMMUNITY_POST_NUMBER_COUNTER_TABLE,
} from "./tables.ts";

// One board, one sequence. The scope column exists because the counter shape is shared with the
// per-firm sequences, which are scoped per firm; here there is nothing to scope by.
export const POST_NUMBER_SCOPE = "post";

// Posts start at a number that does not read as "we have had four posts". Starting at 1 tells every
// early reader exactly how small the board is on its first week, which is a fact about the product
// rather than about the post.
export const FIRST_POST_NUMBER = 1001;

export function ensurePostNumberCounterStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${COMMUNITY_POST_NUMBER_COUNTER_TABLE} (scope_key, next_value)
       VALUES (?1, ?2) ON CONFLICT (scope_key) DO NOTHING`,
    )
    .bind(POST_NUMBER_SCOPE, FIRST_POST_NUMBER);
}

export function selectNextPostNumberStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT next_value FROM ${COMMUNITY_POST_NUMBER_COUNTER_TABLE} WHERE scope_key = ?1`,
    )
    .bind(POST_NUMBER_SCOPE);
}

// Advances the counter only if it still holds the value the drawer observed. A concurrent draw that
// already advanced it makes this match zero rows — the loser, caught by the allocation row below.
export function advancePostNumberStatement(
  database: SqlDatabase,
  observedValue: number,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_POST_NUMBER_COUNTER_TABLE}
         SET next_value = next_value + 1
       WHERE scope_key = ?1 AND next_value = ?2`,
    )
    .bind(POST_NUMBER_SCOPE, observedValue);
}

// Claims the drawn number. Composed AFTER the post's own insert in the batch, because the owner
// column is a foreign key onto it.
export function allocatePostNumberStatement(
  database: SqlDatabase,
  input: { readonly drawnValue: number; readonly postId: CommunityPostId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${COMMUNITY_POST_NUMBER_ALLOCATION_TABLE} (scope_key, drawn_value, post_id, allocated_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(POST_NUMBER_SCOPE, input.drawnValue, input.postId, input.now);
}

// How many times a losing drawer retries before giving up. A caller that exhausts this is looking at
// sustained contention rather than a race, which is a different problem and should surface as one
// rather than as a request that hangs.
export const MAX_POST_NUMBER_DRAW_ATTEMPTS = 5;

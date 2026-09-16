import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { CustodyItemId, CustodyPacketId } from "@magna-carta/identifiers/types";
import { CUSTODY_ITEM_TABLE, CUSTODY_PACKET_TABLE } from "./packet-statements.ts";

// The review schedule's own writes and its one read. Kept apart from packet-statements.ts because a
// review date is not a descriptive field: the roll-forward carries a precondition on the date it
// observed, so two people completing the same review concurrently advance the cycle once rather than
// twice.

// Advances a packet's review date, guarded on the date the caller read. A zero-row result means
// somebody else already rolled it; the caller's movement row still lands, which is correct — two
// people really did look at the envelope — but the cycle does not skip a period.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function rollCustodyPacketReviewStatement(
  database: SqlDatabase,
  id: CustodyPacketId,
  nextReviewOn: string | null,
  expectedReviewOn: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_PACKET_TABLE} SET review_on = ?2, updated_at = ?3 WHERE id = ?1 AND review_on = ?4`,
    )
    .bind(id, nextReviewOn, updatedAt, expectedReviewOn);
}

export function rollCustodyItemReviewStatement(
  database: SqlDatabase,
  id: CustodyItemId,
  nextReviewOn: string | null,
  expectedReviewOn: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_ITEM_TABLE} SET review_on = ?2, updated_at = ?3 WHERE id = ?1 AND review_on = ?4`,
    )
    .bind(id, nextReviewOn, updatedAt, expectedReviewOn);
}

export interface CustodyReviewDueRow {
  readonly packet_id: CustodyPacketId;
  readonly item_id: CustodyItemId | null;
  readonly custody_number: string;
  readonly review_on: string;
  readonly review_interval_months: number | null;
  readonly packet_status: string;
}

// Everything scheduled for review on or before a date, packets and items together in one ordered
// read. The two halves are a UNION ALL rather than two round trips because the report and the
// reminder collection both want them interleaved by date — "what needs looking at" is one list to
// the person holding it, not two.
//
// A released, destroyed, or lost packet is excluded: the firm no longer holds the property, and a
// reminder to review something that left the safe is noise the register would train people to ignore.
export function selectCustodyReviewsDueStatement(
  database: SqlDatabase,
  asOfDate: string,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT packet.id AS packet_id,
              NULL AS item_id,
              packet.custody_number AS custody_number,
              packet.review_on AS review_on,
              packet.review_interval_months AS review_interval_months,
              packet.status AS packet_status
         FROM ${CUSTODY_PACKET_TABLE} AS packet
        WHERE packet.review_on IS NOT NULL
          AND packet.review_on <= ?1
          AND packet.status IN ('held', 'out')
        UNION ALL
       SELECT item.packet_id AS packet_id,
              item.id AS item_id,
              packet.custody_number AS custody_number,
              item.review_on AS review_on,
              item.review_interval_months AS review_interval_months,
              packet.status AS packet_status
         FROM ${CUSTODY_ITEM_TABLE} AS item
         JOIN ${CUSTODY_PACKET_TABLE} AS packet ON packet.id = item.packet_id
        WHERE item.review_on IS NOT NULL
          AND item.review_on <= ?1
          AND item.status IN ('held', 'out')
          AND packet.status IN ('held', 'out')
        ORDER BY review_on ASC, packet_id ASC, item_id ASC
        LIMIT ?2`,
    )
    .bind(asOfDate, limit);
}

export async function readCustodyReviewsDue(
  database: SqlDatabase,
  asOfDate: string,
  limit: number,
): Promise<CustodyReviewDueRow[]> {
  const { results } = await selectCustodyReviewsDueStatement(
    database,
    asOfDate,
    limit,
  ).all<CustodyReviewDueRow>();
  return results;
}

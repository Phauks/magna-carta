import {
  appendCursorPredicate,
  assemblePage,
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  type Page,
  type SortCursor,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  CustodyDestructionRequestId,
  CustodyItemId,
  CustodyMovementId,
  CustodyPacketId,
  UserId,
} from "@magna-carta/identifiers/types";
import { CUSTODY_MOVEMENT_TABLE } from "./movement-statements.ts";
import type { CustodyDestructionOutcome } from "./types.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const CUSTODY_DESTRUCTION_REQUEST_TABLE = "custody_destruction_request";

export interface CustodyDestructionRequestRow {
  readonly id: CustodyDestructionRequestId;
  readonly packet_id: CustodyPacketId;
  readonly item_id: CustodyItemId | null;
  readonly requested_by: UserId | null;
  readonly requested_at: string;
  readonly basis: string;
  readonly approved_by: UserId | null;
  readonly approved_at: string | null;
  readonly refused_by: UserId | null;
  readonly refused_at: string | null;
  readonly refusal_reason: string | null;
  readonly executed_at: string | null;
  readonly executed_by: UserId | null;
  readonly executed_movement_id: CustodyMovementId | null;
  readonly outcome: CustodyDestructionOutcome | null;
}

const REQUEST_COLUMNS =
  "id, packet_id, item_id, requested_by, requested_at, basis, approved_by, approved_at, refused_by, refused_at, refusal_reason, executed_at, executed_by, executed_movement_id, outcome";

export function insertCustodyDestructionRequestStatement(
  database: SqlDatabase,
  row: {
    readonly id: CustodyDestructionRequestId;
    readonly packetId: CustodyPacketId;
    readonly itemId: CustodyItemId | null;
    readonly requestedBy: UserId | null;
    readonly requestedAt: string;
    readonly basis: string;
    readonly createdAt: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_DESTRUCTION_REQUEST_TABLE} (id, packet_id, item_id, requested_by, requested_at, basis, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
    .bind(
      row.id,
      row.packetId,
      row.itemId,
      row.requestedBy,
      row.requestedAt,
      row.basis,
      row.createdAt,
    );
}

// Every decision statement carries its own precondition in the WHERE clause as well as being covered
// by a trigger, and the two do different jobs: the trigger aborts the batch when the rule is broken,
// the WHERE makes a racing second decision match zero rows so the loser changes nothing rather than
// overwriting the winner's name. D1 has no interactive transaction, so a read-then-write needs both.
export function approveCustodyDestructionRequestStatement(
  database: SqlDatabase,
  id: CustodyDestructionRequestId,
  approvedBy: UserId,
  approvedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_DESTRUCTION_REQUEST_TABLE} SET approved_by = ?2, approved_at = ?3, outcome = 'approved', updated_at = ?3 WHERE id = ?1 AND outcome IS NULL AND approved_by IS NULL`,
    )
    .bind(id, approvedBy, approvedAt);
}

export function refuseCustodyDestructionRequestStatement(
  database: SqlDatabase,
  id: CustodyDestructionRequestId,
  refusedBy: UserId | null,
  refusedAt: string,
  reason: string | null,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_DESTRUCTION_REQUEST_TABLE} SET refused_by = ?2, refused_at = ?3, refusal_reason = ?4, outcome = 'refused', updated_at = ?3 WHERE id = ?1 AND outcome IS NULL`,
    )
    .bind(id, refusedBy, refusedAt, reason);
}

// Execution names the ledger row it appended. A request marked executed that named no movement would
// be a destruction the register cannot prove happened, which is the one thing a custody record exists
// to be able to do.
export function executeCustodyDestructionRequestStatement(
  database: SqlDatabase,
  id: CustodyDestructionRequestId,
  executedBy: UserId | null,
  executedAt: string,
  movementId: CustodyMovementId,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_DESTRUCTION_REQUEST_TABLE} SET executed_at = ?3, executed_by = ?2, executed_movement_id = ?4, outcome = 'executed', updated_at = ?3 WHERE id = ?1 AND outcome = 'approved' AND executed_at IS NULL`,
    )
    .bind(id, executedBy, executedAt, movementId);
}

export function withdrawCustodyDestructionRequestStatement(
  database: SqlDatabase,
  id: CustodyDestructionRequestId,
  withdrawnAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_DESTRUCTION_REQUEST_TABLE} SET outcome = 'withdrawn', updated_at = ?2 WHERE id = ?1 AND outcome IS NULL`,
    )
    .bind(id, withdrawnAt);
}

export function selectCustodyDestructionRequestStatement(
  database: SqlDatabase,
  id: CustodyDestructionRequestId,
): SqlStatement {
  return database
    .prepare(`SELECT ${REQUEST_COLUMNS} FROM ${CUSTODY_DESTRUCTION_REQUEST_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readCustodyDestructionRequest(
  database: SqlDatabase,
  id: CustodyDestructionRequestId,
): Promise<CustodyDestructionRequestRow | undefined> {
  const { results } = await selectCustodyDestructionRequestStatement(
    database,
    id,
  ).all<CustodyDestructionRequestRow>();
  return results[0];
}

// The pending queue and the history, in one read shaped by whether an outcome is asked for.
// `pending` is a null outcome — the requests waiting for a second person, which is the list somebody
// actually opens the screen to see.
//
// `interrupted` is the third question this list has to be able to answer. Execution commits the
// ledger row BEFORE the request's completion, deliberately: a destruction with no ledger entry is a
// destruction nobody can prove. The cost of that ordering is that a failure between the two commits
// leaves a proven destruction beside a request still reading `approved` — and `outcome = 'approved'`
// alone cannot tell that request from one genuinely waiting to be carried out, because the only fact
// that distinguishes them lives in a table the filter never joined. So it joins it: `interrupted`
// pairs each approved request against a `destroyed` movement on the same packet at or after the
// approval, which turns "visible and correctable" from a claim in a comment into a list somebody can
// open.
export interface ListCustodyDestructionRequestsFilters {
  readonly packetId?: CustodyPacketId;
  readonly outcome?: CustodyDestructionOutcome | "pending" | "interrupted";
}

export function listCustodyDestructionRequestsStatement(
  database: SqlDatabase,
  filter: ListCustodyDestructionRequestsFilters,
  cursor: SortCursor | undefined,
  limit: number,
): SqlStatement {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (filter.packetId !== undefined) {
    conditions.push("packet_id = ?");
    bindings.push(filter.packetId);
  }
  if (filter.outcome === "pending") {
    conditions.push("outcome IS NULL");
  } else if (filter.outcome === "interrupted") {
    conditions.push("outcome = 'approved'");
    // Item-scoped and packet-scoped destructions both land a `destroyed` movement naming the packet,
    // so the packet is the join key either way; `occurred_at` is back-datable, which is why the
    // correlation is on `recorded_at` — when the row was actually appended.
    conditions.push(
      `EXISTS (SELECT 1 FROM ${CUSTODY_MOVEMENT_TABLE} AS movement
                WHERE movement.packet_id = ${CUSTODY_DESTRUCTION_REQUEST_TABLE}.packet_id
                  AND movement.kind = 'destroyed'
                  AND movement.recorded_at >= ${CUSTODY_DESTRUCTION_REQUEST_TABLE}.approved_at)`,
    );
  } else if (filter.outcome !== undefined) {
    conditions.push("outcome = ?");
    bindings.push(filter.outcome);
  }
  appendCursorPredicate(conditions, bindings, cursor);
  bindings.push(limit);
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")} `;
  return database
    .prepare(
      `SELECT ${REQUEST_COLUMNS}, created_at FROM ${CUSTODY_DESTRUCTION_REQUEST_TABLE} ${where}ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

export async function listCustodyDestructionRequests(
  database: SqlDatabase,
  params: ListCustodyDestructionRequestsFilters & {
    readonly cursor?: string;
    readonly pageSize?: number;
  },
): Promise<Page<CustodyDestructionRequestRow>> {
  const limit = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const { results } = await listCustodyDestructionRequestsStatement(
    database,
    params,
    decodeCursor(params.cursor),
    limit + 1,
  ).all<CustodyDestructionRequestRow & { created_at: string }>();
  return assemblePage(results, limit, (row) => row);
}

// Whether any item covered by this request carries the intrinsic-value flag. A packet-scoped request
// covers every item in the packet: destroying the envelope destroys the will inside it.
export function selectCustodyIntrinsicValueItemCountStatement(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  itemId: CustodyItemId | null,
): SqlStatement {
  return itemId === null
    ? database
        .prepare(
          `SELECT COUNT(*) AS intrinsic_count FROM custody_item WHERE packet_id = ?1 AND intrinsic_value = 1`,
        )
        .bind(packetId)
    : database
        .prepare(
          `SELECT COUNT(*) AS intrinsic_count FROM custody_item WHERE id = ?1 AND intrinsic_value = 1`,
        )
        .bind(itemId);
}

export async function readCustodyIntrinsicValueItemCount(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  itemId: CustodyItemId | null,
): Promise<number> {
  const { results } = await selectCustodyIntrinsicValueItemCountStatement(
    database,
    packetId,
    itemId,
  ).all<{ intrinsic_count: number }>();
  return results[0]?.intrinsic_count ?? 0;
}

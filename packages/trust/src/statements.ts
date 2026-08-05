import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  LedgerAccountId,
  LedgerEntryId,
  MatterId,
  TrustAccountId,
  TrustHoldId,
  TrustLedgerNodeId,
  TrustMovementId,
  TrustTransferId,
  UserId,
} from "@magna-carta/identifiers/types";
import { ACCOUNT_BALANCE_TABLE, MAX_BOUND_PARAMETERS } from "@magna-carta/ledger/statements";
import { assertSafeInteger } from "@magna-carta/money/money";
import type { TrustMovementKind, TrustMovementMethod, TrustNodeKind } from "./types.ts";

// Table names tracked against @magna-carta/database's schema by the schema-name-sync test.
export const TRUST_ACCOUNT_TABLE = "trust_account";
export const TRUST_LEDGER_NODE_TABLE = "trust_ledger_node";
export const TRUST_HOLD_TABLE = "trust_hold";
export const TRUST_TRANSFER_TABLE = "trust_transfer";
export const TRUST_MOVEMENT_TABLE = "trust_movement";

// SQLite stores a float or NaN in an INTEGER column without complaint, silently corrupting an
// amount. Every minor-unit number is asserted at the last boundary before SQL through the money
// package's guard — the same single home for the safe-integer rule the ledger statements use.
function assertMinorUnits(value: number, what: string): number {
  assertSafeInteger(value, `${what} (minor units)`);
  return value;
}

export interface InsertTrustAccountRow {
  readonly id: TrustAccountId;
  readonly name: string;
  readonly locationId: string;
  readonly jurisdiction: string | null;
  readonly bankName: string | null;
  readonly accountNumberLastFour: string | null;
  readonly currency: string;
  readonly iolta: number; // 0 | 1
  readonly bankLedgerAccountId: LedgerAccountId;
  readonly clientLiabilityAccountId: LedgerAccountId;
  readonly openedOn: string;
  readonly createdAt: string;
}

export function insertTrustAccountStatement(
  database: SqlDatabase,
  row: InsertTrustAccountRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_ACCOUNT_TABLE} (id, name, location_id, jurisdiction, bank_name, account_number_last_four, currency, iolta, bank_ledger_account_id, client_liability_account_id, status, opened_on, closed_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'open', ?11, NULL, ?12, ?12)`,
    )
    .bind(
      row.id,
      row.name,
      row.locationId,
      row.jurisdiction,
      row.bankName,
      row.accountNumberLastFour,
      row.currency,
      row.iolta,
      row.bankLedgerAccountId,
      row.clientLiabilityAccountId,
      row.openedOn,
      row.createdAt,
    );
}

export function selectTrustAccountStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, currency, status, jurisdiction, bank_ledger_account_id, client_liability_account_id FROM ${TRUST_ACCOUNT_TABLE} WHERE id = ?1`,
    )
    .bind(trustAccountId);
}

export interface InsertTrustLedgerNodeRow {
  readonly id: TrustLedgerNodeId;
  readonly trustAccountId: TrustAccountId;
  readonly ledgerAccountId: LedgerAccountId;
  readonly kind: TrustNodeKind;
  readonly clientEntityId: string | null;
  readonly matterId: MatterId | null;
  readonly parentNodeId: TrustLedgerNodeId | null;
  readonly createdAt: string;
}

export function insertTrustLedgerNodeStatement(
  database: SqlDatabase,
  row: InsertTrustLedgerNodeRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_LEDGER_NODE_TABLE} (id, trust_account_id, ledger_account_id, kind, client_entity_id, matter_id, parent_node_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      row.id,
      row.trustAccountId,
      row.ledgerAccountId,
      row.kind,
      row.clientEntityId,
      row.matterId,
      row.parentNodeId,
      row.createdAt,
    );
}

const NODE_COLUMNS = `id, trust_account_id, ledger_account_id, kind, client_entity_id, matter_id, parent_node_id`;

export function selectTrustNodeStatement(
  database: SqlDatabase,
  nodeId: TrustLedgerNodeId,
): SqlStatement {
  return database
    .prepare(`SELECT ${NODE_COLUMNS} FROM ${TRUST_LEDGER_NODE_TABLE} WHERE id = ?1`)
    .bind(nodeId);
}

// The lazy-creation read: does this client already have a node under this trust account? A miss
// means the caller composes the node and its first posting in ONE batch, so a created-but-unbounded
// leaf cannot exist even for an instant.
export function selectTrustClientNodeStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  clientEntityId: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${NODE_COLUMNS} FROM ${TRUST_LEDGER_NODE_TABLE} WHERE trust_account_id = ?1 AND client_entity_id = ?2 AND kind = 'client'`,
    )
    .bind(trustAccountId, clientEntityId);
}

export function selectTrustMatterNodeStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${NODE_COLUMNS} FROM ${TRUST_LEDGER_NODE_TABLE} WHERE trust_account_id = ?1 AND matter_id = ?2 AND kind = 'matter'`,
    )
    .bind(trustAccountId, matterId);
}

// THE composition-guard read. For each ledger account on a proposed entry it answers, in one query,
// "what is this account to trust" — a registered node, one of a trust account's two roots, or
// nothing at all. The last case is what makes commingling a detected condition rather than an
// assumed-absent one: an operating, income, or expense account resolves to no trust account, and an
// entry carrying one alongside a trust leaf is refused.
export function selectTrustAccountRolesStatement(
  database: SqlDatabase,
  ledgerAccountIds: readonly LedgerAccountId[],
): SqlStatement {
  if (ledgerAccountIds.length === 0) {
    throw new Error("selectTrustAccountRolesStatement: ledgerAccountIds must be non-empty");
  }
  if (ledgerAccountIds.length > MAX_BOUND_PARAMETERS) {
    throw new Error(
      `selectTrustAccountRolesStatement: ${ledgerAccountIds.length} ledgerAccountIds exceeds D1's bound parameter cap (${MAX_BOUND_PARAMETERS}) — chunk the load`,
    );
  }
  // The same numbered placeholders serve all three IN-lists — SQLite resolves ?N by position in the
  // bind list, not by occurrence, so one bind of the account ids covers the whole union.
  const placeholders = ledgerAccountIds.map((_, index) => `?${index + 1}`).join(", ");
  return database
    .prepare(
      `SELECT n.ledger_account_id AS ledger_account_id, 'node' AS role, n.trust_account_id AS trust_account_id, n.id AS node_id, n.kind AS node_kind, n.client_entity_id AS client_entity_id, n.matter_id AS matter_id FROM ${TRUST_LEDGER_NODE_TABLE} n WHERE n.ledger_account_id IN (${placeholders}) UNION ALL SELECT a.bank_ledger_account_id, 'bank', a.id, NULL, NULL, NULL, NULL FROM ${TRUST_ACCOUNT_TABLE} a WHERE a.bank_ledger_account_id IN (${placeholders}) UNION ALL SELECT a.client_liability_account_id, 'liability_root', a.id, NULL, NULL, NULL, NULL FROM ${TRUST_ACCOUNT_TABLE} a WHERE a.client_liability_account_id IN (${placeholders})`,
    )
    .bind(...ledgerAccountIds);
}

export interface InsertTrustHoldRow {
  readonly id: TrustHoldId;
  readonly nodeId: TrustLedgerNodeId;
  readonly amountMinor: number;
  readonly currency: string;
  readonly reason: string;
  readonly placedAt: string;
  readonly placedBy: UserId | null;
  readonly releasesHoldId: TrustHoldId | null;
}

export function insertTrustHoldStatement(
  database: SqlDatabase,
  row: InsertTrustHoldRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_HOLD_TABLE} (id, node_id, amount_minor, currency, reason, placed_at, placed_by, releases_hold_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      row.id,
      row.nodeId,
      assertMinorUnits(row.amountMinor, "hold amount_minor"),
      row.currency,
      row.reason,
      row.placedAt,
      row.placedBy,
      row.releasesHoldId,
    );
}

// A hold is active when it is a placement and no row names it as released — status DERIVED from the
// link, exactly as a ledger entry's reversed status is. There is no released flag to fall out of
// sync with the rows.
export function selectTrustHoldStatement(database: SqlDatabase, holdId: TrustHoldId): SqlStatement {
  return database
    .prepare(
      `SELECT h.id, h.node_id, h.amount_minor, h.currency, h.releases_hold_id, (SELECT r.id FROM ${TRUST_HOLD_TABLE} r WHERE r.releases_hold_id = h.id) AS released_by_hold_id FROM ${TRUST_HOLD_TABLE} h WHERE h.id = ?1`,
    )
    .bind(holdId);
}

// Available balance for one node: the stored balance minus every active hold. The disbursement
// ceiling reads THIS, never balance_minor — a positive balance whose disputed portion is spoken for
// is not money the firm may pay out.
export function selectTrustAvailableBalanceStatement(
  database: SqlDatabase,
  nodeId: TrustLedgerNodeId,
): SqlStatement {
  return database
    .prepare(
      `SELECT b.balance_minor AS balance_minor, COALESCE((SELECT SUM(p.amount_minor) FROM ${TRUST_HOLD_TABLE} p WHERE p.node_id = n.id AND p.releases_hold_id IS NULL AND NOT EXISTS (SELECT 1 FROM ${TRUST_HOLD_TABLE} r WHERE r.releases_hold_id = p.id)), 0) AS held_minor FROM ${TRUST_LEDGER_NODE_TABLE} n JOIN ${ACCOUNT_BALANCE_TABLE} b ON b.account_id = n.ledger_account_id WHERE n.id = ?1`,
    )
    .bind(nodeId);
}

export interface InsertTrustTransferRow {
  readonly id: TrustTransferId;
  readonly trustAccountId: TrustAccountId;
  readonly fromNodeId: TrustLedgerNodeId;
  readonly amountMinor: number;
  readonly currency: string;
  readonly trustEntryId: LedgerEntryId;
  readonly operatingEntryId: LedgerEntryId;
  readonly authorizedBy: UserId | null;
  readonly effectiveDate: string;
  readonly recordedAt: string;
}

export function insertTrustTransferStatement(
  database: SqlDatabase,
  row: InsertTrustTransferRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_TRANSFER_TABLE} (id, trust_account_id, from_node_id, amount_minor, currency, trust_entry_id, operating_entry_id, authorized_by, effective_date, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      row.id,
      row.trustAccountId,
      row.fromNodeId,
      assertMinorUnits(row.amountMinor, "transfer amount_minor"),
      row.currency,
      row.trustEntryId,
      row.operatingEntryId,
      row.authorizedBy,
      row.effectiveDate,
      row.recordedAt,
    );
}

export interface InsertTrustMovementRow {
  readonly id: TrustMovementId;
  readonly trustAccountId: TrustAccountId;
  readonly kind: TrustMovementKind;
  readonly nodeId: TrustLedgerNodeId;
  readonly counterpartyNodeId: TrustLedgerNodeId | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly entryId: LedgerEntryId;
  readonly method: TrustMovementMethod;
  readonly reference: string | null;
  readonly counterpartyName: string | null;
  readonly purpose: string;
  readonly recordedBy: UserId;
  readonly authorizedBy: UserId | null;
  readonly effectiveDate: string;
  readonly recordedAt: string;
}

// The client-ledger record beside a trust entry. The shape CHECK on the table decides which columns
// each kind may carry, so nothing here has to remember the combinations — a movement row that lies
// about itself aborts the batch that carries the entry it describes.
export function insertTrustMovementStatement(
  database: SqlDatabase,
  row: InsertTrustMovementRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_MOVEMENT_TABLE} (id, trust_account_id, kind, node_id, counterparty_node_id, amount_minor, currency, entry_id, method, reference, counterparty_name, purpose, recorded_by, authorized_by, effective_date, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
    )
    .bind(
      row.id,
      row.trustAccountId,
      row.kind,
      row.nodeId,
      row.counterpartyNodeId,
      assertMinorUnits(row.amountMinor, "movement amount_minor"),
      row.currency,
      row.entryId,
      row.method,
      row.reference,
      row.counterpartyName,
      row.purpose,
      row.recordedBy,
      row.authorizedBy,
      row.effectiveDate,
      row.recordedAt,
    );
}

const MOVEMENT_COLUMNS = `id, trust_account_id, kind, node_id, counterparty_node_id, amount_minor, currency, entry_id, method, reference, counterparty_name, purpose, recorded_by, authorized_by, effective_date, recorded_at`;

export function selectTrustMovementStatement(
  database: SqlDatabase,
  movementId: TrustMovementId,
): SqlStatement {
  return database
    .prepare(`SELECT ${MOVEMENT_COLUMNS} FROM ${TRUST_MOVEMENT_TABLE} WHERE id = ?1`)
    .bind(movementId);
}

// One matter leaf's client ledger, chronological — the report the record-keeping rules name. A
// matter transfer appears on BOTH leaves it touches, which is why the node filter reaches the
// counterparty too: the receiving leaf's ledger must show the funds arriving as plainly as the
// source leaf shows them leaving.
export function selectTrustMovementsForNodeStatement(
  database: SqlDatabase,
  nodeId: TrustLedgerNodeId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${MOVEMENT_COLUMNS} FROM ${TRUST_MOVEMENT_TABLE} WHERE node_id = ?1 OR counterparty_node_id = ?1 ORDER BY effective_date, recorded_at, id`,
    )
    .bind(nodeId);
}

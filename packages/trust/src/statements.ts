import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  LedgerAccountId,
  LedgerEntryId,
  MatterId,
  TrustAccountId,
  TrustBankStatementId,
  TrustBankStatementLineId,
  TrustDisbursementDecisionId,
  TrustDisbursementRequestId,
  TrustHoldId,
  TrustLedgerNodeId,
  TrustMovementId,
  TrustReconciliationId,
  TrustReconciliationMatchId,
  TrustTransferId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  ACCOUNT_BALANCE_TABLE,
  LEDGER_ENTRY_TABLE,
  LEDGER_LINE_TABLE,
  MAX_BOUND_PARAMETERS,
} from "@magna-carta/ledger/statements";
import { assertSafeInteger } from "@magna-carta/money/money";
import type {
  TrustBankStatementLineDirection,
  TrustBankStatementSource,
  TrustDisbursementAuthorizationBasis,
  TrustDisbursementDecisionKind,
  TrustDisbursementMethod,
  TrustFrozenProof,
  TrustMovementKind,
  TrustMovementMethod,
  TrustNodeKind,
} from "./types.ts";

// Table names tracked against @magna-carta/database's schema by the schema-name-sync test.
export const TRUST_ACCOUNT_TABLE = "trust_account";
export const TRUST_LEDGER_NODE_TABLE = "trust_ledger_node";
export const TRUST_HOLD_TABLE = "trust_hold";
export const TRUST_TRANSFER_TABLE = "trust_transfer";
export const TRUST_MOVEMENT_TABLE = "trust_movement";
export const TRUST_DISBURSEMENT_REQUEST_TABLE = "trust_disbursement_request";
export const TRUST_DISBURSEMENT_DECISION_TABLE = "trust_disbursement_decision";
export const TRUST_BANK_STATEMENT_TABLE = "trust_bank_statement";
export const TRUST_BANK_STATEMENT_LINE_TABLE = "trust_bank_statement_line";
export const TRUST_RECONCILIATION_TABLE = "trust_reconciliation";
export const TRUST_RECONCILIATION_MATCH_TABLE = "trust_reconciliation_match";

// The capability a member must hold to submit or approve a trust disbursement. Spelled here as a
// literal because the value it has to agree with is the one baked into the sole-authorizer trigger
// in the per-firm migration, which cannot import anything; both are pinned against the permission
// registry by packages/database/test/trust-disbursement-authorization.test.ts and by this package's
// test/schema-name-sync.test.ts.
export const TRUST_MANAGE_PERMISSION = "trust:manage";

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
// sync with the rows. Written once, as a predicate over a hold alias, because every reader of
// "what is still held" has to agree on it: available balance, the close gate, and the fitness query
// that re-proves them both.
export function activeTrustHoldPredicate(holdAlias: string): string {
  return `${holdAlias}.releases_hold_id IS NULL AND NOT EXISTS (SELECT 1 FROM ${TRUST_HOLD_TABLE} r WHERE r.releases_hold_id = ${holdAlias}.id)`;
}

// What one node has under active holds, as a scalar subquery over a node alias. Shared by the
// available-balance read and the matter-close read so the two can never disagree about what is
// spoken for.
function heldMinorForNode(nodeAlias: string): string {
  return `COALESCE((SELECT SUM(p.amount_minor) FROM ${TRUST_HOLD_TABLE} p WHERE p.node_id = ${nodeAlias}.id AND ${activeTrustHoldPredicate("p")}), 0)`;
}

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
      `SELECT b.balance_minor AS balance_minor, ${heldMinorForNode("n")} AS held_minor FROM ${TRUST_LEDGER_NODE_TABLE} n JOIN ${ACCOUNT_BALANCE_TABLE} b ON b.account_id = n.ledger_account_id WHERE n.id = ?1`,
    )
    .bind(nodeId);
}

// Every matter leaf this matter owns, across every trust account, with what each holds and what is
// under an active hold. The matter-close gate reads this: a matter with no leaf returns no rows and
// closes freely, because the absence of a trust ledger is not a refusal.
export function selectMatterTrustPositionsStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT n.id AS node_id, n.trust_account_id AS trust_account_id, a.name AS trust_account_name, a.currency AS currency, b.balance_minor AS balance_minor, ${heldMinorForNode("n")} AS held_minor FROM ${TRUST_LEDGER_NODE_TABLE} n JOIN ${TRUST_ACCOUNT_TABLE} a ON a.id = n.trust_account_id JOIN ${ACCOUNT_BALANCE_TABLE} b ON b.account_id = n.ledger_account_id WHERE n.matter_id = ?1 AND n.kind = 'matter' ORDER BY a.name, n.id`,
    )
    .bind(matterId);
}

// THE close guard, and the reason it looks like a write it never performs. It rides the matter-close
// batch and re-asks, inside that transaction, the question the close read a moment earlier: does any
// of this matter's client ledgers still hold money, or carry an active disputed-funds hold? When the
// answer is no it matches no rows and costs the batch nothing. When the answer is yes it tries to
// write a `kind` the table's CHECK does not permit, and the constraint aborts the entire batch —
// the close, its audit row, its outbox message, and its idempotency record together. The value can
// never be stored, so this statement cannot corrupt a node even in the case where it fires.
export function refuseMatterCloseWithTrustBalanceStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TRUST_LEDGER_NODE_TABLE} SET kind = 'close-refused-trust-balance' WHERE matter_id = ?1 AND kind = 'matter' AND (EXISTS (SELECT 1 FROM ${ACCOUNT_BALANCE_TABLE} b WHERE b.account_id = ${TRUST_LEDGER_NODE_TABLE}.ledger_account_id AND b.balance_minor <> 0) OR EXISTS (SELECT 1 FROM ${TRUST_HOLD_TABLE} p WHERE p.node_id = ${TRUST_LEDGER_NODE_TABLE}.id AND ${activeTrustHoldPredicate("p")}))`,
    )
    .bind(matterId);
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

const QUALIFIED_MOVEMENT_COLUMNS = `m.id, m.trust_account_id, m.kind, m.node_id, m.counterparty_node_id, m.amount_minor, m.currency, m.entry_id, m.method, m.reference, m.counterparty_name, m.purpose, m.recorded_by, m.authorized_by, m.effective_date, m.recorded_at`;

// One matter leaf's client ledger, chronological — the report the record-keeping rules name. A
// matter transfer appears on BOTH leaves it touches, which is why the node filter reaches the
// counterparty too: the receiving leaf's ledger must show the funds arriving as plainly as the
// source leaf shows them leaving.
//
// The approval facts ride along on the same read. A disbursement authorized by the member who
// submitted it — which only a firm with a single trust manager can produce — must be visible AS SUCH
// wherever the ledger is read, not inferable by noticing that two user handles happen to match.
export function selectTrustMovementsForNodeStatement(
  database: SqlDatabase,
  nodeId: TrustLedgerNodeId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${QUALIFIED_MOVEMENT_COLUMNS}, d.request_id AS disbursement_request_id, d.authorization_basis AS authorization_basis FROM ${TRUST_MOVEMENT_TABLE} m LEFT JOIN ${TRUST_DISBURSEMENT_DECISION_TABLE} d ON d.movement_id = m.id WHERE m.node_id = ?1 OR m.counterparty_node_id = ?1 ORDER BY m.effective_date, m.recorded_at, m.id`,
    )
    .bind(nodeId);
}

export interface InsertTrustDisbursementRequestRow {
  readonly id: TrustDisbursementRequestId;
  readonly trustAccountId: TrustAccountId;
  readonly nodeId: TrustLedgerNodeId;
  readonly amountMinor: number;
  readonly currency: string;
  readonly method: TrustDisbursementMethod;
  readonly reference: string | null;
  readonly payee: string;
  readonly purpose: string;
  readonly description: string;
  readonly effectiveDate: string;
  readonly requestedBy: UserId;
  readonly requestedAt: string;
}

// The pending request. Nothing else in this batch touches the ledger, the balances, or
// trust_movement — a request that is never approved leaves the client ledger exactly as it was.
export function insertTrustDisbursementRequestStatement(
  database: SqlDatabase,
  row: InsertTrustDisbursementRequestRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_DISBURSEMENT_REQUEST_TABLE} (id, trust_account_id, node_id, amount_minor, currency, method, reference, payee, purpose, description, effective_date, requested_by, requested_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .bind(
      row.id,
      row.trustAccountId,
      row.nodeId,
      assertMinorUnits(row.amountMinor, "disbursement request amount_minor"),
      row.currency,
      row.method,
      row.reference,
      row.payee,
      row.purpose,
      row.description,
      row.effectiveDate,
      row.requestedBy,
      row.requestedAt,
    );
}

const DISBURSEMENT_REQUEST_COLUMNS = `r.id, r.trust_account_id, r.node_id, r.amount_minor, r.currency, r.method, r.reference, r.payee, r.purpose, r.description, r.effective_date, r.requested_by, r.requested_at`;
const DISBURSEMENT_DECISION_COLUMNS = `d.id AS decision_id, d.decision, d.decided_by, d.decided_at, d.reason, d.authorization_basis, d.movement_id`;

// One request and whatever settled it. The decision arrives as a LEFT JOIN rather than a column on
// the request, so "pending" is the absence of a decision row and never a stored state that could
// disagree with one.
export function selectTrustDisbursementRequestStatement(
  database: SqlDatabase,
  requestId: TrustDisbursementRequestId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${DISBURSEMENT_REQUEST_COLUMNS}, ${DISBURSEMENT_DECISION_COLUMNS} FROM ${TRUST_DISBURSEMENT_REQUEST_TABLE} r LEFT JOIN ${TRUST_DISBURSEMENT_DECISION_TABLE} d ON d.request_id = r.id WHERE r.id = ?1`,
    )
    .bind(requestId);
}

// The approval queue for one trust account: every request no decision names, oldest first. The
// anti-join is the same derivation the hold model uses for "still active", so there is one way to
// ask what is outstanding rather than a status column and a query that can disagree.
export function selectPendingTrustDisbursementRequestsStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${DISBURSEMENT_REQUEST_COLUMNS} FROM ${TRUST_DISBURSEMENT_REQUEST_TABLE} r WHERE r.trust_account_id = ?1 AND NOT EXISTS (SELECT 1 FROM ${TRUST_DISBURSEMENT_DECISION_TABLE} d WHERE d.request_id = r.id) ORDER BY r.requested_at, r.id`,
    )
    .bind(trustAccountId);
}

export interface InsertTrustDisbursementDecisionRow {
  readonly id: TrustDisbursementDecisionId;
  readonly requestId: TrustDisbursementRequestId;
  readonly decision: TrustDisbursementDecisionKind;
  readonly decidedBy: UserId;
  readonly decidedAt: string;
  readonly reason: string | null;
  readonly authorizationBasis: TrustDisbursementAuthorizationBasis | null;
  readonly movementId: TrustMovementId | null;
}

// The decision, and — on an approval — the row that ties it to the movement it posted. The shape
// CHECK on the table decides which columns each outcome may carry and the triggers decide who may
// write it, so nothing here has to remember either: a decision that lies about itself, or one a
// second person never gave, aborts the batch carrying the posting it claims to authorize.
export function insertTrustDisbursementDecisionStatement(
  database: SqlDatabase,
  row: InsertTrustDisbursementDecisionRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_DISBURSEMENT_DECISION_TABLE} (id, request_id, decision, decided_by, decided_at, reason, authorization_basis, movement_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      row.id,
      row.requestId,
      row.decision,
      row.decidedBy,
      row.decidedAt,
      row.reason,
      row.authorizationBasis,
      row.movementId,
    );
}

// How many ACTIVE members hold the trust capability, counted the way the sole-authorizer trigger in
// the per-firm migration counts them: role-held and directly granted, unioned by member. It exists
// only to turn that trigger's abort into a refusal naming what the submitter has to do instead —
// the trigger is the guarantee, and this read cannot be atomic with the write it precedes.
export function selectActiveTrustManagerCountStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT COUNT(*) AS manager_count FROM (SELECT mr.member_user_id AS user_id FROM member_role mr JOIN role_permission rp ON rp.role_id = mr.role_id JOIN member m ON m.user_id = mr.member_user_id WHERE rp.permission = '${TRUST_MANAGE_PERMISSION}' AND m.status = 'active' UNION SELECT dg.member_user_id FROM direct_grant dg JOIN member m ON m.user_id = dg.member_user_id WHERE dg.permission = '${TRUST_MANAGE_PERMISSION}' AND m.status = 'active')`,
  );
}

// A ceiling on every reconciliation read. A month of activity on one trust account is hundreds of
// items, not thousands; this exists so a runaway period truncates to an obviously-short answer
// instead of pulling an unbounded result set into a request handler.
export const MAX_TRUST_RECONCILIATION_ROWS = 5_000;

export interface InsertTrustBankStatementRow {
  readonly id: TrustBankStatementId;
  readonly trustAccountId: TrustAccountId;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly openingBalanceMinor: number;
  readonly closingBalanceMinor: number;
  readonly currency: string;
  readonly statementReference: string | null;
  readonly source: TrustBankStatementSource;
  readonly supersedesStatementId: TrustBankStatementId | null;
  readonly recordedBy: UserId;
  readonly recordedAt: string;
}

// The bank's own figures. The two balances are SIGNED and asserted only as safe integers, never as
// positive: a trust bank account really can be overdrawn, and refusing to record that would refuse
// to record the exact condition a reconciliation exists to surface.
export function insertTrustBankStatementStatement(
  database: SqlDatabase,
  row: InsertTrustBankStatementRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_BANK_STATEMENT_TABLE} (id, trust_account_id, period_start, period_end, opening_balance_minor, closing_balance_minor, currency, statement_reference, source, supersedes_statement_id, recorded_by, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(
      row.id,
      row.trustAccountId,
      row.periodStart,
      row.periodEnd,
      assertMinorUnits(row.openingBalanceMinor, "statement opening_balance_minor"),
      assertMinorUnits(row.closingBalanceMinor, "statement closing_balance_minor"),
      row.currency,
      row.statementReference,
      row.source,
      row.supersedesStatementId,
      row.recordedBy,
      row.recordedAt,
    );
}

const BANK_STATEMENT_COLUMNS = `id, trust_account_id, period_start, period_end, opening_balance_minor, closing_balance_minor, currency, statement_reference, source, supersedes_statement_id, recorded_by, recorded_at`;

export function selectTrustBankStatementStatement(
  database: SqlDatabase,
  statementId: TrustBankStatementId,
): SqlStatement {
  return database
    .prepare(`SELECT ${BANK_STATEMENT_COLUMNS} FROM ${TRUST_BANK_STATEMENT_TABLE} WHERE id = ?1`)
    .bind(statementId);
}

// The statements recorded for one account, most recent period first — what a member picks from when
// starting a reconciliation.
export function selectTrustBankStatementsForAccountStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  limit: number = MAX_TRUST_RECONCILIATION_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${BANK_STATEMENT_COLUMNS} FROM ${TRUST_BANK_STATEMENT_TABLE} WHERE trust_account_id = ?1 ORDER BY period_end DESC, id LIMIT ?2`,
    )
    .bind(trustAccountId, limit);
}

export interface InsertTrustBankStatementLineRow {
  readonly id: TrustBankStatementLineId;
  readonly statementId: TrustBankStatementId;
  readonly postedOn: string;
  readonly direction: TrustBankStatementLineDirection;
  readonly amountMinor: number;
  readonly description: string;
  readonly reference: string | null;
  readonly counterpartyName: string | null;
  readonly sourceRowNumber: number | null;
  readonly recordedAt: string;
}

export function insertTrustBankStatementLineStatement(
  database: SqlDatabase,
  row: InsertTrustBankStatementLineRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_BANK_STATEMENT_LINE_TABLE} (id, statement_id, posted_on, direction, amount_minor, description, reference, counterparty_name, source_row_number, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      row.id,
      row.statementId,
      row.postedOn,
      row.direction,
      assertMinorUnits(row.amountMinor, "statement line amount_minor"),
      row.description,
      row.reference,
      row.counterpartyName,
      row.sourceRowNumber,
      row.recordedAt,
    );
}

const BANK_STATEMENT_LINE_COLUMNS = `id, statement_id, posted_on, direction, amount_minor, description, reference, counterparty_name, source_row_number`;

export function selectTrustBankStatementLinesStatement(
  database: SqlDatabase,
  statementId: TrustBankStatementId,
  limit: number = MAX_TRUST_RECONCILIATION_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${BANK_STATEMENT_LINE_COLUMNS} FROM ${TRUST_BANK_STATEMENT_LINE_TABLE} WHERE statement_id = ?1 ORDER BY posted_on, id LIMIT ?2`,
    )
    .bind(statementId, limit);
}

export interface InsertTrustReconciliationRow {
  readonly id: TrustReconciliationId;
  readonly trustAccountId: TrustAccountId;
  readonly statementId: TrustBankStatementId;
  readonly openedBy: UserId;
  readonly openedAt: string;
  readonly supersedesReconciliationId: TrustReconciliationId | null;
  readonly note: string | null;
}

// Opened, and carrying no proof at all. Every frozen column stays null until the close writes them,
// which the table's shape CHECK states rather than leaving to this composer to remember.
export function insertTrustReconciliationStatement(
  database: SqlDatabase,
  row: InsertTrustReconciliationRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_RECONCILIATION_TABLE} (id, trust_account_id, statement_id, status, opened_by, opened_at, closed_by, closed_at, frozen_statement_closing_minor, frozen_outstanding_deposits_minor, frozen_outstanding_disbursements_minor, frozen_adjusted_bank_minor, frozen_book_balance_minor, frozen_client_total_minor, frozen_unmatched_line_count, frozen_unmatched_movement_count, frozen_balanced, supersedes_reconciliation_id, note) VALUES (?1, ?2, ?3, 'open', ?4, ?5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?6, ?7)`,
    )
    .bind(
      row.id,
      row.trustAccountId,
      row.statementId,
      row.openedBy,
      row.openedAt,
      row.supersedesReconciliationId,
      row.note,
    );
}

const RECONCILIATION_COLUMNS = `id, trust_account_id, statement_id, status, opened_by, opened_at, closed_by, closed_at, frozen_statement_closing_minor, frozen_outstanding_deposits_minor, frozen_outstanding_disbursements_minor, frozen_adjusted_bank_minor, frozen_book_balance_minor, frozen_client_total_minor, frozen_unmatched_line_count, frozen_unmatched_movement_count, frozen_balanced, supersedes_reconciliation_id, note`;

export function selectTrustReconciliationStatement(
  database: SqlDatabase,
  reconciliationId: TrustReconciliationId,
): SqlStatement {
  return database
    .prepare(`SELECT ${RECONCILIATION_COLUMNS} FROM ${TRUST_RECONCILIATION_TABLE} WHERE id = ?1`)
    .bind(reconciliationId);
}

export function selectTrustReconciliationsForAccountStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  limit: number = MAX_TRUST_RECONCILIATION_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${RECONCILIATION_COLUMNS} FROM ${TRUST_RECONCILIATION_TABLE} WHERE trust_account_id = ?1 ORDER BY opened_at DESC, id LIMIT ?2`,
    )
    .bind(trustAccountId, limit);
}

// THE FREEZE. The `status = 'open'` guard rides the write because D1 has no interactive
// transaction: a second close arriving concurrently matches zero rows and changes nothing rather
// than overwriting the proof the first one froze. The migration's triggers make the same rule
// structural — a closed row refuses every further update — so this guard is the nicer error in front
// of the real mechanism, never the mechanism itself.
export function closeTrustReconciliationStatement(
  database: SqlDatabase,
  reconciliationId: TrustReconciliationId,
  proof: TrustFrozenProof,
  closedBy: UserId,
  closedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TRUST_RECONCILIATION_TABLE} SET status = 'closed', closed_by = ?2, closed_at = ?3, frozen_statement_closing_minor = ?4, frozen_outstanding_deposits_minor = ?5, frozen_outstanding_disbursements_minor = ?6, frozen_adjusted_bank_minor = ?7, frozen_book_balance_minor = ?8, frozen_client_total_minor = ?9, frozen_unmatched_line_count = ?10, frozen_unmatched_movement_count = ?11, frozen_balanced = ?12 WHERE id = ?1 AND status = 'open'`,
    )
    .bind(
      reconciliationId,
      closedBy,
      closedAt,
      assertMinorUnits(proof.statementClosingMinor, "frozen statement_closing_minor"),
      assertMinorUnits(proof.outstandingDepositsMinor, "frozen outstanding_deposits_minor"),
      assertMinorUnits(
        proof.outstandingDisbursementsMinor,
        "frozen outstanding_disbursements_minor",
      ),
      assertMinorUnits(proof.adjustedBankMinor, "frozen adjusted_bank_minor"),
      assertMinorUnits(proof.bookBalanceMinor, "frozen book_balance_minor"),
      assertMinorUnits(proof.clientLedgerTotalMinor, "frozen client_total_minor"),
      proof.unmatchedLineCount,
      proof.unmatchedItemCount,
      proof.balanced ? 1 : 0,
    );
}

export interface InsertTrustReconciliationMatchRow {
  readonly id: TrustReconciliationMatchId;
  readonly reconciliationId: TrustReconciliationId;
  readonly statementLineId: TrustBankStatementLineId;
  readonly entryId: LedgerEntryId;
  readonly unmatchesMatchId: TrustReconciliationMatchId | null;
  readonly matchedBy: UserId;
  readonly matchedAt: string;
}

// A person's assertion, written by a person's act. There is no code path anywhere that composes one
// of these from a suggestion without a caller naming both ends.
export function insertTrustReconciliationMatchStatement(
  database: SqlDatabase,
  row: InsertTrustReconciliationMatchRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_RECONCILIATION_MATCH_TABLE} (id, reconciliation_id, statement_line_id, entry_id, unmatches_match_id, matched_by, matched_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      row.id,
      row.reconciliationId,
      row.statementLineId,
      row.entryId,
      row.unmatchesMatchId,
      row.matchedBy,
      row.matchedAt,
    );
}

// A match is active when it is an assertion and no row withdraws it — status DERIVED from the link,
// exactly as an active hold is. Written once, as a predicate over a match alias, because every
// reader of "what is still matched" has to agree on it: the unmatched-line list, the outstanding
// item list, and the fitness query that re-proves both.
export function activeTrustReconciliationMatchPredicate(matchAlias: string): string {
  return `${matchAlias}.unmatches_match_id IS NULL AND NOT EXISTS (SELECT 1 FROM ${TRUST_RECONCILIATION_MATCH_TABLE} w WHERE w.unmatches_match_id = ${matchAlias}.id)`;
}

// The stronger predicate the OUTSTANDING read uses: active, and belonging to a reconciliation
// nothing supersedes. A closed reconciliation's matches are frozen and can never be withdrawn, so
// without this a match that turned out to be wrong would suppress its item from every future
// outstanding list forever. Superseding the reconciliation is the remedy, and this is what makes it
// one: the replacement re-asserts the matches that were right and simply omits the one that was not.
export function bindingTrustReconciliationMatchPredicate(matchAlias: string): string {
  return `${activeTrustReconciliationMatchPredicate(matchAlias)} AND NOT EXISTS (SELECT 1 FROM ${TRUST_RECONCILIATION_TABLE} s WHERE s.supersedes_reconciliation_id = ${matchAlias}.reconciliation_id)`;
}

const RECONCILIATION_MATCH_COLUMNS = `x.id, x.reconciliation_id, x.statement_line_id, x.entry_id, x.unmatches_match_id, x.matched_by, x.matched_at`;

export function selectTrustReconciliationMatchStatement(
  database: SqlDatabase,
  matchId: TrustReconciliationMatchId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${RECONCILIATION_MATCH_COLUMNS}, (SELECT w.id FROM ${TRUST_RECONCILIATION_MATCH_TABLE} w WHERE w.unmatches_match_id = x.id) AS unmatched_by_match_id FROM ${TRUST_RECONCILIATION_MATCH_TABLE} x WHERE x.id = ?1`,
    )
    .bind(matchId);
}

// What one reconciliation still holds matched, oldest first.
export function selectActiveTrustReconciliationMatchesStatement(
  database: SqlDatabase,
  reconciliationId: TrustReconciliationId,
  limit: number = MAX_TRUST_RECONCILIATION_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${RECONCILIATION_MATCH_COLUMNS}, NULL AS unmatched_by_match_id FROM ${TRUST_RECONCILIATION_MATCH_TABLE} x WHERE x.reconciliation_id = ?1 AND ${activeTrustReconciliationMatchPredicate("x")} ORDER BY x.matched_at, x.id LIMIT ?2`,
    )
    .bind(reconciliationId, limit);
}

// The statement lines this reconciliation has not tied to anything. Scoped to THIS reconciliation —
// unlike the outstanding-item read, which asks whether an item has reached any statement at all —
// because the proof is about one period and a line's fate in some other reconciliation says nothing
// about whether this one accounted for it.
export function selectUnmatchedTrustBankStatementLinesStatement(
  database: SqlDatabase,
  reconciliationId: TrustReconciliationId,
  statementId: TrustBankStatementId,
  limit: number = MAX_TRUST_RECONCILIATION_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${BANK_STATEMENT_LINE_COLUMNS} FROM ${TRUST_BANK_STATEMENT_LINE_TABLE} l WHERE l.statement_id = ?2 AND NOT EXISTS (SELECT 1 FROM ${TRUST_RECONCILIATION_MATCH_TABLE} x WHERE x.statement_line_id = l.id AND x.reconciliation_id = ?1 AND ${activeTrustReconciliationMatchPredicate("x")}) ORDER BY l.posted_on, l.id LIMIT ?3`,
    )
    .bind(reconciliationId, statementId, limit);
}

// THE BOOK LEG, as of a civil date. The trust bank account is an asset, so a debit adds; summing
// every line on it up to the period end reproduces exactly, and keeps reproducing, because reports
// read `effective_date` and a reversal is its own dated entry rather than an edit. Deliberately not
// the stored `account_balance`, which is a live figure with no as-of.
export function selectTrustBookBalanceAsOfStatement(
  database: SqlDatabase,
  bankLedgerAccountId: LedgerAccountId,
  asOfDate: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = 'debit' THEN l.amount_minor ELSE -l.amount_minor END), 0) AS balance_minor FROM ${LEDGER_LINE_TABLE} l JOIN ${LEDGER_ENTRY_TABLE} e ON e.id = l.entry_id WHERE l.account_id = ?1 AND e.effective_date <= ?2`,
    )
    .bind(bankLedgerAccountId, asOfDate);
}

// THE CLIENT LEG, as of the same date: every ledger account the sub-ledger tree names under this
// trust account, summed in liability terms. It walks the nodes rather than reading any parent's
// stored balance, because a roll-up's stored balance stays at zero forever and reading one would
// silently report that the clients hold nothing.
export function selectTrustClientLedgerTotalAsOfStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  asOfDate: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = 'credit' THEN l.amount_minor ELSE -l.amount_minor END), 0) AS total_minor FROM ${TRUST_LEDGER_NODE_TABLE} n JOIN ${LEDGER_LINE_TABLE} l ON l.account_id = n.ledger_account_id JOIN ${LEDGER_ENTRY_TABLE} e ON e.id = l.entry_id WHERE n.trust_account_id = ?1 AND e.effective_date <= ?2`,
    )
    .bind(trustAccountId, asOfDate);
}

// THE OUTSTANDING ITEMS: everything the firm recorded on or before the period end that moved this
// account's bank balance and that no binding match ties to a statement line. Keyed by the LEDGER
// ENTRY, so an earned-fee transfer out of trust — which records a trust_transfer and no movement row
// at all — appears here exactly as a disbursement does. The movement and transfer records are
// LEFT-joined for display; an item with neither would be an entry that reached the trust bank
// without any trust record beside it, which the fitness suite treats as corruption rather than as a
// row to hide.
export function selectOutstandingTrustBankItemsStatement(
  database: SqlDatabase,
  bankLedgerAccountId: LedgerAccountId,
  asOfDate: string,
  limit: number = MAX_TRUST_RECONCILIATION_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT e.id AS entry_id, e.effective_date AS effective_date, e.description AS description, SUM(CASE WHEN l.direction = 'debit' THEN l.amount_minor ELSE -l.amount_minor END) AS bank_delta_minor, m.id AS movement_id, m.kind AS movement_kind, m.reference AS reference, m.counterparty_name AS counterparty_name, t.id AS transfer_id FROM ${LEDGER_ENTRY_TABLE} e JOIN ${LEDGER_LINE_TABLE} l ON l.entry_id = e.id LEFT JOIN ${TRUST_MOVEMENT_TABLE} m ON m.entry_id = e.id LEFT JOIN ${TRUST_TRANSFER_TABLE} t ON t.trust_entry_id = e.id WHERE l.account_id = ?1 AND e.effective_date <= ?2 AND NOT EXISTS (SELECT 1 FROM ${TRUST_RECONCILIATION_MATCH_TABLE} x WHERE x.entry_id = e.id AND ${bindingTrustReconciliationMatchPredicate("x")}) GROUP BY e.id, e.effective_date, e.description, m.id, m.kind, m.reference, m.counterparty_name, t.id ORDER BY e.effective_date, e.id LIMIT ?3`,
    )
    .bind(bankLedgerAccountId, asOfDate, limit);
}

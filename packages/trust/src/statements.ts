import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  LedgerAccountId,
  LedgerEntryId,
  MatterId,
  TrustAccountId,
  TrustDisbursementDecisionId,
  TrustDisbursementRequestId,
  TrustHoldId,
  TrustLedgerNodeId,
  TrustMovementId,
  TrustTransferId,
  UserId,
} from "@magna-carta/identifiers/types";
import { ACCOUNT_BALANCE_TABLE, MAX_BOUND_PARAMETERS } from "@magna-carta/ledger/statements";
import { assertSafeInteger } from "@magna-carta/money/money";
import type {
  TrustDisbursementAuthorizationBasis,
  TrustDisbursementDecisionKind,
  TrustDisbursementMethod,
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

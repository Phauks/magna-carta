import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  LedgerAccountId,
  LedgerEntryId,
  MatterId,
  TrustAccountId,
  TrustAuthorizationPolicyId,
  TrustBankStatementId,
  TrustBankStatementLineId,
  TrustDisbursementDecisionId,
  TrustDisbursementRequestId,
  TrustFirmFundsMovementId,
  TrustHoldId,
  TrustLedgerNodeId,
  TrustMovementId,
  TrustReconciliationId,
  TrustReconciliationMatchId,
  TrustTransferId,
  TrustUnclaimedFundsContactAttemptId,
  TrustUnclaimedFundsReviewClosureId,
  TrustUnclaimedFundsReviewId,
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
  TrustAuthorizationPolicyKind,
  TrustBankStatementLineDirection,
  TrustBankStatementSource,
  TrustDisbursementAuthorizationBasis,
  TrustDisbursementDecisionKind,
  TrustDisbursementMethod,
  TrustDisbursementRequestKind,
  TrustFirmFundsMovementKind,
  TrustFirmFundsMovementMethod,
  TrustFrozenProof,
  TrustMovementKind,
  TrustMovementMethod,
  TrustNodeKind,
  TrustUnclaimedFundsContactChannel,
  TrustUnclaimedFundsContactOutcome,
  TrustUnclaimedFundsReviewOutcome,
} from "./types.ts";

// Table names tracked against @magna-carta/database's schema by the schema-name-sync test.
export const TRUST_ACCOUNT_TABLE = "trust_account";
// The office a trust account belongs to; read here only for the listing's time zone column.
const LOCATION_TABLE = "location";
// The matter a client ledger belongs to, read here only for the number and title a person reads a
// queued request by. Nothing in this package decides anything from a matter row — the money facts
// come from the trust tables, and this join is a caption.
const MATTER_TABLE = "matter";
export const TRUST_LEDGER_NODE_TABLE = "trust_ledger_node";
export const TRUST_HOLD_TABLE = "trust_hold";
export const TRUST_TRANSFER_TABLE = "trust_transfer";
export const TRUST_MOVEMENT_TABLE = "trust_movement";
export const TRUST_DISBURSEMENT_REQUEST_TABLE = "trust_disbursement_request";
export const TRUST_DISBURSEMENT_DECISION_TABLE = "trust_disbursement_decision";
export const TRUST_AUTHORIZATION_POLICY_TABLE = "trust_authorization_policy";
export const TRUST_BANK_STATEMENT_TABLE = "trust_bank_statement";
export const TRUST_BANK_STATEMENT_LINE_TABLE = "trust_bank_statement_line";
export const TRUST_RECONCILIATION_TABLE = "trust_reconciliation";
export const TRUST_RECONCILIATION_MATCH_TABLE = "trust_reconciliation_match";
export const TRUST_FIRM_FUNDS_MOVEMENT_TABLE = "trust_firm_funds_movement";
export const TRUST_UNCLAIMED_FUNDS_REVIEW_TABLE = "trust_unclaimed_funds_review";
export const TRUST_UNCLAIMED_FUNDS_CONTACT_ATTEMPT_TABLE = "trust_unclaimed_funds_contact_attempt";
export const TRUST_UNCLAIMED_FUNDS_REVIEW_CLOSURE_TABLE = "trust_unclaimed_funds_review_closure";

// The capability a member must hold to submit or approve a trust disbursement. Spelled here as a
// literal because the value it has to agree with is the one baked into the sole-authorizer trigger
// in the per-firm migration, which cannot import anything; both are pinned against the permission
// registry by packages/database/test/trust-disbursement-authorization.test.ts and by this package's
// test/schema-name-sync.test.ts.
export const TRUST_MANAGE_PERMISSION = "trust:manage";

// The authority to act on client money — the capability the firm's authorization policy can require
// of whoever lets a disbursement or an earned-fee application go. Spelled here as a literal for the
// same reason as TRUST_MANAGE_PERMISSION: the value must agree with the authority triggers baked
// into the per-firm migration, which cannot import anything.
export const TRUST_AUTHORIZE_PERMISSION = "trust:authorize";

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
      `SELECT id, currency, status, jurisdiction, iolta, bank_ledger_account_id, client_liability_account_id FROM ${TRUST_ACCOUNT_TABLE} WHERE id = ?1`,
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
// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
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
  readonly authorizedBy: UserId;
  readonly recordedBy: UserId;
  readonly policyId: TrustAuthorizationPolicyId | null;
  readonly approvedRequestId: TrustDisbursementRequestId | null;
  readonly effectiveDate: string;
  readonly recordedAt: string;
}

export function insertTrustTransferStatement(
  database: SqlDatabase,
  row: InsertTrustTransferRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_TRANSFER_TABLE} (id, trust_account_id, from_node_id, amount_minor, currency, trust_entry_id, operating_entry_id, authorized_by, recorded_by, policy_id, approved_request_id, effective_date, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
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
      row.recordedBy,
      row.policyId,
      row.approvedRequestId,
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
  readonly kind: TrustDisbursementRequestKind;
  readonly operatingDescription: string | null;
  readonly policyId: TrustAuthorizationPolicyId | null;
}

// The pending request. Nothing else in this batch touches the ledger, the balances, or
// trust_movement — a request that is never approved leaves the client ledger exactly as it was.
export function insertTrustDisbursementRequestStatement(
  database: SqlDatabase,
  row: InsertTrustDisbursementRequestRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_DISBURSEMENT_REQUEST_TABLE} (id, trust_account_id, node_id, amount_minor, currency, method, reference, payee, purpose, description, effective_date, requested_by, requested_at, kind, operating_description, policy_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
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
      row.kind,
      row.operatingDescription,
      row.policyId,
    );
}

const DISBURSEMENT_REQUEST_COLUMNS = `r.id, r.trust_account_id, r.node_id, r.amount_minor, r.currency, r.method, r.reference, r.payee, r.purpose, r.description, r.effective_date, r.requested_by, r.requested_at, r.kind, r.operating_description, r.policy_id`;
const DISBURSEMENT_DECISION_COLUMNS = `d.id AS decision_id, d.decision, d.decided_by, d.decided_at, d.reason, d.authorization_basis, d.movement_id, d.transfer_id`;

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

// A request is PENDING when no decision names it — status derived from the absence of a row, the
// same derivation the hold model uses for "still active". Written once, as a predicate over a
// request alias, because the queue a member works from and the count an account's position reports
// have to mean the same thing: two spellings of the anti-join would each answer plausibly, and the
// day they disagreed nothing would say so.
export function pendingTrustDisbursementRequestPredicate(requestAlias: string): string {
  return `NOT EXISTS (SELECT 1 FROM ${TRUST_DISBURSEMENT_DECISION_TABLE} d WHERE d.request_id = ${requestAlias}.id)`;
}

// The approval queue for one trust account: every request no decision names, oldest first.
//
// The matter is joined through the request's own node rather than carried on the request row, and it
// is a CAPTION: an approver reading a payee and an amount cannot tell whose money it is without the
// matter it would leave, and one join over the queue is the alternative to a read per row. A request
// filed against a node that is not a matter leaf comes back with all three matter columns null,
// which is the honest answer rather than an omitted row.
export function selectPendingTrustDisbursementRequestsStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${DISBURSEMENT_REQUEST_COLUMNS}, n.matter_id AS matter_id, mt.matter_number AS matter_number, mt.title AS matter_title FROM ${TRUST_DISBURSEMENT_REQUEST_TABLE} r LEFT JOIN ${TRUST_LEDGER_NODE_TABLE} n ON n.id = r.node_id LEFT JOIN ${MATTER_TABLE} mt ON mt.id = n.matter_id WHERE r.trust_account_id = ?1 AND ${pendingTrustDisbursementRequestPredicate("r")} ORDER BY r.requested_at, r.id`,
    )
    .bind(trustAccountId);
}

// How many requests on one account nobody has decided yet, off the same predicate the queue is
// derived from. A count rather than the queue itself, because a position report wants the number
// and a member working the queue wants the rows.
export function selectPendingTrustDisbursementRequestCountStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): SqlStatement {
  return database
    .prepare(
      `SELECT COUNT(*) AS row_count FROM ${TRUST_DISBURSEMENT_REQUEST_TABLE} r WHERE r.trust_account_id = ?1 AND ${pendingTrustDisbursementRequestPredicate("r")}`,
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
  readonly transferId: TrustTransferId | null;
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
      `INSERT INTO ${TRUST_DISBURSEMENT_DECISION_TABLE} (id, request_id, decision, decided_by, decided_at, reason, authorization_basis, movement_id, transfer_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
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
      row.transferId,
    );
}

// WHICH ACTIVE MEMBERS hold the trust capability, selected the way the sole-authorizer trigger in
// the per-firm migration counts them: role-held and directly granted, unioned by member. It exists
// only to turn that trigger's abort into a refusal naming what the submitter has to do instead —
// the trigger is the guarantee, and this read cannot be atomic with the write it precedes.
//
// The members are NAMED rather than counted, because the count on its own produces a refusal a firm
// cannot act on. The trigger deliberately counts a direct grant whether or not it has expired —
// over-counting authorizers refuses the sole-manager exception, which is the safe direction — but
// the consequence is unbounded in time: a one-person firm that once granted `trust:manage` to a
// contractor whose grant lapsed a year ago is told it "has more than one member who can authorize"
// and has no way to see who that is. Listing them makes the stale grant findable.
export function selectActiveTrustManagersStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT user_id, display_name FROM (SELECT mr.member_user_id AS user_id, m.display_name AS display_name FROM member_role mr JOIN role_permission rp ON rp.role_id = mr.role_id JOIN member m ON m.user_id = mr.member_user_id WHERE rp.permission = '${TRUST_MANAGE_PERMISSION}' AND m.status = 'active' UNION SELECT dg.member_user_id, m.display_name FROM direct_grant dg JOIN member m ON m.user_id = dg.member_user_id WHERE dg.permission = '${TRUST_MANAGE_PERMISSION}' AND m.status = 'active') ORDER BY display_name, user_id`,
  );
}

// WHICH ACTIVE MEMBERS hold the authority capability, selected the way the authority triggers in the
// per-firm migration test membership: role-held and directly granted, unioned by member. Like the
// trust-manager read above, it exists to turn a trigger's abort into a refusal naming who CAN act —
// the trigger is the guarantee.
export function selectActiveTrustAuthorityHoldersStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT user_id, display_name FROM (SELECT mr.member_user_id AS user_id, m.display_name AS display_name FROM member_role mr JOIN role_permission rp ON rp.role_id = mr.role_id JOIN member m ON m.user_id = mr.member_user_id WHERE rp.permission = '${TRUST_AUTHORIZE_PERMISSION}' AND m.status = 'active' UNION SELECT dg.member_user_id, m.display_name FROM direct_grant dg JOIN member m ON m.user_id = dg.member_user_id WHERE dg.permission = '${TRUST_AUTHORIZE_PERMISSION}' AND m.status = 'active') ORDER BY display_name, user_id`,
  );
}

export interface InsertTrustAuthorizationPolicyRow {
  readonly id: TrustAuthorizationPolicyId;
  readonly version: number;
  readonly policy: TrustAuthorizationPolicyKind;
  readonly thresholdAmountMinor: number | null;
  readonly requireAuthorizedApprover: boolean;
  readonly setBy: UserId;
  readonly setAt: string;
}

// One new immutable policy version. The version-dense trigger and the UNIQUE index are what settle a
// race between two concurrent posture changes: both compute the same next version and the loser's
// batch aborts, so "the current policy" is always MAX(version) with no tie to break.
export function insertTrustAuthorizationPolicyStatement(
  database: SqlDatabase,
  row: InsertTrustAuthorizationPolicyRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_AUTHORIZATION_POLICY_TABLE} (id, version, policy, threshold_amount_minor, require_authorized_approver, set_by, set_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      row.id,
      row.version,
      row.policy,
      row.thresholdAmountMinor === null
        ? null
        : assertMinorUnits(row.thresholdAmountMinor, "authorization policy threshold_amount_minor"),
      row.requireAuthorizedApprover ? 1 : 0,
      row.setBy,
      row.setAt,
    );
}

const AUTHORIZATION_POLICY_COLUMNS = `id, version, policy, threshold_amount_minor, require_authorized_approver, set_by, set_at`;

export function selectCurrentTrustAuthorizationPolicyStatement(
  database: SqlDatabase,
): SqlStatement {
  return database.prepare(
    `SELECT ${AUTHORIZATION_POLICY_COLUMNS} FROM ${TRUST_AUTHORIZATION_POLICY_TABLE} ORDER BY version DESC LIMIT 1`,
  );
}

export function selectTrustAuthorizationPolicyStatement(
  database: SqlDatabase,
  policyId: TrustAuthorizationPolicyId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${AUTHORIZATION_POLICY_COLUMNS} FROM ${TRUST_AUTHORIZATION_POLICY_TABLE} WHERE id = ?1`,
    )
    .bind(policyId);
}

// Every version the firm has ever written, newest first — the history a firm answers "who changed
// our money-movement posture, when, from what to what" out of, read directly from the append-only
// rows rather than reconstructed from audit metadata.
export function selectTrustAuthorizationPolicyHistoryStatement(
  database: SqlDatabase,
): SqlStatement {
  return database.prepare(
    `SELECT ${AUTHORIZATION_POLICY_COLUMNS} FROM ${TRUST_AUTHORIZATION_POLICY_TABLE} ORDER BY version DESC`,
  );
}

// A ceiling on every reconciliation read, so a runaway period cannot pull an unbounded result set
// into a request handler. A month of activity on one trust account is hundreds of items, not
// thousands — but the outstanding-item read has no lower date bound (an uncleared check from two
// years ago is still outstanding, which is exactly what reconciliation exists to surface), so a
// long-lived account genuinely accumulates toward this number.
//
// THE CAP IS DETECTED, NEVER SILENT. A truncated outstanding list does not produce a short answer,
// it produces a confidently wrong one: the proof's totals, its adjusted bank figure, and the numbers
// a close FREEZES as the firm's attestation are all derived from whatever rows came back, and they
// are internally consistent with each other whether or not they are consistent with reality. So the
// read asks for one row more than the cap and the proof refuses by name when that row appears —
// a reconciliation that cannot see all of its outstanding items must not attest to a total.
export const MAX_TRUST_RECONCILIATION_ROWS = 5_000;

// One past the ceiling: the extra row is never used as data, only as the signal that the ceiling
// bound.
export const TRUST_RECONCILIATION_TRUNCATION_PROBE_ROWS = MAX_TRUST_RECONCILIATION_ROWS + 1;

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
      `INSERT INTO ${TRUST_RECONCILIATION_TABLE} (id, trust_account_id, statement_id, status, opened_by, opened_at, closed_by, closed_at, frozen_statement_closing_minor, frozen_outstanding_deposits_minor, frozen_outstanding_disbursements_minor, frozen_adjusted_bank_minor, frozen_book_balance_minor, frozen_client_total_minor, frozen_unmatched_line_count, frozen_unmatched_movement_count, frozen_firm_funds_minor, frozen_balanced, supersedes_reconciliation_id, note) VALUES (?1, ?2, ?3, 'open', ?4, ?5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?6, ?7)`,
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

const RECONCILIATION_COLUMNS = `id, trust_account_id, statement_id, status, opened_by, opened_at, closed_by, closed_at, frozen_statement_closing_minor, frozen_outstanding_deposits_minor, frozen_outstanding_disbursements_minor, frozen_adjusted_bank_minor, frozen_book_balance_minor, frozen_client_total_minor, frozen_unmatched_line_count, frozen_unmatched_movement_count, frozen_firm_funds_minor, frozen_balanced, supersedes_reconciliation_id, note`;

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
      `UPDATE ${TRUST_RECONCILIATION_TABLE} SET status = 'closed', closed_by = ?2, closed_at = ?3, frozen_statement_closing_minor = ?4, frozen_outstanding_deposits_minor = ?5, frozen_outstanding_disbursements_minor = ?6, frozen_adjusted_bank_minor = ?7, frozen_book_balance_minor = ?8, frozen_client_total_minor = ?9, frozen_unmatched_line_count = ?10, frozen_unmatched_movement_count = ?11, frozen_firm_funds_minor = ?12, frozen_balanced = ?13 WHERE id = ?1 AND status = 'open'`,
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
      assertMinorUnits(proof.firmFundsMinor, "frozen firm_funds_minor"),
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

// EVERY ASSERTION ONE RECONCILIATION HOLDS, withdrawn ones included, oldest first — with the bank
// line and the recorded item each one pairs, so a reader sees what was asserted rather than two
// identifiers to go and look up.
//
// A withdrawal is its own row naming the assertion it releases, so the withdrawal rows are excluded
// from the list and LEFT-joined onto the assertions instead: one row per pairing somebody made, and
// the withdrawal reads as what became of it. That somebody asserted a pairing and took it back is
// part of the record, which is why a withdrawn match is listed rather than filtered out.
//
// `bank_delta_minor` is a scalar subquery over the account's bank leaf rather than a join and a
// GROUP BY, so the movement and transfer joins beside it cannot multiply the rows it sums. Its shape
// is the outstanding read's, deliberately: the item a member cleared and the item the proof would
// have adjusted by are described the same way.
export function selectTrustReconciliationMatchesStatement(
  database: SqlDatabase,
  reconciliationId: TrustReconciliationId,
  bankLedgerAccountId: LedgerAccountId,
  limit: number = MAX_TRUST_RECONCILIATION_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT x.id, x.reconciliation_id, x.statement_line_id, x.entry_id, x.matched_by, x.matched_at,
         w.id AS unmatched_by_match_id, w.matched_by AS withdrawn_by, w.matched_at AS withdrawn_at,
         l.id AS line_id, l.statement_id AS line_statement_id, l.posted_on AS line_posted_on, l.direction AS line_direction, l.amount_minor AS line_amount_minor, l.description AS line_description, l.reference AS line_reference, l.counterparty_name AS line_counterparty_name, l.source_row_number AS line_source_row_number,
         e.effective_date AS effective_date, e.description AS description,
         (SELECT COALESCE(SUM(CASE WHEN bl.direction = 'debit' THEN bl.amount_minor ELSE -bl.amount_minor END), 0) FROM ${LEDGER_LINE_TABLE} bl WHERE bl.entry_id = e.id AND bl.account_id = ?2) AS bank_delta_minor,
         m.id AS movement_id, m.kind AS movement_kind, m.reference AS reference, m.counterparty_name AS counterparty_name, t.id AS transfer_id
       FROM ${TRUST_RECONCILIATION_MATCH_TABLE} x
       LEFT JOIN ${TRUST_RECONCILIATION_MATCH_TABLE} w ON w.unmatches_match_id = x.id
       JOIN ${TRUST_BANK_STATEMENT_LINE_TABLE} l ON l.id = x.statement_line_id
       JOIN ${LEDGER_ENTRY_TABLE} e ON e.id = x.entry_id
       LEFT JOIN ${TRUST_MOVEMENT_TABLE} m ON m.entry_id = e.id
       LEFT JOIN ${TRUST_TRANSFER_TABLE} t ON t.trust_entry_id = e.id
       WHERE x.reconciliation_id = ?1 AND x.unmatches_match_id IS NULL
       ORDER BY x.matched_at, x.id LIMIT ?3`,
    )
    .bind(reconciliationId, bankLedgerAccountId, limit);
}

// The statement lines this reconciliation has not tied to anything. Scoped to THIS reconciliation —
// unlike the outstanding-item read, which asks whether an item has reached any statement at all —
// because the proof is about one period and a line's fate in some other reconciliation says nothing
// about whether this one accounted for it.
//
// THE ONE DEFINITION of an unmatched statement line. Every surface that shows a member unmatched
// lines, and the proof that counts them, reads them here: two definitions of the same word would
// each produce a plausible list, so the day they disagreed nothing would say so.
export function selectUnmatchedTrustBankStatementLinesStatement(
  database: SqlDatabase,
  reconciliationId: TrustReconciliationId,
  statementId: TrustBankStatementId,
  // One past the cap by default, on the same terms as the outstanding-item read: the extra row is
  // never data, only the signal that the ceiling bound. A statement is separately capped at
  // MAX_TRUST_BANK_STATEMENT_LINES, which today sits below this ceiling — but nothing here depends
  // on the two constants keeping that order, which is the point of asking.
  limit: number = TRUST_RECONCILIATION_TRUNCATION_PROBE_ROWS,
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

// THE CLIENT LEG, as of the same date: what this trust account holds FOR OTHER PEOPLE, summed in
// liability terms. It walks the MATTER leaves rather than reading any parent's stored balance,
// because a roll-up's stored balance stays at zero forever and reading one would silently report
// that the clients hold nothing.
//
// `kind = 'matter'` is load-bearing rather than a tidy-up. The tree also carries the firm's own
// bank-charge cushion, and that money is not owed to any client: folded in here it would make the
// proof tie out while asserting that firm money is client money — the reconciliation certifying the
// exact confusion it exists to detect. It is summed separately by
// selectTrustFirmFundsTotalAsOfStatement and reported as its own leg.
export function selectTrustClientLedgerTotalAsOfStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  asOfDate: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = 'credit' THEN l.amount_minor ELSE -l.amount_minor END), 0) AS total_minor FROM ${TRUST_LEDGER_NODE_TABLE} n JOIN ${LEDGER_LINE_TABLE} l ON l.account_id = n.ledger_account_id JOIN ${LEDGER_ENTRY_TABLE} e ON e.id = l.entry_id WHERE n.trust_account_id = ?1 AND n.kind = 'matter' AND e.effective_date <= ?2`,
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
  // One past the cap by default, so the caller can tell a full list from a truncated one. Every
  // caller in this package leaves it alone; see MAX_TRUST_RECONCILIATION_ROWS for why the difference
  // matters more here than on any other read.
  limit: number = TRUST_RECONCILIATION_TRUNCATION_PROBE_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT e.id AS entry_id, e.effective_date AS effective_date, e.description AS description, SUM(CASE WHEN l.direction = 'debit' THEN l.amount_minor ELSE -l.amount_minor END) AS bank_delta_minor, m.id AS movement_id, m.kind AS movement_kind, m.reference AS reference, m.counterparty_name AS counterparty_name, t.id AS transfer_id FROM ${LEDGER_ENTRY_TABLE} e JOIN ${LEDGER_LINE_TABLE} l ON l.entry_id = e.id LEFT JOIN ${TRUST_MOVEMENT_TABLE} m ON m.entry_id = e.id LEFT JOIN ${TRUST_TRANSFER_TABLE} t ON t.trust_entry_id = e.id WHERE l.account_id = ?1 AND e.effective_date <= ?2 AND NOT EXISTS (SELECT 1 FROM ${TRUST_RECONCILIATION_MATCH_TABLE} x WHERE x.entry_id = e.id AND ${bindingTrustReconciliationMatchPredicate("x")}) GROUP BY e.id, e.effective_date, e.description, m.id, m.kind, m.reference, m.counterparty_name, t.id ORDER BY e.effective_date, e.id LIMIT ?3`,
    )
    .bind(bankLedgerAccountId, asOfDate, limit);
}

// WHAT IS UNDER HOLD ACROSS ONE ACCOUNT: every active disputed-funds hold on every node beneath it,
// summed. The per-node question is selectTrustAvailableBalanceStatement's; this is the same
// definition of "still held" asked of a whole account, so the two cannot disagree about what is
// spoken for. Not an as-of figure: a hold is a present claim on money, with no effective date to
// compute one from.
export function selectTrustAccountHeldTotalStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): SqlStatement {
  return database
    .prepare(
      `SELECT COALESCE(SUM(h.amount_minor), 0) AS total_minor FROM ${TRUST_HOLD_TABLE} h JOIN ${TRUST_LEDGER_NODE_TABLE} n ON n.id = h.node_id WHERE n.trust_account_id = ?1 AND ${activeTrustHoldPredicate("h")}`,
    )
    .bind(trustAccountId);
}

// How many client ledgers one account carries. Every matter leaf counts, including the ones sitting
// at zero: a ledger that has been paid out is still a ledger the firm keeps records for, and a count
// that dropped it would tell a firm it has fewer than it does.
export function selectTrustMatterLedgerCountStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): SqlStatement {
  return database
    .prepare(
      `SELECT COUNT(*) AS row_count FROM ${TRUST_LEDGER_NODE_TABLE} WHERE trust_account_id = ?1 AND kind = 'matter'`,
    )
    .bind(trustAccountId);
}

// ---- the bank-charge carve-out: the firm's own money in a trust account ----

// The single firm-funds node under one trust account, if the firm opened one. A miss is the ordinary
// state — the carve-out is off until somebody deliberately turns it on for that account — and the
// per-account UNIQUE index is what makes "the" node a well-formed phrase.
export function selectTrustFirmFundsNodeStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${NODE_COLUMNS} FROM ${TRUST_LEDGER_NODE_TABLE} WHERE trust_account_id = ?1 AND kind = 'firm_funds'`,
    )
    .bind(trustAccountId);
}

export interface InsertTrustFirmFundsMovementRow {
  readonly id: TrustFirmFundsMovementId;
  readonly trustAccountId: TrustAccountId;
  readonly kind: TrustFirmFundsMovementKind;
  readonly amountMinor: number;
  readonly currency: string;
  readonly entryId: LedgerEntryId;
  readonly method: TrustFirmFundsMovementMethod;
  readonly reference: string | null;
  readonly description: string;
  readonly recordedBy: UserId;
  readonly effectiveDate: string;
  readonly recordedAt: string;
}

export function insertTrustFirmFundsMovementStatement(
  database: SqlDatabase,
  row: InsertTrustFirmFundsMovementRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_FIRM_FUNDS_MOVEMENT_TABLE} (id, trust_account_id, kind, amount_minor, currency, entry_id, method, reference, description, recorded_by, effective_date, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(
      row.id,
      row.trustAccountId,
      row.kind,
      assertMinorUnits(row.amountMinor, "firm-funds movement amount_minor"),
      row.currency,
      row.entryId,
      row.method,
      row.reference,
      row.description,
      row.recordedBy,
      row.effectiveDate,
      row.recordedAt,
    );
}

const FIRM_FUNDS_MOVEMENT_COLUMNS = `id, trust_account_id, kind, amount_minor, currency, entry_id, method, reference, description, recorded_by, effective_date, recorded_at`;

export function selectTrustFirmFundsMovementsStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  limit: number = MAX_TRUST_RECONCILIATION_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${FIRM_FUNDS_MOVEMENT_COLUMNS} FROM ${TRUST_FIRM_FUNDS_MOVEMENT_TABLE} WHERE trust_account_id = ?1 ORDER BY effective_date DESC, id LIMIT ?2`,
    )
    .bind(trustAccountId, limit);
}

// The firm's own cushion as of a date, computed from the ledger's dated rows for the same reason
// every other leg of the proof is: a stored balance has no as-of, and a reconciliation is an
// assertion about a moment. Zero on an account that never opened the carve-out, which is what makes
// the proof's arithmetic identical for both kinds of account.
export function selectTrustFirmFundsTotalAsOfStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  asOfDate: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = 'credit' THEN l.amount_minor ELSE -l.amount_minor END), 0) AS total_minor FROM ${TRUST_LEDGER_NODE_TABLE} n JOIN ${LEDGER_LINE_TABLE} l ON l.account_id = n.ledger_account_id JOIN ${LEDGER_ENTRY_TABLE} e ON e.id = l.entry_id WHERE n.trust_account_id = ?1 AND n.kind = 'firm_funds' AND e.effective_date <= ?2`,
    )
    .bind(trustAccountId, asOfDate);
}

// ---- unclaimed and dormant client funds ----

// DORMANCY IS THIS QUERY, and there is no other definition of it anywhere in the package. Every
// matter leaf under one trust account that still holds money and whose most recent movement is on or
// before a date THE CALLER STATES. No stored flag maintains it, no sweep writes it, and no
// jurisdiction period is baked in: the window is an argument because the number varies, the clock it
// runs from varies, and a firm may have been in contact with the client this morning in a way this
// platform never saw.
//
// Two dates come back and they answer different questions. `last_activity_date` is what the window
// filters on — how long this ledger has been quiet. `earliest_receipt_date` is the effective date of
// the oldest deposit still sitting on it, which is what the rules' clocks actually run from, and it
// is deliberately NOT the filter: a ledger topped up last year still holds money received five years
// ago, and a filter on receipt alone would surface an active matter.
export function selectDormantTrustBalancesStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  quietOnOrBefore: string,
  // One past the cap by default, so a caller can tell a full list from a truncated one — the same
  // arrangement the outstanding-item read uses, and for the same reason.
  limit: number = TRUST_RECONCILIATION_TRUNCATION_PROBE_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT n.id AS node_id, n.trust_account_id AS trust_account_id, n.matter_id AS matter_id, n.client_entity_id AS client_entity_id, b.balance_minor AS balance_minor, a.currency AS currency,
         (SELECT MIN(e.effective_date) FROM ${LEDGER_LINE_TABLE} rl JOIN ${LEDGER_ENTRY_TABLE} e ON e.id = rl.entry_id WHERE rl.account_id = n.ledger_account_id AND rl.direction = 'credit') AS earliest_receipt_date,
         (SELECT MAX(e.effective_date) FROM ${LEDGER_LINE_TABLE} al JOIN ${LEDGER_ENTRY_TABLE} e ON e.id = al.entry_id WHERE al.account_id = n.ledger_account_id) AS last_activity_date,
         (SELECT r.id FROM ${TRUST_UNCLAIMED_FUNDS_REVIEW_TABLE} r WHERE r.node_id = n.id AND NOT EXISTS (SELECT 1 FROM ${TRUST_UNCLAIMED_FUNDS_REVIEW_CLOSURE_TABLE} c WHERE c.review_id = r.id) ORDER BY r.opened_at DESC, r.id LIMIT 1) AS open_review_id
       FROM ${TRUST_LEDGER_NODE_TABLE} n
       JOIN ${TRUST_ACCOUNT_TABLE} a ON a.id = n.trust_account_id
       JOIN ${ACCOUNT_BALANCE_TABLE} b ON b.account_id = n.ledger_account_id
       WHERE n.trust_account_id = ?1 AND n.kind = 'matter' AND b.balance_minor > 0
         AND (SELECT MAX(e.effective_date) FROM ${LEDGER_LINE_TABLE} al JOIN ${LEDGER_ENTRY_TABLE} e ON e.id = al.entry_id WHERE al.account_id = n.ledger_account_id) <= ?2
       ORDER BY last_activity_date, n.id LIMIT ?3`,
    )
    .bind(trustAccountId, quietOnOrBefore, limit);
}

export interface InsertTrustUnclaimedFundsReviewRow {
  readonly id: TrustUnclaimedFundsReviewId;
  readonly trustAccountId: TrustAccountId;
  readonly nodeId: TrustLedgerNodeId;
  readonly observedBalanceMinor: number;
  readonly currency: string;
  readonly observedEarliestReceiptDate: string | null;
  readonly observedLastActivityDate: string | null;
  readonly openedBy: UserId;
  readonly openedAt: string;
  readonly note: string | null;
}

export function insertTrustUnclaimedFundsReviewStatement(
  database: SqlDatabase,
  row: InsertTrustUnclaimedFundsReviewRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_UNCLAIMED_FUNDS_REVIEW_TABLE} (id, trust_account_id, node_id, observed_balance_minor, currency, observed_earliest_receipt_date, observed_last_activity_date, opened_by, opened_at, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      row.id,
      row.trustAccountId,
      row.nodeId,
      assertMinorUnits(row.observedBalanceMinor, "unclaimed-funds review observed_balance_minor"),
      row.currency,
      row.observedEarliestReceiptDate,
      row.observedLastActivityDate,
      row.openedBy,
      row.openedAt,
      row.note,
    );
}

const UNCLAIMED_FUNDS_REVIEW_COLUMNS = `id, trust_account_id, node_id, observed_balance_minor, currency, observed_earliest_receipt_date, observed_last_activity_date, opened_by, opened_at, note`;

export function selectTrustUnclaimedFundsReviewStatement(
  database: SqlDatabase,
  reviewId: TrustUnclaimedFundsReviewId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${UNCLAIMED_FUNDS_REVIEW_COLUMNS} FROM ${TRUST_UNCLAIMED_FUNDS_REVIEW_TABLE} WHERE id = ?1`,
    )
    .bind(reviewId);
}

// OPEN IS DERIVED. A review is open when no closure names it — the same derivation an active hold
// and a pending disbursement request use, and the reason no status column exists to disagree.
export function selectOpenTrustUnclaimedFundsReviewForNodeStatement(
  database: SqlDatabase,
  nodeId: TrustLedgerNodeId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${UNCLAIMED_FUNDS_REVIEW_COLUMNS} FROM ${TRUST_UNCLAIMED_FUNDS_REVIEW_TABLE} r WHERE r.node_id = ?1 AND NOT EXISTS (SELECT 1 FROM ${TRUST_UNCLAIMED_FUNDS_REVIEW_CLOSURE_TABLE} c WHERE c.review_id = r.id) ORDER BY r.opened_at DESC, r.id LIMIT 1`,
    )
    .bind(nodeId);
}

export interface InsertTrustUnclaimedFundsContactAttemptRow {
  readonly id: TrustUnclaimedFundsContactAttemptId;
  readonly reviewId: TrustUnclaimedFundsReviewId;
  readonly channel: TrustUnclaimedFundsContactChannel;
  readonly attemptedOn: string;
  readonly contactUsed: string | null;
  readonly outcome: TrustUnclaimedFundsContactOutcome;
  readonly note: string | null;
  readonly recordedBy: UserId;
  readonly recordedAt: string;
}

export function insertTrustUnclaimedFundsContactAttemptStatement(
  database: SqlDatabase,
  row: InsertTrustUnclaimedFundsContactAttemptRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_UNCLAIMED_FUNDS_CONTACT_ATTEMPT_TABLE} (id, review_id, channel, attempted_on, contact_used, outcome, note, recorded_by, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      row.id,
      row.reviewId,
      row.channel,
      row.attemptedOn,
      row.contactUsed,
      row.outcome,
      row.note,
      row.recordedBy,
      row.recordedAt,
    );
}

export function selectTrustUnclaimedFundsContactAttemptsStatement(
  database: SqlDatabase,
  reviewId: TrustUnclaimedFundsReviewId,
  limit: number = MAX_TRUST_RECONCILIATION_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, review_id, channel, attempted_on, contact_used, outcome, note, recorded_by, recorded_at FROM ${TRUST_UNCLAIMED_FUNDS_CONTACT_ATTEMPT_TABLE} WHERE review_id = ?1 ORDER BY attempted_on, id LIMIT ?2`,
    )
    .bind(reviewId, limit);
}

export interface InsertTrustUnclaimedFundsReviewClosureRow {
  readonly id: TrustUnclaimedFundsReviewClosureId;
  readonly reviewId: TrustUnclaimedFundsReviewId;
  readonly outcome: TrustUnclaimedFundsReviewOutcome;
  readonly movementId: TrustMovementId | null;
  readonly closedBy: UserId;
  readonly closedAt: string;
  readonly note: string | null;
}

export function insertTrustUnclaimedFundsReviewClosureStatement(
  database: SqlDatabase,
  row: InsertTrustUnclaimedFundsReviewClosureRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRUST_UNCLAIMED_FUNDS_REVIEW_CLOSURE_TABLE} (id, review_id, outcome, movement_id, closed_by, closed_at, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(row.id, row.reviewId, row.outcome, row.movementId, row.closedBy, row.closedAt, row.note);
}

export function selectTrustUnclaimedFundsReviewClosureStatement(
  database: SqlDatabase,
  reviewId: TrustUnclaimedFundsReviewId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, review_id, outcome, movement_id, closed_by, closed_at, note FROM ${TRUST_UNCLAIMED_FUNDS_REVIEW_CLOSURE_TABLE} WHERE review_id = ?1`,
    )
    .bind(reviewId);
}

export function selectTrustUnclaimedFundsReviewsForAccountStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  limit: number = MAX_TRUST_RECONCILIATION_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${UNCLAIMED_FUNDS_REVIEW_COLUMNS} FROM ${TRUST_UNCLAIMED_FUNDS_REVIEW_TABLE} WHERE trust_account_id = ?1 ORDER BY opened_at DESC, id LIMIT ?2`,
    )
    .bind(trustAccountId, limit);
}

// The live balance of one trust ledger node, straight off the stored figure. It answers "can the
// next charge be borne", which is a question about now — the as-of figures every leg of the
// reconciliation needs are computed from dated rows by their own statements and never from here.
export function selectTrustNodeStoredBalanceStatement(
  database: SqlDatabase,
  ledgerAccountId: LedgerAccountId,
): SqlStatement {
  return database
    .prepare(`SELECT balance_minor FROM ${ACCOUNT_BALANCE_TABLE} WHERE account_id = ?1`)
    .bind(ledgerAccountId);
}

// ---- the bitemporal reads a compliance report is taken over ----
//
// Every statement below filters on BOTH date axes: `effective_date` (when the event is deemed to
// have happened) and `recorded_at` (when the platform learned of it). The as-of statements above
// filter on the effective axis alone, and they are deliberately unchanged — the three-way proof's
// contract is settled and a report must not move it.
//
// The second axis is what makes an audit artifact reproducible. Filtering on the effective axis
// alone means a reversal posted next month with a backdated effective date silently changes last
// month's answer after somebody signed it — the precise failure the reconciliation freeze exists to
// prevent, reintroduced by every report that read one axis. With both, a stated
// (period, knowledge instant) triple selects rows that can never change, so re-running it in five
// years returns the same integers.

// A ceiling on every per-row report read, so a runaway period cannot pull an unbounded result set
// into a request handler or a queue consumer. Separate from MAX_TRUST_RECONCILIATION_ROWS because it
// bounds a different thing: a reconciliation's outstanding list has no lower date bound and grows
// with the account's whole life, where a report section is bounded by its period.
//
// THE CAP IS DETECTED, NEVER SILENT, on the same reasoning the reconciliation cap carries. A pack
// section that came back short would be a client ledger missing entries, or a journal missing a
// disbursement, presented as complete — and a document a regulator reads must not be quietly
// incomplete. Each read asks for one row past the cap so the caller can tell a full list from a
// truncated one and refuse rather than print.
export const MAX_TRUST_REPORT_ROWS = 20_000;

export const TRUST_REPORT_TRUNCATION_PROBE_ROWS = MAX_TRUST_REPORT_ROWS + 1;

// EVERY MATTER LEAF UNDER ONE TRUST ACCOUNT, with its balance as of a civil date and bounded by a
// knowledge instant. One builder rather than two, called twice — the opening balance and the closing
// balance are the same question at two dates, and two builders would eventually answer it
// differently.
//
// A LEFT JOIN, so a leaf that saw no activity at all still comes back, at zero. Which leaves a pack
// PRINTS is a presentation decision the caller makes; a read that silently dropped the quiet ones
// would take that decision away from it.
//
// The sign convention is the client leg's: a credit increases what the firm owes this client, a
// debit reduces it — identical to selectTrustClientLedgerTotalAsOfStatement, which the per-leaf sums
// are proved to add up to.
export function selectTrustMatterLeafBalancesAsOfStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  asOfDate: string,
  knownAsOf: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT n.id AS node_id, n.matter_id AS matter_id, n.client_entity_id AS client_entity_id, n.ledger_account_id AS ledger_account_id,
         COALESCE(SUM(CASE WHEN e.id IS NULL THEN 0 WHEN l.direction = 'credit' THEN l.amount_minor ELSE -l.amount_minor END), 0) AS balance_minor
       FROM ${TRUST_LEDGER_NODE_TABLE} n
       LEFT JOIN ${LEDGER_LINE_TABLE} l ON l.account_id = n.ledger_account_id
       LEFT JOIN ${LEDGER_ENTRY_TABLE} e ON e.id = l.entry_id AND e.effective_date <= ?2 AND e.recorded_at <= ?3
       WHERE n.trust_account_id = ?1 AND n.kind = 'matter'
       GROUP BY n.id, n.matter_id, n.client_entity_id, n.ledger_account_id
       ORDER BY n.client_entity_id, n.matter_id, n.id`,
    )
    .bind(trustAccountId, asOfDate, knownAsOf);
}

// EVERY ENTRY ON EVERY CLIENT LEDGER under one trust account, in the period, as known at an instant.
//
// One row per (leaf, ledger line), so a matter-to-matter reallocation appears on BOTH leaves it
// touches — the receiving ledger must show the funds arriving as plainly as the source ledger shows
// them leaving, which is why the movement join reaches the counterparty node as well.
//
// The movement and the transfer are LEFT-joined for what they add and nothing more: the method, the
// reference, the counterparty, and who authorized the money leaving. An earned-fee transfer out of
// trust records a `trust_transfer` and no movement row at all, so a read keyed on movements would
// omit the single operation most likely to be looked at.
export function selectTrustClientLedgerEntriesInPeriodStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  periodStart: string,
  periodEnd: string,
  knownAsOf: string,
  limit: number = TRUST_REPORT_TRUNCATION_PROBE_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT n.id AS node_id, n.matter_id AS matter_id, n.client_entity_id AS client_entity_id,
         e.id AS entry_id, e.effective_date AS effective_date, e.recorded_at AS recorded_at, e.description AS description, e.reverses_entry_id AS reverses_entry_id,
         l.line_index AS line_index, l.direction AS direction, l.amount_minor AS amount_minor,
         CASE WHEN l.direction = 'credit' THEN l.amount_minor ELSE -l.amount_minor END AS delta_minor,
         m.id AS movement_id, m.kind AS movement_kind, m.method AS method, m.reference AS reference, m.counterparty_name AS counterparty_name, m.purpose AS purpose, m.recorded_by AS recorded_by, m.authorized_by AS authorized_by, m.counterparty_node_id AS counterparty_node_id,
         t.id AS transfer_id, t.authorized_by AS transfer_authorized_by, t.recorded_by AS transfer_recorded_by
       FROM ${TRUST_LEDGER_NODE_TABLE} n
       JOIN ${LEDGER_LINE_TABLE} l ON l.account_id = n.ledger_account_id
       JOIN ${LEDGER_ENTRY_TABLE} e ON e.id = l.entry_id
       LEFT JOIN ${TRUST_MOVEMENT_TABLE} m ON m.entry_id = e.id AND (m.node_id = n.id OR m.counterparty_node_id = n.id)
       LEFT JOIN ${TRUST_TRANSFER_TABLE} t ON t.trust_entry_id = e.id AND t.from_node_id = n.id
       WHERE n.trust_account_id = ?1 AND n.kind = 'matter'
         AND e.effective_date >= ?2 AND e.effective_date <= ?3 AND e.recorded_at <= ?4
       ORDER BY n.client_entity_id, n.matter_id, n.id, e.effective_date, e.recorded_at, e.id, l.line_index
       LIMIT ?5`,
    )
    .bind(trustAccountId, periodStart, periodEnd, knownAsOf, limit);
}

// THE RECEIPTS-AND-DISBURSEMENTS JOURNAL: everything that moved this account's bank balance in the
// period, as known at an instant.
//
// KEYED ON THE LEDGER ENTRY, never on `trust_movement`. An earned-fee transfer out of trust writes a
// `trust_transfer` and no movement row, and a bank service charge writes a
// `trust_firm_funds_movement` and no movement row either; a movement-keyed journal would omit both
// while looking complete. Anything that moves the bank balance is an entry touching the trust bank
// account, whatever composed it — the same rule the reconciliation's outstanding-item read holds.
//
// The bank leaf is an asset, so a debit adds and a credit subtracts; the per-entry SUM is the net
// effect on the bank, which is what a running balance in a journal is built from.
export function selectTrustBankJournalInPeriodStatement(
  database: SqlDatabase,
  bankLedgerAccountId: LedgerAccountId,
  periodStart: string,
  periodEnd: string,
  knownAsOf: string,
  limit: number = TRUST_REPORT_TRUNCATION_PROBE_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT e.id AS entry_id, e.effective_date AS effective_date, e.recorded_at AS recorded_at, e.description AS description, e.reverses_entry_id AS reverses_entry_id,
         SUM(CASE WHEN l.direction = 'debit' THEN l.amount_minor ELSE -l.amount_minor END) AS bank_delta_minor,
         m.id AS movement_id, m.kind AS movement_kind, m.method AS method, m.reference AS reference, m.counterparty_name AS counterparty_name, m.purpose AS purpose, m.node_id AS node_id, m.counterparty_node_id AS counterparty_node_id, m.recorded_by AS recorded_by, m.authorized_by AS authorized_by,
         t.id AS transfer_id, t.from_node_id AS transfer_from_node_id, t.recorded_by AS transfer_recorded_by, t.authorized_by AS transfer_authorized_by,
         f.id AS firm_funds_movement_id, f.kind AS firm_funds_movement_kind, f.method AS firm_funds_method, f.reference AS firm_funds_reference, f.description AS firm_funds_description
       FROM ${LEDGER_ENTRY_TABLE} e
       JOIN ${LEDGER_LINE_TABLE} l ON l.entry_id = e.id
       LEFT JOIN ${TRUST_MOVEMENT_TABLE} m ON m.entry_id = e.id
       LEFT JOIN ${TRUST_TRANSFER_TABLE} t ON t.trust_entry_id = e.id
       LEFT JOIN ${TRUST_FIRM_FUNDS_MOVEMENT_TABLE} f ON f.entry_id = e.id
       WHERE l.account_id = ?1 AND e.effective_date >= ?2 AND e.effective_date <= ?3 AND e.recorded_at <= ?4
       GROUP BY e.id, e.effective_date, e.recorded_at, e.description, e.reverses_entry_id, m.id, m.kind, m.method, m.reference, m.counterparty_name, m.purpose, m.node_id, m.counterparty_node_id, m.recorded_by, m.authorized_by, t.id, t.from_node_id, t.recorded_by, t.authorized_by, f.id, f.kind, f.method, f.reference, f.description
       ORDER BY e.effective_date, e.recorded_at, e.id
       LIMIT ?5`,
    )
    .bind(bankLedgerAccountId, periodStart, periodEnd, knownAsOf, limit);
}

// THE BANK BALANCE AS OF A DATE, bounded by a knowledge instant — the journal's opening and closing
// figures. The effective-axis-only twin (selectTrustBookBalanceAsOfStatement) stays exactly as it is,
// because the three-way proof's book leg is settled; this is the reproducible reading of the same
// quantity, and the journal's closing figure is proved equal to the settled one over the fixture book
// when the knowledge bound covers everything recorded.
export function selectTrustBookBalanceAsKnownStatement(
  database: SqlDatabase,
  bankLedgerAccountId: LedgerAccountId,
  asOfDate: string,
  knownAsOf: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = 'debit' THEN l.amount_minor ELSE -l.amount_minor END), 0) AS balance_minor FROM ${LEDGER_LINE_TABLE} l JOIN ${LEDGER_ENTRY_TABLE} e ON e.id = l.entry_id WHERE l.account_id = ?1 AND e.effective_date <= ?2 AND e.recorded_at <= ?3`,
    )
    .bind(bankLedgerAccountId, asOfDate, knownAsOf);
}

// THE FIRM'S OWN CUSHION as of a date, bounded by a knowledge instant. Zero on an account that never
// opened the bank-charge carve-out, which is what lets the pack's arithmetic be identical for both
// kinds of account instead of branching on one.
export function selectTrustFirmFundsTotalAsKnownStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  asOfDate: string,
  knownAsOf: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = 'credit' THEN l.amount_minor ELSE -l.amount_minor END), 0) AS total_minor FROM ${TRUST_LEDGER_NODE_TABLE} n JOIN ${LEDGER_LINE_TABLE} l ON l.account_id = n.ledger_account_id JOIN ${LEDGER_ENTRY_TABLE} e ON e.id = l.entry_id WHERE n.trust_account_id = ?1 AND n.kind = 'firm_funds' AND e.effective_date <= ?2 AND e.recorded_at <= ?3`,
    )
    .bind(trustAccountId, asOfDate, knownAsOf);
}

// THE CLIENT LEG as of a date, bounded by a knowledge instant. `kind = 'matter'` is load-bearing here
// for exactly the reason it is load-bearing on the settled statement: the tree also carries the
// firm's own cushion, and folding that in would report that firm money is client money.
export function selectTrustClientLedgerTotalAsKnownStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  asOfDate: string,
  knownAsOf: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = 'credit' THEN l.amount_minor ELSE -l.amount_minor END), 0) AS total_minor FROM ${TRUST_LEDGER_NODE_TABLE} n JOIN ${LEDGER_LINE_TABLE} l ON l.account_id = n.ledger_account_id JOIN ${LEDGER_ENTRY_TABLE} e ON e.id = l.entry_id WHERE n.trust_account_id = ?1 AND n.kind = 'matter' AND e.effective_date <= ?2 AND e.recorded_at <= ?3`,
    )
    .bind(trustAccountId, asOfDate, knownAsOf);
}

// EVERY FIRM-FUNDS MOVEMENT in the period, as known at an instant — the cushion's own journal, kept
// separate from the client one because the money is the firm's and folding it into a client total
// would tie out while asserting that firm money is client money.
export function selectTrustFirmFundsMovementsInPeriodStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  periodStart: string,
  periodEnd: string,
  knownAsOf: string,
  limit: number = TRUST_REPORT_TRUNCATION_PROBE_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${FIRM_FUNDS_MOVEMENT_COLUMNS} FROM ${TRUST_FIRM_FUNDS_MOVEMENT_TABLE} WHERE trust_account_id = ?1 AND effective_date >= ?2 AND effective_date <= ?3 AND recorded_at <= ?4 ORDER BY effective_date, recorded_at, id LIMIT ?5`,
    )
    .bind(trustAccountId, periodStart, periodEnd, knownAsOf, limit);
}

// EVERY RECONCILIATION whose statement period ends inside the report period, as it stood at the
// knowledge instant — with the firm's own frozen attestation, whole.
//
// A RECONCILIATION CLOSED AFTER THE KNOWLEDGE INSTANT READS AS OPEN, and its frozen figures do not
// appear. That is not a nicety: a pack taken as at a Tuesday must not print an attestation the firm
// made on the Wednesday, or the same triple would answer differently before and after the close and
// the whole reproducibility claim would be false. Each frozen column is therefore gated on
// `closed_at <= ?4` rather than on the stored status, and a NULL `closed_at` fails that comparison
// on its own.
//
// `frozen_firm_funds_minor` is COALESCEd to zero for the rows that predate the column: those
// reconciliations were attested honestly under the arithmetic that then applied, where the cushion
// was not a separate leg, and rewriting them would be asserting a figure nobody stood behind.
export function selectTrustReconciliationsInPeriodStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  periodStart: string,
  periodEnd: string,
  knownAsOf: string,
  limit: number = MAX_TRUST_RECONCILIATION_ROWS,
): SqlStatement {
  const frozenAsKnown = (column: string, fallback: string | null = null): string => {
    const value = fallback === null ? `r.${column}` : `COALESCE(r.${column}, ${fallback})`;
    return `CASE WHEN r.closed_at <= ?4 THEN ${value} ELSE NULL END AS ${column}`;
  };
  return database
    .prepare(
      `SELECT r.id, r.trust_account_id, r.statement_id, r.opened_by, r.opened_at, r.supersedes_reconciliation_id, r.note,
         CASE WHEN r.closed_at <= ?4 THEN 'closed' ELSE 'open' END AS status,
         CASE WHEN r.closed_at <= ?4 THEN r.closed_by ELSE NULL END AS closed_by,
         CASE WHEN r.closed_at <= ?4 THEN r.closed_at ELSE NULL END AS closed_at,
         ${frozenAsKnown("frozen_statement_closing_minor")},
         ${frozenAsKnown("frozen_outstanding_deposits_minor")},
         ${frozenAsKnown("frozen_outstanding_disbursements_minor")},
         ${frozenAsKnown("frozen_adjusted_bank_minor")},
         ${frozenAsKnown("frozen_book_balance_minor")},
         ${frozenAsKnown("frozen_client_total_minor")},
         ${frozenAsKnown("frozen_unmatched_line_count")},
         ${frozenAsKnown("frozen_unmatched_movement_count")},
         ${frozenAsKnown("frozen_firm_funds_minor", "0")},
         ${frozenAsKnown("frozen_balanced")},
         s.period_start AS statement_period_start, s.period_end AS statement_period_end, s.closing_balance_minor AS statement_closing_balance_minor, s.statement_reference AS statement_reference
       FROM ${TRUST_RECONCILIATION_TABLE} r
       JOIN ${TRUST_BANK_STATEMENT_TABLE} s ON s.id = r.statement_id
       WHERE r.trust_account_id = ?1 AND s.period_end >= ?2 AND s.period_end <= ?3 AND r.opened_at <= ?4
       ORDER BY s.period_end, r.opened_at, r.id
       LIMIT ?5`,
    )
    .bind(trustAccountId, periodStart, periodEnd, knownAsOf, limit);
}

// THE HOLDS IN FORCE at a knowledge instant, on every matter leaf under one trust account.
//
// A hold carries `placed_at` — a UTC instant — and no effective date, so "in force" is a question
// about the KNOWLEDGE axis only: a hold is in force when it was placed on or before the instant and
// no release recorded on or before that instant names it. There is deliberately no attempt to give
// it an effective date it does not have; a pack states that this section is as at the knowledge
// instant rather than as at the period end, because inventing an axis would be inventing a fact.
export function selectTrustHoldsInForceAsKnownStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  knownAsOf: string,
  limit: number = TRUST_REPORT_TRUNCATION_PROBE_ROWS,
): SqlStatement {
  return database
    .prepare(
      `SELECT h.id AS hold_id, h.node_id AS node_id, n.matter_id AS matter_id, n.client_entity_id AS client_entity_id, h.amount_minor AS amount_minor, h.currency AS currency, h.reason AS reason, h.placed_at AS placed_at, h.placed_by AS placed_by
       FROM ${TRUST_HOLD_TABLE} h
       JOIN ${TRUST_LEDGER_NODE_TABLE} n ON n.id = h.node_id
       WHERE n.trust_account_id = ?1 AND h.releases_hold_id IS NULL AND h.placed_at <= ?2
         AND NOT EXISTS (SELECT 1 FROM ${TRUST_HOLD_TABLE} r WHERE r.releases_hold_id = h.id AND r.placed_at <= ?2)
       ORDER BY h.placed_at, h.id
       LIMIT ?3`,
    )
    .bind(trustAccountId, knownAsOf, limit);
}

// THE ACCOUNT'S IDENTITY, for the cover of a document a firm hands somebody outside it: what the
// firm calls the account, which office holds it, which institution it is at, and the last four of
// the number.
//
// The last four is what the schema stores and is therefore what a report body can contain — there is
// no full account number anywhere to leak. `selectTrustAccountStatement` deliberately does not carry
// these: it is the read every money path runs, and a movement has no use for a caption.
export function selectTrustAccountIdentityStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, name, location_id, jurisdiction, bank_name, account_number_last_four, currency, iolta, status, opened_on, closed_at, bank_ledger_account_id, client_liability_account_id FROM ${TRUST_ACCOUNT_TABLE} WHERE id = ?1`,
    )
    .bind(trustAccountId);
}

// The holding office's zone for ONE account, for the caller that has an account identifier and no
// listing in hand: a figure asked for "as at today" resolves that day in the office's own zone, not
// the server's. A LEFT JOIN, so the absence of rows means the account is unknown rather than its
// office being unreadable; a null zone falls back in the one place the platform resolves a zone.
export function selectTrustAccountTimeZoneStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): SqlStatement {
  return database
    .prepare(
      `SELECT l.time_zone AS location_time_zone FROM ${TRUST_ACCOUNT_TABLE} a LEFT JOIN ${LOCATION_TABLE} l ON l.id = a.location_id WHERE a.id = ?1`,
    )
    .bind(trustAccountId);
}

// THE FIRM'S TRUST ACCOUNTS, as a listing a person picks one from — the report screen's account
// control, and the matter ledger's the day it is wired. Oldest first on the shared (created_at, id)
// keyset, the one cursor shape every listing on the platform mints: an account's label is free text
// the cursor encoding cannot carry (a firm names accounts with dashes and accents, and the opaque
// token is Latin-1), so the alphabetical order a picker wants is the picker's to apply over what it
// loaded, not the page's to promise.
//
// The same identity columns the pack's cover reads, plus the holding office's time zone: a report
// asked "as at the end of 31 July" resolves that day in the office's own zone, and the listing is
// where the account and its office are already read together. The last four is all the schema
// stores of the number.
export function selectTrustAccountsPageStatement(
  database: SqlDatabase,
  page: {
    readonly afterCreatedAt: string | null;
    readonly afterId: string | null;
    readonly limit: number;
  },
): SqlStatement {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (page.afterCreatedAt !== null && page.afterId !== null) {
    conditions.push("(a.created_at > ? OR (a.created_at = ? AND a.id > ?))");
    bindings.push(page.afterCreatedAt, page.afterCreatedAt, page.afterId);
  }
  const where = conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
  bindings.push(page.limit);
  return database
    .prepare(
      `SELECT a.id, a.name, a.location_id, a.jurisdiction, a.bank_name, a.account_number_last_four, a.currency, a.iolta, a.status, a.opened_on, a.closed_at, a.created_at, l.time_zone AS location_time_zone
       FROM ${TRUST_ACCOUNT_TABLE} a
       JOIN ${LOCATION_TABLE} l ON l.id = a.location_id${where} ORDER BY a.created_at, a.id LIMIT ?`,
    )
    .bind(...bindings);
}

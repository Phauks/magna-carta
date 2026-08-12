import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { ACCOUNT_BALANCE_TABLE, LEDGER_LINE_TABLE } from "@magna-carta/ledger/statements";
import { matterClientPartyExistsPredicate } from "@magna-carta/matters/matter-party";
import {
  activeTrustHoldPredicate,
  activeTrustReconciliationMatchPredicate,
  TRUST_ACCOUNT_TABLE,
  TRUST_BANK_STATEMENT_LINE_TABLE,
  TRUST_BANK_STATEMENT_TABLE,
  TRUST_FIRM_FUNDS_MOVEMENT_TABLE,
  TRUST_HOLD_TABLE,
  TRUST_LEDGER_NODE_TABLE,
  TRUST_MOVEMENT_TABLE,
  TRUST_RECONCILIATION_MATCH_TABLE,
  TRUST_RECONCILIATION_TABLE,
  TRUST_UNCLAIMED_FUNDS_REVIEW_CLOSURE_TABLE,
  TRUST_UNCLAIMED_FUNDS_REVIEW_TABLE,
} from "./statements.ts";

// Fitness queries: re-prove the trust invariants over the WHOLE table. Zero rows = healthy.
//
// Every rule below is already enforced on the write path. These exist because a write-path guard
// reads before its batch commits and D1 has no interactive transaction to hold that read still, and
// because a future caller may find a door around the composition guard. A structural invariant that
// cannot be re-proved against stored data is an invariant you are trusting rather than holding.

// Which ledger accounts belong to which trust account — the node leaves plus each account's two
// roots, in one relation. Written once and reused so the commingling query cannot drift between its
// two halves.
const TRUST_ACCOUNT_MEMBERSHIP = `SELECT n.ledger_account_id AS account_id, n.trust_account_id AS trust_account_id FROM ${TRUST_LEDGER_NODE_TABLE} n UNION ALL SELECT a.bank_ledger_account_id, a.id FROM ${TRUST_ACCOUNT_TABLE} a UNION ALL SELECT a.client_liability_account_id, a.id FROM ${TRUST_ACCOUNT_TABLE} a`;

// NO COMMINGLING. An entry that touches one trust account's accounts must touch nothing else: not
// another trust account, and not an operating, income, or expense account. This is the query that
// would surface a processor fee netted out of a trust deposit, firm money parked in a client ledger,
// or client money paid straight into the operating account.
export function commingledTrustEntriesStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT DISTINCT l.entry_id AS entry_id FROM ${LEDGER_LINE_TABLE} l JOIN (${TRUST_ACCOUNT_MEMBERSHIP}) m ON m.account_id = l.account_id WHERE EXISTS (SELECT 1 FROM ${LEDGER_LINE_TABLE} o LEFT JOIN (${TRUST_ACCOUNT_MEMBERSHIP}) m2 ON m2.account_id = o.account_id WHERE o.entry_id = l.entry_id AND (m2.trust_account_id IS NULL OR m2.trust_account_id <> m.trust_account_id))`,
    )
    .bind();
}

// CLIENT-TO-CLIENT IS REFUSED. One entry, at most one client's money. A row here is either a
// composition guard that was bypassed or a movement between two clients' ledgers, which is the
// misappropriation pattern the guard exists to make unrepresentable.
export function multiClientTrustEntriesStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT entry_id, clients FROM (SELECT l.entry_id AS entry_id, COUNT(DISTINCT n.client_entity_id) AS clients FROM ${LEDGER_LINE_TABLE} l JOIN ${TRUST_LEDGER_NODE_TABLE} n ON n.ledger_account_id = l.account_id WHERE n.client_entity_id IS NOT NULL GROUP BY l.entry_id) WHERE clients > 1`,
    )
    .bind();
}

// A CLIENT LEDGER IS FILED UNDER THE CLIENT WHOSE MATTER IT IS. `trust_ledger_node.client_entity_id`
// decides whose money the leaf holds — which client node it hangs under, which client the
// composition guard sees on every entry touching it, whose ledger it is readable and disbursable
// from, and whose matter it blocks from closing. Nothing in the schema ties it to the matter it also
// names, so a leaf attributed to one client on another client's matter is a structurally valid row.
// The composer derives the attribution from `matter_party` rather than accepting it, which is what
// stops one being written; this is what finds one written before that, or written around the
// composer. It is deliberately NOT covered by the one-client-per-entry query, which counts distinct
// clients over the very column being asserted and would see a single, consistent, wrong answer.
export function trustMatterNodesMisattributedStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT n.id AS node_id, n.matter_id AS matter_id, n.client_entity_id AS client_entity_id FROM ${TRUST_LEDGER_NODE_TABLE} n WHERE n.kind = 'matter' AND n.matter_id IS NOT NULL AND NOT ${matterClientPartyExistsPredicate("n.matter_id", "n.client_entity_id")}`,
    )
    .bind();
}

// THE FLOOR IS ACTUALLY SET. min_balance_minor = 0 on every leaf that carries a balance is the whole
// no-negative guarantee; a leaf created without it is a leaf that can be overdrawn, and nothing else
// in the system would notice until it was. The firm-funds leaf is included for a second reason on
// top of that one: its floor is what stops a bank charge larger than the firm's own cushion being
// borne by client money, so a firm-funds node without a floor silently converts the carve-out into a
// path to client funds.
export function trustLeavesWithoutZeroFloorStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT n.id AS node_id, n.kind, b.min_balance_minor FROM ${TRUST_LEDGER_NODE_TABLE} n JOIN ${ACCOUNT_BALANCE_TABLE} b ON b.account_id = n.ledger_account_id WHERE n.kind IN ('matter', 'firm_funds') AND (b.min_balance_minor IS NULL OR b.min_balance_minor <> 0)`,
    )
    .bind();
}

// POSTINGS LAND ON LEAVES. A client node carrying a line would sit outside the roll-up of the
// matters beneath it, so the client's ledger total and the sum of that client's matters would
// silently disagree — and the disagreement would be invisible on both reports. The firm-funds node
// is a leaf rather than a roll-up (nothing hangs under it) and is deliberately not counted here; the
// query below is what polices what may touch IT.
export function trustRollupNodesWithPostingsStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT DISTINCT n.id AS node_id, n.kind FROM ${TRUST_LEDGER_NODE_TABLE} n WHERE n.kind = 'client' AND EXISTS (SELECT 1 FROM ${LEDGER_LINE_TABLE} l WHERE l.account_id = n.ledger_account_id)`,
    )
    .bind();
}

// THE FIRM'S OWN MONEY NEVER SHARES AN ENTRY WITH A CLIENT'S. This is the re-proof of the whole
// bank-charge carve-out: the narrower composition door admits only the firm-funds node paired with
// its account's bank leaf, and a row here means something reached the ledger that pairs firm money
// with a client ledger, a roll-up, or another trust account. It is the difference between a
// carve-out and a second way to move client money, asserted over stored lines rather than trusted to
// the composer that wrote them.
export function firmFundsEntriesTouchingClientMoneyStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT DISTINCT l.entry_id AS entry_id FROM ${LEDGER_LINE_TABLE} l JOIN ${TRUST_LEDGER_NODE_TABLE} f ON f.ledger_account_id = l.account_id AND f.kind = 'firm_funds' WHERE EXISTS (SELECT 1 FROM ${LEDGER_LINE_TABLE} o LEFT JOIN ${TRUST_LEDGER_NODE_TABLE} n2 ON n2.ledger_account_id = o.account_id LEFT JOIN ${TRUST_ACCOUNT_TABLE} a2 ON a2.bank_ledger_account_id = o.account_id WHERE o.entry_id = l.entry_id AND o.account_id <> l.account_id AND (a2.id IS NULL OR a2.id <> f.trust_account_id OR n2.id IS NOT NULL))`,
    )
    .bind();
}

// EVERY FIRM-FUNDS ENTRY CARRIES ITS RECORD, AND EVERY SUCH RECORD ITS ENTRY. The two rows are
// written by one composer and nothing in the schema ties them together. A bank charge with no
// `trust_firm_funds_movement` beside it is money that left the account with no account of why, and a
// record naming an entry that never touched the firm-funds node is a journal that disagrees with the
// ledger it purports to describe.
export function firmFundsMovementsDisagreeingWithLedgerStatement(
  database: SqlDatabase,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.id AS firm_funds_movement_id, v.amount_minor AS amount_minor FROM ${TRUST_FIRM_FUNDS_MOVEMENT_TABLE} v WHERE NOT EXISTS (SELECT 1 FROM ${LEDGER_LINE_TABLE} l JOIN ${TRUST_LEDGER_NODE_TABLE} n ON n.ledger_account_id = l.account_id AND n.kind = 'firm_funds' AND n.trust_account_id = v.trust_account_id WHERE l.entry_id = v.entry_id AND l.amount_minor = v.amount_minor)`,
    )
    .bind();
}

// AN UNCLAIMED-FUNDS CLOSURE NAMES THIS LEDGER'S OWN PAYMENT. The composer checks it, and the shape
// CHECK proves a distribution carries a movement at all — but neither can prove the movement came
// from the ledger under review. A row here is a diligence file recording a client as paid out of
// somebody else's money, which reads on the certification as a search that succeeded.
export function unclaimedFundsClosuresNamingAnotherLedgerStatement(
  database: SqlDatabase,
): SqlStatement {
  return database
    .prepare(
      `SELECT c.id AS closure_id, c.review_id AS review_id FROM ${TRUST_UNCLAIMED_FUNDS_REVIEW_CLOSURE_TABLE} c JOIN ${TRUST_UNCLAIMED_FUNDS_REVIEW_TABLE} r ON r.id = c.review_id LEFT JOIN ${TRUST_MOVEMENT_TABLE} m ON m.id = c.movement_id WHERE c.movement_id IS NOT NULL AND (m.id IS NULL OR m.node_id <> r.node_id OR m.kind <> 'disbursement')`,
    )
    .bind();
}

// AN UNCLAIMED-FUNDS REVIEW IS ABOUT A CLIENT'S MATTER LEDGER. A review over a roll-up or over the
// firm's own bank-charge cushion would be a diligence file about money no client is owed — and on
// the firm-funds node it would be the firm searching for itself.
export function unclaimedFundsReviewsOffMatterLeavesStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT r.id AS review_id, n.kind AS node_kind FROM ${TRUST_UNCLAIMED_FUNDS_REVIEW_TABLE} r JOIN ${TRUST_LEDGER_NODE_TABLE} n ON n.id = r.node_id WHERE n.kind <> 'matter' OR n.trust_account_id <> r.trust_account_id`,
    )
    .bind();
}

// ONE OPEN DILIGENCE FILE PER CLIENT LEDGER. Open is derived from the absence of a closure row, so
// the rule cannot be a UNIQUE index — the same arrangement the hold model and the match model use.
// Two open reviews over one balance split the evidence trail in half, and the certification a firm
// eventually signs is about the whole search.
export function unclaimedFundsLedgersWithTwoOpenReviewsStatement(
  database: SqlDatabase,
): SqlStatement {
  return database
    .prepare(
      `SELECT node_id, open_reviews FROM (SELECT r.node_id AS node_id, COUNT(*) AS open_reviews FROM ${TRUST_UNCLAIMED_FUNDS_REVIEW_TABLE} r WHERE NOT EXISTS (SELECT 1 FROM ${TRUST_UNCLAIMED_FUNDS_REVIEW_CLOSURE_TABLE} c WHERE c.review_id = r.id) GROUP BY r.node_id) WHERE open_reviews > 1`,
    )
    .bind();
}

// HOLDS NEVER EXCEED THE BALANCE THEY RESTRICT. Available balance is balance minus active holds, so
// holds larger than the balance make available negative — a number no disbursement check can reason
// about, and a sign that a hold outlived the money it was placed against.
export function trustHoldsExceedingBalanceStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT n.id AS node_id, b.balance_minor, h.held_minor FROM ${TRUST_LEDGER_NODE_TABLE} n JOIN ${ACCOUNT_BALANCE_TABLE} b ON b.account_id = n.ledger_account_id JOIN (SELECT p.node_id AS node_id, SUM(p.amount_minor) AS held_minor FROM ${TRUST_HOLD_TABLE} p WHERE ${activeTrustHoldPredicate("p")} GROUP BY p.node_id) h ON h.node_id = n.id WHERE h.held_minor > b.balance_minor`,
    )
    .bind();
}

// A MOVEMENT RECORD DESCRIBES THE ENTRY IT SITS BESIDE. The client-ledger record and the money are
// two rows written by one composer, and nothing in the schema ties their amounts together: a foreign
// key proves the entry exists, not that it moved what the record says it moved. A row here means the
// per-client ledger a firm hands an examiner disagrees with the ledger that actually holds the
// money, which is worse than either being wrong alone.
export function trustMovementsDisagreeingWithLedgerStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT v.id AS movement_id, v.amount_minor AS amount_minor FROM ${TRUST_MOVEMENT_TABLE} v JOIN ${TRUST_LEDGER_NODE_TABLE} n ON n.id = v.node_id WHERE NOT EXISTS (SELECT 1 FROM ${LEDGER_LINE_TABLE} l WHERE l.entry_id = v.entry_id AND l.account_id = n.ledger_account_id AND l.amount_minor = v.amount_minor)`,
    )
    .bind();
}

// A MATTER TRANSFER REACHES BOTH LEAVES IT NAMES. The destination leaf is what makes the movement a
// reallocation rather than a disappearance, and a transfer whose entry never credited it would show
// funds leaving one client ledger and arriving on none.
export function trustTransfersMissingCounterpartyLineStatement(
  database: SqlDatabase,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.id AS movement_id FROM ${TRUST_MOVEMENT_TABLE} v JOIN ${TRUST_LEDGER_NODE_TABLE} n ON n.id = v.counterparty_node_id WHERE v.counterparty_node_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${LEDGER_LINE_TABLE} l WHERE l.entry_id = v.entry_id AND l.account_id = n.ledger_account_id AND l.amount_minor = v.amount_minor)`,
    )
    .bind();
}

// ONE STATEMENT LINE CLEARS ONCE, AND SO DOES ONE ENTRY. The one-to-one rule is checked by the
// composer and cannot be a UNIQUE index, because a match's active state is derived from the absence
// of a withdrawal row rather than stored in a column. Two active matches on the same line — or on
// the same entry — would let a firm's reconciliation account for one real event twice, and a proof
// built on that ties out while the bank and the ledger disagree.
export function trustReconciliationDoubleMatchesStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT reconciliation_id, side, matched_key, matches FROM (SELECT x.reconciliation_id AS reconciliation_id, 'statement line' AS side, x.statement_line_id AS matched_key, COUNT(*) AS matches FROM ${TRUST_RECONCILIATION_MATCH_TABLE} x WHERE ${activeTrustReconciliationMatchPredicate("x")} GROUP BY x.reconciliation_id, x.statement_line_id UNION ALL SELECT x.reconciliation_id, 'ledger entry', x.entry_id, COUNT(*) FROM ${TRUST_RECONCILIATION_MATCH_TABLE} x WHERE ${activeTrustReconciliationMatchPredicate("x")} GROUP BY x.reconciliation_id, x.entry_id) WHERE matches > 1`,
    )
    .bind();
}

// A MATCH STAYS INSIDE THE PERIOD IT BELONGS TO. The migration's triggers refuse a line from another
// statement at insert; this re-proves it over stored rows, because a trigger dropped by a future
// table rebuild is a control that silently stops existing.
export function trustReconciliationMatchesOffStatementStatement(
  database: SqlDatabase,
): SqlStatement {
  return database
    .prepare(
      `SELECT x.id AS match_id FROM ${TRUST_RECONCILIATION_MATCH_TABLE} x JOIN ${TRUST_RECONCILIATION_TABLE} r ON r.id = x.reconciliation_id JOIN ${TRUST_BANK_STATEMENT_LINE_TABLE} l ON l.id = x.statement_line_id WHERE l.statement_id <> r.statement_id`,
    )
    .bind();
}

// A CLOSED RECONCILIATION'S FROZEN PROOF IS ARITHMETICALLY WHAT IT CLAIMS. The adjusted bank figure
// is the statement's closing balance plus deposits in transit less outstanding disbursements, and
// `frozen_balanced` says the three legs agreed. A row where those do not hold together is a frozen
// attestation that contradicts itself, which is worse than an honest red: it is a number a firm
// would file.
export function trustReconciliationsWithIncoherentProofStatement(
  database: SqlDatabase,
): SqlStatement {
  return database
    .prepare(
      `SELECT r.id AS reconciliation_id FROM ${TRUST_RECONCILIATION_TABLE} r WHERE r.status = 'closed' AND (r.frozen_adjusted_bank_minor <> r.frozen_statement_closing_minor + r.frozen_outstanding_deposits_minor - r.frozen_outstanding_disbursements_minor OR (r.frozen_balanced = 1 AND (r.frozen_adjusted_bank_minor <> r.frozen_book_balance_minor OR r.frozen_book_balance_minor <> r.frozen_client_total_minor + COALESCE(r.frozen_firm_funds_minor, 0))) OR (r.frozen_balanced = 0 AND r.frozen_adjusted_bank_minor = r.frozen_book_balance_minor AND r.frozen_book_balance_minor = r.frozen_client_total_minor + COALESCE(r.frozen_firm_funds_minor, 0)))`,
    )
    .bind();
}

// A RECONCILIATION AND ITS STATEMENT ARE ABOUT THE SAME ACCOUNT. Nothing composes one that is not,
// but a reconciliation whose statement belongs elsewhere would prove one account's bank balance
// against another's client ledgers and could report that as balanced.
export function trustReconciliationsCrossingAccountsStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT r.id AS reconciliation_id FROM ${TRUST_RECONCILIATION_TABLE} r JOIN ${TRUST_BANK_STATEMENT_TABLE} s ON s.id = r.statement_id WHERE s.trust_account_id <> r.trust_account_id`,
    )
    .bind();
}

const FITNESS_STATEMENTS = [
  ["commingled trust entries", commingledTrustEntriesStatement],
  ["entries touching more than one client", multiClientTrustEntriesStatement],
  [
    "matter ledgers filed under a client whose matter it is not",
    trustMatterNodesMisattributedStatement,
  ],
  ["trust leaves without a zero floor", trustLeavesWithoutZeroFloorStatement],
  ["roll-up nodes carrying postings", trustRollupNodesWithPostingsStatement],
  ["holds exceeding the balance they restrict", trustHoldsExceedingBalanceStatement],
  ["movement records disagreeing with the ledger", trustMovementsDisagreeingWithLedgerStatement],
  [
    "matter transfers missing their destination line",
    trustTransfersMissingCounterpartyLineStatement,
  ],
  ["statement lines or entries matched more than once", trustReconciliationDoubleMatchesStatement],
  [
    "reconciliation matches naming another statement's line",
    trustReconciliationMatchesOffStatementStatement,
  ],
  [
    "closed reconciliations whose frozen proof contradicts itself",
    trustReconciliationsWithIncoherentProofStatement,
  ],
  [
    "reconciliations whose statement belongs to another account",
    trustReconciliationsCrossingAccountsStatement,
  ],
  ["firm-funds entries touching client money", firmFundsEntriesTouchingClientMoneyStatement],
  [
    "firm-funds records disagreeing with the ledger",
    firmFundsMovementsDisagreeingWithLedgerStatement,
  ],
  [
    "unclaimed-funds closures naming another ledger's payment",
    unclaimedFundsClosuresNamingAnotherLedgerStatement,
  ],
  [
    "unclaimed-funds reviews that are not about a matter ledger",
    unclaimedFundsReviewsOffMatterLeavesStatement,
  ],
  [
    "client ledgers carrying two open unclaimed-funds reviews",
    unclaimedFundsLedgersWithTwoOpenReviewsStatement,
  ],
] as const;

// The one proof call sites use. Every query runs, so a query added above is automatically part of
// every proof. Corruption throws a plain Error — nothing a caller's user can fix — naming the failed
// query and the offending rows.
export async function assertTrustFitness(database: SqlDatabase): Promise<void> {
  for (const [name, statement] of FITNESS_STATEMENTS) {
    const { results } = await statement(database).all();
    if (results.length > 0) {
      throw new Error(
        `trust fitness: ${name} — ${results.length} offending row(s): ${JSON.stringify(results)}`,
      );
    }
  }
}

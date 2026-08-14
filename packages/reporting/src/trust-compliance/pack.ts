import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type {
  LedgerAccountId,
  LedgerEntryId,
  MatterId,
  TrustAccountId,
  TrustBankStatementId,
  TrustHoldId,
  TrustLedgerNodeId,
  TrustMovementId,
  TrustReconciliationId,
  TrustTransferId,
  UserId,
} from "@magna-carta/identifiers/types";
import { inconsistentBalancesStatement } from "@magna-carta/ledger/fitness";
import { loadTrustFirmFundsNode } from "@magna-carta/trust/firm-funds";
import {
  requireTrustJurisdiction,
  resolveTrustRequirement,
  type TrustJurisdictionPort,
} from "@magna-carta/trust/jurisdiction";
import {
  MAX_TRUST_REPORT_ROWS,
  selectOutstandingTrustBankItemsStatement,
  selectTrustAccountIdentityStatement,
  selectTrustBankJournalInPeriodStatement,
  selectTrustBookBalanceAsKnownStatement,
  selectTrustClientLedgerEntriesInPeriodStatement,
  selectTrustFirmFundsMovementsInPeriodStatement,
  selectTrustFirmFundsTotalAsKnownStatement,
  selectTrustHoldsInForceAsKnownStatement,
  selectTrustMatterLeafBalancesAsOfStatement,
  selectTrustReconciliationsInPeriodStatement,
} from "@magna-carta/trust/statements";
import { computeTrustThreeWayProof } from "@magna-carta/trust/three-way-proof";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import type { TrustFrozenProof, TrustThreeWayProof } from "@magna-carta/trust/types";
import { completeScope } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";
import {
  dayBefore,
  knowledgeBoundOf,
  reproducibilityOf,
  reproducibilityStatement,
  type ReportingPeriod,
} from "../temporal.ts";
import type {
  TrustCompliancePack,
  TrustCompliancePackClientLedger,
  TrustCompliancePackCushion,
  TrustCompliancePackCushionMovement,
  TrustCompliancePackHold,
  TrustCompliancePackJournal,
  TrustCompliancePackJournalEntry,
  TrustCompliancePackLedgerEntry,
  TrustCompliancePackMatterLedger,
  TrustCompliancePackReconciliation,
  TrustCompliancePackStoredBalanceDisagreement,
  TrustComplianceJurisdictionStatement,
  TrustComplianceOutstandingItem,
  TrustComplianceProofDifference,
  TrustComplianceUnmatchedLine,
} from "./types.ts";

// THE PACK'S ONE RULE: it never becomes a second answer to a question that already has one.
//
// The three-way proof, the client-ledger total, the book balance, the outstanding-item list and the
// stored-balance fitness query are all read through the functions and statements that OWN them. What
// this module adds is decomposition — a per-client, per-matter breakdown of a total trust already
// asserts, and a per-entry journal behind a bank balance trust already asserts — and every
// decomposition is proved equal to its aggregate in test/agreement.test.ts rather than trusted.
//
// The arithmetic that genuinely belongs here is running balances and the difference between a frozen
// attestation and the live proof. Neither is a quantity any financial package asserts, and the
// difference is labelled rather than resolved: the pack prints both figures and says why they differ.

// The layout of the document. Bumped when a section is added, removed, or reordered, so two packs a
// firm holds are comparable — a reader who cannot tell whether the copy in their hand is laid out
// like the one beside it cannot compare them.
export const TRUST_COMPLIANCE_PACK_SHAPE_VERSION = 1;

// THE OWNER'S CHOICES, made explicit rather than baked in. Each of these changes what the document
// SAYS rather than what it computes, so each is a seam with a stated default and none of them is
// decided by the code needing an answer.
export interface TrustCompliancePackOptions {
  // Whether a matter ledger that was at zero throughout the period appears at all. Completeness
  // argues for listing every ledger that existed; a readable document argues for listing only those
  // with activity or a balance. The default here is completeness, because a pack is evidence before
  // it is a document, and a reader who can see the quiet ledgers can also see that they were quiet.
  readonly zeroBalanceLedgers?: "include" | "omit";
  // Whether the journal and the client ledgers name the member who authorized money leaving a client
  // ledger. The ledger records it on every such movement precisely so it can be produced, and being
  // able to show who authorized a payment is a compliance strength — it is also a personnel record
  // going to a regulator, which is why it is a choice rather than a constant.
  readonly authorizers?: "include" | "omit";
  // What the pack does when the account's governing-rule citation cannot be resolved — because the
  // office recorded no jurisdiction, because nobody has encoded that jurisdiction's rules, because
  // no attorney has reviewed them, or because this one requirement was never researched.
  //
  // The default STATES the refusal on the cover and produces the rest of the pack. The pack's
  // figures are the firm's own ledger rows and no jurisdiction fact conditions any of them, so
  // refusing outright would withhold a firm's own records over a gap in the platform's reference
  // data. What the default will not do is print a citation nobody stood behind: the cover carries
  // the refusal in the corpus's own words instead.
  readonly onJurisdictionUnavailable?: "state-on-the-cover" | "refuse";
}

export interface AssembleTrustCompliancePackInput {
  readonly trustAccountId: TrustAccountId;
  readonly period: ReportingPeriod;
  // Who asked. Null for a read served straight to a screen, where the session is the record.
  readonly requestedBy?: UserId | null;
  readonly options?: TrustCompliancePackOptions;
}

// The requirement a bar-audit pack cites: what the governing rules say about reconciling a client
// trust account. One requirement rather than the whole profile, because that is the rule this
// document is produced under and quoting the rest would be quoting rules the pack does not evidence.
const RECONCILIATION_REQUIREMENT = "reconciliation" as const;

interface TrustAccountIdentityRow {
  id: string;
  name: string;
  location_id: string;
  jurisdiction: string | null;
  bank_name: string | null;
  account_number_last_four: string | null;
  currency: string;
  iolta: number;
  status: "open" | "closed";
  opened_on: string;
  closed_at: string | null;
  bank_ledger_account_id: string;
  client_liability_account_id: string;
}

interface LeafBalanceRow {
  node_id: string;
  matter_id: string | null;
  client_entity_id: string | null;
  ledger_account_id: string;
  balance_minor: number;
}

interface ClientLedgerEntryRow {
  node_id: string;
  matter_id: string | null;
  client_entity_id: string | null;
  entry_id: string;
  effective_date: string;
  recorded_at: string;
  description: string;
  reverses_entry_id: string | null;
  line_index: number;
  direction: "debit" | "credit";
  amount_minor: number;
  delta_minor: number;
  movement_id: string | null;
  movement_kind: string | null;
  method: string | null;
  reference: string | null;
  counterparty_name: string | null;
  purpose: string | null;
  recorded_by: string | null;
  authorized_by: string | null;
  counterparty_node_id: string | null;
  transfer_id: string | null;
  transfer_authorized_by: string | null;
  transfer_recorded_by: string | null;
}

interface JournalRow {
  entry_id: string;
  effective_date: string;
  recorded_at: string;
  description: string;
  reverses_entry_id: string | null;
  bank_delta_minor: number;
  movement_id: string | null;
  movement_kind: string | null;
  method: string | null;
  reference: string | null;
  counterparty_name: string | null;
  purpose: string | null;
  node_id: string | null;
  counterparty_node_id: string | null;
  recorded_by: string | null;
  authorized_by: string | null;
  transfer_id: string | null;
  transfer_from_node_id: string | null;
  transfer_recorded_by: string | null;
  transfer_authorized_by: string | null;
  firm_funds_movement_id: string | null;
  firm_funds_movement_kind: string | null;
  firm_funds_method: string | null;
  firm_funds_reference: string | null;
  firm_funds_description: string | null;
}

interface FirmFundsMovementRow {
  id: string;
  trust_account_id: string;
  kind: "firm_funds_deposit" | "bank_charge";
  amount_minor: number;
  currency: string;
  entry_id: string;
  method: string;
  reference: string | null;
  description: string;
  recorded_by: string;
  effective_date: string;
  recorded_at: string;
}

interface HoldRow {
  hold_id: string;
  node_id: string;
  matter_id: string | null;
  client_entity_id: string | null;
  amount_minor: number;
  currency: string;
  reason: string;
  placed_at: string;
  placed_by: string | null;
}

interface ReconciliationRow {
  id: string;
  trust_account_id: string;
  statement_id: string;
  opened_by: string;
  opened_at: string;
  supersedes_reconciliation_id: string | null;
  note: string | null;
  status: "open" | "closed";
  closed_by: string | null;
  closed_at: string | null;
  frozen_statement_closing_minor: number | null;
  frozen_outstanding_deposits_minor: number | null;
  frozen_outstanding_disbursements_minor: number | null;
  frozen_adjusted_bank_minor: number | null;
  frozen_book_balance_minor: number | null;
  frozen_client_total_minor: number | null;
  frozen_unmatched_line_count: number | null;
  frozen_unmatched_movement_count: number | null;
  frozen_firm_funds_minor: number | null;
  frozen_balanced: number | null;
  statement_period_start: string;
  statement_period_end: string;
  statement_closing_balance_minor: number;
  statement_reference: string | null;
}

interface OutstandingItemRow {
  entry_id: string;
  effective_date: string;
  description: string;
  bank_delta_minor: number;
  movement_id: string | null;
  transfer_id: string | null;
  reference: string | null;
  counterparty_name: string | null;
}

interface InconsistentBalanceRow {
  account_id: string;
  balance_minor: number;
  computed: number;
}

interface TotalRow {
  total_minor?: number;
  balance_minor?: number;
}

// Each per-row read asks for one row past its ceiling, so a truncated list arrives as a detectable
// condition rather than a confidently short section. Refusing names the section and the remedy —
// narrow the period — because a shorter period is a real answer and a truncated pack is not.
function assertNotTruncated(
  rowCount: number,
  code:
    | "reporting-client-ledger-truncated"
    | "reporting-journal-truncated"
    | "reporting-cushion-journal-truncated"
    | "reporting-holds-truncated",
  section: string,
  period: ReportingPeriod,
): void {
  if (rowCount > MAX_TRUST_REPORT_ROWS) {
    throw new ReportingValidationError(
      code,
      `${section} holds more than ${MAX_TRUST_REPORT_ROWS} rows between ${period.periodStart} and ${period.periodEnd}, which is more than one document can carry: produce the period in shorter parts so nothing is left out`,
    );
  }
}

function frozenProofOf(row: ReconciliationRow): TrustFrozenProof | null {
  if (
    row.status !== "closed" ||
    row.frozen_statement_closing_minor === null ||
    row.frozen_adjusted_bank_minor === null ||
    row.frozen_book_balance_minor === null ||
    row.frozen_client_total_minor === null ||
    row.frozen_balanced === null
  ) {
    return null;
  }
  return {
    statementClosingMinor: row.frozen_statement_closing_minor,
    outstandingDepositsMinor: row.frozen_outstanding_deposits_minor ?? 0,
    outstandingDisbursementsMinor: row.frozen_outstanding_disbursements_minor ?? 0,
    adjustedBankMinor: row.frozen_adjusted_bank_minor,
    bookBalanceMinor: row.frozen_book_balance_minor,
    clientLedgerTotalMinor: row.frozen_client_total_minor,
    firmFundsMinor: row.frozen_firm_funds_minor ?? 0,
    unmatchedLineCount: row.frozen_unmatched_line_count ?? 0,
    unmatchedItemCount: row.frozen_unmatched_movement_count ?? 0,
    balanced: row.frozen_balanced === 1,
  };
}

// The difference between what the firm attested to and what the ledger now says, leg by leg. It is
// arithmetic no financial package asserts — nobody else compares a frozen proof to a live one — so it
// belongs here, and it is stated as a DIFFERENCE rather than resolved into a preferred figure. A
// backdated posting into a closed reconciliation's period is legal and moves the live proof; this is
// the surface on which a firm sees that it did.
function proofDifferences(
  frozen: TrustFrozenProof,
  live: TrustThreeWayProof,
): readonly TrustComplianceProofDifference[] {
  const legs: ReadonlyArray<readonly [TrustComplianceProofDifference["leg"], number, number]> = [
    ["statement-closing", frozen.statementClosingMinor, live.statementClosingMinor],
    ["outstanding-deposits", frozen.outstandingDepositsMinor, live.outstandingDepositsMinor],
    [
      "outstanding-disbursements",
      frozen.outstandingDisbursementsMinor,
      live.outstandingDisbursementsMinor,
    ],
    ["adjusted-bank", frozen.adjustedBankMinor, live.adjustedBankMinor],
    ["book-balance", frozen.bookBalanceMinor, live.bookBalanceMinor],
    ["client-total", frozen.clientLedgerTotalMinor, live.clientLedgerTotalMinor],
    ["firm-funds", frozen.firmFundsMinor, live.firmFundsMinor],
  ];
  return legs
    .filter(([, attested, liveValue]) => attested !== liveValue)
    .map(([leg, attested, liveValue]) => ({
      leg,
      attestedMinor: attested,
      liveMinor: liveValue,
      differenceMinor: liveValue - attested,
    }));
}

// The cover's rule citation, or the named reason there is not one. The four jurisdiction refusals
// stay distinct all the way onto the page: each is fixed by a different person doing a different
// thing — recording the office's state, researching a jurisdiction, having an attorney review one,
// researching the requirement that was missed — and a cover that collapsed them would tell a firm to
// fix the wrong thing.
function resolveJurisdictionStatement(
  account: {
    readonly id: TrustAccountId;
    readonly jurisdiction: string | null;
    readonly currency: string;
    readonly status: "open" | "closed";
    readonly iolta: boolean;
    readonly bankLedgerAccountId: LedgerAccountId;
    readonly clientLiabilityAccountId: LedgerAccountId;
  },
  jurisdictions: TrustJurisdictionPort,
  onUnavailable: "state-on-the-cover" | "refuse",
): TrustComplianceJurisdictionStatement {
  try {
    const recorded = requireTrustJurisdiction(account);
    const resolved = resolveTrustRequirement<unknown>(
      jurisdictions,
      account,
      RECONCILIATION_REQUIREMENT,
    );
    return {
      available: true,
      jurisdiction: recorded,
      requirement: RECONCILIATION_REQUIREMENT,
      citation: resolved.citation,
      binding: resolved.binding,
    };
  } catch (caught) {
    if (!(caught instanceof TrustValidationError)) throw caught;
    if (onUnavailable === "refuse") throw caught;
    return {
      available: false,
      jurisdiction: account.jurisdiction,
      refusalCode: caught.code,
      refusalDetail: caught.message,
    };
  }
}

function toLedgerEntry(
  row: ClientLedgerEntryRow,
  runningBalanceMinor: number,
  namesAuthorizers: boolean,
): TrustCompliancePackLedgerEntry {
  const authorizedBy = row.authorized_by ?? row.transfer_authorized_by;
  return {
    entryId: row.entry_id as LedgerEntryId,
    effectiveDate: row.effective_date,
    recordedAt: row.recorded_at,
    description: row.description,
    reversesEntryId: row.reverses_entry_id as LedgerEntryId | null,
    direction: row.direction,
    amountMinor: row.amount_minor,
    deltaMinor: row.delta_minor,
    runningBalanceMinor,
    movementId: row.movement_id as TrustMovementId | null,
    movementKind: row.movement_kind,
    method: row.method,
    reference: row.reference,
    counterpartyName: row.counterparty_name,
    purpose: row.purpose,
    transferId: row.transfer_id as TrustTransferId | null,
    authorizedBy: namesAuthorizers ? ((authorizedBy as UserId | null) ?? null) : null,
    recordedBy: (row.recorded_by ?? row.transfer_recorded_by) as UserId | null,
  };
}

function toJournalEntry(
  row: JournalRow,
  runningBalanceMinor: number,
  namesAuthorizers: boolean,
): TrustCompliancePackJournalEntry {
  const authorizedBy = row.authorized_by ?? row.transfer_authorized_by;
  return {
    entryId: row.entry_id as LedgerEntryId,
    effectiveDate: row.effective_date,
    recordedAt: row.recorded_at,
    description: row.description,
    reversesEntryId: row.reverses_entry_id as LedgerEntryId | null,
    bankDeltaMinor: row.bank_delta_minor,
    runningBalanceMinor,
    movementId: row.movement_id as TrustMovementId | null,
    movementKind: row.movement_kind,
    transferId: row.transfer_id as TrustTransferId | null,
    firmFundsMovementId: row.firm_funds_movement_id,
    firmFundsMovementKind: row.firm_funds_movement_kind,
    method: row.method ?? row.firm_funds_method,
    reference: row.reference ?? row.firm_funds_reference,
    counterpartyName: row.counterparty_name,
    purpose: row.purpose ?? row.firm_funds_description,
    nodeId: (row.node_id ?? row.transfer_from_node_id) as TrustLedgerNodeId | null,
    counterpartyNodeId: row.counterparty_node_id as TrustLedgerNodeId | null,
    authorizedBy: namesAuthorizers ? ((authorizedBy as UserId | null) ?? null) : null,
    recordedBy: (row.recorded_by ?? row.transfer_recorded_by) as UserId | null,
  };
}

// The client ledgers, built by walking each leaf's entries forward from its opening balance. The
// leaves come from the balance read rather than from the entries, so a ledger that was quiet all
// period is still a ledger the caller can choose to print — the read never takes that choice away.
function buildClientLedgers(
  openingRows: readonly LeafBalanceRow[],
  closingRows: readonly LeafBalanceRow[],
  entryRows: readonly ClientLedgerEntryRow[],
  namesAuthorizers: boolean,
  zeroBalanceLedgers: "include" | "omit",
): readonly TrustCompliancePackClientLedger[] {
  const openingByNode = new Map(openingRows.map((row) => [row.node_id, row.balance_minor]));
  const entriesByNode = new Map<string, ClientLedgerEntryRow[]>();
  for (const row of entryRows) {
    const existing = entriesByNode.get(row.node_id);
    if (existing === undefined) entriesByNode.set(row.node_id, [row]);
    else existing.push(row);
  }

  const matterLedgers: TrustCompliancePackMatterLedger[] = [];
  for (const leaf of closingRows) {
    const opening = openingByNode.get(leaf.node_id) ?? 0;
    const rows = entriesByNode.get(leaf.node_id) ?? [];
    if (
      zeroBalanceLedgers === "omit" &&
      rows.length === 0 &&
      opening === 0 &&
      leaf.balance_minor === 0
    ) {
      continue;
    }
    let running = opening;
    const entries = rows.map((row) => {
      running += row.delta_minor;
      return toLedgerEntry(row, running, namesAuthorizers);
    });
    matterLedgers.push({
      nodeId: leaf.node_id as TrustLedgerNodeId,
      matterId: leaf.matter_id as MatterId | null,
      ledgerAccountId: leaf.ledger_account_id as LedgerAccountId,
      openingBalanceMinor: opening,
      closingBalanceMinor: leaf.balance_minor,
      entries,
    });
  }

  // Grouped by client, because that is how the record-keeping rules ask for it: a ledger per client,
  // with the matters under it. The client handle is the identity; a merge later resolves two handles
  // to one client, and the pack records the handles as they stood rather than collapsing them.
  const byClient = new Map<string, TrustCompliancePackMatterLedger[]>();
  const clientOfNode = new Map(closingRows.map((row) => [row.node_id, row.client_entity_id ?? ""]));
  for (const ledger of matterLedgers) {
    const key = clientOfNode.get(ledger.nodeId) ?? "";
    const existing = byClient.get(key);
    if (existing === undefined) byClient.set(key, [ledger]);
    else existing.push(ledger);
  }
  return [...byClient.entries()].map(([clientEntityId, matters]) => ({
    clientEntityId: clientEntityId === "" ? null : clientEntityId,
    openingBalanceMinor: matters.reduce((total, one) => total + one.openingBalanceMinor, 0),
    closingBalanceMinor: matters.reduce((total, one) => total + one.closingBalanceMinor, 0),
    matters,
  }));
}

// THE ASSEMBLY. Reads only — this module composes nothing, holds no binding, and the purity fitness
// function in test/purity.test.ts proves both over the package's own sources.
export async function assembleTrustCompliancePack(
  database: SqlDatabase,
  input: AssembleTrustCompliancePackInput,
  context: {
    readonly jurisdictions: TrustJurisdictionPort;
    // The instant the pack was assembled at. Passed in rather than read: this package holds no
    // clock, on the same terms as every other domain package here.
    readonly computedAt: string;
  },
): Promise<TrustCompliancePack> {
  const { period } = input;
  const zeroBalanceLedgers = input.options?.zeroBalanceLedgers ?? "include";
  const namesAuthorizers = (input.options?.authorizers ?? "include") === "include";
  const onJurisdictionUnavailable =
    input.options?.onJurisdictionUnavailable ?? "state-on-the-cover";
  const knowledgeBound = knowledgeBoundOf(period, context.computedAt);
  const openingDate = dayBefore(period.periodStart);

  const identity = await selectTrustAccountIdentityStatement(
    database,
    input.trustAccountId,
  ).all<TrustAccountIdentityRow>();
  const accountRow = identity.results[0];
  if (accountRow === undefined) {
    throw new TrustValidationError(
      "unknown-trust-account",
      `unknown trust account ${input.trustAccountId}`,
    );
  }

  const firmFundsNode = await loadTrustFirmFundsNode(database, input.trustAccountId);

  // The account snapshot the jurisdiction resolver takes. Built from the identity row rather than
  // read a second time: two reads of one row is two chances for them to disagree.
  const accountSnapshot = {
    id: accountRow.id as TrustAccountId,
    jurisdiction: accountRow.jurisdiction,
    currency: accountRow.currency,
    status: accountRow.status,
    iolta: accountRow.iolta === 1,
    bankLedgerAccountId: accountRow.bank_ledger_account_id as LedgerAccountId,
    clientLiabilityAccountId: accountRow.client_liability_account_id as LedgerAccountId,
  };
  const jurisdiction = resolveJurisdictionStatement(
    accountSnapshot,
    context.jurisdictions,
    onJurisdictionUnavailable,
  );

  // The bank leaf the journal is taken over, off the same row the money paths read it off.
  const bankLedgerAccountId = accountRow.bank_ledger_account_id as LedgerAccountId;

  const reconciliationRows = await selectTrustReconciliationsInPeriodStatement(
    database,
    input.trustAccountId,
    period.periodStart,
    period.periodEnd,
    knowledgeBound,
  ).all<ReconciliationRow>();

  const reconciliations: TrustCompliancePackReconciliation[] = [];
  const unmatchedStatementLines: TrustComplianceUnmatchedLine[] = [];
  for (const row of reconciliationRows.results) {
    // Resolved once and used twice: the snapshot the proof is computed against and the attestation
    // the pack prints have to be the same reading of the same row, not two of them.
    const frozenProof = frozenProofOf(row);
    // THE LIVE PROOF IS THE TRUST PACKAGE'S OWN. It is called, never reimplemented — including its
    // refusal when the outstanding-item list is longer than one reconciliation can account for,
    // which propagates unchanged and produces no pack at all. A pack that quietly omitted the
    // section would be worse than no pack, because every figure the proof derives is computed from
    // that list and they stay internally consistent whether or not they are consistent with reality.
    const liveProof = await computeTrustThreeWayProof(database, {
      id: row.id as TrustReconciliationId,
      trustAccountId: row.trust_account_id as TrustAccountId,
      statementId: row.statement_id as TrustBankStatementId,
      status: row.status,
      openedBy: row.opened_by as UserId,
      openedAt: row.opened_at,
      closedBy: row.closed_by as UserId | null,
      closedAt: row.closed_at,
      frozenProof,
      supersedesReconciliationId: row.supersedes_reconciliation_id as TrustReconciliationId | null,
      note: row.note,
    });
    reconciliations.push({
      reconciliationId: row.id as TrustReconciliationId,
      statementId: row.statement_id as TrustBankStatementId,
      statementPeriodStart: row.statement_period_start,
      statementPeriodEnd: row.statement_period_end,
      statementReference: row.statement_reference,
      openedBy: row.opened_by as UserId,
      openedAt: row.opened_at,
      statusAsKnown: row.status,
      closedBy: row.closed_by as UserId | null,
      closedAt: row.closed_at,
      frozenProof,
      proofAtProduction: {
        computedAt: context.computedAt,
        boundedByKnowledgeInstant: false,
        proof: liveProof,
        differencesFromAttestation:
          frozenProof === null ? [] : proofDifferences(frozenProof, liveProof),
      },
    });
    for (const line of liveProof.unmatchedStatementLines) {
      unmatchedStatementLines.push({ reconciliationId: row.id as TrustReconciliationId, line });
    }
  }

  const [openingBalances, closingBalances, entries, journalRows, bankOpening, bankClosing] =
    await Promise.all([
      selectTrustMatterLeafBalancesAsOfStatement(
        database,
        input.trustAccountId,
        openingDate,
        knowledgeBound,
      ).all<LeafBalanceRow>(),
      selectTrustMatterLeafBalancesAsOfStatement(
        database,
        input.trustAccountId,
        period.periodEnd,
        knowledgeBound,
      ).all<LeafBalanceRow>(),
      selectTrustClientLedgerEntriesInPeriodStatement(
        database,
        input.trustAccountId,
        period.periodStart,
        period.periodEnd,
        knowledgeBound,
      ).all<ClientLedgerEntryRow>(),
      selectTrustBankJournalInPeriodStatement(
        database,
        bankLedgerAccountId,
        period.periodStart,
        period.periodEnd,
        knowledgeBound,
      ).all<JournalRow>(),
      selectTrustBookBalanceAsKnownStatement(
        database,
        bankLedgerAccountId,
        openingDate,
        knowledgeBound,
      ).all<TotalRow>(),
      selectTrustBookBalanceAsKnownStatement(
        database,
        bankLedgerAccountId,
        period.periodEnd,
        knowledgeBound,
      ).all<TotalRow>(),
    ]);

  assertNotTruncated(
    entries.results.length,
    "reporting-client-ledger-truncated",
    "the client ledgers for this account",
    period,
  );
  assertNotTruncated(
    journalRows.results.length,
    "reporting-journal-truncated",
    "the receipts-and-disbursements journal",
    period,
  );

  const clientLedgers = buildClientLedgers(
    openingBalances.results,
    closingBalances.results,
    entries.results,
    namesAuthorizers,
    zeroBalanceLedgers,
  );

  let runningBank = bankOpening.results[0]?.balance_minor ?? 0;
  const journal: TrustCompliancePackJournal = {
    openingBalanceMinor: runningBank,
    closingBalanceMinor: bankClosing.results[0]?.balance_minor ?? 0,
    entries: journalRows.results.map((row) => {
      runningBank += row.bank_delta_minor;
      return toJournalEntry(row, runningBank, namesAuthorizers);
    }),
  };

  const cushion = await assembleCushion(
    database,
    input.trustAccountId,
    firmFundsNode,
    period,
    openingDate,
    knowledgeBound,
  );

  const holdRows = await selectTrustHoldsInForceAsKnownStatement(
    database,
    input.trustAccountId,
    knowledgeBound,
  ).all<HoldRow>();
  assertNotTruncated(
    holdRows.results.length,
    "reporting-holds-truncated",
    "the holds in force on this account",
    period,
  );

  // The outstanding-item list, read through the trust package's own statement so it is the SAME list
  // the reconciliation adjusts by. Its truncation refusal is raised by the proof above; here the row
  // count is bounded by the same probe, so a list past the ceiling has already refused.
  const outstandingRows = await selectOutstandingTrustBankItemsStatement(
    database,
    bankLedgerAccountId,
    period.periodEnd,
  ).all<OutstandingItemRow>();

  // The ledger's own fitness query, narrowed in memory to this account's accounts. Running it
  // unbounded and filtering is deliberate: the query is the LEDGER's definition of a stored balance
  // disagreeing with its lines, and rewriting it with an account filter would be a second definition
  // of the one thing a report must never redefine. It is expected to return nothing at all.
  const accountIdsInThisAccount = new Set<string>(
    closingBalances.results.map((row) => row.ledger_account_id),
  );
  const inconsistent = await inconsistentBalancesStatement(database).all<InconsistentBalanceRow>();
  const storedBalanceDisagreements: TrustCompliancePackStoredBalanceDisagreement[] =
    inconsistent.results
      .filter((row) => accountIdsInThisAccount.has(row.account_id))
      .map((row) => ({
        ledgerAccountId: row.account_id as LedgerAccountId,
        storedBalanceMinor: row.balance_minor,
        computedBalanceMinor: row.computed,
      }));

  const reproducibility = reproducibilityOf(period, context.computedAt);
  return {
    cover: {
      trustAccountId: accountRow.id as TrustAccountId,
      trustAccountName: accountRow.name,
      locationId: accountRow.location_id,
      currency: accountRow.currency,
      pooledInterestBearing: accountRow.iolta === 1,
      accountStatus: accountRow.status,
      bankName: accountRow.bank_name,
      accountNumberLastFour: accountRow.account_number_last_four,
      jurisdiction,
      bankChargeCarveOutOpen: firmFundsNode !== null,
      reproducibility,
      reproducibilityStatement: reproducibilityStatement(reproducibility),
      // Nothing screens a matter out of this read today, and the bar-audit pack is deliberately the
      // report that never will be: it is evidence produced for a regulator about the firm's handling
      // of client money, and a partial one is not evidence. The access answer to a screening question
      // here is a narrower grant, not a quieter number.
      completeness: completeScope(),
    },
    reconciliations,
    reconciliationNote:
      reconciliations.length === 0
        ? "No reconciliation of this trust account has a statement period ending in this report period."
        : null,
    // WHICH FIGURE LEADS, said out loud. The attestation is what the firm signed and it never moves;
    // the proof beside it is the ledger as it stood when this document was produced, and a backdated
    // posting made after the attestation moves that one and only that one.
    proofAtProductionNote:
      "Each reconciliation below leads with the totals the firm attested to when it closed the period. " +
      "The figures beside them are the ledger as it stood when this document was produced: they are not " +
      "bounded by this report's knowledge instant, so they are the one part of this document that can " +
      "differ between two runs of the same period. Where they differ from the attestation, the difference " +
      "is stated leg by leg — it is the ledger having moved since the firm attested, not a fault in either figure.",
    clientLedgers,
    journal,
    cushion,
    exceptions: {
      holdsInForceAtKnowledgeInstant: holdRows.results.map(toHold),
      atProduction: {
        computedAt: context.computedAt,
        boundedByKnowledgeInstant: false,
        outstandingBankItems: outstandingRows.results.map(toOutstandingItem),
        unmatchedStatementLines,
        storedBalanceDisagreements,
      },
    },
    provenance: {
      requestedBy: input.requestedBy ?? null,
      computedAt: context.computedAt,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      knownAsOf: period.knownAsOf,
      packShapeVersion: TRUST_COMPLIANCE_PACK_SHAPE_VERSION,
      options: {
        zeroBalanceLedgers,
        authorizers: namesAuthorizers ? "include" : "omit",
      },
    },
  };
}

function toHold(row: HoldRow): TrustCompliancePackHold {
  return {
    holdId: row.hold_id as TrustHoldId,
    nodeId: row.node_id as TrustLedgerNodeId,
    matterId: row.matter_id as MatterId | null,
    clientEntityId: row.client_entity_id,
    amountMinor: row.amount_minor,
    reason: row.reason,
    placedAt: row.placed_at,
    placedBy: row.placed_by as UserId | null,
  };
}

function toOutstandingItem(row: OutstandingItemRow): TrustComplianceOutstandingItem {
  return {
    entryId: row.entry_id as LedgerEntryId,
    effectiveDate: row.effective_date,
    description: row.description,
    bankDeltaMinor: row.bank_delta_minor,
    movementId: row.movement_id as TrustMovementId | null,
    transferId: row.transfer_id as TrustTransferId | null,
    reference: row.reference,
    counterpartyName: row.counterparty_name,
  };
}

function toCushionMovement(row: FirmFundsMovementRow): TrustCompliancePackCushionMovement {
  return {
    firmFundsMovementId: row.id,
    kind: row.kind,
    effectiveDate: row.effective_date,
    recordedAt: row.recorded_at,
    amountMinor: row.amount_minor,
    method: row.method,
    reference: row.reference,
    description: row.description,
    recordedBy: row.recorded_by as UserId,
  };
}

// ABSENT, NOT ZERO, on an account without the carve-out. The firm's cushion is something a firm opts
// into on one account at a time; a zero would say the firm keeps one here and it happens to be
// empty, which is a different fact. It is also never folded into a client total — the same reason the
// three-way proof gives it a fourth leg.
async function assembleCushion(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  firmFundsNode: { readonly id: TrustLedgerNodeId } | null,
  period: ReportingPeriod,
  openingDate: string,
  knowledgeBound: string,
): Promise<TrustCompliancePackCushion | null> {
  if (firmFundsNode === null) return null;
  const [opening, closing, movements] = await Promise.all([
    selectTrustFirmFundsTotalAsKnownStatement(
      database,
      trustAccountId,
      openingDate,
      knowledgeBound,
    ).all<TotalRow>(),
    selectTrustFirmFundsTotalAsKnownStatement(
      database,
      trustAccountId,
      period.periodEnd,
      knowledgeBound,
    ).all<TotalRow>(),
    selectTrustFirmFundsMovementsInPeriodStatement(
      database,
      trustAccountId,
      period.periodStart,
      period.periodEnd,
      knowledgeBound,
    ).all<FirmFundsMovementRow>(),
  ]);
  assertNotTruncated(
    movements.results.length,
    "reporting-cushion-journal-truncated",
    "the firm's own bank-charge cushion",
    period,
  );
  return {
    nodeId: firmFundsNode.id,
    openingBalanceMinor: opening.results[0]?.total_minor ?? 0,
    closingBalanceMinor: closing.results[0]?.total_minor ?? 0,
    movements: movements.results.map(toCushionMovement),
  };
}

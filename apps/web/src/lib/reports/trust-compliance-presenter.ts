/*
 * The trust-compliance pack, arranged for a screen and a file.
 *
 * Every figure below is the pack's own: opening and closing balances, running balances, the
 * attested proof and the live one beside it, and the difference between them all arrive computed
 * by the reporting package, where the agreement tests prove them. This module formats money,
 * dates and instants and puts rows in sections. It sums nothing, and its test says so.
 *
 * CAPTIONS ARE NOT FIGURES. The pack carries identifiers beside every name because names drift and
 * identifiers do not. A caption port lets the screen name a matter or a client where it can (the
 * firm's matter roster is already read for the Time screen); where it cannot, the identifier is
 * printed as it stands, which is the pack's own posture rather than a stand-in that names the
 * wrong thing.
 */
import { formatDate, formatInstant, formatMoney } from "@magna-carta/design-system/formatters";
import {
  completenessLine,
  figureCell,
  type ReportCell,
  type ReportPresentation,
  type ReportSection,
} from "./report-presentation.ts";
import type {
  TrustComplianceBankItem,
  TrustCompliancePack,
  TrustComplianceStatementLine,
} from "./reports-api.ts";

/** How the screen names the records the pack identifies. Identity where it has no better word. */
export interface ReportCaptions {
  readonly matter: (matterId: string) => string;
  readonly client: (clientEntityId: string) => string;
  readonly member: (userId: string) => string;
}

export const IDENTITY_CAPTIONS: ReportCaptions = {
  matter: (matterId) => matterId,
  client: (clientEntityId) => clientEntityId,
  member: (userId) => userId,
};

const NONE = "";
const YES = "Yes";
const NO = "No";

function money(amountMinor: number, currency: string): ReportCell {
  return figureCell(formatMoney(amountMinor / 100, { currency }), amountMinor / 100);
}

function optional(value: string | null, captions?: (value: string) => string): string {
  if (value === null) return NONE;
  return captions === undefined ? value : captions(value);
}

function yesNo(value: boolean): string {
  return value ? YES : NO;
}

const MOVEMENT_KIND_LABELS: Readonly<Record<string, string>> = {
  deposit: "Deposit",
  disbursement: "Disbursement",
  matter_transfer: "Transfer between matters",
  firm_funds_deposit: "Firm funds deposit",
  bank_charge: "Bank charge",
};

/** What a movement is, in the reader's words; an unknown kind is printed as served. */
function movementKind(kind: string | null, transferId: string | null): string {
  if (kind !== null) return MOVEMENT_KIND_LABELS[kind] ?? kind;
  if (transferId !== null) return "Earned-fee transfer";
  return NONE;
}

const LEG_LABELS: Readonly<Record<string, string>> = {
  bank: "Adjusted bank",
  book: "Book",
  client: "Client ledgers",
  firmFunds: "Firm funds",
};

function legLabel(leg: string): string {
  return LEG_LABELS[leg] ?? leg;
}

function bankItemRow(item: TrustComplianceBankItem, currency: string): ReportCell[] {
  return [
    formatDate(item.effectiveDate),
    item.description,
    movementKind(item.movementKind, item.transferId),
    optional(item.reference),
    optional(item.counterpartyName),
    money(item.bankDeltaMinor, currency),
  ];
}

function statementLineRow(line: TrustComplianceStatementLine, currency: string): ReportCell[] {
  return [
    formatDate(line.postedOn),
    line.description,
    line.direction,
    optional(line.reference),
    optional(line.counterpartyName),
    money(line.amountMinor, currency),
  ];
}

export function presentTrustCompliancePack(
  pack: TrustCompliancePack,
  captions: ReportCaptions = IDENTITY_CAPTIONS,
): ReportPresentation {
  const { cover, provenance } = pack;
  const currency = cover.currency;
  const period = `${formatDate(provenance.periodStart)} to ${formatDate(provenance.periodEnd)}`;
  const knowledge =
    provenance.knownAsOf === null
      ? `Everything known when produced, at ${formatInstant(provenance.computedAt)}`
      : `Everything recorded by ${formatInstant(provenance.knownAsOf)}`;

  const coverSection: ReportSection = {
    id: "cover",
    title: "Cover",
    headers: ["Item", "Detail"],
    whenEmpty: "Nothing to show.",
    rows: [
      ["Trust Account", cover.trustAccountName],
      ["Trust Account Identifier", cover.trustAccountId],
      ["Bank", optional(cover.bankName)],
      ["Account Number Ending", optional(cover.accountNumberLastFour)],
      ["Currency", cover.currency],
      ["Account Status", cover.accountStatus === "open" ? "Open" : "Closed"],
      ["Pooled Interest-Bearing", yesNo(cover.pooledInterestBearing)],
      [
        "Governing Rule",
        cover.jurisdiction.available
          ? `${cover.jurisdiction.citation}: ${cover.jurisdiction.requirement}`
          : cover.jurisdiction.refusalDetail,
      ],
      ["Bank-Charge Carve-Out", cover.bankChargeCarveOutOpen ? "Open" : "Not open"],
      ["Period", period],
      ["Knowledge", knowledge],
      ["Coverage", completenessLine(cover.completeness)],
    ],
  };

  const reconciliationRows: ReportCell[][] = pack.reconciliations.map((reconciliation) => {
    const frozen = reconciliation.frozenProof;
    const live = reconciliation.proofAtProduction.proof;
    const differences = reconciliation.proofAtProduction.differencesFromAttestation
      .map(
        (difference) =>
          `${legLabel(difference.leg)} ${formatMoney(difference.differenceMinor / 100, { currency })}`,
      )
      .join("; ");
    return [
      `${formatDate(reconciliation.statementPeriodStart)} to ${formatDate(reconciliation.statementPeriodEnd)}`,
      optional(reconciliation.statementReference),
      reconciliation.statusAsKnown === "closed" ? "Closed" : "Open",
      optional(reconciliation.closedBy, captions.member),
      reconciliation.closedAt === null ? NONE : formatInstant(reconciliation.closedAt),
      frozen === null ? NONE : money(frozen.adjustedBankMinor, currency),
      frozen === null ? NONE : money(frozen.bookBalanceMinor, currency),
      frozen === null ? NONE : money(frozen.clientLedgerTotalMinor, currency),
      frozen === null ? NONE : money(frozen.firmFundsMinor, currency),
      frozen === null ? NONE : yesNo(frozen.balanced),
      money(live.adjustedBankMinor, currency),
      money(live.bookBalanceMinor, currency),
      money(live.clientLedgerTotalMinor, currency),
      money(live.firmFundsMinor, currency),
      yesNo(live.balanced),
      differences === "" ? NONE : differences,
    ];
  });

  const reconciliationsSection: ReportSection = {
    id: "reconciliations",
    title: "Reconciliations",
    headers: [
      "Statement Period",
      "Statement",
      "Status",
      "Closed By",
      "Closed At",
      "Attested Bank",
      "Attested Book",
      "Attested Client Ledgers",
      "Attested Firm Funds",
      "Attested Balanced",
      "Bank Now",
      "Book Now",
      "Client Ledgers Now",
      "Firm Funds Now",
      "Balanced Now",
      "Differences",
    ],
    endAlignedColumns: [5, 6, 7, 8, 10, 11, 12, 13],
    rows: reconciliationRows,
    note: pack.reconciliationNote ?? pack.proofAtProductionNote,
    whenEmpty: pack.reconciliationNote ?? "No reconciliation falls in this period.",
  };

  const ledgerRows: ReportCell[][] = [];
  for (const client of pack.clientLedgers) {
    const clientName = optional(client.clientEntityId, captions.client);
    for (const matter of client.matters) {
      const matterName = optional(matter.matterId, captions.matter);
      ledgerRows.push([
        clientName,
        matterName,
        NONE,
        "Balance brought forward",
        NONE,
        NONE,
        NONE,
        money(matter.openingBalanceMinor, currency),
        NONE,
      ]);
      for (const entry of matter.entries) {
        ledgerRows.push([
          clientName,
          matterName,
          formatDate(entry.effectiveDate),
          entry.reversesEntryId === null
            ? entry.description
            : `${entry.description} (reverses ${entry.reversesEntryId})`,
          movementKind(entry.movementKind, entry.transferId),
          optional(entry.reference),
          money(entry.deltaMinor, currency),
          money(entry.runningBalanceMinor, currency),
          optional(entry.authorizedBy, captions.member),
        ]);
      }
      ledgerRows.push([
        clientName,
        matterName,
        NONE,
        "Balance carried forward",
        NONE,
        NONE,
        NONE,
        money(matter.closingBalanceMinor, currency),
        NONE,
      ]);
    }
  }

  const clientLedgersSection: ReportSection = {
    id: "client-ledgers",
    title: "Client Ledgers",
    headers: [
      "Client",
      "Matter",
      "Date",
      "Description",
      "Kind",
      "Reference",
      "Amount",
      "Balance",
      "Authorized By",
    ],
    endAlignedColumns: [6, 7],
    rows: ledgerRows,
    whenEmpty: "No client ledger held money in this period.",
  };

  const journalRows: ReportCell[][] = [
    [
      NONE,
      "Balance brought forward",
      NONE,
      NONE,
      NONE,
      NONE,
      NONE,
      money(pack.journal.openingBalanceMinor, currency),
      NONE,
    ],
  ];
  for (const entry of pack.journal.entries) {
    journalRows.push([
      formatDate(entry.effectiveDate),
      entry.reversesEntryId === null
        ? entry.description
        : `${entry.description} (reverses ${entry.reversesEntryId})`,
      entry.firmFundsMovementKind === null
        ? movementKind(entry.movementKind, entry.transferId)
        : movementKind(entry.firmFundsMovementKind, null),
      optional(entry.method),
      optional(entry.reference),
      optional(entry.counterpartyName),
      money(entry.bankDeltaMinor, currency),
      money(entry.runningBalanceMinor, currency),
      optional(entry.authorizedBy, captions.member),
    ]);
  }
  journalRows.push([
    NONE,
    "Balance carried forward",
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    money(pack.journal.closingBalanceMinor, currency),
    NONE,
  ]);

  const journalSection: ReportSection = {
    id: "journal",
    title: "Receipts and Disbursements Journal",
    headers: [
      "Date",
      "Description",
      "Kind",
      "Method",
      "Reference",
      "Counterparty",
      "Amount",
      "Bank Balance",
      "Authorized By",
    ],
    endAlignedColumns: [6, 7],
    rows: journalRows,
    whenEmpty: "Nothing moved the bank balance in this period.",
  };

  const sections: ReportSection[] = [
    coverSection,
    reconciliationsSection,
    clientLedgersSection,
    journalSection,
  ];

  if (pack.cushion !== null) {
    const cushionRows: ReportCell[][] = [
      [
        NONE,
        "Balance brought forward",
        NONE,
        NONE,
        NONE,
        NONE,
        money(pack.cushion.openingBalanceMinor, currency),
        NONE,
      ],
    ];
    for (const movement of pack.cushion.movements) {
      cushionRows.push([
        formatDate(movement.effectiveDate),
        movement.description,
        movementKind(movement.kind, null),
        movement.method,
        optional(movement.reference),
        money(
          movement.kind === "bank_charge" ? -movement.amountMinor : movement.amountMinor,
          currency,
        ),
        NONE,
        captions.member(movement.recordedBy),
      ]);
    }
    cushionRows.push([
      NONE,
      "Balance carried forward",
      NONE,
      NONE,
      NONE,
      NONE,
      money(pack.cushion.closingBalanceMinor, currency),
      NONE,
    ]);
    sections.push({
      id: "cushion",
      title: "The Firm's Own Funds",
      headers: [
        "Date",
        "Description",
        "Kind",
        "Method",
        "Reference",
        "Amount",
        "Balance",
        "Recorded By",
      ],
      endAlignedColumns: [5, 6],
      rows: cushionRows,
      whenEmpty: "The firm deposited nothing and paid no bank charge in this period.",
    });
  }

  const { exceptions } = pack;
  sections.push({
    id: "holds",
    title: "Holds in Force",
    headers: ["Client", "Matter", "Amount", "Reason", "Placed At", "Placed By"],
    endAlignedColumns: [2],
    rows: exceptions.holdsInForceAtKnowledgeInstant.map((hold) => [
      optional(hold.clientEntityId, captions.client),
      optional(hold.matterId, captions.matter),
      money(hold.amountMinor, currency),
      hold.reason,
      formatInstant(hold.placedAt),
      optional(hold.placedBy, captions.member),
    ]),
    whenEmpty: "No hold was in place as of the report date.",
  });

  const atProduction = `As at ${formatInstant(exceptions.atProduction.computedAt)}, not bounded by the knowledge instant.`;
  sections.push({
    id: "outstanding-items",
    title: "Outstanding Recorded Items",
    headers: ["Date", "Description", "Kind", "Reference", "Counterparty", "Amount"],
    endAlignedColumns: [5],
    rows: exceptions.atProduction.outstandingBankItems.map((item) => bankItemRow(item, currency)),
    note: atProduction,
    whenEmpty: "All recorded items have reached the bank.",
  });
  sections.push({
    id: "unmatched-lines",
    title: "Unmatched Statement Lines",
    headers: ["Posted On", "Description", "Direction", "Reference", "Counterparty", "Amount"],
    endAlignedColumns: [5],
    rows: exceptions.atProduction.unmatchedStatementLines.map(({ line }) =>
      statementLineRow(line, currency),
    ),
    note: atProduction,
    whenEmpty: "All statement lines are matched.",
  });
  sections.push({
    id: "stored-balance-checks",
    title: "Stored Balance Checks",
    headers: ["Ledger Account", "Stored Balance", "Computed Balance"],
    endAlignedColumns: [1, 2],
    rows: exceptions.atProduction.storedBalanceDisagreements.map((disagreement) => [
      disagreement.ledgerAccountId,
      money(disagreement.storedBalanceMinor, currency),
      money(disagreement.computedBalanceMinor, currency),
    ]),
    note: atProduction,
    whenEmpty: "All stored balances match their entries.",
  });

  sections.push({
    id: "provenance",
    title: "Provenance",
    headers: ["Item", "Detail"],
    whenEmpty: "Nothing to show.",
    rows: [
      ["Produced At", formatInstant(provenance.computedAt)],
      ["Period", period],
      ["Knowledge Instant", provenance.knownAsOf ?? "None: live"],
      ["Requested By", optional(provenance.requestedBy, captions.member)],
      [
        "Zero-Balance Ledgers",
        provenance.options.zeroBalanceLedgers === "include" ? "Listed" : "Omitted",
      ],
      ["Authorizers", provenance.options.authorizers === "include" ? "Named" : "Omitted"],
      ["Document Shape Version", String(provenance.packShapeVersion)],
      ["Statement", cover.reproducibilityStatement],
    ],
  });

  return {
    title: "Trust Compliance Report",
    subtitle: cover.trustAccountName,
    stamp: cover.reproducibilityStatement,
    reproducible: cover.reproducibility.reproducible,
    completeness: cover.completeness,
    sections,
  };
}

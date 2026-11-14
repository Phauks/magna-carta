/*
 * A sample trust-compliance pack, for the run screen's loading fixture and for the presenter's
 * tests. Sample words only — the design system's own sample people and matters, invented
 * references and round-looking sums — never a firm's own figures. Every figure here is written so
 * the pack is internally consistent (a running balance follows its entries), because the fixture is
 * rendered through the same presenter the answer is, and a test over it asserts the presenter
 * printed the pack's figures and not its own.
 */
import { SAMPLE_MATTERS, SAMPLE_PEOPLE } from "@magna-carta/design-system/loading-fixtures";
import type { TrustCompliancePack } from "./reports-api.ts";

const CURRENCY = "USD";
const PRODUCED_AT = "2026-08-01T00:00:00.000Z";
const KNOWN_AS_OF = "2026-07-31T23:59:59.999Z";
const REPRODUCIBILITY_STATEMENT =
  "The figures in this report cover 2026-07-01 to 2026-07-31 and include everything the platform " +
  "had recorded as at 2026-07-31T23:59:59.999Z. Running the same period and the same knowledge " +
  "instant again returns the same figures, whatever has been recorded since. Names, office details " +
  "and rule citations are as they stood when this report was produced.";

const matterOne = SAMPLE_MATTERS[0];
const matterTwo = SAMPLE_MATTERS[1];
const personOne = SAMPLE_PEOPLE[0];

export const SAMPLE_TRUST_ACCOUNT_ID = "trustAccount_sample";
export const SAMPLE_MATTER_ONE_ID = matterOne?.number ?? "matter_sample_one";
export const SAMPLE_MATTER_TWO_ID = matterTwo?.number ?? "matter_sample_two";
export const SAMPLE_CLIENT_ID = "entity_sample_client";
export const SAMPLE_MEMBER_ID = personOne?.name ?? "user_sample";

export function sampleTrustCompliancePack(): TrustCompliancePack {
  return {
    cover: {
      trustAccountId: SAMPLE_TRUST_ACCOUNT_ID,
      trustAccountName: "IOLTA Trust Account",
      locationId: "location_sample",
      currency: CURRENCY,
      pooledInterestBearing: true,
      accountStatus: "open",
      bankName: "First Meridian Bank",
      accountNumberLastFour: "4471",
      jurisdiction: {
        available: false,
        jurisdiction: "US-NV",
        refusalCode: "jurisdiction-not-verified",
        refusalDetail:
          "The rules for US-NV aren't reviewed by an attorney yet, so no citation is quoted.",
      },
      bankChargeCarveOutOpen: false,
      reproducibility: {
        reproducible: true,
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        knownAsOf: KNOWN_AS_OF,
      },
      reproducibilityStatement: REPRODUCIBILITY_STATEMENT,
      completeness: { scope: "complete" },
    },
    reconciliations: [
      {
        reconciliationId: "trustReconciliation_sample",
        statementId: "trustBankStatement_sample",
        statementPeriodStart: "2026-07-01",
        statementPeriodEnd: "2026-07-31",
        statementReference: "Statement 07/2026",
        openedBy: SAMPLE_MEMBER_ID,
        openedAt: "2026-08-01T15:00:00.000Z",
        statusAsKnown: "closed",
        closedBy: SAMPLE_MEMBER_ID,
        closedAt: "2026-08-02T16:30:00.000Z",
        frozenProof: {
          statementClosingMinor: 1_250_000,
          outstandingDepositsMinor: 0,
          outstandingDisbursementsMinor: 0,
          adjustedBankMinor: 1_250_000,
          bookBalanceMinor: 1_250_000,
          clientLedgerTotalMinor: 1_250_000,
          firmFundsMinor: 0,
          unmatchedLineCount: 0,
          unmatchedItemCount: 0,
          balanced: true,
        },
        proofAtProduction: {
          computedAt: PRODUCED_AT,
          boundedByKnowledgeInstant: false,
          proof: {
            trustAccountId: SAMPLE_TRUST_ACCOUNT_ID,
            statementId: "trustBankStatement_sample",
            asOfDate: "2026-07-31",
            currency: CURRENCY,
            statementClosingMinor: 1_250_000,
            outstandingDeposits: [],
            outstandingDepositsMinor: 0,
            outstandingDisbursements: [],
            outstandingDisbursementsMinor: 0,
            adjustedBankMinor: 1_250_000,
            bookBalanceMinor: 1_250_000,
            clientLedgerTotalMinor: 1_250_000,
            firmFundsMinor: 0,
            unmatchedStatementLines: [],
            balanced: true,
            disagreements: [],
          },
          differencesFromAttestation: [],
        },
      },
    ],
    reconciliationNote: null,
    proofAtProductionNote:
      "Each reconciliation is compared with the ledger as it is now, not as of the report date.",
    clientLedgers: [
      {
        clientEntityId: SAMPLE_CLIENT_ID,
        openingBalanceMinor: 500_000,
        closingBalanceMinor: 1_250_000,
        matters: [
          {
            nodeId: "trustLedgerNode_sample_one",
            matterId: SAMPLE_MATTER_ONE_ID,
            ledgerAccountId: "ledgerAccount_sample_one",
            openingBalanceMinor: 500_000,
            closingBalanceMinor: 950_000,
            entries: [
              {
                entryId: "ledgerEntry_sample_one",
                effectiveDate: "2026-07-03",
                recordedAt: "2026-07-03T18:00:00.000Z",
                description: "Retainer received",
                reversesEntryId: null,
                direction: "credit",
                amountMinor: 750_000,
                deltaMinor: 750_000,
                runningBalanceMinor: 1_250_000,
                movementId: "trustMovement_sample_one",
                movementKind: "deposit",
                method: "wire",
                reference: "WIRE 20931",
                counterpartyName: "Sample client",
                purpose: "Advance on fees and costs",
                transferId: null,
                authorizedBy: null,
                recordedBy: SAMPLE_MEMBER_ID,
              },
              {
                entryId: "ledgerEntry_sample_two",
                effectiveDate: "2026-07-18",
                recordedAt: "2026-07-18T21:00:00.000Z",
                description: "Filing fee paid to the clerk",
                reversesEntryId: null,
                direction: "debit",
                amountMinor: 300_000,
                deltaMinor: -300_000,
                runningBalanceMinor: 950_000,
                movementId: "trustMovement_sample_two",
                movementKind: "disbursement",
                method: "check",
                reference: "1042",
                counterpartyName: "Clerk of the court",
                purpose: "Filing fee",
                transferId: null,
                authorizedBy: SAMPLE_MEMBER_ID,
                recordedBy: SAMPLE_MEMBER_ID,
              },
            ],
          },
          {
            nodeId: "trustLedgerNode_sample_two",
            matterId: SAMPLE_MATTER_TWO_ID,
            ledgerAccountId: "ledgerAccount_sample_two",
            openingBalanceMinor: 0,
            closingBalanceMinor: 300_000,
            entries: [
              {
                entryId: "ledgerEntry_sample_three",
                effectiveDate: "2026-07-22",
                recordedAt: "2026-07-22T17:15:00.000Z",
                description: "Settlement proceeds received",
                reversesEntryId: null,
                direction: "credit",
                amountMinor: 300_000,
                deltaMinor: 300_000,
                runningBalanceMinor: 300_000,
                movementId: "trustMovement_sample_three",
                movementKind: "deposit",
                method: "check",
                reference: "8817",
                counterpartyName: "Opposing insurer",
                purpose: "Settlement",
                transferId: null,
                authorizedBy: null,
                recordedBy: SAMPLE_MEMBER_ID,
              },
            ],
          },
        ],
      },
    ],
    journal: {
      openingBalanceMinor: 500_000,
      closingBalanceMinor: 1_250_000,
      entries: [
        {
          entryId: "ledgerEntry_sample_one",
          effectiveDate: "2026-07-03",
          recordedAt: "2026-07-03T18:00:00.000Z",
          description: "Retainer received",
          reversesEntryId: null,
          bankDeltaMinor: 750_000,
          runningBalanceMinor: 1_250_000,
          movementId: "trustMovement_sample_one",
          movementKind: "deposit",
          transferId: null,
          firmFundsMovementId: null,
          firmFundsMovementKind: null,
          method: "wire",
          reference: "WIRE 20931",
          counterpartyName: "Sample client",
          purpose: "Advance on fees and costs",
          nodeId: "trustLedgerNode_sample_one",
          counterpartyNodeId: null,
          authorizedBy: null,
          recordedBy: SAMPLE_MEMBER_ID,
        },
        {
          entryId: "ledgerEntry_sample_two",
          effectiveDate: "2026-07-18",
          recordedAt: "2026-07-18T21:00:00.000Z",
          description: "Filing fee paid to the clerk",
          reversesEntryId: null,
          bankDeltaMinor: -300_000,
          runningBalanceMinor: 950_000,
          movementId: "trustMovement_sample_two",
          movementKind: "disbursement",
          transferId: null,
          firmFundsMovementId: null,
          firmFundsMovementKind: null,
          method: "check",
          reference: "1042",
          counterpartyName: "Clerk of the court",
          purpose: "Filing fee",
          nodeId: "trustLedgerNode_sample_one",
          counterpartyNodeId: null,
          authorizedBy: SAMPLE_MEMBER_ID,
          recordedBy: SAMPLE_MEMBER_ID,
        },
        {
          entryId: "ledgerEntry_sample_three",
          effectiveDate: "2026-07-22",
          recordedAt: "2026-07-22T17:15:00.000Z",
          description: "Settlement proceeds received",
          reversesEntryId: null,
          bankDeltaMinor: 300_000,
          runningBalanceMinor: 1_250_000,
          movementId: "trustMovement_sample_three",
          movementKind: "deposit",
          transferId: null,
          firmFundsMovementId: null,
          firmFundsMovementKind: null,
          method: "check",
          reference: "8817",
          counterpartyName: "Opposing insurer",
          purpose: "Settlement",
          nodeId: "trustLedgerNode_sample_two",
          counterpartyNodeId: null,
          authorizedBy: null,
          recordedBy: SAMPLE_MEMBER_ID,
        },
      ],
    },
    cushion: null,
    exceptions: {
      holdsInForceAtKnowledgeInstant: [
        {
          holdId: "trustHold_sample",
          nodeId: "trustLedgerNode_sample_two",
          matterId: SAMPLE_MATTER_TWO_ID,
          clientEntityId: SAMPLE_CLIENT_ID,
          amountMinor: 100_000,
          reason: "Lien asserted by a treating provider",
          placedAt: "2026-07-23T14:00:00.000Z",
          placedBy: SAMPLE_MEMBER_ID,
        },
      ],
      atProduction: {
        computedAt: PRODUCED_AT,
        boundedByKnowledgeInstant: false,
        outstandingBankItems: [],
        unmatchedStatementLines: [],
        storedBalanceDisagreements: [],
      },
    },
    provenance: {
      requestedBy: null,
      computedAt: PRODUCED_AT,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      knownAsOf: KNOWN_AS_OF,
      packShapeVersion: 1,
      options: { zeroBalanceLedgers: "include", authorizers: "include" },
    },
  };
}

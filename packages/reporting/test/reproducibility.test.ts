import { reverseEntry } from "@magna-carta/ledger/reverse-entry";
import { composeTrustBankStatement } from "@magna-carta/trust/bank-statements";
import {
  closeTrustReconciliation,
  openTrustReconciliation,
} from "@magna-carta/trust/reconciliation";
import { describe, expect, it } from "vitest";
import { resolveReportingPeriod } from "../src/temporal.ts";
import {
  assembleTrustCompliancePack,
  type AssembleTrustCompliancePackInput,
} from "../src/trust-compliance/pack.ts";
import type { TrustCompliancePack } from "../src/trust-compliance/types.ts";
import {
  AUTHORIZER,
  commit,
  depositInto,
  disburseFrom,
  optionsAt,
  reportingFixture,
  seedMatter,
  unreviewedJurisdictions,
  usd,
} from "./support.ts";

// THE PROPERTY THIS SLICE EXISTS TO DELIVER, in its own file because it is the claim rather than a
// feature: a bar-audit pack is evidence, and evidence that answers differently the second time it is
// asked is not evidence.
//
// The shape of the test is the shape of the failure it guards against. Produce a pack at a knowledge
// instant. Post a correction with an effective date INSIDE the period the pack covers and a
// `recorded_at` after that instant — the exact move that, on a single-axis report, silently rewrites
// a month somebody already signed. Re-run at the same instant and every figure must be identical.

const COMPUTED_AT = "2026-09-01T12:00:00.000Z";
const RE_RUN_AT = "2026-11-01T12:00:00.000Z";
// After the July activity and after the reconciliation closed; before the correction posted in
// October.
const KNOWN_AS_OF = "2026-08-15T00:00:00.000Z";

// Everything a document says except the one block that is deliberately not bounded by the knowledge
// instant: the three-way proof as it stood at production. The pack states on its own face that this
// is the part allowed to differ, and this helper is how the test holds it to exactly that.
function figuresBoundedByTheKnowledgeInstant(pack: TrustCompliancePack) {
  return {
    ...pack,
    cover: { ...pack.cover, reproducibilityStatement: pack.cover.reproducibilityStatement },
    reconciliations: pack.reconciliations.map((reconciliation) => {
      const { proofAtProduction: _unboundedProof, ...bounded } = reconciliation;
      return bounded;
    }),
    exceptions: { holdsInForceAtKnowledgeInstant: pack.exceptions.holdsInForceAtKnowledgeInstant },
    provenance: { ...pack.provenance, computedAt: "<the instant it was assembled>" },
  };
}

async function reconciledFixture() {
  const fixture = await reportingFixture();
  const webb = await seedMatter(fixture, "Webb", "entity_webb", "2026-06-01T09:00:00.000Z");
  const deposit = await depositInto(fixture, {
    matterId: webb,
    label: "Webb",
    amountMinor: 900_00,
    effectiveDate: "2026-07-03",
    recordedAt: "2026-07-03T10:00:00.000Z",
  });
  const disbursement = await disburseFrom(fixture, {
    fromNodeId: deposit.nodeId,
    amountMinor: 150_00,
    effectiveDate: "2026-07-18",
    recordedAt: "2026-07-18T10:00:00.000Z",
  });

  // The bank's own figures for July, and the reconciliation the firm attested to on them.
  const statement = await composeTrustBankStatement(
    fixture.database,
    {
      trustAccountId: fixture.trustAccountId,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      openingBalance: usd(0),
      closingBalance: usd(750_00),
      statementReference: "JUL-2026",
      source: "entered",
      lines: [
        {
          postedOn: "2026-07-03",
          direction: "deposit",
          amount: usd(900_00),
          description: "Deposit",
          reference: "1041",
        },
        {
          postedOn: "2026-07-18",
          direction: "withdrawal",
          amount: usd(150_00),
          description: "Check 2001",
          reference: "2001",
        },
      ],
      recordedBy: AUTHORIZER,
    },
    optionsAt("2026-08-01T09:00:00.000Z"),
  );
  await commit(fixture.database, statement.effect, "2026-08-01T09:00:00.000Z");

  const opened = await openTrustReconciliation(
    fixture.database,
    { statementId: statement.statementId, openedBy: AUTHORIZER },
    optionsAt("2026-08-01T10:00:00.000Z"),
  );
  await commit(fixture.database, opened.effect, "2026-08-01T10:00:00.000Z");
  const closed = await closeTrustReconciliation(
    fixture.database,
    opened.reconciliationId,
    AUTHORIZER,
    optionsAt("2026-08-02T10:00:00.000Z"),
  );
  await commit(fixture.database, closed.effect, "2026-08-02T10:00:00.000Z");

  return { fixture, webb, deposit, disbursement, reconciliationId: opened.reconciliationId };
}

const julyAt = (
  knownAsOf: string | null,
  now: string,
): AssembleTrustCompliancePackInput["period"] =>
  resolveReportingPeriod({ periodStart: "2026-07-01", periodEnd: "2026-07-31", knownAsOf }, now);

describe("a pack taken at a knowledge instant reproduces", () => {
  it("returns the same figures after a correction is backdated into the period", async () => {
    const { fixture, disbursement } = await reconciledFixture();
    const before = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAt(KNOWN_AS_OF, COMPUTED_AT) },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );

    // The move the two axes exist to survive: an effective date inside the period, recorded months
    // after somebody signed the pack. On a single-axis report this silently rewrites July.
    const correction = await reverseEntry(
      fixture.database,
      {
        entryId: disbursement.entryId,
        effectiveDate: "2026-07-18",
        description: "Check 2001 was never presented and is voided",
      },
      optionsAt("2026-10-05T09:00:00.000Z"),
    );
    await commit(fixture.database, correction.effect, "2026-10-05T09:00:00.000Z");

    const after = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAt(KNOWN_AS_OF, RE_RUN_AT) },
      { jurisdictions: unreviewedJurisdictions, computedAt: RE_RUN_AT },
    );

    expect(figuresBoundedByTheKnowledgeInstant(after)).toEqual(
      figuresBoundedByTheKnowledgeInstant(before),
    );
    // Not a vacuous comparison: the pack really does carry the July figures the correction attacks.
    expect(after.journal.closingBalanceMinor).toBe(750_00);
    expect(after.clientLedgers[0]?.closingBalanceMinor).toBe(750_00);
    expect(after.reconciliations.length).toBe(1);
  });

  it("shows the figures moving once the same period is re-run live, and the attestation not moving", async () => {
    const { fixture, disbursement } = await reconciledFixture();
    const asOf = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAt(KNOWN_AS_OF, COMPUTED_AT) },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    const correction = await reverseEntry(
      fixture.database,
      {
        entryId: disbursement.entryId,
        effectiveDate: "2026-07-18",
        description: "Check 2001 was never presented and is voided",
      },
      optionsAt("2026-10-05T09:00:00.000Z"),
    );
    await commit(fixture.database, correction.effect, "2026-10-05T09:00:00.000Z");

    const live = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAt(null, RE_RUN_AT) },
      { jurisdictions: unreviewedJurisdictions, computedAt: RE_RUN_AT },
    );

    // The ledger moved, and the live pack says so.
    expect(live.journal.closingBalanceMinor).toBe(900_00);
    expect(live.cover.reproducibility.reproducible).toBe(false);
    expect(live.cover.reproducibilityStatement).toContain("not claimed to reproduce");

    // The attestation did not move, in either pack: the freeze is one-way and a backdated posting
    // cannot rewrite what a firm signed.
    expect(live.reconciliations[0]?.frozenProof).toEqual(asOf.reconciliations[0]?.frozenProof);

    // And the difference between the two is stated leg by leg rather than resolved into one figure.
    const differences = live.reconciliations[0]?.proofAtProduction.differencesFromAttestation ?? [];
    expect(differences.length).toBeGreaterThan(0);
    const bookLeg = differences.find((difference) => difference.leg === "book-balance");
    expect(bookLeg?.attestedMinor).toBe(750_00);
    expect(bookLeg?.liveMinor).toBe(900_00);
    expect(bookLeg?.differenceMinor).toBe(150_00);
  });

  // A correction stands BESIDE the entry it corrects. A report that netted it away would lose the
  // fact a reader needs, so the live ledger shows both rows and the reversal names its target.
  it("prints the reversal beside the entry it reverses rather than netting it away", async () => {
    const { fixture, disbursement } = await reconciledFixture();
    const correction = await reverseEntry(
      fixture.database,
      {
        entryId: disbursement.entryId,
        effectiveDate: "2026-07-18",
        description: "Check 2001 was never presented and is voided",
      },
      optionsAt("2026-10-05T09:00:00.000Z"),
    );
    await commit(fixture.database, correction.effect, "2026-10-05T09:00:00.000Z");

    const live = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAt(null, RE_RUN_AT) },
      { jurisdictions: unreviewedJurisdictions, computedAt: RE_RUN_AT },
    );
    const entries = live.clientLedgers.flatMap((client) =>
      client.matters.flatMap((matter) => matter.entries),
    );
    expect(entries.map((entry) => entry.entryId)).toContain(disbursement.entryId);
    const reversal = entries.find((entry) => entry.entryId === correction.entryId);
    expect(reversal?.reversesEntryId).toBe(disbursement.entryId);
    // Both rows are present, and the disbursement's own line is unchanged by the correction.
    const original = entries.find((entry) => entry.entryId === disbursement.entryId);
    expect(original?.deltaMinor).toBe(-150_00);
    expect(reversal?.deltaMinor).toBe(150_00);
  });

  // A reconciliation closed AFTER the knowledge instant reads as open, with no attestation. Printing
  // one would print knowledge from after the moment the pack claims to be taken at, and the same
  // triple would then answer differently before and after the close.
  it("does not print an attestation the firm made after the pack's knowledge instant", async () => {
    const { fixture } = await reconciledFixture();
    const beforeTheClose = await assembleTrustCompliancePack(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        period: julyAt("2026-08-01T12:00:00.000Z", COMPUTED_AT),
      },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    expect(beforeTheClose.reconciliations[0]?.statusAsKnown).toBe("open");
    expect(beforeTheClose.reconciliations[0]?.frozenProof).toBeNull();
    expect(beforeTheClose.reconciliations[0]?.closedAt).toBeNull();

    const afterTheClose = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAt(KNOWN_AS_OF, COMPUTED_AT) },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    expect(afterTheClose.reconciliations[0]?.statusAsKnown).toBe("closed");
    expect(afterTheClose.reconciliations[0]?.frozenProof).not.toBeNull();
  });
});

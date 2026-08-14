import {
  openTrustFirmFundsNode,
  composeTrustFirmFundsDeposit,
} from "@magna-carta/trust/firm-funds";
import {
  selectTrustBookBalanceAsOfStatement,
  selectTrustClientLedgerTotalAsOfStatement,
  selectTrustFirmFundsTotalAsOfStatement,
} from "@magna-carta/trust/statements";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import { describe, expect, it } from "vitest";
import { assembleTrustCompliancePack } from "../src/trust-compliance/pack.ts";
import { resolveReportingPeriod } from "../src/temporal.ts";
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

// THE AGREEMENT TESTS — the load-bearing ones in this package.
//
// Every figure in the pack falls into one of three classes: owned by another package (read through
// that package's own function), a DECOMPOSITION of something owned elsewhere, or genuinely new here.
// The middle class is where a reporting surface quietly acquires a second answer, and these tests are
// what stops that: each decomposition is asserted equal to the aggregate its owner produces, over
// real rows written by the real composers.
//
// Every assertion below is taken at a knowledge instant past everything the fixture recorded, which
// is the only condition under which the bitemporal read and the settled effective-axis statement are
// answering the same question. The settled statements are not modified by this slice, so proving the
// equality at that instant is the honest form of the claim.

const COMPUTED_AT = "2026-12-31T23:59:59.999Z";
const KNOWN_NOW = "2026-12-31T23:59:59.999Z";

const julyAsKnownNow = () =>
  resolveReportingPeriod(
    { periodStart: "2026-07-01", periodEnd: "2026-07-31", knownAsOf: KNOWN_NOW },
    COMPUTED_AT,
  );

async function bookedFixture() {
  const fixture = await reportingFixture();
  const webb = await seedMatter(fixture, "Webb", "entity_webb", "2026-06-01T09:00:00.000Z");
  const ash = await seedMatter(fixture, "Ash", "entity_ash", "2026-06-01T09:00:00.000Z");
  // A second matter for the SAME client, so the per-client roll-up is exercised rather than assumed.
  const webbSecond = await seedMatter(
    fixture,
    "Webb Estate",
    "entity_webb",
    "2026-06-01T09:00:00.000Z",
  );

  // Money on the books before the period, so the opening balances are not all zero.
  const webbLeaf = await depositInto(fixture, {
    matterId: webb,
    label: "Webb",
    amountMinor: 800_00,
    effectiveDate: "2026-06-15",
    recordedAt: "2026-06-15T10:00:00.000Z",
  });
  await depositInto(fixture, {
    matterId: ash,
    label: "Ash",
    amountMinor: 300_00,
    effectiveDate: "2026-07-05",
    recordedAt: "2026-07-05T10:00:00.000Z",
  });
  await depositInto(fixture, {
    matterId: webbSecond,
    label: "Webb Estate",
    amountMinor: 150_00,
    effectiveDate: "2026-07-09",
    recordedAt: "2026-07-09T10:00:00.000Z",
  });
  await disburseFrom(fixture, {
    fromNodeId: webbLeaf.nodeId,
    amountMinor: 120_00,
    effectiveDate: "2026-07-20",
    recordedAt: "2026-07-20T10:00:00.000Z",
  });
  return { fixture, webb, ash, webbSecond, webbLeaf };
}

describe("every decomposition equals the aggregate its owner produces", () => {
  it("the per-matter closing balances sum to the client-ledger total the proof's client leg uses", async () => {
    const { fixture } = await bookedFixture();
    const pack = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAsKnownNow() },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    const decomposed = pack.clientLedgers
      .flatMap((client) => client.matters)
      .reduce((total, matter) => total + matter.closingBalanceMinor, 0);
    const aggregate = await selectTrustClientLedgerTotalAsOfStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-07-31",
    ).all<{ total_minor: number }>();
    expect(decomposed).toBe(aggregate.results[0]?.total_minor);
    expect(decomposed).toBe(1130_00);
  });

  it("each client roll-up equals the sum of its own matter ledgers", async () => {
    const { fixture } = await bookedFixture();
    const pack = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAsKnownNow() },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    for (const client of pack.clientLedgers) {
      expect(client.closingBalanceMinor).toBe(
        client.matters.reduce((total, matter) => total + matter.closingBalanceMinor, 0),
      );
      expect(client.openingBalanceMinor).toBe(
        client.matters.reduce((total, matter) => total + matter.openingBalanceMinor, 0),
      );
    }
    // One client holds two matters, so the roll-up is a real sum rather than a copy.
    const webbClient = pack.clientLedgers.find((client) => client.clientEntityId === "entity_webb");
    expect(webbClient?.matters.length).toBe(2);
  });

  // A running balance is arithmetic this package owns, so it is proved against the endpoints two
  // other packages own: it starts at the opening balance and lands exactly on the closing one.
  it("each matter ledger's running balance walks from its opening to its closing figure", async () => {
    const { fixture } = await bookedFixture();
    const pack = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAsKnownNow() },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    for (const matter of pack.clientLedgers.flatMap((client) => client.matters)) {
      const walked = matter.entries.reduce(
        (balance, entry) => balance + entry.deltaMinor,
        matter.openingBalanceMinor,
      );
      expect(walked).toBe(matter.closingBalanceMinor);
      const last = matter.entries.at(-1);
      if (last !== undefined) expect(last.runningBalanceMinor).toBe(matter.closingBalanceMinor);
    }
  });

  it("the journal's closing bank balance equals the book balance the proof's book leg uses", async () => {
    const { fixture } = await bookedFixture();
    const pack = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAsKnownNow() },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    const book = await selectTrustBookBalanceAsOfStatement(
      fixture.database,
      fixture.bankLedgerAccountId,
      "2026-07-31",
    ).all<{ balance_minor: number }>();
    expect(pack.journal.closingBalanceMinor).toBe(book.results[0]?.balance_minor);
    // And the journal walks there from its own opening figure, entry by entry.
    const walked = pack.journal.entries.reduce(
      (balance, entry) => balance + entry.bankDeltaMinor,
      pack.journal.openingBalanceMinor,
    );
    expect(walked).toBe(pack.journal.closingBalanceMinor);
  });

  it("the cushion equals the firm-funds total the proof's fourth leg uses, and is absent without the carve-out", async () => {
    const { fixture } = await bookedFixture();
    const withoutCarveOut = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAsKnownNow() },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    // ABSENT, not zero. A zero would say the firm keeps a cushion here and it happens to be empty.
    expect(withoutCarveOut.cushion).toBeNull();
    expect(withoutCarveOut.cover.bankChargeCarveOutOpen).toBe(false);

    const openedNode = await openTrustFirmFundsNode(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, nodeName: "Firm funds — Reno" },
      optionsAt("2026-07-01T09:00:00.000Z"),
    );
    await commit(fixture.database, openedNode.effect, "2026-07-01T09:00:00.000Z");
    const funded = await composeTrustFirmFundsDeposit(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        amount: usd(50_00),
        effectiveDate: "2026-07-02",
        description: "Cushion for bank charges",
        method: "check",
        reference: "77",
        recordedBy: AUTHORIZER,
      },
      optionsAt("2026-07-02T09:00:00.000Z"),
    );
    await commit(fixture.database, funded.effect, "2026-07-02T09:00:00.000Z");

    const pack = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAsKnownNow() },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    const firmFunds = await selectTrustFirmFundsTotalAsOfStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-07-31",
    ).all<{ total_minor: number }>();
    expect(pack.cushion?.closingBalanceMinor).toBe(firmFunds.results[0]?.total_minor);
    expect(pack.cushion?.closingBalanceMinor).toBe(50_00);
    expect(pack.cover.bankChargeCarveOutOpen).toBe(true);

    // The cushion is never folded into a client total: the client decomposition still equals the
    // client leg, which excludes the firm's own money entirely.
    const clientTotal = await selectTrustClientLedgerTotalAsOfStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-07-31",
    ).all<{ total_minor: number }>();
    const decomposed = pack.clientLedgers
      .flatMap((client) => client.matters)
      .reduce((total, matter) => total + matter.closingBalanceMinor, 0);
    expect(decomposed).toBe(clientTotal.results[0]?.total_minor);
    expect(decomposed).toBe(1130_00);
  });
});

describe("what the pack says when it cannot say something", () => {
  it("states the jurisdiction refusal on the cover rather than printing a citation nobody reviewed", async () => {
    const { fixture } = await bookedFixture();
    const pack = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAsKnownNow() },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    expect(pack.cover.jurisdiction.available).toBe(false);
    if (!pack.cover.jurisdiction.available) {
      expect(pack.cover.jurisdiction.jurisdiction).toBe("US-NV");
      expect(pack.cover.jurisdiction.refusalCode).toBe("jurisdiction-not-verified");
    }
  });

  it("refuses outright when the firm asked it to rather than produce a pack without a citation", async () => {
    const { fixture } = await bookedFixture();
    // The trust package's own refusal, propagated unchanged — never re-coded into a reporting
    // synonym of it. The four jurisdiction refusals are each fixed by a different person doing a
    // different thing, and the remedy a firm has to act on is stated by the package that refused.
    let refusal: unknown;
    try {
      await assembleTrustCompliancePack(
        fixture.database,
        {
          trustAccountId: fixture.trustAccountId,
          period: julyAsKnownNow(),
          options: { onJurisdictionUnavailable: "refuse" },
        },
        { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
      );
    } catch (caught) {
      refusal = caught;
    }
    expect(refusal).toBeInstanceOf(TrustValidationError);
    expect((refusal as TrustValidationError).code).toBe("jurisdiction-not-verified");
  });

  it("says in words that the period holds no reconciliation, rather than leaving a blank section", async () => {
    const { fixture } = await bookedFixture();
    const pack = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAsKnownNow() },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    expect(pack.reconciliations).toEqual([]);
    expect(pack.reconciliationNote).toContain("No reconciliation");
  });
});

describe("the choices a firm makes about what the document says", () => {
  it("lists a ledger that was at zero throughout by default, and omits it when asked to", async () => {
    const { fixture } = await reportingFixture().then(async (fixture) => {
      const quiet = await seedMatter(fixture, "Quiet", "entity_quiet", "2026-06-01T09:00:00.000Z");
      const opened = await depositInto(fixture, {
        matterId: quiet,
        label: "Quiet",
        amountMinor: 10_00,
        effectiveDate: "2026-05-01",
        recordedAt: "2026-05-01T10:00:00.000Z",
      });
      await disburseFrom(fixture, {
        fromNodeId: opened.nodeId,
        amountMinor: 10_00,
        effectiveDate: "2026-05-02",
        recordedAt: "2026-05-02T10:00:00.000Z",
        description: "Returned to client",
      });
      return { fixture };
    });

    const included = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAsKnownNow() },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    expect(included.clientLedgers.flatMap((client) => client.matters).length).toBe(1);
    expect(included.provenance.options.zeroBalanceLedgers).toBe("include");

    const omitted = await assembleTrustCompliancePack(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        period: julyAsKnownNow(),
        options: { zeroBalanceLedgers: "omit" },
      },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    expect(omitted.clientLedgers.flatMap((client) => client.matters)).toEqual([]);
    expect(omitted.provenance.options.zeroBalanceLedgers).toBe("omit");
  });

  it("names who authorized money leaving a client ledger by default, and suppresses it when asked to", async () => {
    const { fixture } = await bookedFixture();
    const named = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAsKnownNow() },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    const disbursement = named.journal.entries.find((entry) => entry.bankDeltaMinor < 0);
    expect(disbursement?.authorizedBy).toBe(AUTHORIZER);

    const anonymous = await assembleTrustCompliancePack(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        period: julyAsKnownNow(),
        options: { authorizers: "omit" },
      },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    for (const entry of anonymous.journal.entries) expect(entry.authorizedBy).toBeNull();
    expect(anonymous.provenance.options.authorizers).toBe("omit");
  });

  // The bar-audit pack is never screened. Its completeness declaration says so from the first
  // version, so a renderer can never present a partial pack as a whole one by omission.
  it("declares its scope complete", async () => {
    const { fixture } = await bookedFixture();
    const pack = await assembleTrustCompliancePack(
      fixture.database,
      { trustAccountId: fixture.trustAccountId, period: julyAsKnownNow() },
      { jurisdictions: unreviewedJurisdictions, computedAt: COMPUTED_AT },
    );
    expect(pack.cover.completeness).toEqual({ scope: "complete" });
  });
});

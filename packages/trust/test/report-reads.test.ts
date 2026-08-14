import type { UserId } from "@magna-carta/identifiers/types";
import type { ClockPort } from "@magna-carta/ledger/types";
import { money, USD } from "@magna-carta/money/money";
import { reverseEntry } from "@magna-carta/ledger/reverse-entry";
import { describe, expect, it } from "vitest";
import { composeTrustDeposit, composeTrustDisbursement } from "../src/movements.ts";
import {
  selectTrustBankJournalInPeriodStatement,
  selectTrustClientLedgerEntriesInPeriodStatement,
  selectTrustClientLedgerTotalAsKnownStatement,
  selectTrustClientLedgerTotalAsOfStatement,
  selectTrustHoldsInForceAsKnownStatement,
  selectTrustMatterLeafBalancesAsOfStatement,
  selectTrustReconciliationsInPeriodStatement,
} from "../src/statements.ts";
import { placeTrustHold, releaseTrustHold } from "../src/holds.ts";
import { commit, seedMatter, trustFixture } from "./support.ts";

// The two axes, exercised against real rows. Every read below has to answer the same question twice:
// what happened in the period (the effective axis), and what the platform knew when the question was
// asked (the knowledge axis). The suite drives the second axis by committing under different clocks,
// which is the only thing that moves `recorded_at` — it is system-set and immutable.

const usd = (minor: number) => money(minor, USD);
const RECORDER = "user_recorder" as UserId;
const AUTHORIZER = "user_authorizer" as UserId;

const clockAt = (instant: string): ClockPort => ({
  now: () => instant,
  // `today` only bounds future-dating, and every effective date this suite uses is in the past
  // relative to the instants it records at.
  today: () => instant.slice(0, 10),
});

const optionsAt = (instant: string) => ({ clock: clockAt(instant) });

const leafReference = (matterId: string, label: string) => ({
  matterId: matterId as never,
  clientNodeName: `Trust — ${label}`,
  matterLeafName: `Trust — ${label} — ${matterId}`,
});

const RECORDED_IN_PERIOD = "2026-07-31T23:00:00.000Z";
const RECORDED_AFTER_THE_CUT = "2026-08-10T10:00:00.000Z";
// The knowledge instant every "as known then" assertion below is taken at: after everything the firm
// recorded during the period, and before the corrections it recorded afterwards.
const KNOWN_AT_THE_CUT = "2026-08-01T00:00:00.000Z";
const KNOWN_NOW = "2026-12-31T23:59:59.999Z";

async function depositedFixture() {
  const fixture = await trustFixture({ jurisdiction: "US-NV" });
  const matterId = await seedMatter(fixture, "Webb", "entity_webb");
  // Recorded inside the period, effective inside the period: the ordinary case.
  const deposit = await composeTrustDeposit(
    fixture.database,
    {
      trustAccountId: fixture.trustAccountId,
      to: leafReference(matterId, "Webb"),
      amount: usd(500_00),
      effectiveDate: "2026-07-10",
      description: "Retainer received",
      method: "check",
      reference: "1041",
      source: "Webb Holdings",
      purpose: "Advance on fees and costs",
      recordedBy: RECORDER,
    },
    optionsAt(RECORDED_IN_PERIOD),
  );
  await commit(fixture.database, deposit.effect);
  return { fixture, matterId, depositEntryId: deposit.entryId, depositNodeId: deposit.nodeId };
}

describe("the client-ledger read is bounded on both axes", () => {
  it("includes an entry whose effective date is the period end", async () => {
    const { fixture, matterId } = await depositedFixture();
    const onTheLastDay = await composeTrustDeposit(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        to: leafReference(matterId, "Webb"),
        amount: usd(100_00),
        effectiveDate: "2026-07-31",
        description: "Further funds",
        method: "check",
        reference: "1042",
        source: "Webb Holdings",
        purpose: "Advance on fees and costs",
        recordedBy: RECORDER,
      },
      optionsAt(RECORDED_IN_PERIOD),
    );
    await commit(fixture.database, onTheLastDay.effect);
    const { results } = await selectTrustClientLedgerEntriesInPeriodStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-07-01",
      "2026-07-31",
      KNOWN_AT_THE_CUT,
    ).all<{ entry_id: string; effective_date: string; delta_minor: number }>();
    expect(results.map((row) => row.effective_date)).toEqual(["2026-07-10", "2026-07-31"]);
    expect(results.reduce((total, row) => total + row.delta_minor, 0)).toBe(600_00);
  });

  // The whole reason there are two axes. A correction recorded after somebody signed the report must
  // not move the report they signed.
  it("omits an entry backdated into the period but recorded after the knowledge instant", async () => {
    const { fixture, matterId } = await depositedFixture();
    const backdated = await composeTrustDeposit(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        to: leafReference(matterId, "Webb"),
        amount: usd(250_00),
        effectiveDate: "2026-07-20",
        description: "Funds the firm learned of later",
        method: "check",
        reference: "1043",
        source: "Webb Holdings",
        purpose: "Advance on fees and costs",
        recordedBy: RECORDER,
      },
      optionsAt(RECORDED_AFTER_THE_CUT),
    );
    await commit(fixture.database, backdated.effect);

    const asKnownThen = await selectTrustClientLedgerEntriesInPeriodStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-07-01",
      "2026-07-31",
      KNOWN_AT_THE_CUT,
    ).all<{ entry_id: string; delta_minor: number }>();
    expect(asKnownThen.results.map((row) => row.entry_id)).not.toContain(backdated.entryId);

    const asKnownNow = await selectTrustClientLedgerEntriesInPeriodStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-07-01",
      "2026-07-31",
      KNOWN_NOW,
    ).all<{ entry_id: string }>();
    expect(asKnownNow.results.map((row) => row.entry_id)).toContain(backdated.entryId);
  });

  // A reversal STANDS BESIDE what it reverses; it never removes it. So a knowledge instant before the
  // reversal shows the original alone, and one after shows both — never a ledger with the original
  // silently gone.
  it("hides a reversal recorded after the knowledge instant and keeps its target visible", async () => {
    const { fixture, depositEntryId } = await depositedFixture();
    const reversal = await reverseEntry(
      fixture.database,
      { entryId: depositEntryId, effectiveDate: "2026-07-25", description: "Deposit returned" },
      optionsAt(RECORDED_AFTER_THE_CUT),
    );
    await commit(fixture.database, reversal.effect);

    const asKnownThen = await selectTrustClientLedgerEntriesInPeriodStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-07-01",
      "2026-07-31",
      KNOWN_AT_THE_CUT,
    ).all<{ entry_id: string; delta_minor: number }>();
    expect(asKnownThen.results.map((row) => row.entry_id)).toEqual([depositEntryId]);
    expect(asKnownThen.results.reduce((total, row) => total + row.delta_minor, 0)).toBe(500_00);

    const asKnownNow = await selectTrustClientLedgerEntriesInPeriodStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-07-01",
      "2026-07-31",
      KNOWN_NOW,
    ).all<{ entry_id: string; delta_minor: number }>();
    expect(asKnownNow.results.map((row) => row.entry_id)).toEqual([
      depositEntryId,
      reversal.entryId,
    ]);
    expect(asKnownNow.results.reduce((total, row) => total + row.delta_minor, 0)).toBe(0);
  });
});

describe("the per-leaf balance read", () => {
  it("returns a leaf that saw no activity, at zero, rather than dropping it", async () => {
    const { fixture } = await depositedFixture();
    // A second matter with a leaf and no postings at all. Which leaves a pack PRINTS is the caller's
    // decision; the read must not take it away by omitting the quiet ones.
    const quietMatterId = await seedMatter(fixture, "Ash", "entity_ash");
    const opened = await composeTrustDeposit(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        to: leafReference(quietMatterId, "Ash"),
        amount: usd(10_00),
        effectiveDate: "2026-06-01",
        description: "Opening funds, later withdrawn",
        method: "check",
        reference: "900",
        source: "Ash",
        purpose: "Advance on costs",
        recordedBy: RECORDER,
      },
      optionsAt("2026-06-01T10:00:00.000Z"),
    );
    await commit(fixture.database, opened.effect);
    const withdrawn = await composeTrustDisbursement(
      fixture.database,
      {
        fromNodeId: opened.nodeId,
        amount: usd(10_00),
        effectiveDate: "2026-06-02",
        description: "Returned to client",
        method: "check",
        reference: "901",
        payee: "Ash",
        purpose: "Refund of unused advance",
        recordedBy: RECORDER,
        authorizedBy: AUTHORIZER,
      },
      optionsAt("2026-06-02T10:00:00.000Z"),
    );
    await commit(fixture.database, withdrawn.effect);

    const { results } = await selectTrustMatterLeafBalancesAsOfStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-07-31",
      KNOWN_AT_THE_CUT,
    ).all<{ matter_id: string; balance_minor: number }>();
    expect(results.length).toBe(2);
    expect(results.find((row) => row.matter_id === quietMatterId)?.balance_minor).toBe(0);
  });

  // THE AGREEMENT THAT MATTERS: the per-leaf decomposition adds up to the aggregate the three-way
  // proof's client leg reads. The knowledge bound is set past everything recorded, which is the only
  // condition under which the two are answering the same question — the settled statement filters on
  // the effective axis alone, by design, and this suite does not move it.
  it("sums to the client-ledger total the reconciliation's client leg uses", async () => {
    const { fixture } = await depositedFixture();
    const leaves = await selectTrustMatterLeafBalancesAsOfStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-07-31",
      KNOWN_NOW,
    ).all<{ balance_minor: number }>();
    const aggregate = await selectTrustClientLedgerTotalAsOfStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-07-31",
    ).all<{ total_minor: number }>();
    const decomposed = leaves.results.reduce((total, row) => total + row.balance_minor, 0);
    expect(decomposed).toBe(aggregate.results[0]?.total_minor);
    expect(decomposed).toBe(500_00);
  });

  it("and the bitemporal client total agrees with the settled one at an unbounding knowledge instant", async () => {
    const { fixture } = await depositedFixture();
    const asKnown = await selectTrustClientLedgerTotalAsKnownStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-07-31",
      KNOWN_NOW,
    ).all<{ total_minor: number }>();
    const settled = await selectTrustClientLedgerTotalAsOfStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-07-31",
    ).all<{ total_minor: number }>();
    expect(asKnown.results[0]?.total_minor).toBe(settled.results[0]?.total_minor);
  });
});

describe("the bank journal", () => {
  // Keyed on the ledger entry, so everything that moved the bank appears — including the operations
  // that write no `trust_movement` row at all.
  it("carries every entry touching the bank leaf in the period, with its net effect", async () => {
    const { fixture, depositNodeId } = await depositedFixture();
    const paid = await composeTrustDisbursement(
      fixture.database,
      {
        fromNodeId: depositNodeId,
        amount: usd(120_00),
        effectiveDate: "2026-07-20",
        description: "Filing fee",
        method: "check",
        reference: "2001",
        payee: "Clerk of the Court",
        purpose: "Court filing fee",
        recordedBy: RECORDER,
        authorizedBy: AUTHORIZER,
      },
      optionsAt(RECORDED_IN_PERIOD),
    );
    await commit(fixture.database, paid.effect);

    const { results } = await selectTrustBankJournalInPeriodStatement(
      fixture.database,
      fixture.bankLedgerAccountId,
      "2026-07-01",
      "2026-07-31",
      KNOWN_AT_THE_CUT,
    ).all<{ entry_id: string; bank_delta_minor: number; movement_kind: string | null }>();
    expect(results.map((row) => row.bank_delta_minor)).toEqual([500_00, -120_00]);
    expect(results.map((row) => row.movement_kind)).toEqual(["deposit", "disbursement"]);
  });

  it("omits an entry recorded after the knowledge instant", async () => {
    const { fixture, depositNodeId } = await depositedFixture();
    const late = await composeTrustDisbursement(
      fixture.database,
      {
        fromNodeId: depositNodeId,
        amount: usd(50_00),
        effectiveDate: "2026-07-28",
        description: "Recorded in August",
        method: "check",
        reference: "2002",
        payee: "Clerk of the Court",
        purpose: "Court filing fee",
        recordedBy: RECORDER,
        authorizedBy: AUTHORIZER,
      },
      optionsAt(RECORDED_AFTER_THE_CUT),
    );
    await commit(fixture.database, late.effect);
    const { results } = await selectTrustBankJournalInPeriodStatement(
      fixture.database,
      fixture.bankLedgerAccountId,
      "2026-07-01",
      "2026-07-31",
      KNOWN_AT_THE_CUT,
    ).all<{ entry_id: string }>();
    expect(results.map((row) => row.entry_id)).not.toContain(late.entryId);
  });
});

describe("holds in force", () => {
  // A hold has no effective date, so "in force" is a question about the knowledge axis alone — which
  // is what the read answers, and what a pack has to say on its face rather than implying a period
  // boundary the row does not carry.
  it("is answered on the knowledge axis, and a later release does not reach back", async () => {
    const { fixture, depositNodeId } = await depositedFixture();
    const hold = await placeTrustHold(
      fixture.database,
      {
        nodeId: depositNodeId,
        amount: usd(200_00),
        reason: "Disputed fee",
        placedBy: RECORDER,
      },
      optionsAt(RECORDED_IN_PERIOD),
    );
    await commit(fixture.database, hold.effect);
    const released = await releaseTrustHold(
      fixture.database,
      { holdId: hold.holdId, reason: "Dispute settled", releasedBy: RECORDER },
      optionsAt(RECORDED_AFTER_THE_CUT),
    );
    await commit(fixture.database, released.effect);

    const atTheCut = await selectTrustHoldsInForceAsKnownStatement(
      fixture.database,
      fixture.trustAccountId,
      KNOWN_AT_THE_CUT,
    ).all<{ hold_id: string; amount_minor: number }>();
    expect(atTheCut.results.map((row) => row.hold_id)).toEqual([hold.holdId]);

    const now = await selectTrustHoldsInForceAsKnownStatement(
      fixture.database,
      fixture.trustAccountId,
      KNOWN_NOW,
    ).all<{ hold_id: string }>();
    expect(now.results).toEqual([]);
  });
});

describe("the reconciliations in a period", () => {
  it("returns nothing for an account that was never reconciled", async () => {
    const { fixture } = await depositedFixture();
    const { results } = await selectTrustReconciliationsInPeriodStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-07-01",
      "2026-07-31",
      KNOWN_NOW,
    ).all<{ id: string }>();
    expect(results).toEqual([]);
  });
});

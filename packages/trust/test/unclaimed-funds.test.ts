import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { TrustUnclaimedFundsReviewId } from "@magna-carta/identifiers/types";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { assertTrustFitness } from "../src/fitness.ts";
import { composeTrustDeposit, composeTrustDisbursement } from "../src/movements.ts";
import {
  composeTrustUnclaimedFundsContactAttempt,
  composeTrustUnclaimedFundsReview,
  composeTrustUnclaimedFundsReviewClosure,
  readDormantTrustBalances,
  readTrustUnclaimedFundsReview,
} from "../src/unclaimed-funds.ts";
import {
  commit,
  expectRefusal,
  options,
  seedMatterLeaf,
  trustFixture,
  type SeededMatterLeaf,
} from "./support.ts";

// UNCLAIMED CLIENT FUNDS. The whole slice is a read and an evidence trail: dormancy is computed at
// read time and never stored, and nothing in this file can move a cent. Several tests below exist
// only to state that second property in a name, because it is the kind of property a later change
// removes by accident.

const ACCOUNT = { jurisdiction: "US-NV" } as const;

type Fixture = Awaited<ReturnType<typeof trustFixture>>;

async function depositOnto(
  fixture: Fixture,
  leaf: SeededMatterLeaf,
  amountMinor: number,
  effectiveDate: string,
): Promise<void> {
  const deposit = await composeTrustDeposit(
    fixture.database,
    {
      trustAccountId: fixture.trustAccountId,
      to: {
        matterId: leaf.matterId,
        clientNodeName: `Trust — ${leaf.clientEntityId}`,
        matterLeafName: `Trust — ${leaf.matterId}`,
      },
      amount: money(amountMinor, USD),
      effectiveDate,
      description: "Retainer received",
      method: "wire",
      source: "Client",
      purpose: "Advance on fees",
      recordedBy: fixture.memberUserId,
    },
    options,
  );
  await commit(fixture.database, deposit.effect);
}

async function openReviewOver(
  fixture: Fixture,
  leaf: SeededMatterLeaf,
  observedBalanceMinor: number,
): Promise<TrustUnclaimedFundsReviewId> {
  const review = await composeTrustUnclaimedFundsReview(
    fixture.database,
    {
      nodeId: leaf.nodeId,
      observedBalanceMinor,
      observedEarliestReceiptDate: "2019-04-02",
      observedLastActivityDate: "2019-04-02",
      openedBy: fixture.memberUserId,
    },
    options,
  );
  await commit(fixture.database, review.effect);
  return review.reviewId;
}

describe("the dormancy read", () => {
  it("is a comparison over the ledger, and stores nothing", async () => {
    const fixture = await trustFixture(ACCOUNT);
    const quiet = await seedMatterLeaf(fixture, "entity_quiet", "Quiet");
    const active = await seedMatterLeaf(fixture, "entity_active", "Active");
    await depositOnto(fixture, quiet, 40_000, "2019-04-02");
    await depositOnto(fixture, active, 40_000, "2026-07-01");

    const dormant = await readDormantTrustBalances(fixture.database, {
      trustAccountId: fixture.trustAccountId,
      quietOnOrBefore: "2021-08-05",
    });
    expect(dormant.balances.map((row) => row.nodeId)).toEqual([quiet.nodeId]);
    expect(dormant.balances[0]?.balanceMinor).toBe(40_000);

    // Nothing was written. The same read against a wider window returns a different answer with no
    // state having changed, which is what "dormancy is not a stored flag" means concretely.
    const wider = await readDormantTrustBalances(fixture.database, {
      trustAccountId: fixture.trustAccountId,
      quietOnOrBefore: "2026-08-05",
    });
    expect(wider.balances.map((row) => row.nodeId).sort()).toEqual(
      [quiet.nodeId, active.nodeId].sort(),
    );
  });

  it("reports the EARLIEST receipt separately from the last activity — the clocks differ", async () => {
    const fixture = await trustFixture(ACCOUNT);
    const leaf = await seedMatterLeaf(fixture, "entity_ford", "Ford");
    await depositOnto(fixture, leaf, 30_000, "2019-04-02");
    await depositOnto(fixture, leaf, 10_000, "2021-06-15");

    const dormant = await readDormantTrustBalances(fixture.database, {
      trustAccountId: fixture.trustAccountId,
      quietOnOrBefore: "2026-08-05",
    });
    const row = dormant.balances[0];
    // The rules' clock runs from receipt of the property, and the money received in 2019 is still
    // sitting here. A view that reported only the last activity would answer a different question.
    expect(row?.earliestReceiptDate).toBe("2019-04-02");
    expect(row?.lastActivityDate).toBe("2021-06-15");
  });

  it("omits a ledger that holds nothing, however long ago it went quiet", async () => {
    const fixture = await trustFixture(ACCOUNT);
    const leaf = await seedMatterLeaf(fixture, "entity_gray", "Gray");
    await depositOnto(fixture, leaf, 20_000, "2019-04-02");
    const paid = await composeTrustDisbursement(
      fixture.database,
      {
        fromNodeId: leaf.nodeId,
        amount: money(20_000, USD),
        effectiveDate: "2019-05-02",
        description: "Refund to client",
        method: "check",
        payee: "Gray",
        purpose: "Return of unearned advance",
        recordedBy: fixture.memberUserId,
        authorizedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, paid.effect);

    const dormant = await readDormantTrustBalances(fixture.database, {
      trustAccountId: fixture.trustAccountId,
      quietOnOrBefore: "2026-08-05",
    });
    expect(dormant.balances).toEqual([]);
  });

  it("refuses a window that is not a calendar date rather than guessing one", async () => {
    const fixture = await trustFixture(ACCOUNT);
    await expect(
      readDormantTrustBalances(fixture.database, {
        trustAccountId: fixture.trustAccountId,
        quietOnOrBefore: "2026-02-30",
      }),
    ).rejects.toMatchObject({ code: "trust-unclaimed-funds-window-invalid" });
  });

  it("shows which ledgers already have an open review, derived from the absence of a closure", async () => {
    const fixture = await trustFixture(ACCOUNT);
    const leaf = await seedMatterLeaf(fixture, "entity_hale", "Hale");
    await depositOnto(fixture, leaf, 40_000, "2019-04-02");
    const before = await readDormantTrustBalances(fixture.database, {
      trustAccountId: fixture.trustAccountId,
      quietOnOrBefore: "2026-08-05",
    });
    expect(before.balances[0]?.openReviewId).toBeNull();

    const reviewId = await openReviewOver(fixture, leaf, 40_000);
    const during = await readDormantTrustBalances(fixture.database, {
      trustAccountId: fixture.trustAccountId,
      quietOnOrBefore: "2026-08-05",
    });
    expect(during.balances[0]?.openReviewId).toBe(reviewId);

    const closure = await composeTrustUnclaimedFundsReviewClosure(
      fixture.database,
      { reviewId, outcome: "search_continues", closedBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, closure.effect);
    const after = await readDormantTrustBalances(fixture.database, {
      trustAccountId: fixture.trustAccountId,
      quietOnOrBefore: "2026-08-05",
    });
    expect(after.balances[0]?.openReviewId).toBeNull();
  });
});

describe("the diligence file", () => {
  it("records every locate attempt with the contact actually used", async () => {
    const fixture = await trustFixture(ACCOUNT);
    const leaf = await seedMatterLeaf(fixture, "entity_ives", "Ives");
    await depositOnto(fixture, leaf, 40_000, "2019-04-02");
    const reviewId = await openReviewOver(fixture, leaf, 40_000);

    for (const attempt of [
      { channel: "regular_mail", contactUsed: "14 Elm Street, Reno NV", outcome: "no_response" },
      {
        channel: "certified_mail",
        contactUsed: "14 Elm Street, Reno NV",
        outcome: "undeliverable",
      },
      { channel: "telephone", contactUsed: "+1 775 555 0143", outcome: "wrong_contact" },
      { channel: "email", contactUsed: "ives@example.test", outcome: "no_response" },
      { channel: "record_review", outcome: "other" },
    ] as const) {
      const recorded = await composeTrustUnclaimedFundsContactAttempt(
        fixture.database,
        {
          reviewId,
          channel: attempt.channel,
          attemptedOn: "2026-03-04",
          contactUsed: "contactUsed" in attempt ? attempt.contactUsed : null,
          outcome: attempt.outcome,
          recordedBy: fixture.memberUserId,
        },
        options,
      );
      await commit(fixture.database, recorded.effect);
    }

    const review = await readTrustUnclaimedFundsReview(fixture.database, reviewId);
    expect(review.attempts).toHaveLength(5);
    expect(review.attempts.map((attempt) => attempt.channel)).toContain("certified_mail");
    // A record review has no contact detail; every other channel used one, and the schema refuses
    // the other combination.
    expect(
      review.attempts.find((attempt) => attempt.channel === "record_review")?.contactUsed,
    ).toBeNull();
    await assertTrustFitness(fixture.database);
  });

  it("refuses a second open review over one client ledger", async () => {
    const fixture = await trustFixture(ACCOUNT);
    const leaf = await seedMatterLeaf(fixture, "entity_kerr", "Kerr");
    await depositOnto(fixture, leaf, 40_000, "2019-04-02");
    await openReviewOver(fixture, leaf, 40_000);
    await expect(
      composeTrustUnclaimedFundsReview(
        fixture.database,
        {
          nodeId: leaf.nodeId,
          observedBalanceMinor: 40_000,
          observedEarliestReceiptDate: "2019-04-02",
          observedLastActivityDate: "2019-04-02",
          openedBy: fixture.memberUserId,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-unclaimed-funds-review-already-open" });
  });

  it("refuses a review over a ledger that holds nothing", async () => {
    const fixture = await trustFixture(ACCOUNT);
    const leaf = await seedMatterLeaf(fixture, "entity_lowe", "Lowe");
    await expect(
      composeTrustUnclaimedFundsReview(
        fixture.database,
        {
          nodeId: leaf.nodeId,
          observedBalanceMinor: 0,
          observedEarliestReceiptDate: null,
          observedLastActivityDate: null,
          openedBy: fixture.memberUserId,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-unclaimed-funds-node-holds-no-balance" });
  });

  it("adds nothing to a closed file — a further attempt belongs to a new review", async () => {
    const fixture = await trustFixture(ACCOUNT);
    const leaf = await seedMatterLeaf(fixture, "entity_mott", "Mott");
    await depositOnto(fixture, leaf, 40_000, "2019-04-02");
    const reviewId = await openReviewOver(fixture, leaf, 40_000);
    const closure = await composeTrustUnclaimedFundsReviewClosure(
      fixture.database,
      { reviewId, outcome: "search_continues", closedBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, closure.effect);
    await expect(
      composeTrustUnclaimedFundsContactAttempt(
        fixture.database,
        {
          reviewId,
          channel: "telephone",
          attemptedOn: "2026-04-04",
          contactUsed: "+1 775 555 0143",
          outcome: "no_response",
          recordedBy: fixture.memberUserId,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-unclaimed-funds-review-already-closed" });
  });

  it("is append-only — a recorded attempt cannot be edited away", async () => {
    const fixture = await trustFixture(ACCOUNT);
    const leaf = await seedMatterLeaf(fixture, "entity_nunez", "Nunez");
    await depositOnto(fixture, leaf, 40_000, "2019-04-02");
    const reviewId = await openReviewOver(fixture, leaf, 40_000);
    const attempt = await composeTrustUnclaimedFundsContactAttempt(
      fixture.database,
      {
        reviewId,
        channel: "email",
        attemptedOn: "2026-03-04",
        contactUsed: "nunez@example.test",
        outcome: "no_response",
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, attempt.effect);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "UPDATE trust_unclaimed_funds_contact_attempt SET outcome = 'reached' WHERE id = ?1",
          )
          .bind(attempt.attemptId)
          .run(),
      ),
    ).rejects.toThrowError(/append-only/);
  });
});

describe("the manual-confirmation gate", () => {
  it("CLOSING A REVIEW CANNOT MOVE MONEY — the closure takes a movement that already posted", async () => {
    const fixture = await trustFixture(ACCOUNT);
    const leaf = await seedMatterLeaf(fixture, "entity_ortiz", "Ortiz");
    await depositOnto(fixture, leaf, 40_000, "2019-04-02");
    const reviewId = await openReviewOver(fixture, leaf, 40_000);

    // Closing as distributed without a movement is refused: there is deliberately no route from here
    // to a ledger entry, so the only way to reach this outcome is to have paid the owner first,
    // through the ordinary authorized disbursement path.
    await expect(
      composeTrustUnclaimedFundsReviewClosure(
        fixture.database,
        { reviewId, outcome: "distributed_to_owner", closedBy: fixture.memberUserId },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-unclaimed-funds-movement-is-not-this-ledger" });

    const paid = await composeTrustDisbursement(
      fixture.database,
      {
        fromNodeId: leaf.nodeId,
        amount: money(40_000, USD),
        effectiveDate: "2026-08-04",
        description: "Refund to located client",
        method: "check",
        payee: "Ortiz",
        purpose: "Return of unearned advance",
        recordedBy: fixture.memberUserId,
        authorizedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, paid.effect);

    const closure = await composeTrustUnclaimedFundsReviewClosure(
      fixture.database,
      {
        reviewId,
        outcome: "distributed_to_owner",
        movementId: paid.movementId,
        closedBy: fixture.memberUserId,
      },
      options,
    );
    // The closure writes exactly one row and posts nothing: no ledger entry, no movement, no outbox.
    expect(closure.effect.statements).toHaveLength(1);
    expect(closure.effect.outboxMessages).toEqual([]);
    await commit(fixture.database, closure.effect);

    const review = await readTrustUnclaimedFundsReview(fixture.database, reviewId);
    expect(review.closure?.outcome).toBe("distributed_to_owner");
    expect(review.closure?.movementId).toBe(paid.movementId);
    await assertTrustFitness(fixture.database);
  });

  it("refuses a closure naming another client's payment", async () => {
    const fixture = await trustFixture(ACCOUNT);
    const subject = await seedMatterLeaf(fixture, "entity_pace", "Pace");
    const other = await seedMatterLeaf(fixture, "entity_quill", "Quill");
    await depositOnto(fixture, subject, 40_000, "2019-04-02");
    await depositOnto(fixture, other, 40_000, "2019-04-02");
    const reviewId = await openReviewOver(fixture, subject, 40_000);

    const otherPayment = await composeTrustDisbursement(
      fixture.database,
      {
        fromNodeId: other.nodeId,
        amount: money(40_000, USD),
        effectiveDate: "2026-08-04",
        description: "Refund",
        method: "check",
        payee: "Quill",
        purpose: "Return of unearned advance",
        recordedBy: fixture.memberUserId,
        authorizedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, otherPayment.effect);

    await expect(
      composeTrustUnclaimedFundsReviewClosure(
        fixture.database,
        {
          reviewId,
          outcome: "distributed_to_owner",
          movementId: otherPayment.movementId,
          closedBy: fixture.memberUserId,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-unclaimed-funds-movement-is-not-this-ledger" });
  });

  it("the database refuses the same thing, so a route around the composer gains nothing", async () => {
    const fixture = await trustFixture(ACCOUNT);
    const subject = await seedMatterLeaf(fixture, "entity_reid", "Reid");
    const other = await seedMatterLeaf(fixture, "entity_shaw", "Shaw");
    await depositOnto(fixture, subject, 40_000, "2019-04-02");
    await depositOnto(fixture, other, 40_000, "2019-04-02");
    const reviewId = await openReviewOver(fixture, subject, 40_000);
    const otherPayment = await composeTrustDisbursement(
      fixture.database,
      {
        fromNodeId: other.nodeId,
        amount: money(40_000, USD),
        effectiveDate: "2026-08-04",
        description: "Refund",
        method: "check",
        payee: "Shaw",
        purpose: "Return of unearned advance",
        recordedBy: fixture.memberUserId,
        authorizedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, otherPayment.effect);

    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "INSERT INTO trust_unclaimed_funds_review_closure (id, review_id, outcome, movement_id, closed_by, closed_at, note) VALUES (?1, ?2, 'distributed_to_owner', ?3, ?4, '2026-08-05T00:00:00.000Z', NULL)",
          )
          .bind(
            newIdentifier("trustUnclaimedFundsReviewClosure"),
            reviewId,
            otherPayment.movementId,
            fixture.memberUserId,
          )
          .run(),
      ),
    ).rejects.toThrowError(/client ledger under review/);
  });

  it("closes only once — a second closure loses at commit", async () => {
    const fixture = await trustFixture(ACCOUNT);
    const leaf = await seedMatterLeaf(fixture, "entity_tate", "Tate");
    await depositOnto(fixture, leaf, 40_000, "2019-04-02");
    const reviewId = await openReviewOver(fixture, leaf, 40_000);
    const first = await composeTrustUnclaimedFundsReviewClosure(
      fixture.database,
      { reviewId, outcome: "search_continues", closedBy: fixture.memberUserId },
      options,
    );
    const second = await composeTrustUnclaimedFundsReviewClosure(
      fixture.database,
      { reviewId, outcome: "not_dormant", closedBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, first.effect);
    await expect(
      expectRefusal(() => commit(fixture.database, second.effect)),
    ).rejects.toThrowError();
  });
});

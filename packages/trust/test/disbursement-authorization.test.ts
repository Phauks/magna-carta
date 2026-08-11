import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { TrustDisbursementRequestId, UserId } from "@magna-carta/identifiers/types";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { loadMatterTrustLeaf } from "../src/account-tree.ts";
import {
  composeTrustDisbursementApproval,
  composeTrustDisbursementRejection,
  composeTrustDisbursementRequest,
  composeTrustDisbursementWithdrawal,
  loadTrustDisbursementRequest,
  readPendingTrustDisbursementRequests,
} from "../src/disbursement-authorization.ts";
import { assertTrustFitness } from "../src/fitness.ts";
import { placeTrustHold, readTrustAvailableBalance } from "../src/holds.ts";
import { composeTrustDeposit } from "../src/movements.ts";
import { insertTrustDisbursementDecisionStatement } from "../src/statements.ts";
import { TrustValidationError } from "../src/trust-validation.ts";
import {
  clock,
  commit,
  expectRefusal,
  options,
  seedMatter,
  seedTrustManager,
  setTrustAuthorizationPolicy,
  trustFixture,
} from "./support.ts";

// Two-person authorization for money leaving a client ledger. What is proved here is the whole of
// it: that a pending request moves nothing, that the movement is composed at APPROVAL time against
// the ledger as it stands then, that the approver-differs rule holds at the database even when the
// application layer is bypassed entirely, and that the single-trust-manager exception is recorded on
// its face rather than passing as an ordinary approval.

const usd = (minor: number) => money(minor, USD);

const fixtureWithJurisdiction = () => trustFixture({ jurisdiction: "US-NV" });

async function fundedFixture(amountMinor: number) {
  const fixture = await fixtureWithJurisdiction();
  // This suite is about the TWO-PERSON shape, which is a posture a firm writes rather than the one
  // every database is seeded with, so it is stated here once. Authority off, because who may
  // authorize is the subject of authorization-policy.test.ts and would otherwise be a second
  // variable in every case below.
  await setTrustAuthorizationPolicy(fixture, { policy: "always" });
  const matterId = await seedMatter(fixture, "Webb", "entity_webb");
  const deposit = await composeTrustDeposit(
    fixture.database,
    {
      trustAccountId: fixture.trustAccountId,
      to: {
        matterId,
        clientNodeName: "Trust — Webb",
        matterLeafName: `Trust — Webb — ${matterId}`,
      },
      amount: usd(amountMinor),
      effectiveDate: "2026-08-05",
      description: "Retainer received",
      method: "check",
      reference: "1041",
      source: "Webb Holdings",
      purpose: "Advance on fees and costs",
      recordedBy: newIdentifier("user"),
    },
    options,
  );
  await commit(fixture.database, deposit.effect);
  const node = await loadMatterTrustLeaf(fixture.database, fixture.trustAccountId, matterId);
  return { fixture, matterId, node };
}

interface RequestedDisbursement {
  fixture: Awaited<ReturnType<typeof fundedFixture>>["fixture"];
  node: Awaited<ReturnType<typeof fundedFixture>>["node"];
  requestId: TrustDisbursementRequestId;
  submitter: UserId;
}

async function requestedDisbursement(
  fundedMinor: number,
  requestedMinor: number,
  submitter: UserId,
): Promise<RequestedDisbursement> {
  const { fixture, node } = await fundedFixture(fundedMinor);
  const composed = await composeTrustDisbursementRequest(
    fixture.database,
    {
      fromNodeId: node.id,
      amount: usd(requestedMinor),
      effectiveDate: "2026-08-05",
      description: "Filing fee paid on the client's behalf",
      method: "check",
      reference: "2207",
      payee: "Second Judicial District Court",
      purpose: "Complaint filing fee",
      requestedBy: submitter,
    },
    options,
  );
  await commit(fixture.database, composed.effect);
  return { fixture, node, requestId: composed.requestId, submitter };
}

const countRows = async (
  database: Awaited<ReturnType<typeof fundedFixture>>["fixture"]["database"],
  table: string,
): Promise<number> => {
  const { results } = await database
    .prepare(`SELECT COUNT(*) AS total FROM ${table}`)
    .all<{ total: number }>();
  return results[0]?.total ?? 0;
};

describe("a pending request is not a movement", () => {
  it("touches no ledger entry, no balance, and no movement record", async () => {
    const submitter = "user_submitter" as UserId;
    const { fixture, node } = await requestedDisbursement(500000, 120000, submitter);

    const balance = await readTrustAvailableBalance(fixture.database, node.id);
    expect(balance.balanceMinor).toBe(500000);
    expect(balance.availableMinor).toBe(500000);
    // One movement exists — the deposit that funded the ledger. The request added none.
    expect(await countRows(fixture.database, "trust_movement")).toBe(1);
    expect(await countRows(fixture.database, "trust_disbursement_decision")).toBe(0);
    await expect(assertTrustFitness(fixture.database)).resolves.toBeUndefined();
  });

  it("records the particulars the approver is being asked to approve", async () => {
    const submitter = "user_submitter" as UserId;
    const { fixture, requestId } = await requestedDisbursement(500000, 120000, submitter);
    const request = await loadTrustDisbursementRequest(fixture.database, requestId);
    expect(request).toMatchObject({
      amountMinor: 120000,
      currency: "USD",
      method: "check",
      reference: "2207",
      payee: "Second Judicial District Court",
      purpose: "Complaint filing fee",
      description: "Filing fee paid on the client's behalf",
      effectiveDate: "2026-08-05",
      requestedBy: submitter,
      requestedAt: clock.now(),
      decision: null,
    });
  });

  it("refuses a proposal the client ledger could not fund even now", async () => {
    const { fixture, node } = await fundedFixture(100000);
    await expect(
      composeTrustDisbursementRequest(
        fixture.database,
        {
          fromNodeId: node.id,
          amount: usd(500000),
          effectiveDate: "2026-08-05",
          description: "Payment to the client",
          method: "wire",
          payee: "A Webb",
          purpose: "Balance returned",
          requestedBy: "user_submitter" as UserId,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "movement-exceeds-available" });
  });

  it("lists what is awaiting a decision, and drops it once decided", async () => {
    const submitter = "user_submitter" as UserId;
    const { fixture, requestId } = await requestedDisbursement(500000, 120000, submitter);
    const approver = await seedTrustManager(fixture, "Approving Attorney");

    const pending = await readPendingTrustDisbursementRequests(
      fixture.database,
      fixture.trustAccountId,
    );
    expect(pending.map((request) => request.id)).toEqual([requestId]);

    const approved = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId, approvedBy: approver },
      options,
    );
    await commit(fixture.database, approved.effect);
    const afterApproval = await readPendingTrustDisbursementRequests(
      fixture.database,
      fixture.trustAccountId,
    );
    expect(afterApproval).toEqual([]);
  });
});

describe("approval posts the movement", () => {
  it("records the submitter as the recorder and the approver as the authorizer", async () => {
    const submitter = "user_submitter" as UserId;
    const { fixture, node, requestId } = await requestedDisbursement(500000, 120000, submitter);
    const approver = await seedTrustManager(fixture, "Approving Attorney");

    const approved = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId, approvedBy: approver },
      options,
    );
    await commit(fixture.database, approved.effect);
    expect(approved.authorizationBasis).toBe("second_person");

    const { results } = await fixture.database
      .prepare(
        "SELECT kind, amount_minor, method, reference, counterparty_name, purpose, recorded_by, authorized_by FROM trust_movement WHERE id = ?1",
      )
      .bind(approved.movement.movementId)
      .all();
    expect(results[0]).toMatchObject({
      kind: "disbursement",
      amount_minor: 120000,
      method: "check",
      reference: "2207",
      counterparty_name: "Second Judicial District Court",
      purpose: "Complaint filing fee",
      recorded_by: submitter,
      authorized_by: approver,
    });

    const balance = await readTrustAvailableBalance(fixture.database, node.id);
    expect(balance.balanceMinor).toBe(380000);
    await expect(assertTrustFitness(fixture.database)).resolves.toBeUndefined();
  });

  it("ties the decision to the movement it posted", async () => {
    const submitter = "user_submitter" as UserId;
    const { fixture, requestId } = await requestedDisbursement(500000, 120000, submitter);
    const approver = await seedTrustManager(fixture, "Approving Attorney");
    const approved = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId, approvedBy: approver },
      options,
    );
    await commit(fixture.database, approved.effect);

    const settled = await loadTrustDisbursementRequest(fixture.database, requestId);
    expect(settled.decision).toMatchObject({
      decision: "approved",
      decidedBy: approver,
      decidedAt: clock.now(),
      reason: null,
      authorizationBasis: "second_person",
      movementId: approved.movement.movementId,
    });
  });

  it("refuses to re-decide a request that is already settled", async () => {
    const submitter = "user_submitter" as UserId;
    const { fixture, requestId } = await requestedDisbursement(500000, 120000, submitter);
    const approver = await seedTrustManager(fixture, "Approving Attorney");
    const second = await seedTrustManager(fixture, "Another Attorney");
    const approved = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId, approvedBy: approver },
      options,
    );
    await commit(fixture.database, approved.effect);

    await expect(
      composeTrustDisbursementApproval(
        fixture.database,
        { requestId, approvedBy: second },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-disbursement-request-already-decided" });
  });
});

describe("the approver must differ from the submitter", () => {
  it("refuses the submitter's own approval by name when the firm has other authorizers", async () => {
    const { fixture, node } = await fundedFixture(500000);
    const submitter = await seedTrustManager(fixture, "Submitting Attorney");
    await seedTrustManager(fixture, "Approving Attorney");
    const composed = await composeTrustDisbursementRequest(
      fixture.database,
      {
        fromNodeId: node.id,
        amount: usd(120000),
        effectiveDate: "2026-08-05",
        description: "Filing fee paid on the client's behalf",
        method: "check",
        payee: "Second Judicial District Court",
        purpose: "Complaint filing fee",
        requestedBy: submitter,
      },
      options,
    );
    await commit(fixture.database, composed.effect);

    await expect(
      composeTrustDisbursementApproval(
        fixture.database,
        { requestId: composed.requestId, approvedBy: submitter },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-disbursement-decider-is-requester" });
    expect(await countRows(fixture.database, "trust_disbursement_decision")).toBe(0);
  });

  // The application refusal above is a nicer message in front of the real mechanism. THIS is the
  // mechanism: a decision written straight to the table, with the composer bypassed entirely. A
  // rejection is used because it carries no movement, so nothing but the approver-differs trigger
  // can be what refuses it.
  it("refuses a self-decision at the DATABASE even with the composer bypassed", async () => {
    const submitter = "user_submitter" as UserId;
    const { fixture, requestId } = await requestedDisbursement(500000, 120000, submitter);
    await expect(
      expectRefusal(() =>
        insertTrustDisbursementDecisionStatement(fixture.database, {
          id: newIdentifier("trustDisbursementDecision"),
          requestId,
          decision: "rejected",
          decidedBy: submitter,
          decidedAt: clock.now(),
          reason: "Refusing my own request",
          authorizationBasis: null,
          movementId: null,
          transferId: null,
        }).run(),
      ),
    ).rejects.toThrow(/only another member may reject a trust disbursement request/);
    expect(await countRows(fixture.database, "trust_disbursement_decision")).toBe(0);
  });

  it("refuses a withdrawal by anyone but the submitter at the DATABASE", async () => {
    const submitter = "user_submitter" as UserId;
    const { fixture, requestId } = await requestedDisbursement(500000, 120000, submitter);
    await expect(
      expectRefusal(() =>
        insertTrustDisbursementDecisionStatement(fixture.database, {
          id: newIdentifier("trustDisbursementDecision"),
          requestId,
          decision: "withdrawn",
          decidedBy: "user_someone_else" as UserId,
          decidedAt: clock.now(),
          reason: null,
          authorizationBasis: null,
          movementId: null,
          transferId: null,
        }).run(),
      ),
    ).rejects.toThrow(/may withdraw it/);
  });

  it("refuses a self-REJECTION too — taking back your own request is a withdrawal", async () => {
    const submitter = "user_submitter" as UserId;
    const { fixture, requestId } = await requestedDisbursement(500000, 120000, submitter);
    await expect(
      composeTrustDisbursementRejection(
        fixture.database,
        { requestId, rejectedBy: submitter, reason: "Changed my mind" },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-disbursement-decider-is-requester" });
  });
});

describe("a firm with a single trust manager", () => {
  it("records the submitter's own approval AS SUCH rather than as an ordinary one", async () => {
    const { fixture, node } = await fundedFixture(500000);
    // The fixture member IS the firm's one trust:manage holder — the exception belongs to the
    // counted member, so only that member may act alone.
    const soleManager = fixture.memberUserId;
    const composed = await composeTrustDisbursementRequest(
      fixture.database,
      {
        fromNodeId: node.id,
        amount: usd(120000),
        effectiveDate: "2026-08-05",
        description: "Filing fee paid on the client's behalf",
        method: "check",
        payee: "Second Judicial District Court",
        purpose: "Complaint filing fee",
        requestedBy: soleManager,
      },
      options,
    );
    await commit(fixture.database, composed.effect);

    const approved = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId: composed.requestId, approvedBy: soleManager },
      options,
    );
    await commit(fixture.database, approved.effect);

    expect(approved.authorizationBasis).toBe("sole_trust_manager");
    const settled = await loadTrustDisbursementRequest(fixture.database, composed.requestId);
    expect(settled.decision).toMatchObject({
      decision: "approved",
      decidedBy: soleManager,
      authorizationBasis: "sole_trust_manager",
    });
    const { results } = await fixture.database
      .prepare("SELECT recorded_by, authorized_by FROM trust_movement WHERE id = ?1")
      .bind(approved.movement.movementId)
      .all();
    expect(results[0]).toMatchObject({ recorded_by: soleManager, authorized_by: soleManager });
    await expect(assertTrustFitness(fixture.database)).resolves.toBeUndefined();
  });

  // The exception is not a setting and cannot be opted into. A second trust manager appearing
  // between the composer's count and the commit is the sharpest form of that: the approval was
  // legitimately composed on the sole-manager basis and the database still refuses it, taking the
  // whole posting with it.
  it("loses the exception at the DATABASE the moment a second trust manager exists", async () => {
    const { fixture, node } = await fundedFixture(500000);
    const submitter = fixture.memberUserId;
    const composed = await composeTrustDisbursementRequest(
      fixture.database,
      {
        fromNodeId: node.id,
        amount: usd(120000),
        effectiveDate: "2026-08-05",
        description: "Filing fee paid on the client's behalf",
        method: "check",
        payee: "Second Judicial District Court",
        purpose: "Complaint filing fee",
        requestedBy: submitter,
      },
      options,
    );
    await commit(fixture.database, composed.effect);

    const approved = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId: composed.requestId, approvedBy: submitter },
      options,
    );
    expect(approved.authorizationBasis).toBe("sole_trust_manager");

    await seedTrustManager(fixture, "A Second Attorney");
    await expect(expectRefusal(() => commit(fixture.database, approved.effect))).rejects.toThrow(
      /sole-authorizer exception/,
    );

    expect(await countRows(fixture.database, "trust_disbursement_decision")).toBe(0);
    const balance = await readTrustAvailableBalance(fixture.database, node.id);
    expect(balance.balanceMinor).toBe(500000);
  });
});

describe("the ceiling is re-read at approval time", () => {
  it("refuses a stale request naming the shortfall, and posts nothing", async () => {
    const submitter = "user_submitter" as UserId;
    const { fixture, node, requestId } = await requestedDisbursement(500000, 400000, submitter);
    const approver = await seedTrustManager(fixture, "Approving Attorney");

    // The money is still on the ledger, but it is no longer AVAILABLE — the disputed portion is
    // spoken for. This is the shape of every stale approval: the request was fundable when it was
    // written and is not fundable now.
    const hold = await placeTrustHold(
      fixture.database,
      {
        nodeId: node.id,
        amount: usd(250000),
        reason: "Fee dispute raised by the client",
        placedBy: approver,
      },
      options,
    );
    await commit(fixture.database, hold.effect);

    const refusal = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId, approvedBy: approver },
      options,
    ).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(TrustValidationError);
    expect((refusal as TrustValidationError).code).toBe("movement-exceeds-available");
    // The refusal names the money that is not there: what was asked for, what is available, and the
    // held portion that explains the difference.
    expect((refusal as TrustValidationError).message).toContain("400000");
    expect((refusal as TrustValidationError).message).toContain("250000");

    expect(await countRows(fixture.database, "trust_disbursement_decision")).toBe(0);
    const balance = await readTrustAvailableBalance(fixture.database, node.id);
    expect(balance.balanceMinor).toBe(500000);
    await expect(assertTrustFitness(fixture.database)).resolves.toBeUndefined();
  });

  it("lets exactly one of two concurrent approvals through, and rolls the loser's posting back with it", async () => {
    const submitter = "user_submitter" as UserId;
    const { fixture, node, requestId } = await requestedDisbursement(500000, 120000, submitter);
    const first = await seedTrustManager(fixture, "First Approver");
    const second = await seedTrustManager(fixture, "Second Approver");

    // Both compose against the same pending request — neither can see the other's decision, which is
    // exactly the window a status column would have to defend and a UNIQUE index simply closes.
    const approvalA = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId, approvedBy: first },
      options,
    );
    const approvalB = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId, approvedBy: second },
      options,
    );

    await commit(fixture.database, approvalA.effect);
    await expect(expectRefusal(() => commit(fixture.database, approvalB.effect))).rejects.toThrow();

    // The loser's ENTIRE batch went with its decision: one disbursement, not two.
    const balance = await readTrustAvailableBalance(fixture.database, node.id);
    expect(balance.balanceMinor).toBe(380000);
    expect(await countRows(fixture.database, "trust_disbursement_decision")).toBe(1);
    const { results } = await fixture.database
      .prepare("SELECT COUNT(*) AS total FROM trust_movement WHERE kind = 'disbursement'")
      .all<{ total: number }>();
    expect(results[0]?.total).toBe(1);
    await expect(assertTrustFitness(fixture.database)).resolves.toBeUndefined();
  });
});

describe("rejection and withdrawal", () => {
  it("records a refusal with its reason and leaves the ledger alone", async () => {
    const submitter = "user_submitter" as UserId;
    const { fixture, node, requestId } = await requestedDisbursement(500000, 120000, submitter);
    const reviewer = await seedTrustManager(fixture, "Reviewing Attorney");

    const rejected = await composeTrustDisbursementRejection(
      fixture.database,
      { requestId, rejectedBy: reviewer, reason: "The invoice this pays has not been approved" },
      options,
    );
    await commit(fixture.database, rejected.effect);

    const settled = await loadTrustDisbursementRequest(fixture.database, requestId);
    expect(settled.decision).toMatchObject({
      decision: "rejected",
      decidedBy: reviewer,
      reason: "The invoice this pays has not been approved",
      authorizationBasis: null,
      movementId: null,
    });
    const balance = await readTrustAvailableBalance(fixture.database, node.id);
    expect(balance.balanceMinor).toBe(500000);
    expect(await countRows(fixture.database, "trust_movement")).toBe(1);
  });

  it("lets the submitter take their own request back, and nobody else", async () => {
    const submitter = "user_submitter" as UserId;
    const { fixture, requestId } = await requestedDisbursement(500000, 120000, submitter);
    const other = await seedTrustManager(fixture, "Another Attorney");

    await expect(
      composeTrustDisbursementWithdrawal(
        fixture.database,
        { requestId, withdrawnBy: other },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-disbursement-withdrawal-not-by-requester" });

    const withdrawn = await composeTrustDisbursementWithdrawal(
      fixture.database,
      { requestId, withdrawnBy: submitter, reason: "Paid from the operating account instead" },
      options,
    );
    await commit(fixture.database, withdrawn.effect);
    const settled = await loadTrustDisbursementRequest(fixture.database, requestId);
    expect(settled.decision).toMatchObject({ decision: "withdrawn", decidedBy: submitter });
  });
});

describe("both records are append-only", () => {
  it("refuses an edit or a deletion of a request and of a decision", async () => {
    const submitter = "user_submitter" as UserId;
    const { fixture, requestId } = await requestedDisbursement(500000, 120000, submitter);
    const reviewer = await seedTrustManager(fixture, "Reviewing Attorney");
    const rejected = await composeTrustDisbursementRejection(
      fixture.database,
      { requestId, rejectedBy: reviewer, reason: "Not this month" },
      options,
    );
    await commit(fixture.database, rejected.effect);

    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE trust_disbursement_request SET payee = 'Someone else' WHERE id = ?1")
          .bind(requestId)
          .run(),
      ),
    ).rejects.toThrow();
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("DELETE FROM trust_disbursement_request WHERE id = ?1")
          .bind(requestId)
          .run(),
      ),
    ).rejects.toThrow();
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE trust_disbursement_decision SET decision = 'approved' WHERE id = ?1")
          .bind(rejected.decisionId)
          .run(),
      ),
    ).rejects.toThrow();
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("DELETE FROM trust_disbursement_decision WHERE id = ?1")
          .bind(rejected.decisionId)
          .run(),
      ),
    ).rejects.toThrow();
  });
});

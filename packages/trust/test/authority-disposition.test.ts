import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { UserId } from "@magna-carta/identifiers/types";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { loadMatterTrustLeaf } from "../src/account-tree.ts";
import {
  readCurrentTrustAuthorizationPolicy,
  resolveTrustAuthorizationDisposition,
  SHIPPED_TRUST_AUTHORIZATION_POLICY,
} from "../src/authorization-policy.ts";
import {
  composeTrustDisbursementApproval,
  composeTrustDisbursementRequest,
  composeTrustDisbursementSubmission,
  loadTrustDisbursementRequest,
} from "../src/disbursement-authorization.ts";
import { assertTrustFitness } from "../src/fitness.ts";
import { composeTrustDeposit } from "../src/movements.ts";
import { insertTrustDisbursementDecisionStatement } from "../src/statements.ts";
import type { TrustAuthorizationPolicySnapshot } from "../src/types.ts";
import {
  clock,
  commit,
  expectRefusal,
  grantTrustAuthority,
  options,
  seedActiveMember,
  seedMatter,
  seedTrustManager,
  setTrustAuthorizationPolicy,
  trustFixture,
} from "./support.ts";

// AUTHORITY IS A PROPERTY OF THE PERSON, not a count of people. What is proved here is the whole of
// that sentence: a member holding the authority releases client money alone, in ONE atomic act; a
// member without it cannot, at any amount, and is told who can; the answer the caller acts on is the
// answer the database independently enforces; and none of the four ways a member might try to borrow
// somebody else's standing works — not the firm merely having a holder, not approving your own
// request, not a lone manager's exception in a firm you are not the lone manager of, and not a
// pending request outliving the posture it was submitted under.

const usd = (minor: number) => money(minor, USD);

async function fundedFixture(amountMinor: number) {
  const fixture = await trustFixture({ jurisdiction: "US-NV" });
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
      recordedBy: fixture.memberUserId,
    },
    options,
  );
  await commit(fixture.database, deposit.effect);
  const node = await loadMatterTrustLeaf(fixture.database, fixture.trustAccountId, matterId);
  return { fixture, matterId, node };
}

type Fixture = Awaited<ReturnType<typeof fundedFixture>>["fixture"];

const submission = (nodeId: string, minor: number, requestedBy: UserId) =>
  ({
    fromNodeId: nodeId as never,
    amount: usd(minor),
    effectiveDate: "2026-08-05",
    description: "Filing fee paid on the client's behalf",
    method: "check" as const,
    reference: "2207",
    payee: "Second Judicial District Court",
    purpose: "Complaint filing fee",
    requestedBy,
  }) as const;

const countRows = async (fixture: Fixture, table: string): Promise<number> => {
  const { results } = await fixture.database
    .prepare(`SELECT COUNT(*) AS total FROM ${table}`)
    .all<{ total: number }>();
  return results[0]?.total ?? 0;
};

describe("the disposition: may this member release this amount alone, and if not who can", () => {
  it("solo for a holder under the seeded posture, at any amount", async () => {
    const { fixture, node } = await fundedFixture(500000);
    const policy = await readCurrentTrustAuthorizationPolicy(fixture.database);
    const disposition = await resolveTrustAuthorizationDisposition(fixture.database, {
      policy,
      amountMinor: 499999,
      actor: fixture.memberUserId,
    });
    expect(disposition).toMatchObject({
      mode: "solo",
      authorizationBasis: "policy_exempt",
      routeReason: null,
      requiresSecondPerson: false,
      eligibleApprovers: [],
    });
    expect(node.id).toBeTruthy();
  });

  it("routes a member without the authority, and NAMES the holders who can act", async () => {
    const { fixture } = await fundedFixture(500000);
    const clerk = await seedActiveMember(fixture, "Billing Clerk");
    const policy = await readCurrentTrustAuthorizationPolicy(fixture.database);
    const disposition = await resolveTrustAuthorizationDisposition(fixture.database, {
      policy,
      amountMinor: 1,
      actor: clerk,
    });
    expect(disposition).toMatchObject({
      mode: "route",
      authorizationBasis: null,
      routeReason: "authority-required",
    });
    expect(disposition.eligibleApprovers.map((approver) => approver.userId)).toEqual([
      fixture.memberUserId,
    ]);
  });

  it("routes above a threshold even for a holder, and offers only OTHER holders as the second person", async () => {
    const { fixture } = await fundedFixture(500000);
    const partner = await seedActiveMember(fixture, "Named Partner");
    await grantTrustAuthority(fixture, partner);
    // A second trust manager, so the lone-holder exception is available to nobody and the only
    // question left above the threshold is who the second person may be.
    await seedTrustManager(fixture, "Second Manager");
    await setTrustAuthorizationPolicy(fixture, {
      policy: "threshold",
      thresholdAmountMinor: 100000,
      requireAuthorizedApprover: true,
    });
    const policy = await readCurrentTrustAuthorizationPolicy(fixture.database);

    // At the threshold: alone. Strictly above it: a second person, who must also hold authority —
    // peer approval, with no regress, because two holders satisfy it.
    await expect(
      resolveTrustAuthorizationDisposition(fixture.database, {
        policy,
        amountMinor: 100000,
        actor: fixture.memberUserId,
      }),
    ).resolves.toMatchObject({ mode: "solo", authorizationBasis: "policy_exempt" });

    const above = await resolveTrustAuthorizationDisposition(fixture.database, {
      policy,
      amountMinor: 100001,
      actor: fixture.memberUserId,
    });
    expect(above).toMatchObject({ mode: "route", routeReason: "second-person-required" });
    expect(above.eligibleApprovers.map((approver) => approver.userId)).toEqual([partner]);
  });

  it("refuses an unrecognized policy kind rather than resolving it to solo", async () => {
    const { fixture } = await fundedFixture(500000);
    // A value from a future deploy reaching an older reader. Fail closed: the answer is a throw, not
    // "no second person required".
    const fromTheFuture = {
      ...SHIPPED_TRUST_AUTHORIZATION_POLICY,
      policy: "authority" as TrustAuthorizationPolicySnapshot["policy"],
    };
    await expect(
      resolveTrustAuthorizationDisposition(fixture.database, {
        policy: fromTheFuture,
        amountMinor: 1,
        actor: fixture.memberUserId,
      }),
    ).rejects.toMatchObject({ code: "trust-authorization-policy-malformed" });
  });
});

describe("a holder releases client money alone, in one act", () => {
  it("posts the request, the movement, and the decision in ONE batch", async () => {
    const { fixture, node } = await fundedFixture(500000);
    const composed = await composeTrustDisbursementSubmission(
      fixture.database,
      submission(node.id, 120000, fixture.memberUserId),
      options,
    );
    expect(composed.disposition.mode).toBe("solo");
    expect(composed.released?.authorizationBasis).toBe("policy_exempt");
    await commit(fixture.database, composed.effect);

    const settled = await loadTrustDisbursementRequest(fixture.database, composed.requestId);
    expect(settled.decision).toMatchObject({
      decision: "approved",
      decidedBy: fixture.memberUserId,
      authorizationBasis: "policy_exempt",
      movementId: composed.released?.movement.movementId,
    });
    const { results } = await fixture.database
      .prepare("SELECT recorded_by, authorized_by, amount_minor FROM trust_movement WHERE id = ?1")
      .bind(composed.released?.movement.movementId)
      .all();
    expect(results[0]).toMatchObject({
      recorded_by: fixture.memberUserId,
      authorized_by: fixture.memberUserId,
      amount_minor: 120000,
    });
    await expect(assertTrustFitness(fixture.database)).resolves.toBeUndefined();
  });

  it("leaves the ledger untouched when any part of the act refuses", async () => {
    const { fixture, node } = await fundedFixture(500000);
    // More than the ledger holds: the proposal itself is refused, so there is no half-written
    // request to approve later.
    await expect(
      composeTrustDisbursementSubmission(
        fixture.database,
        submission(node.id, 900000, fixture.memberUserId),
        options,
      ),
    ).rejects.toMatchObject({ code: "movement-exceeds-available" });
    expect(await countRows(fixture, "trust_disbursement_request")).toBe(0);
    expect(await countRows(fixture, "trust_disbursement_decision")).toBe(0);
  });

  it("leaves a pending request and moves nothing when the submitter has no authority", async () => {
    const { fixture, node } = await fundedFixture(500000);
    const clerk = await seedActiveMember(fixture, "Billing Clerk");
    const composed = await composeTrustDisbursementSubmission(
      fixture.database,
      submission(node.id, 120000, clerk),
      options,
    );
    expect(composed.released).toBeNull();
    expect(composed.disposition.routeReason).toBe("authority-required");
    await commit(fixture.database, composed.effect);

    expect(await countRows(fixture, "trust_disbursement_decision")).toBe(0);
    const { results } = await fixture.database
      .prepare("SELECT COUNT(*) AS total FROM trust_movement WHERE kind = 'disbursement'")
      .all<{ total: number }>();
    expect(results[0]?.total).toBe(0);

    // And the holder settles it as an ordinary second person.
    const approved = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId: composed.requestId, approvedBy: fixture.memberUserId },
      options,
    );
    expect(approved.authorizationBasis).toBe("second_person");
    await commit(fixture.database, approved.effect);
    await expect(assertTrustFitness(fixture.database)).resolves.toBeUndefined();
  });
});

// THE ATTACKS. Each is a member trying to release client money on a standing that belongs to
// somebody else, and each is tried twice: through the composers, and with the composers bypassed
// entirely so only the database's own triggers can be what refuses.
describe("borrowing somebody else's standing", () => {
  it("a member without the authority cannot self-approve just because the FIRM has a holder", async () => {
    const { fixture, node } = await fundedFixture(500000);
    // The generalized form of the defect this area already produced: the firm HAS an authority
    // holder (the fixture member), and the clerk is not it. A check that asked "does this firm have
    // one" instead of "is this actor one" would let the clerk release the money.
    const clerk = await seedActiveMember(fixture, "Billing Clerk");
    const requested = await composeTrustDisbursementRequest(
      fixture.database,
      submission(node.id, 50000, clerk),
      options,
    );
    await commit(fixture.database, requested.effect);

    await expect(
      composeTrustDisbursementApproval(
        fixture.database,
        { requestId: requested.requestId, approvedBy: clerk },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-authorization-authority-required" });

    // Straight at the table, with a real posting to claim so nothing but the authority trigger can
    // be what refuses it.
    const movement = await composeTrustDisbursementSubmission(
      fixture.database,
      submission(node.id, 1000, fixture.memberUserId),
      options,
    );
    await commit(fixture.database, movement.effect);
    const probe = await composeTrustDisbursementSubmission(
      fixture.database,
      submission(node.id, 1000, clerk),
      options,
    );
    await commit(fixture.database, probe.effect);
    const orphanMovement = movement.released?.movement.movementId;
    expect(orphanMovement).toBeTruthy();

    await expect(
      expectRefusal(() =>
        insertTrustDisbursementDecisionStatement(fixture.database, {
          id: newIdentifier("trustDisbursementDecision"),
          requestId: probe.requestId,
          decision: "approved",
          decidedBy: clerk,
          decidedAt: clock.now(),
          reason: null,
          authorizationBasis: "policy_exempt",
          movementId: orphanMovement ?? null,
          transferId: null,
        }).run(),
      ),
    ).rejects.toThrow(/authority to act|authorized it/);
    expect(await countRows(fixture, "trust_disbursement_decision")).toBe(1);
  });

  it("a member cannot approve their own request once the amount takes a second person", async () => {
    const { fixture, node } = await fundedFixture(500000);
    const partner = await seedActiveMember(fixture, "Named Partner");
    await grantTrustAuthority(fixture, partner);
    await setTrustAuthorizationPolicy(fixture, {
      policy: "threshold",
      thresholdAmountMinor: 100000,
      requireAuthorizedApprover: true,
    });
    // Two managers, so the lone-holder exception is unavailable to anybody.
    await seedTrustManager(fixture, "Second Manager");

    const composed = await composeTrustDisbursementSubmission(
      fixture.database,
      submission(node.id, 100001, fixture.memberUserId),
      options,
    );
    expect(composed.released).toBeNull();
    expect(composed.disposition.routeReason).toBe("second-person-required");
    await commit(fixture.database, composed.effect);

    await expect(
      composeTrustDisbursementApproval(
        fixture.database,
        { requestId: composed.requestId, approvedBy: fixture.memberUserId },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-disbursement-decider-is-requester" });

    // The peer holds authority and is a different person: that is the whole of what "above the
    // threshold" asks for.
    const approved = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId: composed.requestId, approvedBy: partner },
      options,
    );
    expect(approved.authorizationBasis).toBe("second_person");
    await commit(fixture.database, approved.effect);
  });

  it("an authority holder cannot borrow the lone-manager exception in a firm they do not solely manage", async () => {
    const { fixture, node } = await fundedFixture(500000);
    // A partner who holds the AUTHORITY but is not a trust manager at all, in a firm whose only
    // trust:manage holder is somebody else. The exception is the counted manager's; the partner
    // qualifies for neither half of it.
    const partner = await seedActiveMember(fixture, "Named Partner");
    await grantTrustAuthority(fixture, partner);
    await setTrustAuthorizationPolicy(fixture, {
      policy: "always",
      requireAuthorizedApprover: true,
    });

    const composed = await composeTrustDisbursementSubmission(
      fixture.database,
      submission(node.id, 120000, partner),
      options,
    );
    expect(composed.released).toBeNull();
    expect(composed.disposition.routeReason).toBe("second-person-required");
    await commit(fixture.database, composed.effect);

    await expect(
      composeTrustDisbursementApproval(
        fixture.database,
        { requestId: composed.requestId, approvedBy: partner },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-disbursement-decider-is-requester" });

    // With the composer bypassed, wearing the basis the genuine lone manager would carry.
    const posting = await composeTrustDisbursementSubmission(
      fixture.database,
      submission(node.id, 1000, fixture.memberUserId),
      options,
    );
    expect(posting.released?.authorizationBasis).toBe("sole_trust_manager");
    await commit(fixture.database, posting.effect);
    await expect(
      expectRefusal(() =>
        insertTrustDisbursementDecisionStatement(fixture.database, {
          id: newIdentifier("trustDisbursementDecision"),
          requestId: composed.requestId,
          decision: "approved",
          decidedBy: partner,
          decidedAt: clock.now(),
          reason: null,
          authorizationBasis: "sole_trust_manager",
          movementId: posting.released?.movement.movementId ?? null,
          transferId: null,
        }).run(),
      ),
    ).rejects.toThrow(/sole-authorizer exception|authorized it/);
  });

  it("a request submitted under a strict posture is not unlocked by relaxing it afterwards", async () => {
    const { fixture, node } = await fundedFixture(500000);
    await seedTrustManager(fixture, "Second Manager");
    await setTrustAuthorizationPolicy(fixture, { policy: "always" });

    const clerk = await seedActiveMember(fixture, "Billing Clerk");
    const composed = await composeTrustDisbursementSubmission(
      fixture.database,
      submission(node.id, 120000, clerk),
      options,
    );
    expect(composed.released).toBeNull();
    await commit(fixture.database, composed.effect);

    // The firm relaxes all the way to "anybody may act alone" AFTER the request was written.
    await setTrustAuthorizationPolicy(fixture, { policy: "off" });

    // The stale request is still governed by its stamp: the clerk cannot settle it.
    await expect(
      composeTrustDisbursementApproval(
        fixture.database,
        { requestId: composed.requestId, approvedBy: clerk },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-disbursement-decider-is-requester" });

    // And with the composer bypassed, wearing the basis the CURRENT posture would justify.
    const posting = await composeTrustDisbursementSubmission(
      fixture.database,
      submission(node.id, 1000, clerk),
      options,
    );
    expect(posting.released?.authorizationBasis).toBe("policy_exempt");
    await commit(fixture.database, posting.effect);
    await expect(
      expectRefusal(() =>
        insertTrustDisbursementDecisionStatement(fixture.database, {
          id: newIdentifier("trustDisbursementDecision"),
          requestId: composed.requestId,
          decision: "approved",
          decidedBy: clerk,
          decidedAt: clock.now(),
          reason: null,
          authorizationBasis: "policy_exempt",
          movementId: posting.released?.movement.movementId ?? null,
          transferId: null,
        }).run(),
      ),
    ).rejects.toThrow(/requires a second person|authorized it/);
  });
});

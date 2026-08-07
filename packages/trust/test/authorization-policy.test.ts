import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { TrustAuthorizationPolicyId, UserId } from "@magna-carta/identifiers/types";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { loadMatterTrustLeaf } from "../src/account-tree.ts";
import {
  composeTrustAuthorizationPolicyChange,
  readCurrentTrustAuthorizationPolicy,
  readTrustAuthorizationPolicyHistory,
  SHIPPED_TRUST_AUTHORIZATION_POLICY,
  trustAuthorizationRequiresSecondPerson,
} from "../src/authorization-policy.ts";
import {
  composeTrustDisbursementApproval,
  composeTrustDisbursementRequest,
  loadTrustDisbursementRequest,
} from "../src/disbursement-authorization.ts";
import { composeTrustDeposit, composeTrustDisbursement } from "../src/movements.ts";
import {
  insertTrustAuthorizationPolicyStatement,
  insertTrustDisbursementDecisionStatement,
} from "../src/statements.ts";
import { composeTrustToOperatingTransfer, type EarnedFeePrecondition } from "../src/transfer.ts";
import {
  clock,
  commit,
  expectRefusal,
  grantTrustAuthority,
  options,
  seedActiveMember,
  seedMatter,
  seedTrustManager,
  trustFixture,
} from "./support.ts";

// The per-firm authorization policy: the two-person rule as the FIRM'S posture rather than the
// platform's. Proved here: the shipped default is the strict one and a firm must explicitly relax;
// the posture is versioned, audited, and append-only; each request is decided under the policy
// STAMPED on it — an in-flight request keeps the rules it was submitted against, in both
// directions; the exemption basis is recorded on the decision's face and the database refuses a
// basis the stamp contradicts; the approver-authority option binds whoever lets money go; and the
// earned-fee transfer runs the same predicate against the same policy rows.

const usd = (minor: number) => money(minor, USD);
const permitting: EarnedFeePrecondition = { assertTransferPermitted: () => Promise.resolve() };

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
      recordedBy: newIdentifier("user"),
    },
    options,
  );
  await commit(fixture.database, deposit.effect);
  const node = await loadMatterTrustLeaf(fixture.database, fixture.trustAccountId, matterId);
  return { fixture, matterId, node };
}

type Fixture = Awaited<ReturnType<typeof fundedFixture>>["fixture"];

async function setPolicy(
  fixture: Fixture,
  policy: "off" | "threshold" | "always",
  extras: { thresholdAmountMinor?: number; requireAuthorizedApprover?: boolean } = {},
) {
  const change = await composeTrustAuthorizationPolicyChange(
    fixture.database,
    {
      policy,
      thresholdAmountMinor: extras.thresholdAmountMinor ?? null,
      requireAuthorizedApprover: extras.requireAuthorizedApprover ?? false,
      setBy: fixture.memberUserId,
    },
    options,
  );
  await commit(fixture.database, change.effect);
  return change;
}

// A committed movement authorized by `authorizedBy`, for the database-bypass probes: a decision
// probe needs a real posting to claim, or the posting-shape triggers refuse it before the policy
// trigger under test ever fires.
async function committedProbeMovement(
  fixture: Fixture,
  nodeId: string,
  minor: number,
  authorizedBy: UserId,
) {
  const movement = await composeTrustDisbursement(
    fixture.database,
    {
      fromNodeId: nodeId as never,
      amount: usd(minor),
      effectiveDate: "2026-08-05",
      description: "Probe disbursement",
      method: "check",
      reference: null,
      payee: "Probe Payee",
      purpose: "Probe",
      recordedBy: authorizedBy,
      authorizedBy,
    },
    options,
  );
  await commit(fixture.database, movement.effect);
  return movement.movementId;
}

async function submitDisbursement(fixture: Fixture, nodeId: string, minor: number, by: UserId) {
  const composed = await composeTrustDisbursementRequest(
    fixture.database,
    {
      fromNodeId: nodeId as never,
      amount: usd(minor),
      effectiveDate: "2026-08-05",
      description: "Filing fee paid on the client's behalf",
      method: "check",
      reference: "2207",
      payee: "Second Judicial District Court",
      purpose: "Complaint filing fee",
      requestedBy: by,
    },
    options,
  );
  await commit(fixture.database, composed.effect);
  return composed.requestId;
}

describe("the policy itself: versioned, audited, append-only, strict by default", () => {
  it("ships strict: no row means always two-person with no authority requirement", async () => {
    const { fixture } = await fundedFixture(500000);
    const current = await readCurrentTrustAuthorizationPolicy(fixture.database);
    expect(current).toEqual(SHIPPED_TRUST_AUTHORIZATION_POLICY);
    expect(current.policy).toBe("always");
    expect(current.requireAuthorizedApprover).toBe(false);
    expect(trustAuthorizationRequiresSecondPerson(current, 1)).toBe(true);
  });

  it("a change is a dense new version with an audit row naming from and to", async () => {
    const { fixture } = await fundedFixture(500000);
    await setPolicy(fixture, "threshold", { thresholdAmountMinor: 100000 });
    await setPolicy(fixture, "off");

    const history = await readTrustAuthorizationPolicyHistory(fixture.database);
    expect(history.map((version) => [version.version, version.policy])).toEqual([
      [2, "off"],
      [1, "threshold"],
    ]);
    const current = await readCurrentTrustAuthorizationPolicy(fixture.database);
    expect(current.version).toBe(2);
    expect(current.setBy).toBe(fixture.memberUserId);

    const { results } = await fixture.database
      .prepare(
        "SELECT actor_user_id, subject_id, metadata FROM audit_log WHERE event = 'trust.authorization_policy_changed'",
      )
      .all<{ actor_user_id: string; subject_id: string; metadata: string }>();
    expect(results).toHaveLength(2);
    // Identified by content rather than position: the fixture clock is frozen, so the two audit
    // rows share created_at and no stored order between them is meaningful.
    const metadatas = results.map(
      (row) => JSON.parse(row.metadata) as Record<string, unknown>,
    );
    const second = metadatas.find((metadata) => metadata["toPolicy"] === "off");
    expect(second).toMatchObject({
      fromPolicy: "threshold",
      toPolicy: "off",
      fromThresholdAmountMinor: 100000,
      fromVersion: 1,
      toVersion: 2,
    });
  });

  it("refuses a re-statement, a threshold without an amount, and an amount without threshold", async () => {
    const { fixture } = await fundedFixture(500000);
    await setPolicy(fixture, "off");
    await expect(setPolicy(fixture, "off")).rejects.toMatchObject({
      code: "trust-authorization-policy-unchanged",
    });
    await expect(setPolicy(fixture, "threshold")).rejects.toMatchObject({
      code: "trust-authorization-policy-threshold-required",
    });
    await expect(setPolicy(fixture, "always", { thresholdAmountMinor: 5 })).rejects.toMatchObject({
      code: "trust-authorization-policy-threshold-forbidden",
    });
  });

  it("the database refuses an edit, a delete, and a stale version", async () => {
    const { fixture } = await fundedFixture(500000);
    const change = await setPolicy(fixture, "off");
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE trust_authorization_policy SET policy = 'always' WHERE id = ?1")
          .bind(change.policyId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      expectRefusal(() => fixture.database.prepare("DELETE FROM trust_authorization_policy").run()),
    ).rejects.toThrow(/append-only/);
    // A concurrent change computed the same next version and lost: the dense-version trigger is
    // what turns interleaving into a refusal.
    await expect(
      expectRefusal(() =>
        insertTrustAuthorizationPolicyStatement(fixture.database, {
          id: newIdentifier("trustAuthorizationPolicy"),
          version: 2 + 1,
          policy: "always",
          thresholdAmountMinor: null,
          requireAuthorizedApprover: false,
          setBy: fixture.memberUserId,
          setAt: clock.now(),
        }).run(),
      ),
    ).rejects.toThrow(/next version/);
  });
});

describe("the posture applied: off, threshold, always", () => {
  it("off: the submitter approves their own request, recorded as policy_exempt on its face", async () => {
    const { fixture, node } = await fundedFixture(500000);
    await seedTrustManager(fixture, "Second Manager");
    await seedTrustManager(fixture, "Third Manager");
    await setPolicy(fixture, "off");

    const submitter = "user_submitter" as UserId;
    const requestId = await submitDisbursement(fixture, node.id, 120000, submitter);
    const approved = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId, approvedBy: submitter },
      options,
    );
    expect(approved.authorizationBasis).toBe("policy_exempt");
    await commit(fixture.database, approved.effect);

    const settled = await loadTrustDisbursementRequest(fixture.database, requestId);
    expect(settled.decision?.authorizationBasis).toBe("policy_exempt");
    expect(settled.decision?.decidedBy).toBe(submitter);
  });

  it("threshold: at the threshold the submitter acts alone; above it a second person is required", async () => {
    const { fixture, node } = await fundedFixture(500000);
    await seedTrustManager(fixture, "Second Manager");
    await seedTrustManager(fixture, "Third Manager");
    await setPolicy(fixture, "threshold", { thresholdAmountMinor: 100000 });

    const submitter = "user_submitter" as UserId;
    const atThreshold = await submitDisbursement(fixture, node.id, 100000, submitter);
    const exempt = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId: atThreshold, approvedBy: submitter },
      options,
    );
    expect(exempt.authorizationBasis).toBe("policy_exempt");
    await commit(fixture.database, exempt.effect);

    const aboveThreshold = await submitDisbursement(fixture, node.id, 100001, submitter);
    await expect(
      composeTrustDisbursementApproval(
        fixture.database,
        { requestId: aboveThreshold, approvedBy: submitter },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-disbursement-decider-is-requester" });
    // A second person still approves it.
    const approved = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId: aboveThreshold, approvedBy: "user_partner" as UserId },
      options,
    );
    expect(approved.authorizationBasis).toBe("second_person");
    await commit(fixture.database, approved.effect);
  });

  it("always (the default) still refuses a self-approval in a multi-manager firm, composer or no composer", async () => {
    const { fixture, node } = await fundedFixture(500000);
    await seedTrustManager(fixture, "Second Manager");
    await seedTrustManager(fixture, "Third Manager");

    const submitter = "user_submitter" as UserId;
    const requestId = await submitDisbursement(fixture, node.id, 120000, submitter);
    await expect(
      composeTrustDisbursementApproval(
        fixture.database,
        { requestId, approvedBy: submitter },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-disbursement-decider-is-requester" });
    // Straight at the table, wearing the exemption basis the stamp contradicts, with a real posting
    // to claim so nothing but the policy trigger can be what refuses.
    const movementId = await committedProbeMovement(fixture, node.id, 1000, submitter);
    await expect(
      expectRefusal(() =>
        insertTrustDisbursementDecisionStatement(fixture.database, {
          id: newIdentifier("trustDisbursementDecision"),
          requestId,
          decision: "approved",
          decidedBy: submitter,
          decidedAt: clock.now(),
          reason: null,
          authorizationBasis: "policy_exempt",
          movementId,
          transferId: null,
        }).run(),
      ),
    ).rejects.toThrow(/requires a second person/);
  });
});

describe("an in-flight request keeps the policy it was created under", () => {
  it("relaxing to off does NOT unlock a request submitted under always", async () => {
    const { fixture, node } = await fundedFixture(500000);
    await seedTrustManager(fixture, "Second Manager");
    await seedTrustManager(fixture, "Third Manager");

    const submitter = "user_submitter" as UserId;
    // Submitted under the shipped default: always two-person.
    const requestId = await submitDisbursement(fixture, node.id, 120000, submitter);
    // The firm then relaxes its posture entirely.
    await setPolicy(fixture, "off");

    // The pending request is still decided under the policy stamped on it: a self-approval refuses
    // at the composer...
    await expect(
      composeTrustDisbursementApproval(
        fixture.database,
        { requestId, approvedBy: submitter },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-disbursement-decider-is-requester" });
    // ...and at the database, where the policy_exempt basis is refused against the always stamp
    // even with a real posting to claim.
    const movementId = await committedProbeMovement(fixture, node.id, 1000, submitter);
    await expect(
      expectRefusal(() =>
        insertTrustDisbursementDecisionStatement(fixture.database, {
          id: newIdentifier("trustDisbursementDecision"),
          requestId,
          decision: "approved",
          decidedBy: submitter,
          decidedAt: clock.now(),
          reason: null,
          authorizationBasis: "policy_exempt",
          movementId,
          transferId: null,
        }).run(),
      ),
    ).rejects.toThrow(/requires a second person/);
    // A NEW request, submitted under the relaxed posture, self-approves.
    const relaxedRequest = await submitDisbursement(fixture, node.id, 60000, submitter);
    const approved = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId: relaxedRequest, approvedBy: submitter },
      options,
    );
    expect(approved.authorizationBasis).toBe("policy_exempt");
    await commit(fixture.database, approved.effect);
  });

  it("tightening to always does NOT strand a request the old policy exempted", async () => {
    const { fixture, node } = await fundedFixture(500000);
    await seedTrustManager(fixture, "Second Manager");
    await seedTrustManager(fixture, "Third Manager");
    await setPolicy(fixture, "off");

    const submitter = "user_submitter" as UserId;
    const requestId = await submitDisbursement(fixture, node.id, 120000, submitter);
    await setPolicy(fixture, "always");

    const approved = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId, approvedBy: submitter },
      options,
    );
    expect(approved.authorizationBasis).toBe("policy_exempt");
    await commit(fixture.database, approved.effect);
  });

  it("a new request cannot be stamped with a superseded policy version", async () => {
    const { fixture, node } = await fundedFixture(500000);
    const superseded = await setPolicy(fixture, "off");
    await setPolicy(fixture, "always");

    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "INSERT INTO trust_disbursement_request (id, trust_account_id, node_id, amount_minor, currency, method, reference, payee, purpose, description, effective_date, requested_by, requested_at, kind, operating_description, policy_id) VALUES (?1, ?2, ?3, 100, 'USD', 'check', NULL, 'Payee', 'p', 'd', '2026-08-05', 'user_x', ?4, 'disbursement', NULL, ?5)",
          )
          .bind(
            newIdentifier("trustDisbursementRequest"),
            fixture.trustAccountId,
            node.id,
            clock.now(),
            superseded.policyId,
          )
          .run(),
      ),
    ).rejects.toThrow(/current authorization policy version/);
  });
});

describe("the approver-authority option", () => {
  it("binds whoever lets money go, and names who can act", async () => {
    const { fixture, node } = await fundedFixture(500000);
    const partner = await seedActiveMember(fixture, "Named Partner");
    await grantTrustAuthority(fixture, partner);
    await setPolicy(fixture, "off", { requireAuthorizedApprover: true });

    const submitter = "user_submitter" as UserId;
    const requestId = await submitDisbursement(fixture, node.id, 120000, submitter);
    // The submitter, policy-exempt from a second person, still lacks the authority to act.
    await expect(
      composeTrustDisbursementApproval(
        fixture.database,
        { requestId, approvedBy: submitter },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-authorization-authority-required" });
    // And the database holds the same without the composer, with a real posting to claim.
    const movementId = await committedProbeMovement(fixture, node.id, 1000, submitter);
    await expect(
      expectRefusal(() =>
        insertTrustDisbursementDecisionStatement(fixture.database, {
          id: newIdentifier("trustDisbursementDecision"),
          requestId,
          decision: "approved",
          decidedBy: submitter,
          decidedAt: clock.now(),
          reason: null,
          authorizationBasis: "policy_exempt",
          movementId,
          transferId: null,
        }).run(),
      ),
    ).rejects.toThrow(/authority to act/);
    // The member holding trust:authorize approves — an ordinary second person with authority.
    const approved = await composeTrustDisbursementApproval(
      fixture.database,
      { requestId, approvedBy: partner },
      options,
    );
    expect(approved.authorizationBasis).toBe("second_person");
    await commit(fixture.database, approved.effect);
  });
});

describe("the earned-fee transfer runs the same policy", () => {
  const transferInput = (
    fixture: Fixture,
    nodeId: string,
    minor: number,
    recordedBy: UserId,
    authorizedBy: UserId,
  ) => ({
    fromNodeId: nodeId as never,
    amount: usd(minor),
    effectiveDate: "2026-08-05",
    trustDescription: "Earned fees withdrawn from trust",
    operatingDescription: "Earned fees received into operating",
    operatingBankAccountId: fixture.operatingBankAccountId,
    accountsReceivableAccountId: fixture.accountsReceivableAccountId,
    recordedBy,
    authorizedBy,
  });

  it("under the default policy a single actor is refused in a multi-manager firm, and at the database", async () => {
    const { fixture, node } = await fundedFixture(500000);
    await seedTrustManager(fixture, "Second Manager");
    await seedTrustManager(fixture, "Third Manager");
    const actor = "user_biller" as UserId;

    await expect(
      composeTrustToOperatingTransfer(
        fixture.database,
        transferInput(fixture, node.id, 120000, actor, actor),
        { ...options, earnedFeePrecondition: permitting },
      ),
    ).rejects.toMatchObject({ code: "transfer-requires-second-person" });

    // Two distinct members satisfy the posture — the queue's decision triggers are what make the
    // second act a real, authenticated one on the application flow.
    const transfer = await composeTrustToOperatingTransfer(
      fixture.database,
      transferInput(fixture, node.id, 120000, actor, "user_partner" as UserId),
      { ...options, earnedFeePrecondition: permitting },
    );
    await commit(fixture.database, transfer.effect);

    // Bypassing the composer: the trigger refuses the single-actor row on its own.
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "INSERT INTO trust_transfer (id, trust_account_id, from_node_id, amount_minor, currency, trust_entry_id, operating_entry_id, authorized_by, recorded_by, policy_id, approved_request_id, effective_date, recorded_at) VALUES (?1, ?2, ?3, 100, 'USD', ?4, ?5, 'user_same', 'user_same', NULL, NULL, '2026-08-05', ?6)",
          )
          .bind(
            newIdentifier("trustTransfer"),
            fixture.trustAccountId,
            node.id,
            transfer.trustEntryId,
            transfer.operatingEntryId,
            clock.now(),
          )
          .run(),
      ),
    ).rejects.toThrow(/second person/);
  });

  it("the authority option binds the transfer's authorizer too", async () => {
    const { fixture, node } = await fundedFixture(500000);
    const partner = await seedActiveMember(fixture, "Named Partner");
    await grantTrustAuthority(fixture, partner);
    await setPolicy(fixture, "off", { requireAuthorizedApprover: true });
    const biller = "user_biller" as UserId;

    await expect(
      composeTrustToOperatingTransfer(
        fixture.database,
        transferInput(fixture, node.id, 120000, biller, biller),
        { ...options, earnedFeePrecondition: permitting },
      ),
    ).rejects.toMatchObject({ code: "trust-authorization-authority-required" });

    const transfer = await composeTrustToOperatingTransfer(
      fixture.database,
      transferInput(fixture, node.id, 120000, biller, partner),
      { ...options, earnedFeePrecondition: permitting },
    );
    await commit(fixture.database, transfer.effect);
    const { results } = await fixture.database
      .prepare("SELECT recorded_by, authorized_by, policy_id FROM trust_transfer WHERE id = ?1")
      .bind(transfer.transferId)
      .all<{ recorded_by: string; authorized_by: string; policy_id: string | null }>();
    expect(results[0]?.recorded_by).toBe(biller);
    expect(results[0]?.authorized_by).toBe(partner);
    expect(results[0]?.policy_id).not.toBeNull();
  });

  it("a direct transfer cannot be stamped with a superseded policy version", async () => {
    const { fixture, node } = await fundedFixture(500000);
    const superseded = await setPolicy(fixture, "off");
    await setPolicy(fixture, "always");

    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "INSERT INTO trust_transfer (id, trust_account_id, from_node_id, amount_minor, currency, trust_entry_id, operating_entry_id, authorized_by, recorded_by, policy_id, approved_request_id, effective_date, recorded_at) VALUES (?1, ?2, ?3, 100, 'USD', 'ledgerEntry_bogus_a', 'ledgerEntry_bogus_b', 'user_a', 'user_b', ?4, NULL, '2026-08-05', ?5)",
          )
          .bind(
            newIdentifier("trustTransfer"),
            fixture.trustAccountId,
            node.id,
            superseded.policyId,
            clock.now(),
          )
          .run(),
      ),
    ).rejects.toThrow(/current authorization policy version/);
  });
});

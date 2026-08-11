import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { InvoiceId, MatterId, TrustAccountId, UserId } from "@magna-carta/identifiers/types";
import { composeTrustAuthorizationPolicyChange } from "@magna-carta/trust/authorization-policy";
import { composeTrustDisbursementWithdrawal } from "@magna-carta/trust/disbursement-authorization";
import { describe, expect, it } from "vitest";
import {
  applyEarnedFeesUnderAuthorizationPolicy,
  composeTrustApplicationApproval,
  readTrustApplicationRequestLines,
  submitTrustApplicationRequest,
} from "../src/apply-authorization.ts";
import { applyTrustFundsToInvoices } from "../src/apply-trust-funds.ts";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { finalizeInvoice } from "../src/finalize.ts";
import { readInvoiceApplications, readInvoiceMatterBalances } from "../src/statements.ts";
import {
  billingFixture,
  clock,
  commit,
  expectRefusal,
  mapAccountRoles,
  options,
  readOneRow,
  seedMatter,
  seedTimeEntry,
  seedTrustAccount,
  depositToMatterTrustLeaf,
  type BillingFixture,
} from "./support.ts";

// The earned-fee application under the firm's authorization policy — billing's side of the shared
// queue. Proved here: under a firm-written always-two-person posture a multi-manager firm cannot
// take its fees single-handed on the direct path and CAN through submit-then-approve; the approval
// re-resolves the invoices and posts through the one apply path; the record ties the decision, the
// transfer, and the request together; an in-flight application keeps the policy it was submitted
// under; and a firm that relaxes its posture gets the single-actor path back.

const ACME = "directoryOrganization_acme";
const FINALIZE_DATES = { issueDate: "2026-08-05", dueDate: "2026-09-04" } as const;
const APPLY_ROLES = ["accounts_receivable", "fee_income", "operating_bank"] as const;

// Every per-firm database is seeded with the authority-based posture — a holder acts alone — so a
// suite about the TWO-PERSON shape writes that posture rather than leaning on a default.
async function requireTwoPeople(fixture: BillingFixture): Promise<void> {
  const change = await composeTrustAuthorizationPolicyChange(
    fixture.database,
    { policy: "always", requireAuthorizedApprover: false, setBy: fixture.memberUserId },
    options,
  );
  await commit(fixture.database, change.effect);
}

async function seedTrustManager(fixture: BillingFixture, displayName: string): Promise<UserId> {
  const userId = newIdentifier("user");
  await fixture.database.batch([
    fixture.database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, 'active', ?3)",
      )
      .bind(userId, displayName, clock.now()),
    fixture.database
      .prepare(
        "INSERT INTO direct_grant (id, member_user_id, permission, expires_at, granted_by, created_at) VALUES (?1, ?2, 'trust:manage', NULL, ?2, ?3)",
      )
      .bind(newIdentifier("grant"), userId, clock.now()),
  ]);
  return userId;
}

interface ApplicationFixture {
  readonly fixture: BillingFixture;
  readonly trustAccountId: TrustAccountId;
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
  readonly approver: UserId;
}

// A multi-manager firm that requires two people: a finalized 500.00 bill, 800.00 of the client's
// money in trust against the matter, and a second member who can approve.
async function applicationFixture(): Promise<ApplicationFixture> {
  const fixture = await billingFixture();
  await requireTwoPeople(fixture);
  await mapAccountRoles(fixture, [...APPLY_ROLES]);
  const matterId = await seedMatter(fixture, ACME, "Acme");
  const timeEntryId = await seedTimeEntry(fixture, matterId, { amountMinor: 500_00 });
  const draft = createInvoiceDraft(
    fixture.database,
    { clientEntityId: ACME, currency: "USD", createdBy: fixture.memberUserId },
    options,
  );
  await commit(fixture.database, draft.effect);
  const claimed = await addClaimsToDraft(
    fixture.database,
    draft.invoiceId,
    [{ sourceKind: "time_entry", sourceId: timeEntryId }],
    options,
  );
  await commit(fixture.database, claimed.effect);
  const finalized = await finalizeInvoice(
    fixture.database,
    { invoiceId: draft.invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
    options,
  );
  await commit(fixture.database, finalized.effect);
  const trustAccountId = await seedTrustAccount(fixture);
  await depositToMatterTrustLeaf(fixture, trustAccountId, matterId, 800_00);
  await seedTrustManager(fixture, "Submitting Manager");
  const approver = await seedTrustManager(fixture, "Approving Partner");
  return { fixture, trustAccountId, invoiceId: draft.invoiceId, matterId, approver };
}

function submitInput(context: ApplicationFixture, amountMinor: number) {
  return {
    trustAccountId: context.trustAccountId,
    matterId: context.matterId,
    applications: [{ invoiceId: context.invoiceId, amountMinor }],
    currency: "USD",
    effectiveDate: "2026-08-05",
    trustDescription: "Earned fees transferred to operating",
    operatingDescription: "Earned fees received from trust",
    method: "electronic_transfer",
    payee: "The Firm — operating account",
    purpose: "Earned fees on finalized invoice",
    requestedBy: context.fixture.memberUserId,
  } as const;
}

describe("the earned-fee application under an always-two-person posture", () => {
  it("refuses the single-actor direct path in a multi-manager firm, naming the queue", async () => {
    const context = await applicationFixture();
    await expect(
      applyTrustFundsToInvoices(
        context.fixture.database,
        {
          trustAccountId: context.trustAccountId,
          matterId: context.matterId,
          applications: [{ invoiceId: context.invoiceId, amountMinor: 500_00 }],
          currency: "USD",
          effectiveDate: "2026-08-05",
          trustDescription: "Earned fees transferred to operating",
          operatingDescription: "Earned fees received from trust",
          appliedBy: context.fixture.memberUserId,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "transfer-requires-second-person" });
  });

  it("submit then approve: one batch posts the transfer, the applications, and the decision, tied together", async () => {
    const context = await applicationFixture();
    const { fixture } = context;

    const submitted = await submitTrustApplicationRequest(
      fixture.database,
      submitInput(context, 500_00),
      options,
    );
    await commit(fixture.database, submitted.effect);
    // Nothing has moved: the request and its lines are a proposal.
    const balancesBefore = await readInvoiceMatterBalances(fixture.database, context.invoiceId);
    expect(balancesBefore[0]?.appliedMinor).toBe(0);
    const lines = await readTrustApplicationRequestLines(fixture.database, submitted.requestId);
    expect(lines.map((line) => [line.invoiceId, line.amountMinor])).toEqual([
      [context.invoiceId, 500_00],
    ]);

    // The submitter may not approve their own application under this policy.
    await expect(
      composeTrustApplicationApproval(
        fixture.database,
        { requestId: submitted.requestId, approvedBy: fixture.memberUserId },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-disbursement-decider-is-requester" });

    const approved = await composeTrustApplicationApproval(
      fixture.database,
      { requestId: submitted.requestId, approvedBy: context.approver },
      options,
    );
    await commit(fixture.database, approved.effect);

    // The bill is paid, through the ordinary application door.
    const [balance] = await readInvoiceMatterBalances(fixture.database, context.invoiceId);
    expect(balance?.appliedMinor).toBe(500_00);
    const [application] = await readInvoiceApplications(fixture.database, context.invoiceId);
    expect(application?.trustTransferId).toBe(approved.transferId);

    // The transfer names the submitter as recorder, the approver as authorizer, and the request it
    // was approved from; the decision names the transfer and the second-person footing.
    const transfer = await readOneRow<{
      recorded_by: string;
      authorized_by: string;
      approved_request_id: string;
    }>(
      fixture.database,
      "SELECT recorded_by, authorized_by, approved_request_id FROM trust_transfer WHERE id = ?1",
      approved.transferId,
    );
    expect(transfer).toEqual({
      recorded_by: fixture.memberUserId,
      authorized_by: context.approver,
      approved_request_id: submitted.requestId,
    });
    const decision = await readOneRow<{
      decision: string;
      decided_by: string;
      authorization_basis: string;
      transfer_id: string;
      movement_id: string | null;
    }>(
      fixture.database,
      "SELECT decision, decided_by, authorization_basis, transfer_id, movement_id FROM trust_disbursement_decision WHERE request_id = ?1",
      submitted.requestId,
    );
    expect(decision).toEqual({
      decision: "approved",
      decided_by: context.approver,
      authorization_basis: "second_person",
      transfer_id: approved.transferId,
      movement_id: null,
    });

    // Settled means settled: a second approval refuses by name.
    await expect(
      composeTrustApplicationApproval(
        fixture.database,
        { requestId: submitted.requestId, approvedBy: context.approver },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-disbursement-request-already-decided" });
  });

  it("the approval re-resolves the invoices as they stand THEN, not at submission", async () => {
    const context = await applicationFixture();
    const { fixture } = context;
    const submitted = await submitTrustApplicationRequest(
      fixture.database,
      submitInput(context, 500_00),
      options,
    );
    await commit(fixture.database, submitted.effect);

    // The bill is overtaken: a second application (approved by the second member) consumes 200.00
    // of its unpaid balance while the request sits in the queue.
    const overtaking = await applyTrustFundsToInvoices(
      fixture.database,
      {
        trustAccountId: context.trustAccountId,
        matterId: context.matterId,
        applications: [{ invoiceId: context.invoiceId, amountMinor: 200_00 }],
        currency: "USD",
        effectiveDate: "2026-08-05",
        trustDescription: "Partial fees transferred to operating",
        operatingDescription: "Partial fees received from trust",
        appliedBy: fixture.memberUserId,
        authorizedBy: context.approver,
      },
      options,
    );
    await commit(fixture.database, overtaking.effect);

    await expect(
      composeTrustApplicationApproval(
        fixture.database,
        { requestId: submitted.requestId, approvedBy: context.approver },
        options,
      ),
    ).rejects.toMatchObject({ code: "earned-fee-exceeds-unpaid-balance" });
  });

  it("a pending application keeps the policy it was submitted under when the firm relaxes", async () => {
    const context = await applicationFixture();
    const { fixture } = context;
    const submitted = await submitTrustApplicationRequest(
      fixture.database,
      submitInput(context, 500_00),
      options,
    );
    await commit(fixture.database, submitted.effect);

    // The firm turns the requirement off entirely — for NEW authorizations.
    const relaxed = await composeTrustAuthorizationPolicyChange(
      fixture.database,
      { policy: "off", requireAuthorizedApprover: false, setBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, relaxed.effect);

    // The in-flight request is still decided under its stamp: self-approval refuses.
    await expect(
      composeTrustApplicationApproval(
        fixture.database,
        { requestId: submitted.requestId, approvedBy: fixture.memberUserId },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-disbursement-decider-is-requester" });

    // The submitter withdraws it (trust's kind-agnostic composer) and re-submits under the relaxed
    // posture, which self-approves — recorded as policy_exempt on its face.
    const withdrawal = await composeTrustDisbursementWithdrawal(
      fixture.database,
      {
        requestId: submitted.requestId,
        withdrawnBy: fixture.memberUserId,
        reason: "Re-submitting under the relaxed posture",
      },
      options,
    );
    await commit(fixture.database, withdrawal.effect);

    const resubmitted = await submitTrustApplicationRequest(
      fixture.database,
      submitInput(context, 500_00),
      options,
    );
    await commit(fixture.database, resubmitted.effect);
    const approved = await composeTrustApplicationApproval(
      fixture.database,
      { requestId: resubmitted.requestId, approvedBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, approved.effect);
    const decision = await readOneRow<{ authorization_basis: string }>(
      fixture.database,
      "SELECT authorization_basis FROM trust_disbursement_decision WHERE request_id = ?1",
      resubmitted.requestId,
    );
    expect(decision?.authorization_basis).toBe("policy_exempt");

    // And with the posture off, the direct single-actor path is back.
    const [balance] = await readInvoiceMatterBalances(fixture.database, context.invoiceId);
    expect(balance?.appliedMinor).toBe(500_00);
  });
});

describe("the lone-holder exception is not borrowable through the application flow", () => {
  // The reviewer's reproduction, at the composer the route calls: a firm with exactly ONE
  // trust:manage holder (the fixture member) and a clerk who can apply but not authorize. The clerk
  // submits an application and self-approves; before the membership half of the lone-holder rule,
  // the batch committed with a sole_trust_manager basis nobody had.
  async function clerkFixture() {
    const fixture = await billingFixture();
    await requireTwoPeople(fixture);
    await mapAccountRoles(fixture, [...APPLY_ROLES]);
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const timeEntryId = await seedTimeEntry(fixture, matterId, { amountMinor: 500_00 });
    const draft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: ACME, currency: "USD", createdBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, draft.effect);
    const claimed = await addClaimsToDraft(
      fixture.database,
      draft.invoiceId,
      [{ sourceKind: "time_entry", sourceId: timeEntryId }],
      options,
    );
    await commit(fixture.database, claimed.effect);
    const finalized = await finalizeInvoice(
      fixture.database,
      { invoiceId: draft.invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, finalized.effect);
    const trustAccountId = await seedTrustAccount(fixture);
    await depositToMatterTrustLeaf(fixture, trustAccountId, matterId, 800_00);
    return { fixture, trustAccountId, matterId, invoiceId: draft.invoiceId };
  }

  it("refuses the clerk's self-approval; the holder approves it as a second person", async () => {
    const context = await clerkFixture();
    const { fixture } = context;
    const clerk = "user_clerk_billing_only" as UserId;

    const submitted = await submitTrustApplicationRequest(
      fixture.database,
      {
        trustAccountId: context.trustAccountId,
        matterId: context.matterId,
        applications: [{ invoiceId: context.invoiceId, amountMinor: 500_00 }],
        currency: "USD",
        effectiveDate: "2026-08-05",
        trustDescription: "Earned fees transferred to operating",
        operatingDescription: "Earned fees received from trust",
        method: "electronic_transfer",
        payee: "The Firm — operating account",
        purpose: "Earned fees on finalized invoice",
        requestedBy: clerk,
      },
      options,
    );
    await commit(fixture.database, submitted.effect);

    // Not a second person, and not the holder the exception belongs to: refused by name.
    await expect(
      composeTrustApplicationApproval(
        fixture.database,
        { requestId: submitted.requestId, approvedBy: clerk },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-disbursement-decider-is-requester" });

    // The firm's one trust:manage holder approves it as an ordinary second person.
    const approved = await composeTrustApplicationApproval(
      fixture.database,
      { requestId: submitted.requestId, approvedBy: fixture.memberUserId },
      options,
    );
    expect(approved.authorizationBasis).toBe("second_person");
    await commit(fixture.database, approved.effect);

    // A settled request's particulars are spent: a second transfer claiming the same request under
    // its old stamp aborts at the database, composer or no composer.
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "INSERT INTO trust_transfer (id, trust_account_id, from_node_id, amount_minor, currency, trust_entry_id, operating_entry_id, authorized_by, recorded_by, policy_id, approved_request_id, effective_date, recorded_at) VALUES (?1, ?2, ?3, 50000, 'USD', ?4, ?5, ?6, ?7, NULL, ?8, '2026-08-05', ?9)",
          )
          .bind(
            newIdentifier("trustTransfer"),
            context.trustAccountId,
            submitted.nodeId,
            approved.trustEntryId,
            approved.operatingEntryId,
            fixture.memberUserId,
            clerk,
            submitted.requestId,
            clock.now(),
          )
          .run(),
      ),
    ).rejects.toThrow(/request nobody has decided|UNIQUE/);
  });
});

// UNDER THE POSTURE EVERY FIRM IS SEEDED WITH, the one entrance decides for itself: an authorized
// member takes the fees now, anybody else leaves a proposal for one who can. No posture is written
// here — that IS the case under test.
describe("taking earned fees under the seeded authority-based posture", () => {
  async function seededFixture() {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, [...APPLY_ROLES]);
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const timeEntryId = await seedTimeEntry(fixture, matterId, { amountMinor: 500_00 });
    const draft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: ACME, currency: "USD", createdBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, draft.effect);
    const claimed = await addClaimsToDraft(
      fixture.database,
      draft.invoiceId,
      [{ sourceKind: "time_entry", sourceId: timeEntryId }],
      options,
    );
    await commit(fixture.database, claimed.effect);
    const finalized = await finalizeInvoice(
      fixture.database,
      { invoiceId: draft.invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, finalized.effect);
    const trustAccountId = await seedTrustAccount(fixture);
    await depositToMatterTrustLeaf(fixture, trustAccountId, matterId, 800_00);
    return { fixture, trustAccountId, matterId, invoiceId: draft.invoiceId };
  }

  const feeInput = (context: Awaited<ReturnType<typeof seededFixture>>, requestedBy: UserId) => ({
    trustAccountId: context.trustAccountId,
    matterId: context.matterId,
    applications: [{ invoiceId: context.invoiceId, amountMinor: 500_00 }],
    currency: "USD",
    effectiveDate: "2026-08-05",
    trustDescription: "Earned fees transferred to operating",
    operatingDescription: "Earned fees received from trust",
    method: "electronic_transfer" as const,
    payee: "The Firm — operating account",
    purpose: "Earned fees on finalized invoice",
    requestedBy,
  });

  it("applies for a member holding the authority, in one batch", async () => {
    const context = await seededFixture();
    const outcome = await applyEarnedFeesUnderAuthorizationPolicy(
      context.fixture.database,
      feeInput(context, context.fixture.memberUserId),
      options,
    );
    expect(outcome.outcome).toBe("applied");
    expect(outcome.disposition).toMatchObject({
      mode: "solo",
      authorizationBasis: "policy_exempt",
    });
    await commit(context.fixture.database, outcome.effect);

    const [balance] = await readInvoiceMatterBalances(context.fixture.database, context.invoiceId);
    expect(balance?.appliedMinor).toBe(500_00);
  });

  it("queues for a member without it, names who can release it, and moves nothing", async () => {
    const context = await seededFixture();
    const clerk = "user_clerk_billing_only" as UserId;
    const outcome = await applyEarnedFeesUnderAuthorizationPolicy(
      context.fixture.database,
      feeInput(context, clerk),
      options,
    );
    expect(outcome.outcome).toBe("queued");
    expect(outcome.disposition).toMatchObject({
      mode: "route",
      routeReason: "authority-required",
      authorizationBasis: null,
    });
    expect(outcome.disposition.eligibleApprovers.map((approver) => approver.userId)).toEqual([
      context.fixture.memberUserId,
    ]);
    await commit(context.fixture.database, outcome.effect);

    const [balance] = await readInvoiceMatterBalances(context.fixture.database, context.invoiceId);
    expect(balance?.appliedMinor).toBe(0);

    // And the guard behind the routing agrees: the clerk attempting the direct path anyway is
    // refused by trust's own composer, so the disposition never becomes the only thing standing
    // between a member and client money.
    await expect(
      applyTrustFundsToInvoices(
        context.fixture.database,
        {
          trustAccountId: context.trustAccountId,
          matterId: context.matterId,
          applications: [{ invoiceId: context.invoiceId, amountMinor: 500_00 }],
          currency: "USD",
          effectiveDate: "2026-08-05",
          trustDescription: "Earned fees transferred to operating",
          operatingDescription: "Earned fees received from trust",
          appliedBy: clerk,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "trust-authorization-authority-required" });
  });
});

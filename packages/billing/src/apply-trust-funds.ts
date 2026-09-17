import type { EffectWrite, EffectStatement } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  InvoiceApplicationId,
  MatterId,
  TrustAccountId,
  TrustAuthorizationPolicyId,
  TrustDisbursementRequestId,
  TrustTransferId,
  UserId,
} from "@magna-carta/identifiers/types";
import { readMatterClientEntityId } from "@magna-carta/matters/matter-party";
import { currencyFromCode, money } from "@magna-carta/money/money";
import { loadMatterTrustLeaf } from "@magna-carta/trust/account-tree";
import { composeTrustToOperatingTransfer } from "@magna-carta/trust/transfer";
import { readAccountRoleMap, resolveAccountRole } from "./account-roles.ts";
import { composeInvoiceApplication } from "./application.ts";
import { BillingValidationError } from "./billing-validation.ts";
import { BILLING_AGGREGATE_KEY } from "./draft.ts";
import {
  invoiceBackedEarnedFeePrecondition,
  resolveEarnedFeeApplications,
  type EarnedFeeApplicationRequest,
} from "./earned-fee.ts";
import type { BillingServiceOptions } from "./types.ts";

export const TRUST_APPLIED_TOPIC = "billing.trust.applied";

// APPLYING TRUST FUNDS TO A FINALIZED INVOICE — the longest chain in the financial core, and the one
// surface where a member takes client money.
//
// It is one composed batch carrying three subsystems' statements: trust's two linked ledger entries
// and the transfer row that links them; billing's application rows and their balance deltas; and the
// idempotency record the caller's chokepoint adds. All of it commits together or none of it does. A
// trust disbursement that committed without its application would be client money out of a ledger
// with nothing on the bill to show for it; an application that committed without its transfer would
// be a bill marked paid out of money that never moved.
//
// WHAT THIS PACKAGE DOES NOT DO. It composes no trust statement, writes no trust table, and
// reimplements no trust rule. The entries come from `composeTrustToOperatingTransfer`, which applies
// the composition guard (no entry touching client money may touch anything outside it), the
// available-not-balance ceiling (money under a disputed-funds hold is not money the firm may take),
// the account-open check, and the currency check — all on their own terms, with their own refusals.
// Billing's whole contribution is a satisfier for the earned-fee port trust left refusing. A source
// scan asserts this: no file in this package composes a `trust_*` statement.
//
// AND IT COMPOSES NO LEDGER ENTRY OF ITS OWN. The transfer's operating leg already credits accounts
// receivable. See the header of application.ts for what a second credit here would silently cost.

export interface ApplyTrustFundsInput {
  readonly trustAccountId: TrustAccountId;
  // The matter whose client ledger the money leaves. Whose money it is follows from this matter's own
  // client party and is derived here — never a client handle taken from the request, which would be
  // the caller answering the question the check exists to ask.
  readonly matterId: MatterId;
  // One or more finalized invoices and what to put against each. Partial is the normal case, not an
  // edge case: an evergreen retainer at 2,000 against a 6,500 bill applies 2,000 and leaves 4,500.
  readonly applications: readonly EarnedFeeApplicationRequest[];
  readonly currency: string;
  readonly effectiveDate: string; // YYYY-MM-DD civil date
  readonly trustDescription: string;
  readonly operatingDescription: string;
  readonly appliedBy: UserId;
  // Who let the money go, when that is a different member than the one who assembled the
  // application: the approver of a pending application request. Defaults to `appliedBy` — the
  // direct, single-actor form — which the firm's authorization policy may refuse (trust raises the
  // named refusal, and the trust_transfer triggers hold it at the database).
  readonly authorizedBy?: UserId;
  // Present when this application is the approval of a pending request: the transfer is then
  // governed by the policy version stamped on that request rather than the current one — an
  // in-flight application keeps the rules it was submitted against.
  readonly approvedRequest?: {
    readonly id: TrustDisbursementRequestId;
    readonly policyId: TrustAuthorizationPolicyId | null;
  };
}

export interface AppliedTrustFunds {
  readonly transferId: TrustTransferId;
  readonly trustEntryId: string;
  readonly operatingEntryId: string;
  readonly applicationIds: readonly InvoiceApplicationId[];
  readonly totalMinor: number;
  readonly effect: EffectWrite;
}

export async function applyTrustFundsToInvoices(
  database: SqlDatabase,
  input: ApplyTrustFundsInput,
  options: BillingServiceOptions,
): Promise<AppliedTrustFunds> {
  // The leaf has to already exist. A payout path that lazily created its own source leaf would be
  // composing a refusal out of an empty account it had just invented, so trust refuses by name.
  const leaf = await loadMatterTrustLeaf(database, input.trustAccountId, input.matterId);

  // Whose money this is, from the one home for that derivation — the same link an invoice's client is
  // resolved through, so the two can never end up with different answers about the same matter.
  const clientEntityId = await readMatterClientEntityId(database, input.matterId);
  if (!clientEntityId) {
    throw new BillingValidationError(
      "matter-has-no-client",
      `matter ${input.matterId} has no client party, so there is nobody whose bill this money could be paying: record the client on the matter first`,
    );
  }

  const resolution = await resolveEarnedFeeApplications(database, {
    nodeId: leaf.id,
    matterId: input.matterId,
    clientEntityId,
    currency: input.currency,
    applications: input.applications,
  });

  // The operating side of the transfer, resolved through the role map or refused by name. Trust does
  // not own the firm's chart of accounts and invents no numbering scheme, so these arrive from here —
  // and trust checks that neither of them turns out to belong to a trust account, which is what stops
  // a caller naming the trust bank leaf as the "operating" side and producing a self-dealing pair of
  // entries that balance.
  const accountRoles = await readAccountRoleMap(database);
  const operatingBankAccountId = resolveAccountRole(accountRoles, "operating_bank");
  const accountsReceivableAccountId = resolveAccountRole(accountRoles, "accounts_receivable");

  const transfer = await composeTrustToOperatingTransfer(
    database,
    {
      fromNodeId: leaf.id,
      amount: money(resolution.totalMinor, currencyFromCode(input.currency)),
      effectiveDate: input.effectiveDate,
      trustDescription: input.trustDescription,
      operatingDescription: input.operatingDescription,
      operatingBankAccountId,
      accountsReceivableAccountId,
      // Who assembled the application and who let the money go — distinct members when the firm's
      // policy requires a second person, the same member when it does not. A movement of client
      // money that does not say who let it go is a movement nobody can be asked about.
      recordedBy: input.appliedBy,
      authorizedBy: input.authorizedBy ?? input.appliedBy,
      approvedRequest: input.approvedRequest,
    },
    {
      ...options,
      // The port trust has been refusing every transfer through since it was built. This is the whole
      // of billing's contribution to the trust side, and it is why no trust file had to change.
      earnedFeePrecondition: invoiceBackedEarnedFeePrecondition(resolution),
    },
  );

  const statements: EffectStatement[] = [...transfer.effect.statements];
  const applicationIds: InvoiceApplicationId[] = [];
  for (const application of resolution.applications) {
    const composed = composeInvoiceApplication(
      database,
      {
        invoiceId: application.invoiceId,
        matterId: application.matterId,
        kind: "trust_transfer",
        amountMinor: application.amountMinor,
        currency: application.currency,
        effectiveDate: input.effectiveDate,
        trustTransferId: transfer.transferId,
        appliedBy: input.appliedBy,
      },
      options,
    );
    applicationIds.push(composed.applicationId);
    statements.push(...composed.effect.statements);
  }

  return {
    transferId: transfer.transferId,
    trustEntryId: transfer.trustEntryId,
    operatingEntryId: transfer.operatingEntryId,
    applicationIds,
    totalMinor: resolution.totalMinor,
    effect: {
      statements,
      outboxMessages: [
        ...transfer.effect.outboxMessages,
        {
          topic: TRUST_APPLIED_TOPIC,
          // Identifiers and non-privileged figures only. An outbox message is read by subscribers
          // that have no business knowing what the bill was for.
          payload: {
            transferId: transfer.transferId,
            matterId: input.matterId,
            clientEntityId,
            totalMinor: resolution.totalMinor,
            currency: input.currency,
            invoiceIds: resolution.applications.map((application) => application.invoiceId),
          },
          aggregateKey: BILLING_AGGREGATE_KEY,
        },
      ],
    },
  };
}

import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  LedgerAccountId,
  LedgerEntryId,
  MatterId,
  TrustAuthorizationPolicyId,
  TrustDisbursementRequestId,
  TrustLedgerNodeId,
  TrustTransferId,
  UserId,
} from "@magna-carta/identifiers/types";
import { postEntry } from "@magna-carta/ledger/post-entry";
import { currencyCode } from "@magna-carta/money/format";
import type { Money } from "@magna-carta/money/money";
import { assertTrustAccountOpen, loadTrustAccount, loadTrustNode } from "./account-tree.ts";
import type { TrustServiceOptions } from "./account-tree.ts";
import {
  assertActorHoldsTrustAuthority,
  loadTrustAuthorizationPolicy,
  readCurrentTrustAuthorizationPolicy,
  trustAuthorizationRequiresSecondPerson,
} from "./authorization-policy.ts";
import { composeTrustEntry, loadTrustAccountRoles } from "./composition-guard.ts";
import { readTrustAvailableBalance } from "./holds.ts";
import { assertMovementCurrency } from "./movements.ts";
import { insertTrustTransferStatement, selectActiveTrustManagersStatement } from "./statements.ts";
import { TrustValidationError } from "./trust-validation.ts";

// Moving earned fees out of trust is where most real-world trust violations happen, so the shape
// here is deliberate on three axes.
//
// TWO ENTRIES, NOT ONE. A trust disbursement and an operating receipt, linked by a shared transfer
// row. The two sides clear on different bank statements and reconciliation runs per account; a
// single entry spanning both banks would put an uncleared operating receipt inside a trust
// reconciliation and make the trust account's tie-out permanently wrong by the amount in flight.
// The link is a row, never a mutation of either entry.
//
// THE CEILING IS AVAILABLE, NOT BALANCE. A positive balance whose disputed portion is under hold is
// not money the firm may take.
//
// AND NOTHING TRANSFERS UNTIL THE EARNED-FEE PRECONDITION IS ANSWERED. Money may leave trust for the
// firm only once it has been earned, and what evidence of that the platform requires — a finalized
// invoice, or a warning with a recorded override — is a real product decision with consequences in
// both directions. Until it is made, the default port below REFUSES every transfer. That is the same
// posture the jurisdiction resolver takes: a rule we have not settled is not a rule we quietly
// invent, and the safe direction for an unsettled rule about taking client money is "no".

export interface EarnedFeeTransferContext {
  readonly nodeId: TrustLedgerNodeId;
  readonly matterId: MatterId | null;
  readonly amountMinor: number;
  readonly currency: string;
}

export interface EarnedFeePrecondition {
  assertTransferPermitted(context: EarnedFeeTransferContext): Promise<void>;
}

export const refusingEarnedFeePrecondition: EarnedFeePrecondition = {
  assertTransferPermitted(): Promise<void> {
    return Promise.reject(
      new TrustValidationError(
        "earned-fee-precondition-unavailable",
        "no earned-fee precondition is wired: what evidence permits money to leave trust is not settled, and the transfer is refused rather than guessed",
      ),
    );
  },
};

export interface TrustToOperatingTransferInput {
  readonly fromNodeId: TrustLedgerNodeId;
  readonly amount: Money;
  readonly effectiveDate: string; // YYYY-MM-DD civil date
  readonly trustDescription: string;
  readonly operatingDescription: string;
  // Resolved by the caller, never invented here: trust does not own the firm's chart of accounts and
  // must not guess at its shape. These are ordinary operating accounts and the guard below refuses
  // them if either turns out to belong to a trust account.
  readonly operatingBankAccountId: LedgerAccountId;
  readonly accountsReceivableAccountId: LedgerAccountId;
  // Who entered the record and who let the money go — the same two facts a movement keeps apart.
  // Distinct people when the governing policy requires a second person; the same person when it
  // does not, or when the firm genuinely has nobody else (the recorded lone-manager posture).
  readonly recordedBy: UserId;
  readonly authorizedBy: UserId;
  // Present when this transfer is the approval of a pending earned-fee application: the transfer is
  // then governed by the policy version STAMPED ON THAT REQUEST — the in-flight rule — and records
  // which request it came from. Absent on a directly composed transfer, which is governed by the
  // current policy.
  readonly approvedRequest?: {
    readonly id: TrustDisbursementRequestId;
    readonly policyId: TrustAuthorizationPolicyId | null;
  };
}

export interface TrustToOperatingTransferOptions extends TrustServiceOptions {
  readonly earnedFeePrecondition?: EarnedFeePrecondition;
}

export interface ComposedTrustTransfer {
  readonly transferId: TrustTransferId;
  readonly trustEntryId: LedgerEntryId;
  readonly operatingEntryId: LedgerEntryId;
  readonly effect: EffectWrite;
}

export async function composeTrustToOperatingTransfer(
  database: SqlDatabase,
  input: TrustToOperatingTransferInput,
  options: TrustToOperatingTransferOptions,
): Promise<ComposedTrustTransfer> {
  const node = await loadTrustNode(database, input.fromNodeId);
  const account = await loadTrustAccount(database, node.trustAccountId);
  assertTrustAccountOpen(account);

  const currency = currencyCode(input.amount);
  // The same guard every sibling composer runs, for the same reason: without it the availability
  // check below compares this amount's minor units against a balance denominated in the ACCOUNT's
  // currency, which is a comparison of two different things that happens to typecheck. The ledger's
  // per-line currency check would eventually refuse the posting, but by then the refusal names a
  // line rather than the movement, and the availability answer was already wrong.
  const amountMinor = assertMovementCurrency(account, input.amount);

  const precondition = options.earnedFeePrecondition ?? refusingEarnedFeePrecondition;
  await precondition.assertTransferPermitted({
    nodeId: node.id,
    matterId: node.matterId,
    amountMinor,
    currency,
  });

  // THE FIRM'S AUTHORIZATION POLICY, applied to the other way money leaves a client ledger — the
  // same predicate the disbursement approval runs, against the same policy rows, so the two paths
  // can never disagree about when a second person is required. A transfer approving a pending
  // application is governed by the version stamped on its request (the in-flight rule); a directly
  // composed transfer is governed by the current version. The triggers on trust_transfer hold all of
  // this at the database; these are the named refusals in front of them.
  const policy = input.approvedRequest
    ? await loadTrustAuthorizationPolicy(database, input.approvedRequest.policyId)
    : await readCurrentTrustAuthorizationPolicy(database);
  if (
    input.recordedBy === input.authorizedBy &&
    trustAuthorizationRequiresSecondPerson(policy, amountMinor)
  ) {
    // The same lone-manager posture the disbursement flow records: a firm with genuinely nobody
    // else is not locked out of taking its earned fees. The count mirrors the trigger, over-counting
    // lapsed grants deliberately — refusing the exception is the safe direction to be wrong in.
    const { results: managers } = await selectActiveTrustManagersStatement(database).all<{
      user_id: string;
      display_name: string;
    }>();
    if (managers.length > 1) {
      const others = managers
        .filter((manager) => manager.user_id !== input.authorizedBy)
        .map((manager) => `${manager.display_name} (${manager.user_id})`)
        .join(", ");
      throw new TrustValidationError(
        "transfer-requires-second-person",
        `this firm requires a second person to authorize money leaving a client ledger at this amount; submit it as a pending earned-fee application for one of these members to approve: ${others}`,
      );
    }
  }
  await assertActorHoldsTrustAuthority(database, policy, input.authorizedBy);

  const available = await readTrustAvailableBalance(database, input.fromNodeId);
  // The domain-level pre-check exists to turn a bounds-CHECK rollback into a named refusal a person
  // can act on. It is NOT the guarantee — the account_balance floor is, and it still fires on the
  // batch if a concurrent disbursement lands between this read and the commit.
  if (amountMinor > available.availableMinor) {
    throw new TrustValidationError(
      "transfer-exceeds-available",
      `a transfer of ${amountMinor} exceeds the ${available.availableMinor} available on this client ledger`,
    );
  }

  // The operating leg must be entirely outside trust. Without this, a caller could name the trust
  // bank leaf as the "operating" account and produce a self-dealing pair of entries that balance.
  const operatingRoles = await loadTrustAccountRoles(database, [
    input.operatingBankAccountId,
    input.accountsReceivableAccountId,
  ]);
  for (const accountId of [input.operatingBankAccountId, input.accountsReceivableAccountId]) {
    if (operatingRoles.get(accountId)?.kind !== "outside") {
      throw new TrustValidationError(
        "operating-side-is-trust-account",
        `${accountId} belongs to a trust account and cannot be the operating side of a transfer out of trust`,
      );
    }
  }

  // Leg one, through the guard: Dr the client's matter leaf, Cr the trust bank. The bounds CHECK on
  // the leaf is what makes an over-withdrawal impossible.
  const trustLeg = await composeTrustEntry(
    database,
    {
      description: input.trustDescription,
      effectiveDate: input.effectiveDate,
      lines: [
        { accountId: node.ledgerAccountId, direction: "debit", amount: input.amount },
        { accountId: account.bankLedgerAccountId, direction: "credit", amount: input.amount },
      ],
    },
    options,
  );

  // Leg two, an ordinary operating entry: Dr the operating bank, Cr accounts receivable.
  const operatingLeg = await postEntry(
    database,
    {
      description: input.operatingDescription,
      effectiveDate: input.effectiveDate,
      lines: [
        { accountId: input.operatingBankAccountId, direction: "debit", amount: input.amount },
        { accountId: input.accountsReceivableAccountId, direction: "credit", amount: input.amount },
      ],
    },
    options,
  );

  const transferId = newIdentifier("trustTransfer", options.randomSource);
  return {
    transferId,
    trustEntryId: trustLeg.entryId,
    operatingEntryId: operatingLeg.entryId,
    // One effect, so one batch: both legs and the link commit together or none of them do. A trust
    // disbursement that committed without its operating receipt would be client money that left the
    // trust account and arrived nowhere.
    effect: {
      statements: [
        ...trustLeg.effect.statements,
        ...operatingLeg.effect.statements,
        insertTrustTransferStatement(database, {
          id: transferId,
          trustAccountId: account.id,
          fromNodeId: node.id,
          amountMinor,
          currency,
          trustEntryId: trustLeg.entryId,
          operatingEntryId: operatingLeg.entryId,
          authorizedBy: input.authorizedBy,
          recordedBy: input.recordedBy,
          // The stamp the triggers verify: the governing version resolved above — the request's for
          // a queued approval, the current one for a direct composition.
          policyId: policy.id,
          approvedRequestId: input.approvedRequest?.id ?? null,
          effectiveDate: input.effectiveDate,
          recordedAt: options.clock.now(),
        }),
      ],
      outboxMessages: [...trustLeg.effect.outboxMessages, ...operatingLeg.effect.outboxMessages],
    },
  };
}

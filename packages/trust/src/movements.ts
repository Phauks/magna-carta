import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  LedgerAccountId,
  LedgerEntryId,
  MatterId,
  TrustAccountId,
  TrustLedgerNodeId,
  TrustMovementId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { PendingAccount } from "@magna-carta/ledger/types";
import { currencyCode, toMinor } from "@magna-carta/money/format";
import type { Money } from "@magna-carta/money/money";
import {
  assertTrustAccountOpen,
  ensureMatterTrustLeaf,
  loadTrustAccount,
  loadTrustNode,
  type TrustServiceOptions,
} from "./account-tree.ts";
import { composeTrustEntry } from "./composition-guard.ts";
import { readTrustAvailableBalance } from "./holds.ts";
import { requireTrustJurisdiction } from "./jurisdiction.ts";
import { insertTrustMovementStatement } from "./statements.ts";
import { TrustValidationError } from "./trust-validation.ts";
import type {
  TrustAccountRole,
  TrustAccountSnapshot,
  TrustLedgerNodeSnapshot,
  TrustMovementMethod,
} from "./types.ts";

// The three movements a firm makes inside a trust account: money in, money out, and a reallocation
// between two matters of one client. Each is an ordinary balanced ledger entry composed through the
// composition guard — nothing here reimplements a rule the guard owns — plus one trust_movement row
// carrying the facts the ledger has no column for and the record-keeping rules require: the source
// or the payee, the purpose, the method, the reference, and who authorized it.
//
// WHAT IS ENFORCED WHERE, so that a reader never has to guess which layer is load-bearing:
//
//   the account_balance floor       no client ledger goes negative, ever — the ONLY guarantee, and
//                                   it aborts the whole batch at commit
//   the composition guard           no commingling, no fee on a trust entry, one client per entry,
//                                   postings on matter leaves only
//   the trust_movement shape CHECK  a movement cannot misdescribe itself: an internal reallocation
//                                   claiming a bank method or an external payee, a bank movement
//                                   hiding as internal, money out with nobody named as authorizing it
//   this module                     the named refusals a person can act on, composed BEFORE the
//                                   batch so the failure reads as a sentence instead of a
//                                   constraint violation — never the guarantee itself

// Whether a jurisdiction forbids the method a disbursement proposes to use. Cash withdrawal, ATM or
// debit access, and a check payable to Cash are each banned in some jurisdictions and unaddressed in
// others, and a rule that was never researched must not resolve to "permitted" — so the port is the
// seam and the reference corpus is a separate stream (see jurisdiction.ts for why that stream
// refuses rather than falls back).
export interface TrustDisbursementMethodContext {
  readonly trustAccountId: TrustAccountId;
  readonly jurisdiction: string;
  readonly method: TrustMovementMethod;
}

export interface TrustDisbursementMethodPolicy {
  assertMethodPermitted(context: TrustDisbursementMethodContext): void;
}

// The default policy, and the one every caller gets until a reviewed corpus is bound. It permits
// every method, and that is a statement about this platform's knowledge, not about any
// jurisdiction's rules: no encoded restriction exists to apply. The method is recorded on every
// movement regardless, so binding the real policy later gates future disbursements without needing
// to reconstruct how past ones were paid.
export const unrestrictedTrustDisbursementMethods: TrustDisbursementMethodPolicy = {
  assertMethodPermitted(): void {},
};

export interface TrustMovementOptions extends TrustServiceOptions {
  readonly disbursementMethodPolicy?: TrustDisbursementMethodPolicy;
}

// Names the matter leaf a movement lands on, creating it if this is the client's first trust money
// on that matter. Lazy creation is why this is a descriptor rather than a node identifier: the
// majority of matters never hold client money and should never own an account, and the leaf's
// creation, its zero floor, and the first posting all belong in the ONE batch this composer returns.
export interface MatterTrustLeafReference {
  readonly clientEntityId: string;
  readonly matterId: MatterId;
  readonly clientNodeName: string;
  readonly matterLeafName: string;
}

export interface ComposedTrustMovement {
  readonly movementId: TrustMovementId;
  readonly entryId: LedgerEntryId;
  readonly nodeId: TrustLedgerNodeId;
  readonly counterpartyNodeId: TrustLedgerNodeId | null;
  readonly createdMatterLeaf: boolean;
  readonly effect: EffectWrite;
}

// Every movement resolves its trust account the same way and refuses on the same two facts before
// anything is composed: a closed account takes no activity, and an account whose office recorded no
// jurisdiction cannot be told which record-keeping and disbursement rules apply to it. That second
// refusal is deliberately distinct from "we have not encoded that jurisdiction" — the first is fixed
// by recording the office's state, the second by researching one.
async function resolveOpenTrustAccount(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<{ account: TrustAccountSnapshot; jurisdiction: string }> {
  const account = await loadTrustAccount(database, trustAccountId);
  assertTrustAccountOpen(account);
  return { account, jurisdiction: requireTrustJurisdiction(account) };
}

function assertMovementCurrency(account: TrustAccountSnapshot, amount: Money): number {
  const currency = currencyCode(amount);
  if (currency !== account.currency) {
    throw new TrustValidationError(
      "movement-currency-mismatch",
      `a ${currency} movement cannot post to a ${account.currency} trust account; a foreign-currency trust account is a separate account, never a converted entry`,
    );
  }
  return toMinor(amount);
}

function assertMatterLeaf(node: TrustLedgerNodeSnapshot): void {
  if (node.kind !== "matter") {
    throw new TrustValidationError(
      "movement-node-is-not-a-matter-leaf",
      `${node.id} is a ${node.kind} node; movements land on matter leaves, which are the only tier that carries a balance`,
    );
  }
}

// The domain-level ceiling read. It exists to turn a bounds-CHECK rollback into a refusal naming the
// money that is not there, and it is NOT the guarantee: the account_balance floor is, and it still
// fires on the batch if a concurrent movement lands between this read and the commit. The ceiling is
// AVAILABLE, not balance — a positive balance whose disputed portion is under hold is not money the
// firm may pay out.
async function assertWithinAvailable(
  database: SqlDatabase,
  nodeId: TrustLedgerNodeId,
  amountMinor: number,
): Promise<void> {
  const available = await readTrustAvailableBalance(database, nodeId);
  if (amountMinor > available.availableMinor) {
    throw new TrustValidationError(
      "movement-exceeds-available",
      `${amountMinor} exceeds the ${available.availableMinor} available on this client ledger (balance ${available.balanceMinor} less ${available.heldMinor} held)`,
    );
  }
}

// A leaf this batch is creating is invisible to both the ledger's account read and the trust role
// read, so both are told about it here, in one place, from the same facts.
function declarePendingLeaf(
  ledgerAccountId: LedgerAccountId,
  account: TrustAccountSnapshot,
  nodeId: TrustLedgerNodeId,
  reference: MatterTrustLeafReference,
): {
  pendingAccounts: Map<string, PendingAccount>;
  pendingRoles: Map<string, TrustAccountRole>;
} {
  return {
    pendingAccounts: new Map([
      [ledgerAccountId, { type: "liability" as const, currency: account.currency }],
    ]),
    pendingRoles: new Map<string, TrustAccountRole>([
      [
        ledgerAccountId,
        {
          kind: "matter",
          trustAccountId: account.id,
          nodeId,
          clientEntityId: reference.clientEntityId,
          matterId: reference.matterId,
        },
      ],
    ]),
  };
}

const mergeEffects = (...effects: readonly EffectWrite[]): EffectWrite => ({
  statements: effects.flatMap((effect) => [...effect.statements]),
  outboxMessages: effects.flatMap((effect) => [...effect.outboxMessages]),
});

export interface TrustDepositInput {
  readonly trustAccountId: TrustAccountId;
  readonly to: MatterTrustLeafReference;
  readonly amount: Money;
  readonly effectiveDate: string; // YYYY-MM-DD civil date
  readonly description: string;
  readonly method: TrustMovementMethod;
  readonly reference?: string | null; // check number, wire confirmation, deposit slip
  readonly source: string; // who the money came from — the rules' "source" column
  readonly purpose: string;
  readonly recordedBy: UserId;
  readonly authorizedBy?: UserId | null;
}

// Client money in: Dr the trust bank, Cr the client's matter leaf. The deposit lands GROSS — a
// processor or bank fee has nowhere to sit on this entry at all, because the composition guard
// refuses any line outside the trust account, so the fee is a separate operating entry by
// construction rather than by the caller choosing well.
//
// The leaf, its zero floor, and this posting commit in ONE batch. A leaf that existed for a batch
// without its floor would be a leaf that could be overdrawn in that batch.
export async function composeTrustDeposit(
  database: SqlDatabase,
  input: TrustDepositInput,
  options: TrustMovementOptions,
): Promise<ComposedTrustMovement> {
  const { account } = await resolveOpenTrustAccount(database, input.trustAccountId);
  const amountMinor = assertMovementCurrency(account, input.amount);

  const leaf = await ensureMatterTrustLeaf(
    database,
    { trustAccountId: account.id, ...input.to },
    options,
  );
  const pending = leaf.created
    ? declarePendingLeaf(leaf.ledgerAccountId, account, leaf.nodeId, input.to)
    : undefined;

  const posted = await composeTrustEntry(
    database,
    {
      description: input.description,
      effectiveDate: input.effectiveDate,
      lines: [
        { accountId: account.bankLedgerAccountId, direction: "debit", amount: input.amount },
        { accountId: leaf.ledgerAccountId, direction: "credit", amount: input.amount },
      ],
    },
    { ...options, pendingAccounts: pending?.pendingAccounts, pendingRoles: pending?.pendingRoles },
  );

  const movementId = newIdentifier("trustMovement", options.randomSource);
  return {
    movementId,
    entryId: posted.entryId,
    nodeId: leaf.nodeId,
    counterpartyNodeId: null,
    createdMatterLeaf: leaf.created,
    effect: mergeEffects(leaf.effect, posted.effect, {
      statements: [
        insertTrustMovementStatement(database, {
          id: movementId,
          trustAccountId: account.id,
          kind: "deposit",
          nodeId: leaf.nodeId,
          counterpartyNodeId: null,
          amountMinor,
          currency: account.currency,
          entryId: posted.entryId,
          method: input.method,
          reference: input.reference ?? null,
          counterpartyName: input.source,
          purpose: input.purpose,
          recordedBy: input.recordedBy,
          authorizedBy: input.authorizedBy ?? null,
          effectiveDate: input.effectiveDate,
          recordedAt: options.clock.now(),
        }),
      ],
      outboxMessages: [],
    }),
  };
}

export interface TrustDisbursementInput {
  readonly fromNodeId: TrustLedgerNodeId;
  readonly amount: Money;
  readonly effectiveDate: string; // YYYY-MM-DD civil date
  readonly description: string;
  readonly method: TrustMovementMethod;
  readonly reference?: string | null;
  readonly payee: string;
  readonly purpose: string;
  readonly recordedBy: UserId;
  // Not optional, and not defaulted to the recording user. Several jurisdictions require a written
  // memorandum authorizing each disbursement and identifying the responsible attorney; a field the
  // caller may omit is a field that is empty exactly when an examiner asks for it.
  readonly authorizedBy: UserId;
}

// Client money out: Dr the client's matter leaf, Cr the trust bank. The leaf must already exist —
// money cannot leave a ledger that holds none — and the amount is measured against AVAILABLE, not
// balance.
export async function composeTrustDisbursement(
  database: SqlDatabase,
  input: TrustDisbursementInput,
  options: TrustMovementOptions,
): Promise<ComposedTrustMovement> {
  const node = await loadTrustNode(database, input.fromNodeId);
  assertMatterLeaf(node);
  const { account, jurisdiction } = await resolveOpenTrustAccount(database, node.trustAccountId);
  const amountMinor = assertMovementCurrency(account, input.amount);

  const policy = options.disbursementMethodPolicy ?? unrestrictedTrustDisbursementMethods;
  policy.assertMethodPermitted({
    trustAccountId: account.id,
    jurisdiction,
    method: input.method,
  });

  await assertWithinAvailable(database, node.id, amountMinor);

  const posted = await composeTrustEntry(
    database,
    {
      description: input.description,
      effectiveDate: input.effectiveDate,
      lines: [
        { accountId: node.ledgerAccountId, direction: "debit", amount: input.amount },
        { accountId: account.bankLedgerAccountId, direction: "credit", amount: input.amount },
      ],
    },
    options,
  );

  const movementId = newIdentifier("trustMovement", options.randomSource);
  return {
    movementId,
    entryId: posted.entryId,
    nodeId: node.id,
    counterpartyNodeId: null,
    createdMatterLeaf: false,
    effect: mergeEffects(posted.effect, {
      statements: [
        insertTrustMovementStatement(database, {
          id: movementId,
          trustAccountId: account.id,
          kind: "disbursement",
          nodeId: node.id,
          counterpartyNodeId: null,
          amountMinor,
          currency: account.currency,
          entryId: posted.entryId,
          method: input.method,
          reference: input.reference ?? null,
          counterpartyName: input.payee,
          purpose: input.purpose,
          recordedBy: input.recordedBy,
          authorizedBy: input.authorizedBy,
          effectiveDate: input.effectiveDate,
          recordedAt: options.clock.now(),
        }),
      ],
      outboxMessages: [],
    }),
  };
}

export interface MatterToMatterTransferInput {
  readonly fromNodeId: TrustLedgerNodeId;
  readonly to: MatterTrustLeafReference;
  readonly amount: Money;
  readonly effectiveDate: string; // YYYY-MM-DD civil date
  readonly description: string;
  readonly purpose: string;
  readonly recordedBy: UserId;
  readonly authorizedBy: UserId;
}

// A reallocation between two matters of the SAME client: Dr the source leaf, Cr the destination
// leaf, and no bank line at all — because no bank movement happened. Posting an offsetting pair of
// bank lines instead would invent two items that would sit uncleared on every future reconciliation
// of that account.
//
// The destination is a descriptor rather than a node identifier so that moving funds onto a matter
// that has never held client money works without a preparatory step. It carries its own client
// identity rather than inheriting the source's, so a caller aiming at another client's matter is
// refused by the composition guard's one-client rule instead of silently re-attributing that
// matter's ledger to this client.
export async function composeMatterToMatterTransfer(
  database: SqlDatabase,
  input: MatterToMatterTransferInput,
  options: TrustMovementOptions,
): Promise<ComposedTrustMovement> {
  const from = await loadTrustNode(database, input.fromNodeId);
  assertMatterLeaf(from);
  const { account } = await resolveOpenTrustAccount(database, from.trustAccountId);
  const amountMinor = assertMovementCurrency(account, input.amount);

  if (from.matterId === input.to.matterId) {
    throw new TrustValidationError(
      "movement-transfer-to-same-node",
      "a transfer needs two different matters; moving funds from a matter to itself moves nothing",
    );
  }

  const to = await ensureMatterTrustLeaf(
    database,
    { trustAccountId: account.id, ...input.to },
    options,
  );
  // Reachable only through an identifier the caller resolved elsewhere: the matter identifiers
  // differ, so two distinct leaves under this account are guaranteed by the schema's per-account
  // matter uniqueness. Stated anyway, because the shape CHECK on the movement row refuses equal
  // ends and this refusal names the reason instead.
  if (to.nodeId === from.id) {
    throw new TrustValidationError(
      "movement-transfer-to-same-node",
      "the source and destination resolve to the same trust ledger node",
    );
  }

  await assertWithinAvailable(database, from.id, amountMinor);

  const pending = to.created
    ? declarePendingLeaf(to.ledgerAccountId, account, to.nodeId, input.to)
    : undefined;

  const posted = await composeTrustEntry(
    database,
    {
      description: input.description,
      effectiveDate: input.effectiveDate,
      lines: [
        { accountId: from.ledgerAccountId, direction: "debit", amount: input.amount },
        { accountId: to.ledgerAccountId, direction: "credit", amount: input.amount },
      ],
    },
    { ...options, pendingAccounts: pending?.pendingAccounts, pendingRoles: pending?.pendingRoles },
  );

  const movementId = newIdentifier("trustMovement", options.randomSource);
  return {
    movementId,
    entryId: posted.entryId,
    nodeId: from.id,
    counterpartyNodeId: to.nodeId,
    createdMatterLeaf: to.created,
    effect: mergeEffects(to.effect, posted.effect, {
      statements: [
        insertTrustMovementStatement(database, {
          id: movementId,
          trustAccountId: account.id,
          kind: "matter_transfer",
          nodeId: from.id,
          counterpartyNodeId: to.nodeId,
          amountMinor,
          currency: account.currency,
          entryId: posted.entryId,
          method: "internal",
          reference: null,
          counterpartyName: null,
          purpose: input.purpose,
          recordedBy: input.recordedBy,
          authorizedBy: input.authorizedBy,
          effectiveDate: input.effectiveDate,
          recordedAt: options.clock.now(),
        }),
      ],
      outboxMessages: [],
    }),
  };
}

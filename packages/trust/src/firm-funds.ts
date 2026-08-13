import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  LedgerEntryId,
  TrustAccountId,
  TrustFirmFundsMovementId,
  TrustLedgerNodeId,
  UserId,
} from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import { setAccountBoundsStatement } from "@magna-carta/ledger/statements";
import { currencyCode, toMinor } from "@magna-carta/money/format";
import type { Money } from "@magna-carta/money/money";
import {
  assertTrustAccountOpen,
  loadTrustAccount,
  TRUST_LEAF_MINIMUM_BALANCE_MINOR,
  type TrustServiceOptions,
} from "./account-tree.ts";
import { composeTrustFirmFundsEntry } from "./composition-guard.ts";
import { requireTrustJurisdiction } from "./jurisdiction.ts";
import {
  insertTrustFirmFundsMovementStatement,
  insertTrustLedgerNodeStatement,
  selectTrustFirmFundsNodeStatement,
  selectTrustNodeStoredBalanceStatement,
} from "./statements.ts";
import { TrustValidationError } from "./trust-validation.ts";
import type {
  TrustAccountSnapshot,
  TrustFirmFundsMovementMethod,
  TrustFirmFundsPosition,
  TrustLedgerNodeSnapshot,
} from "./types.ts";

// THE BANK-CHARGE CARVE-OUT, WIRED NARROWLY.
//
// A trust bank account is charged by its institution: a monthly maintenance fee, a per-item charge,
// a wire fee. That money leaves the account with no client-attributable authorization behind it —
// nobody at the firm released it — and it must not be borne by client funds. The
// professional-conduct answer, in materially the same words across every researched jurisdiction, is
// that the lawyer may deposit the lawyer's OWN funds in the trust account for the sole purpose of
// paying those charges, and only in the amount necessary for that purpose.
//
// Everything in this file exists to make "sole purpose" a property of the structure rather than a
// note in a manual. Five mechanisms, in the order they bind:
//
//   1. THE CATEGORY IS CLOSED AND CANNOT NAME A CLIENT. `trust_firm_funds_movement` has no node,
//      matter, client, or payee column. A row of it cannot describe a movement of somebody else's
//      money, whatever a caller intends.
//   2. THE ENTRY GOES THROUGH A NARROWER DOOR. composeTrustFirmFundsEntry admits exactly the
//      firm-funds node paired with this account's bank leaf; composeTrustEntry — the door client
//      money goes through — still refuses a firm-funds line outright, unchanged.
//   3. THE CUSHION IS FLOORED AT ZERO by the same account_balance bounds CHECK that floors a client
//      leaf. A charge larger than the firm's own money in the account would drive the node negative
//      and the whole batch aborts, so a charge can never reach client funds. That is the rule
//      "charges are not borne by client funds", enforced by the database rather than by a comparison
//      somebody could forget.
//   4. THE CARVE-OUT IS OFF UNTIL A FIRM DELIBERATELY OPENS IT, per trust account, through a
//      distinct capability. No account acquires a firm-funds node by drifting into one.
//   5. THE PROOF LEARNS ABOUT IT. The firm's cushion is a separate leg of the three-way proof and is
//      never folded into the client total — see three-way-proof.ts.
//
// WHAT IS DELIBERATELY NOT HERE. There is no composer that pays anybody out of a trust account:
// paying a person is a disbursement, and it goes through the disbursement queue with its
// authorization. There is no withdrawal of surplus firm funds either — the rule text authorizes the
// deposit and is silent on taking it back out, and inventing that movement is not something a
// permissive rule supports. A firm that has over-funded its cushion spends it down on charges.

// The one node kind whose stored balance is the firm's own money. Named here rather than inline so
// the two places that care — the opener and the position read — cannot drift.
const FIRM_FUNDS_NODE_KIND = "firm_funds" as const;

interface TrustNodeRow {
  id: string;
  trust_account_id: string;
  ledger_account_id: string;
  kind: "client" | "matter" | "firm_funds";
  client_entity_id: string | null;
  matter_id: string | null;
  parent_node_id: string | null;
}

interface BalanceRow {
  balance_minor: number;
}

function toFirmFundsNode(row: TrustNodeRow): TrustLedgerNodeSnapshot {
  return {
    id: row.id as TrustLedgerNodeId,
    trustAccountId: row.trust_account_id as TrustAccountId,
    ledgerAccountId: row.ledger_account_id as TrustLedgerNodeSnapshot["ledgerAccountId"],
    kind: FIRM_FUNDS_NODE_KIND,
    clientEntityId: null,
    matterId: null,
    parentNodeId: null,
  };
}

// The firm-funds node of one trust account, or null when the carve-out was never opened there. Null
// is the ordinary answer: most accounts never open one, and every path below treats it as a refusal
// rather than as a reason to create one.
export async function loadTrustFirmFundsNode(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<TrustLedgerNodeSnapshot | null> {
  const { results } = await selectTrustFirmFundsNodeStatement(
    database,
    trustAccountId,
  ).all<TrustNodeRow>();
  const row = results[0];
  return row ? toFirmFundsNode(row) : null;
}

async function requireTrustFirmFundsNode(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<TrustLedgerNodeSnapshot> {
  const node = await loadTrustFirmFundsNode(database, trustAccountId);
  if (node === null) {
    throw new TrustValidationError(
      "firm-funds-node-not-open",
      `trust account ${trustAccountId} keeps none of the firm's own funds: open the bank-charge carve-out on it before recording a charge against it`,
    );
  }
  return node;
}

export interface OpenTrustFirmFundsNodeInput {
  readonly trustAccountId: TrustAccountId;
  readonly nodeName: string;
}

export interface OpenedTrustFirmFundsNode {
  readonly nodeId: TrustLedgerNodeId;
  readonly ledgerAccountId: TrustLedgerNodeSnapshot["ledgerAccountId"];
  readonly effect: EffectWrite;
}

// ENABLING THE CARVE-OUT ON ONE ACCOUNT — a deliberate act, refused twice over.
//
// It is refused on a POOLED INTEREST-BEARING account. The pooled account a jurisdiction compels for
// nominal or short-term client funds is the account most firms hold, and the researched corpus
// records it as exempt from service charges by rule. Where an account bears no charges there is no
// amount necessary to pay them, so there is no permitted deposit — and firm money sitting in a
// pooled client account with no permitted purpose is bare commingling. A firm whose non-pooled
// account genuinely bears charges records the account as such and opens the carve-out there. This
// errs toward refusal in every case where the platform cannot tell, which is the only direction it
// is safe to err in.
//
// The node hangs off NO PARENT, which is what keeps it out of the client roll-up: it is not a tier
// of the client tree, it is the firm's own balance inside the same bank account. Its zero floor is
// written in the SAME batch that creates it, exactly as a matter leaf's is — a cushion that could go
// negative would be a cushion that lets a charge reach client money.
export async function openTrustFirmFundsNode(
  database: SqlDatabase,
  input: OpenTrustFirmFundsNodeInput,
  options: TrustServiceOptions,
): Promise<OpenedTrustFirmFundsNode> {
  const account = await loadTrustAccount(database, input.trustAccountId);
  assertTrustAccountOpen(account);
  // Same refusal every movement earns: an account whose office recorded no jurisdiction cannot be
  // told which rules govern what the firm is about to do inside it.
  requireTrustJurisdiction(account);

  if (account.iolta) {
    throw new TrustValidationError(
      "firm-funds-account-is-pooled-interest-bearing",
      `trust account ${account.id} is recorded as the pooled interest-bearing kind, which the researched rules exempt from service charges: there is no charge for the firm's own funds to pay, so keeping firm money in it would be commingling with no permitted purpose`,
    );
  }

  const existing = await loadTrustFirmFundsNode(database, account.id);
  if (existing !== null) {
    throw new TrustValidationError(
      "firm-funds-node-already-open",
      `trust account ${account.id} already keeps the firm's own funds under node ${existing.id}; there is one such balance per account by design`,
    );
  }

  const createdAt = options.clock.now();
  const ledgerAccount = await createAccount(
    database,
    {
      name: input.nodeName,
      type: "liability",
      currency: account.currency,
    },
    options,
  );
  const nodeId = newIdentifier("trustLedgerNode", options.randomSource);
  return {
    nodeId,
    ledgerAccountId: ledgerAccount.accountId,
    effect: {
      statements: [
        ...ledgerAccount.effect.statements,
        setAccountBoundsStatement(
          database,
          ledgerAccount.accountId,
          TRUST_LEAF_MINIMUM_BALANCE_MINOR,
          null,
          createdAt,
        ),
        insertTrustLedgerNodeStatement(database, {
          id: nodeId,
          trustAccountId: account.id,
          ledgerAccountId: ledgerAccount.accountId,
          kind: FIRM_FUNDS_NODE_KIND,
          clientEntityId: null,
          matterId: null,
          parentNodeId: null,
          createdAt,
        }),
      ],
      outboxMessages: [...ledgerAccount.effect.outboxMessages],
    },
  };
}

// What is left of the firm's cushion in one account. Read from `account_balance` deliberately: this
// is a live "can the next charge be borne" question, not an as-of assertion, and the as-of figure
// the reconciliation needs is computed from dated rows by a different statement.
export async function readTrustFirmFundsPosition(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<TrustFirmFundsPosition | null> {
  const account = await loadTrustAccount(database, trustAccountId);
  const node = await loadTrustFirmFundsNode(database, trustAccountId);
  if (node === null) return null;
  const { results } = await selectTrustNodeStoredBalanceStatement(
    database,
    node.ledgerAccountId,
  ).all<BalanceRow>();
  return {
    trustAccountId: account.id,
    nodeId: node.id,
    ledgerAccountId: node.ledgerAccountId,
    balanceMinor: results[0]?.balance_minor ?? 0,
    currency: account.currency,
  };
}

export interface ComposedTrustFirmFundsMovement {
  readonly firmFundsMovementId: TrustFirmFundsMovementId;
  readonly entryId: LedgerEntryId;
  readonly nodeId: TrustLedgerNodeId;
  readonly effect: EffectWrite;
}

interface FirmFundsMovementShape {
  readonly amount: Money;
  readonly effectiveDate: string;
  readonly description: string;
  readonly reference?: string | null;
  readonly recordedBy: UserId;
}

export interface TrustFirmFundsDepositInput extends FirmFundsMovementShape {
  readonly trustAccountId: TrustAccountId;
  // Every method except `bank_debit`: the firm putting its own cushion in is an act the firm
  // performs, never one the institution performs against it.
  readonly method: Exclude<TrustFirmFundsMovementMethod, "bank_debit">;
}

export interface TrustBankChargeInput extends FirmFundsMovementShape {
  readonly trustAccountId: TrustAccountId;
}

function assertFirmFundsCurrency(account: TrustAccountSnapshot, amount: Money): number {
  const currency = currencyCode(amount);
  if (currency !== account.currency) {
    throw new TrustValidationError(
      "movement-currency-mismatch",
      `a ${currency} movement cannot post to a ${account.currency} trust account; a foreign-currency trust account is a separate account, never a converted entry`,
    );
  }
  return toMinor(amount);
}

async function resolveOpenTrustAccountForFirmFunds(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<TrustAccountSnapshot> {
  const account = await loadTrustAccount(database, trustAccountId);
  assertTrustAccountOpen(account);
  requireTrustJurisdiction(account);
  return account;
}

// THE FIRM'S OWN MONEY IN: Dr the trust bank, Cr the firm-funds node. Two lines, and the narrower
// door refuses any third. This is the deposit the rule permits and the only way the cushion is
// funded.
export async function composeTrustFirmFundsDeposit(
  database: SqlDatabase,
  input: TrustFirmFundsDepositInput,
  options: TrustServiceOptions,
): Promise<ComposedTrustFirmFundsMovement> {
  const account = await resolveOpenTrustAccountForFirmFunds(database, input.trustAccountId);
  const amountMinor = assertFirmFundsCurrency(account, input.amount);
  const node = await requireTrustFirmFundsNode(database, account.id);

  const posted = await composeTrustFirmFundsEntry(
    database,
    {
      description: input.description,
      effectiveDate: input.effectiveDate,
      lines: [
        { accountId: account.bankLedgerAccountId, direction: "debit", amount: input.amount },
        { accountId: node.ledgerAccountId, direction: "credit", amount: input.amount },
      ],
    },
    node.id,
    options,
  );

  const recorded = recordFirmFundsMovement(database, {
    account,
    posted,
    kind: "firm_funds_deposit",
    method: input.method,
    amountMinor,
    input,
    options,
  });
  return {
    firmFundsMovementId: recorded.movementId,
    entryId: posted.entryId,
    nodeId: node.id,
    effect: recorded.effect,
  };
}

// THE BANK TAKING ITS CHARGE: Dr the firm-funds node, Cr the trust bank. The cushion falls and the
// bank balance falls with it, so the three-way proof still ties: book equals client plus firm funds
// on both sides of the movement.
//
// A charge larger than the cushion is REFUSED — named here, and aborted by the node's zero floor at
// commit if a concurrent movement lands in between. That refusal is the rule "charges must not be
// borne by client funds" doing its work, and the remedy it names is the real-world one: the firm
// restores its own funds in the account and then records the charge. The bank statement line sits
// unmatched until it does, and the reconciliation reports the resulting difference — which is the
// honest state, not a gap the platform papers over.
export async function composeTrustBankCharge(
  database: SqlDatabase,
  input: TrustBankChargeInput,
  options: TrustServiceOptions,
): Promise<ComposedTrustFirmFundsMovement> {
  const account = await resolveOpenTrustAccountForFirmFunds(database, input.trustAccountId);
  const amountMinor = assertFirmFundsCurrency(account, input.amount);
  const node = await requireTrustFirmFundsNode(database, account.id);

  const position = await readTrustFirmFundsPosition(database, account.id);
  const cushionMinor = position?.balanceMinor ?? 0;
  if (amountMinor > cushionMinor) {
    throw new TrustValidationError(
      "bank-charge-exceeds-firm-funds",
      `a ${amountMinor} charge is more than the ${cushionMinor} of the firm's own funds in this trust account: a bank charge is never borne by client money, so deposit the firm's funds to cover it and then record the charge`,
    );
  }

  const posted = await composeTrustFirmFundsEntry(
    database,
    {
      description: input.description,
      effectiveDate: input.effectiveDate,
      lines: [
        { accountId: node.ledgerAccountId, direction: "debit", amount: input.amount },
        { accountId: account.bankLedgerAccountId, direction: "credit", amount: input.amount },
      ],
    },
    node.id,
    options,
  );

  const recorded = recordFirmFundsMovement(database, {
    account,
    posted,
    kind: "bank_charge",
    method: "bank_debit",
    amountMinor,
    input,
    options,
  });
  return {
    firmFundsMovementId: recorded.movementId,
    entryId: posted.entryId,
    nodeId: node.id,
    effect: recorded.effect,
  };
}

// The record beside the entry, composed once for both directions so the two cannot drift in what
// they store.
function recordFirmFundsMovement(
  database: SqlDatabase,
  context: {
    account: TrustAccountSnapshot;
    posted: { entryId: LedgerEntryId; effect: EffectWrite };
    kind: "firm_funds_deposit" | "bank_charge";
    method: TrustFirmFundsMovementMethod;
    amountMinor: number;
    input: FirmFundsMovementShape;
    options: TrustServiceOptions;
  },
): { movementId: TrustFirmFundsMovementId; effect: EffectWrite } {
  const movementId = newIdentifier("trustFirmFundsMovement", context.options.randomSource);
  return {
    movementId,
    effect: {
      statements: [
        ...context.posted.effect.statements,
        insertTrustFirmFundsMovementStatement(database, {
          id: movementId,
          trustAccountId: context.account.id,
          kind: context.kind,
          amountMinor: context.amountMinor,
          currency: context.account.currency,
          entryId: context.posted.entryId,
          method: context.method,
          reference: context.input.reference ?? null,
          description: context.input.description,
          recordedBy: context.input.recordedBy,
          effectiveDate: context.input.effectiveDate,
          recordedAt: context.options.clock.now(),
        }),
      ],
      outboxMessages: [...context.posted.effect.outboxMessages],
    },
  };
}

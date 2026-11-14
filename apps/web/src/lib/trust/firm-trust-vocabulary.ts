/*
 * The words the firm's Trust screen uses, and the small judgments behind them.
 *
 * AN ACCOUNT'S STANDING IS NOT IN THE PLATFORM'S STATUS REGISTER, and that is deliberate rather
 * than an oversight. The register's `closed` says "the work has ended; the record stays, and can
 * still take entries against it", which is true of a matter and false of a bank account: a closed
 * trust account takes nothing at all, and telling a reader otherwise about client money is the one
 * place being loosely right has consequences. So the two words are given their label, their tone
 * and their meaning here, in one place, and a surface takes all three from these functions rather
 * than deciding any of them at the call site. Moving them into the shared register is a design-
 * system change with its own meanings to write, not something a screen may do on its way past.
 *
 * MONEY IS CONVERTED IN EXACTLY ONE PLACE ON THIS SURFACE. `trustMoneyText` is the only function
 * here that touches minor units, so the whole screen changes its mind about how an amount reads by
 * changing one line. How many minor units make a major unit is a property of the CURRENCY and this
 * function cannot see one, which is why the division is a debt rather than a detail.
 *
 * WHAT IT WAITS ON IS A FORMATTER THAT TAKES MINOR UNITS, not a package. @magna-carta/money is
 * reachable from here now and holds the amount exactly; what it cannot do is print one, because
 * printing is the design system's
 * (packages/design-system/src/lib/formatters/money.ts), and that formatter is contracted to take a
 * number in the currency's MAJOR unit. Going through the package to satisfy it would mean turning
 * an exact Money back into a float, which is worse than the division it would replace. So the one
 * conversion stands, on its own line, until the design system offers a minor-unit formatter — and
 * then it is a single edit.
 *
 * NOTHING HERE READS A RECORD APART. These are words, not judgments about what a reader may do:
 * who can act on a request, and what a posture means, live in firm-trust-model.ts.
 */
import { formatDate, formatDateRange, formatMoney } from "@magna-carta/design-system/formatters";
import type { BadgeVariant } from "@magna-carta/design-system/badge";
import type {
  TrustAccountListing,
  TrustBankStatement,
  TrustFirmFundsMovementKind,
  TrustReconciliation,
  TrustRequestKind,
} from "./trust-api.ts";

/** An amount of money, in the words a reader reads it in. The one conversion on this surface. */
export function trustMoneyText(amountMinor: number, currency: string): string {
  return formatMoney(amountMinor / 100, { currency });
}

// ---- an account -------------------------------------------------------------------------------

/** What an account's standing is called. */
export function accountStandingLabel(status: TrustAccountListing["status"]): string {
  return status === "open" ? "Open" : "Closed";
}

/** The tone that standing wears. Calm on a register: a chip, never a wash across the rows. */
export function accountStandingTone(status: TrustAccountListing["status"]): BadgeVariant {
  return status === "open" ? "success" : "neutral";
}

/** What the standing MEANS, on the hover. */
export function accountStandingMeaning(status: TrustAccountListing["status"]): string {
  return status === "open"
    ? "Held at the institution and able to take movements."
    : "Closed at the bank. Nothing more can go through it; its history stays on record.";
}

/** What a jurisdiction cell reads where the holding office recorded none. */
export const JURISDICTION_NOT_RECORDED = "Not recorded";

/** Why that matters, on the hover: it is a refusal waiting to happen, not a cosmetic blank. */
export const JURISDICTION_NOT_RECORDED_MEANING =
  "The holding office records no jurisdiction, so movements on this account are refused until it does.";

/** Whether the account is a pooled interest-bearing one, in the column's two words. */
export function ioltaLabel(iolta: boolean): string {
  return iolta ? "Yes" : "No";
}

/** What the IOLTA column is asking, on the hover. */
export const IOLTA_MEANING =
  "A pooled interest-bearing account: interest on pooled client funds goes to the state's legal aid program, not to the firm or any one client.";

// ---- the approval queue -----------------------------------------------------------------------

/** What a queued request IS, in the reader's words. */
export function requestKindLabel(kind: TrustRequestKind): string {
  return kind === "disbursement" ? "Payment Out" : "Earned Fees";
}

/** What that kind means, on the hover. */
export function requestKindMeaning(kind: TrustRequestKind): string {
  return kind === "disbursement"
    ? "Client money leaving a matter's ledger to a payee."
    : "Fees the firm has earned on a finalized bill, taken out of the client's trust ledger.";
}

/** What the queue says when nobody is waiting on anybody. */
export const QUEUE_EMPTY = "Nothing is waiting.";

/**
 * What the Matter row says on a request that stands against no matter.
 *
 * The queue is read per account, and an account's ledger tree holds nodes that are not matter
 * leaves — the firm's own bank-charge cushion is one. A request against one of those has no matter
 * to open, which is a fact about the record rather than something missing from it.
 */
export const REQUEST_NOT_A_MATTER_LEDGER =
  "This request stands against a ledger that belongs to no matter, so there is no matter to open.";

// ---- statements and reconciliations ------------------------------------------------------------

/** The period a statement covers, as one reading. */
export function statementPeriodText(statement: TrustBankStatement): string {
  return formatDateRange(statement.periodStart, statement.periodEnd);
}

/** How the statement reached the platform. */
export function statementSourceLabel(source: TrustBankStatement["source"]): string {
  return source === "entered" ? "Entered by hand" : "Imported";
}

/** What a reconciliation's standing is called. */
export function reconciliationStandingLabel(status: TrustReconciliation["status"]): string {
  return status === "open" ? "Open" : "Closed";
}

/** What a closed reconciliation attested to, in one word. */
export function balancedLabel(balanced: boolean): string {
  return balanced ? "Balanced" : "Did not balance";
}

/** What "balanced" meant at the moment of closing, which is not what is true now. */
export const FROZEN_PROOF_MEANING =
  "The three-way proof as it stood when the period was closed: what the firm attested to then, not what is true now.";

/*
 * What the panel's two "recorded" lists say when the account has none.
 *
 * ONE GRAMMAR FOR BOTH, and the same one the queue's own empty line uses ("Nothing is waiting."):
 * the present tense states what the record HOLDS, where the perfect tense states something about
 * its history that these reads do not actually know.
 */

/** What the reconciliations list says when the account has none. */
export const NO_RECONCILIATIONS = "No reconciliation is recorded.";

/** What the statements list says when the account has none. */
export const NO_STATEMENTS = "No statement is recorded.";

// ---- the firm's own money in a trust account ----------------------------------------------------

/** What a cushion movement is called. */
export function cushionMovementLabel(kind: TrustFirmFundsMovementKind): string {
  return kind === "firm_funds_deposit" ? "Firm funds in" : "Bank charge";
}

/** What the section says on an account where the carve-out was never opened. */
export const CUSHION_NOT_OPENED = "The cushion is not open on this account.";

/** What the cushion's movement list says when the carve-out is open and nothing has moved. */
export const NO_CUSHION_MOVEMENTS = "Nothing has moved through the cushion.";

// ---- days ----------------------------------------------------------------------------------------

/** A day, as this surface prints one. */
export function dayText(civilDate: string): string {
  return formatDate(civilDate);
}

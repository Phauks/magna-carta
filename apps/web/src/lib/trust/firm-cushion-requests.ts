/*
 * What the three cushion panels put on the wire, worked out away from the panels.
 *
 * THE CUSHION IS THE ONE PLACE THE FIRM'S OWN MONEY MAY SIT IN A CLIENT TRUST ACCOUNT, and it is
 * there to bear the institution's service charges and nothing else. Every refusal here is written
 * with that in mind: a figure that cannot be sent is refused on this side, with the reason, rather
 * than being sent for the server to refuse — on the one ledger where a reader must never press a
 * control and then find out what it did.
 *
 * WHAT IS NOT REFUSED HERE IS AS DELIBERATE. A charge larger than the cushion is the server's
 * refusal, not this file's: the cushion's balance moves under the reader — another member's top-up,
 * another charge posted a second ago — and a ceiling worked out in a browser would either refuse a
 * charge the account can bear or let one through that it cannot. The panel shows the server's own
 * `detail`, which names the remedy, because a bank charge is never borne by client money.
 *
 * THE AMOUNT IS READ BY THE ONE PARSER THE MONEY SURFACES SHARE ($lib/billing/amount-entry.ts):
 * digits in, whole cents out, never a float.
 *
 * IT IS PURE, so the bodies these panels compose can be asserted without a browser. A request shape
 * that only exists inside a component is a request shape nothing can check, and the defect it hides
 * — a field left out, an amount in the wrong units — is invisible until a firm's books are wrong.
 * Its sibling is trust-write-requests.ts, which does the same job for the movements of CLIENT
 * money; the two are separate because what they refuse is different.
 */
import { readAmountMinor } from "$lib/billing/amount-entry.ts";
import type {
  TrustBankChargeRequest,
  TrustFirmFundsDepositMethod,
  TrustFirmFundsDepositRequest,
} from "./trust-api.ts";
import type { TrustRequestReading } from "./trust-write-requests.ts";

/** What the firm's own carve-out is called where nobody names it something else. */
export const DEFAULT_CUSHION_NODE_NAME = "Bank-charge cushion";

/** The methods the firm's own money may arrive by. Cash and card are not among them on this path. */
export const TRUST_FIRM_FUNDS_DEPOSIT_METHODS: readonly TrustFirmFundsDepositMethod[] = [
  "check",
  "wire",
  "electronic_transfer",
];

/** The empty string an optional box is left at means the field was not answered, not "". */
function orNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** An amount of the firm's own money, refused where it is not one. */
function readCushionAmountMinor(amountText: string): TrustRequestReading<number> {
  const reading = readAmountMinor(amountText);
  if (reading.kind === "empty") return { kind: "refused", reason: "Say how much money moved." };
  if (reading.kind === "refused") return { kind: "refused", reason: reading.reason };
  if (reading.minor === 0) {
    return { kind: "refused", reason: "An amount of nothing moves nothing. Enter what moved." };
  }
  return { kind: "request", request: reading.minor };
}

// ---- opening the carve-out -----------------------------------------------------------------------

/** What the opening panel holds: the account, and what the firm calls the carve-out. */
export interface TrustCushionOpeningEntry {
  readonly trustAccountId: string;
  readonly nodeName: string;
}

/** What opening the carve-out sends. */
export interface TrustCushionOpening {
  readonly trustAccountId: string;
  readonly nodeName: string;
}

export function readTrustCushionOpening(
  entry: TrustCushionOpeningEntry,
): TrustRequestReading<TrustCushionOpening> {
  if (entry.trustAccountId === "") {
    return { kind: "refused", reason: "Choose the account the cushion is opened on." };
  }
  if (entry.nodeName.trim() === "") {
    return { kind: "refused", reason: "Name the cushion, so the ledger reads as something." };
  }
  return {
    kind: "request",
    request: { trustAccountId: entry.trustAccountId, nodeName: entry.nodeName.trim() },
  };
}

// ---- the firm's own money going in -----------------------------------------------------------------

/** What the funding panel holds while it is being filled in. */
export interface TrustCushionDepositEntry {
  readonly trustAccountId: string;
  readonly amountText: string;
  readonly effectiveDate: string;
  readonly method: TrustFirmFundsDepositMethod;
  readonly reference: string;
  readonly description: string;
}

export function readTrustCushionDepositRequest(
  entry: TrustCushionDepositEntry,
): TrustRequestReading<TrustFirmFundsDepositRequest> {
  const amount = readCushionAmountMinor(entry.amountText);
  if (amount.kind === "refused") return amount;
  if (entry.effectiveDate === "") {
    return { kind: "refused", reason: "Say which day the money reached the account." };
  }
  if (entry.description.trim() === "") {
    return { kind: "refused", reason: "Say why the firm's own money is going in." };
  }
  return {
    kind: "request",
    request: {
      trustAccountId: entry.trustAccountId,
      amountMinor: amount.request,
      currency: "USD",
      effectiveDate: entry.effectiveDate,
      description: entry.description.trim(),
      reference: orNull(entry.reference),
      method: entry.method,
    },
  };
}

// ---- the institution taking a service charge ---------------------------------------------------

/**
 * What the charge panel holds. There is no method: the institution debits the account, so the means
 * is the bank's own and the server records it as such rather than asking somebody to choose one.
 */
export interface TrustBankChargeEntry {
  readonly trustAccountId: string;
  readonly amountText: string;
  readonly effectiveDate: string;
  readonly reference: string;
  readonly description: string;
}

export function readTrustBankChargeRequest(
  entry: TrustBankChargeEntry,
): TrustRequestReading<TrustBankChargeRequest> {
  const amount = readCushionAmountMinor(entry.amountText);
  if (amount.kind === "refused") return amount;
  if (entry.effectiveDate === "") {
    return { kind: "refused", reason: "Say which day the institution took the charge." };
  }
  if (entry.description.trim() === "") {
    return { kind: "refused", reason: "Say what the institution charged for." };
  }
  return {
    kind: "request",
    request: {
      trustAccountId: entry.trustAccountId,
      amountMinor: amount.request,
      currency: "USD",
      effectiveDate: entry.effectiveDate,
      description: entry.description.trim(),
      reference: orNull(entry.reference),
    },
  };
}

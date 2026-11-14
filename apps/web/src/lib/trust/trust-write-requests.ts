/*
 * What the three trust panels actually put on the wire, worked out away from the panels.
 *
 * EVERY REFUSAL IS THE CLIENT'S OWN, AND IT SAYS WHICH FIELD IS WRONG. A commit that cannot succeed
 * stands disabled with the reason rather than being sent for the server to refuse, because client
 * money is the one ledger where a reader must never press a control and then find out. So each
 * reading answers either the request to send or the one sentence to show, and the panels hold no
 * validation of their own.
 *
 * THE ENTRY LINE IS THE PURPOSE, AND NOBODY IS ASKED FOR IT TWICE. The contract carries both a
 * `description` and a `purpose`, and the ledger read serves the purpose alone — so a description
 * somebody wrote by hand was a field the reader could never read back, on the one surface where a
 * value nobody can check is worst. The panels ask why the money moved and this file writes that
 * answer into both.
 *
 * THE AMOUNT IS READ BY THE ONE PARSER THE MONEY SURFACES SHARE ($lib/billing/amount-entry.ts):
 * digits in, whole cents out, never a float. What is trust's own is the CEILING — a payment out
 * cannot exceed what the matter's ledger has available, and the sentence that refuses it names the
 * figure rather than leaving the reader to discover it.
 *
 * IT IS PURE, so the bodies these panels compose can be asserted without a browser. A request shape
 * that only exists inside a component is a request shape nothing can check, and the defect it hides
 * — a field left out, an amount in the wrong units — is invisible until a firm's books are wrong.
 */
import {
  isResolvableTimeZone,
  viewerTimeZone,
  zonedReading,
} from "@magna-carta/civil-time/time-zone";
import { readAmountMinor } from "$lib/billing/amount-entry.ts";
import type { Problem } from "$lib/api/problem.ts";
import type {
  TrustBankMovementMethod,
  TrustDepositRequest,
  TrustDisbursementProposal,
  TrustEligibleApprover,
  TrustMatterTransferRequest,
  TrustPendingRequest,
} from "./trust-api.ts";

/** Either the request to send, or the one sentence that says why nothing can be sent yet. */
export type TrustRequestReading<Request> =
  | { readonly kind: "request"; readonly request: Request }
  | { readonly kind: "refused"; readonly reason: string };

/** The day a trust write defaults to: today where the account is held, not where the reader sits. */
export function defaultEffectiveDate(timeZone: string, now: number = Date.now()): string {
  const zone = isResolvableTimeZone(timeZone) ? timeZone : viewerTimeZone();
  return zonedReading(now, zone).civilDate;
}

/** The empty string a form leaves in an optional box means the field was not answered, not "". */
function orNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The amount a movement moves, refused where it is not one.
 *
 * `ceilingMinor` is null on a deposit — money coming in has no ceiling the screen can know — and is
 * the ledger's available figure on a payment out or a transfer, where exceeding it is refused here
 * with the figure named so nobody has to press to find out.
 */
function readMovementAmountMinor(
  amountText: string,
  ceilingMinor: number | null,
  ceilingText: string,
): TrustRequestReading<number> {
  const reading = readAmountMinor(amountText);
  if (reading.kind === "empty") return { kind: "refused", reason: "Say how much money moved." };
  if (reading.kind === "refused") return { kind: "refused", reason: reading.reason };
  if (reading.minor === 0) {
    return { kind: "refused", reason: "An amount of nothing moves nothing. Enter what moved." };
  }
  if (ceilingMinor !== null && reading.minor > ceilingMinor) {
    return {
      kind: "refused",
      reason: `More than this matter's trust ledger has available, which is ${ceilingText}.`,
    };
  }
  return { kind: "request", request: reading.minor };
}

// ---- a deposit -----------------------------------------------------------------------------------

/** What the deposit panel holds while it is being filled in. */
export interface TrustDepositEntry {
  readonly trustAccountId: string;
  readonly matterId: string;
  readonly amountText: string;
  readonly effectiveDate: string;
  readonly method: TrustBankMovementMethod;
  readonly reference: string;
  /** Who the money came from. */
  readonly source: string;
  readonly purpose: string;
}

export function readTrustDepositRequest(
  entry: TrustDepositEntry,
): TrustRequestReading<TrustDepositRequest> {
  const amount = readMovementAmountMinor(entry.amountText, null, "");
  if (amount.kind === "refused") return amount;
  if (entry.effectiveDate === "") {
    return { kind: "refused", reason: "Say which day the money reached the account." };
  }
  if (entry.source.trim() === "") {
    return { kind: "refused", reason: "Say who the money came from." };
  }
  if (entry.purpose.trim() === "") {
    return { kind: "refused", reason: "Say why the client's money was received." };
  }
  return {
    kind: "request",
    request: {
      trustAccountId: entry.trustAccountId,
      matterId: entry.matterId,
      amountMinor: amount.request,
      currency: "USD",
      effectiveDate: entry.effectiveDate,
      description: entry.purpose.trim(),
      method: entry.method,
      reference: orNull(entry.reference),
      source: entry.source.trim(),
      purpose: entry.purpose.trim(),
    },
  };
}

// ---- a payment out -------------------------------------------------------------------------------

/** What the payment-out panel holds, plus the ceiling the matter's ledger puts on it. */
export interface TrustDisbursementEntry {
  readonly trustAccountId: string;
  readonly matterId: string;
  readonly amountText: string;
  readonly effectiveDate: string;
  readonly method: TrustBankMovementMethod;
  readonly reference: string;
  /** Who is paid. */
  readonly payee: string;
  readonly purpose: string;
  /** What the ledger says may leave: the balance less anything under a hold. */
  readonly availableMinor: number;
  /** That figure as the reader sees it written, for the sentence that refuses more than it. */
  readonly availableText: string;
}

export function readTrustDisbursementProposal(
  entry: TrustDisbursementEntry,
): TrustRequestReading<TrustDisbursementProposal> {
  const amount = readMovementAmountMinor(
    entry.amountText,
    entry.availableMinor,
    entry.availableText,
  );
  if (amount.kind === "refused") return amount;
  if (entry.effectiveDate === "") {
    return { kind: "refused", reason: "Say which day the money leaves the account." };
  }
  if (entry.payee.trim() === "") return { kind: "refused", reason: "Say who is being paid." };
  if (entry.purpose.trim() === "") {
    return { kind: "refused", reason: "Say why the client's money is being paid out." };
  }
  return {
    kind: "request",
    request: {
      trustAccountId: entry.trustAccountId,
      matterId: entry.matterId,
      amountMinor: amount.request,
      currency: "USD",
      effectiveDate: entry.effectiveDate,
      description: entry.purpose.trim(),
      method: entry.method,
      reference: orNull(entry.reference),
      payee: entry.payee.trim(),
      purpose: entry.purpose.trim(),
    },
  };
}

// ---- a transfer between two of one client's matters ----------------------------------------------

/**
 * What the transfer panel holds. There is no method and no reference: nothing leaves the bank, so
 * there is no bank movement to name — the server records the movement's method as internal itself.
 */
export interface TrustMatterTransferEntry {
  readonly trustAccountId: string;
  readonly fromMatterId: string;
  readonly toMatterId: string | null;
  readonly amountText: string;
  readonly effectiveDate: string;
  readonly purpose: string;
  readonly availableMinor: number;
  readonly availableText: string;
}

export function readTrustMatterTransferRequest(
  entry: TrustMatterTransferEntry,
): TrustRequestReading<TrustMatterTransferRequest> {
  const amount = readMovementAmountMinor(
    entry.amountText,
    entry.availableMinor,
    entry.availableText,
  );
  if (amount.kind === "refused") return amount;
  if (entry.toMatterId === null) {
    return { kind: "refused", reason: "Choose the matter the money moves to." };
  }
  if (entry.toMatterId === entry.fromMatterId) {
    return {
      kind: "refused",
      reason: "A transfer moves money between two matters. Choose a different one.",
    };
  }
  if (entry.effectiveDate === "") {
    return { kind: "refused", reason: "Say which day the money moves." };
  }
  if (entry.purpose.trim() === "") {
    return { kind: "refused", reason: "Say why the client's money is moving." };
  }
  return {
    kind: "request",
    request: {
      trustAccountId: entry.trustAccountId,
      fromMatterId: entry.fromMatterId,
      toMatterId: entry.toMatterId,
      amountMinor: amount.request,
      currency: "USD",
      effectiveDate: entry.effectiveDate,
      description: entry.purpose.trim(),
      purpose: entry.purpose.trim(),
    },
  };
}

// ---- what comes back -----------------------------------------------------------------------------

/**
 * The pending requests that are THIS MATTER'S.
 *
 * The queue is read per ACCOUNT, because that is the queue an approving member works from, so every
 * matter sharing the account is on it. A matter's own section shows only the requests standing
 * against its own ledger node — and a matter with no ledger yet has no node, and therefore none.
 */
export function pendingRequestsOnLedger(
  requests: readonly TrustPendingRequest[],
  trustLedgerNodeId: string | null,
): readonly TrustPendingRequest[] {
  if (trustLedgerNodeId === null) return [];
  return requests.filter((request) => request.trustLedgerNodeId === trustLedgerNodeId);
}

/** Several names, read as a person would say them. */
function namesJoined(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0] ?? ""} and ${names[1] ?? ""}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

/**
 * What a proposal that did not release comes to, in one sentence.
 *
 * The server names who can settle it where it knows; where the list is empty the honest thing is
 * still a sentence about what happens next, rather than a request that appears to be waiting on
 * nobody.
 */
export function proposalPendingSentence(approvers: readonly TrustEligibleApprover[]): string {
  const names = approvers.map((approver) => approver.displayName).filter((name) => name !== "");
  if (names.length === 0) {
    return "Proposed. Waiting for someone with authority to release client money.";
  }
  return `Proposed. Waiting on ${namesJoined(names)}.`;
}

/**
 * The server's own words about one field of a refused write, where it named that field.
 *
 * A validation problem carries the path the contract spells, so a refusal about the payee can be
 * shown under the payee rather than as one sentence at the top of the panel that the reader then
 * has to map onto a box.
 */
export function fieldRefusal(problem: Problem | null, path: string): string | undefined {
  return problem?.errors?.find((error) => error.path === path)?.detail;
}

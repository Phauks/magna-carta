/*
 * What the trust panels actually put on the wire, and what they refuse before they send anything.
 *
 * These assert the REQUEST, not the resolution. A call that resolves proves the stub answered; it
 * proves nothing about what went out, and on this surface what goes out is a real movement of a
 * client's money. Two things are worth more here than anywhere else in the product:
 *
 *   - EVERY AMOUNT IS WHOLE MINOR UNITS. A body carrying a major-unit figure would move a hundredth
 *     of what somebody typed, silently and correctly.
 *   - EVERY WRITE CARRIES ITS IDEMPOTENCY KEY. These routes refuse a call without one outright, so
 *     a missing header is not a degraded write, it is no write at all — and a retried deposit that
 *     posted twice would be a second real movement.
 */
import { describe, expect, it } from "vitest";
import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import {
  listPendingTrustRequests,
  recordTrustDeposit,
  proposeTrustDisbursement,
  transferTrustBetweenMatters,
  type TrustPendingRequest,
} from "../src/lib/trust/trust-api.ts";
import {
  defaultEffectiveDate,
  fieldRefusal,
  pendingRequestsOnLedger,
  proposalPendingSentence,
  readTrustDepositRequest,
  readTrustDisbursementProposal,
  readTrustMatterTransferRequest,
} from "../src/lib/trust/trust-write-requests.ts";
import { IDEMPOTENCY_HEADER, recordRequests } from "./time-request-recorder.ts";

const ACCOUNT = "trust_bay";
const MATTER = "matter_pemberton";

const DEPOSIT = {
  trustAccountId: ACCOUNT,
  matterId: MATTER,
  amountText: "2,500.00",
  effectiveDate: "2026-09-18",
  method: "check" as const,
  reference: "  0041  ",
  source: " Pemberton Holdings ",
  purpose: "Retainer",
  description: "Retainer received",
};

const PAYMENT_OUT = {
  trustAccountId: ACCOUNT,
  matterId: MATTER,
  amountText: "1,200.50",
  effectiveDate: "2026-09-18",
  method: "wire" as const,
  reference: "",
  payee: "Superior Court of California",
  purpose: "Filing fee",
  description: "Filing fee paid from trust",
  availableMinor: 250_000,
  availableText: "$2,500.00",
};

const TRANSFER = {
  trustAccountId: ACCOUNT,
  fromMatterId: MATTER,
  toMatterId: "matter_pemberton_appeal",
  amountText: "500",
  effectiveDate: "2026-09-18",
  purpose: "Moved to the appeal",
  description: "Balance moved to the appeal",
  availableMinor: 250_000,
  availableText: "$2,500.00",
};

describe("the body a deposit composes", () => {
  it("reads the amount as whole cents and trims what was typed around it", () => {
    const reading = readTrustDepositRequest(DEPOSIT);
    expect(reading).toEqual({
      kind: "request",
      request: {
        trustAccountId: ACCOUNT,
        matterId: MATTER,
        amountMinor: 250_000,
        currency: "USD",
        effectiveDate: "2026-09-18",
        description: "Retainer received",
        method: "check",
        reference: "0041",
        source: "Pemberton Holdings",
        purpose: "Retainer",
      },
    });
  });

  it("sends a reference nobody filled in as null rather than as an empty string", () => {
    const reading = readTrustDepositRequest({ ...DEPOSIT, reference: "   " });
    expect(reading.kind === "request" && reading.request.reference).toBeNull();
  });

  it("refuses each missing fact in its own words, so a control can say which", () => {
    expect(readTrustDepositRequest({ ...DEPOSIT, amountText: "" })).toEqual({
      kind: "refused",
      reason: "Say how much money moved.",
    });
    expect(readTrustDepositRequest({ ...DEPOSIT, amountText: "0" })).toEqual({
      kind: "refused",
      reason: "An amount of nothing moves nothing. Enter what moved.",
    });
    expect(readTrustDepositRequest({ ...DEPOSIT, source: " " })).toEqual({
      kind: "refused",
      reason: "Say who the money came from.",
    });
    expect(readTrustDepositRequest({ ...DEPOSIT, purpose: "" })).toEqual({
      kind: "refused",
      reason: "Say why the client's money was received.",
    });
  });

  it("has no ceiling: money coming in is not bounded by what the ledger holds", () => {
    const reading = readTrustDepositRequest({ ...DEPOSIT, amountText: "9000000" });
    expect(reading.kind).toBe("request");
  });

  it("carries its idempotency key to the deposits route", async () => {
    const recorder = recordRequests({ trustMovementId: "trust_movement_1" });
    const reading = readTrustDepositRequest(DEPOSIT);
    if (reading.kind !== "request") throw new Error("the deposit was refused");
    await recordTrustDeposit(recorder.fetch, reading.request, "key-deposit");
    const call = recorder.onlyCall();
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/api/v1/trust/deposits");
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-deposit");
    expect(call.body).toEqual(reading.request);
  });
});

describe("the body a payment out composes", () => {
  it("names the payee and the method the money left by", () => {
    const reading = readTrustDisbursementProposal(PAYMENT_OUT);
    expect(reading).toEqual({
      kind: "request",
      request: {
        trustAccountId: ACCOUNT,
        matterId: MATTER,
        amountMinor: 120_050,
        currency: "USD",
        effectiveDate: "2026-09-18",
        description: "Filing fee paid from trust",
        method: "wire",
        reference: null,
        payee: "Superior Court of California",
        purpose: "Filing fee",
      },
    });
  });

  it("refuses more than the ledger has available, with the figure named", () => {
    const reading = readTrustDisbursementProposal({ ...PAYMENT_OUT, amountText: "2500.01" });
    expect(reading).toEqual({
      kind: "refused",
      reason: "More than this matter's trust ledger has available, which is $2,500.00.",
    });
  });

  it("allows exactly what is available: the ceiling is a ceiling, not a limit below it", () => {
    const reading = readTrustDisbursementProposal({ ...PAYMENT_OUT, amountText: "2500.00" });
    expect(reading.kind === "request" && reading.request.amountMinor).toBe(250_000);
  });

  it("refuses everything against a ledger holding nothing", () => {
    const reading = readTrustDisbursementProposal({
      ...PAYMENT_OUT,
      availableMinor: 0,
      availableText: "$0.00",
    });
    expect(reading).toEqual({
      kind: "refused",
      reason: "More than this matter's trust ledger has available, which is $0.00.",
    });
  });

  it("refuses a payment to nobody", () => {
    expect(readTrustDisbursementProposal({ ...PAYMENT_OUT, payee: "  " })).toEqual({
      kind: "refused",
      reason: "Say who is being paid.",
    });
  });

  it("carries its idempotency key to the disbursement-requests route", async () => {
    const recorder = recordRequests({ trustDisbursementRequestId: "trust_request_1" });
    const reading = readTrustDisbursementProposal(PAYMENT_OUT);
    if (reading.kind !== "request") throw new Error("the payment out was refused");
    await proposeTrustDisbursement(recorder.fetch, reading.request, "key-payment");
    const call = recorder.onlyCall();
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/api/v1/trust/disbursement-requests");
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-payment");
    expect(call.body).toEqual(reading.request);
  });
});

describe("the body a transfer between two matters composes", () => {
  it("states no method and no reference: nothing left the bank", () => {
    const reading = readTrustMatterTransferRequest(TRANSFER);
    expect(reading).toEqual({
      kind: "request",
      request: {
        trustAccountId: ACCOUNT,
        fromMatterId: MATTER,
        toMatterId: "matter_pemberton_appeal",
        amountMinor: 50_000,
        currency: "USD",
        effectiveDate: "2026-09-18",
        description: "Balance moved to the appeal",
        purpose: "Moved to the appeal",
      },
    });
  });

  it("refuses a transfer with no destination, and one back onto this matter", () => {
    expect(readTrustMatterTransferRequest({ ...TRANSFER, toMatterId: null })).toEqual({
      kind: "refused",
      reason: "Choose the matter the money moves to.",
    });
    expect(readTrustMatterTransferRequest({ ...TRANSFER, toMatterId: MATTER })).toEqual({
      kind: "refused",
      reason: "A transfer moves money between two matters. Choose a different one.",
    });
  });

  it("is bounded by the same available figure a payment out is", () => {
    const reading = readTrustMatterTransferRequest({ ...TRANSFER, amountText: "2500.01" });
    expect(reading).toEqual({
      kind: "refused",
      reason: "More than this matter's trust ledger has available, which is $2,500.00.",
    });
  });

  it("carries its idempotency key to the matter-transfers route", async () => {
    const recorder = recordRequests({ trustMovementId: "trust_movement_2" });
    const reading = readTrustMatterTransferRequest(TRANSFER);
    if (reading.kind !== "request") throw new Error("the transfer was refused");
    await transferTrustBetweenMatters(recorder.fetch, reading.request, "key-transfer");
    const call = recorder.onlyCall();
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/api/v1/trust/matter-transfers");
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-transfer");
    expect(call.body).toEqual(reading.request);
  });
});

function pendingRequest(id: string, node: string): TrustPendingRequest {
  return {
    id,
    kind: "disbursement",
    trustLedgerNodeId: node,
    amountMinor: 45_000,
    currency: "USD",
    method: "check",
    reference: null,
    payee: "Reporter",
    purpose: "Transcript",
    description: "Transcript",
    effectiveDate: "2026-09-18",
    requestedBy: "user_avery",
    requestedAt: "2026-09-18T15:04:00.000Z",
  };
}

describe("the requests waiting on a decision", () => {
  it("is read per ACCOUNT, so the matter keeps only the ones on its own ledger node", () => {
    const queue = [
      pendingRequest("request_one", "node_pemberton"),
      pendingRequest("request_two", "node_someone_else"),
      pendingRequest("request_three", "node_pemberton"),
    ];
    expect(pendingRequestsOnLedger(queue, "node_pemberton").map((one) => one.id)).toEqual([
      "request_one",
      "request_three",
    ]);
  });

  it("keeps none for a matter that holds no ledger yet: it has no node to match", () => {
    expect(
      pendingRequestsOnLedger([pendingRequest("request_one", "node_pemberton")], null),
    ).toEqual([]);
  });

  it("asks the queue route for one account", async () => {
    const recorder = recordRequests({ requests: [] });
    await listPendingTrustRequests(recorder.fetch, ACCOUNT);
    const call = recorder.onlyCall();
    expect(call.method).toBe("GET");
    expect(call.path).toBe(`/api/v1/trust/disbursement-requests?trustAccountId=${ACCOUNT}`);
  });
});

describe("what a proposal that did not release says", () => {
  it("names who can settle it", () => {
    expect(proposalPendingSentence([{ userId: "user_avery", displayName: "Avery Nkemdi" }])).toBe(
      "Proposed. Waiting on Avery Nkemdi.",
    );
    expect(
      proposalPendingSentence([
        { userId: "user_avery", displayName: "Avery Nkemdi" },
        { userId: "user_ben", displayName: "Ben Ortiz" },
      ]),
    ).toBe("Proposed. Waiting on Avery Nkemdi and Ben Ortiz.");
    expect(
      proposalPendingSentence([
        { userId: "user_avery", displayName: "Avery Nkemdi" },
        { userId: "user_ben", displayName: "Ben Ortiz" },
        { userId: "user_cai", displayName: "Cai Duong" },
      ]),
    ).toBe("Proposed. Waiting on Avery Nkemdi, Ben Ortiz and Cai Duong.");
  });

  it("still says what happens next where the server named nobody", () => {
    expect(proposalPendingSentence([])).toBe(
      "Proposed. Waiting on a member who holds the authority to release client money.",
    );
  });
});

describe("the small readings the panels share", () => {
  it("defaults the effective date to today where the ACCOUNT is held", () => {
    // 2026-09-19T04:30Z is still the 18th in Los Angeles: a reader in London must not record a
    // deposit into a California account as having landed the next day.
    const instant = Date.parse("2026-09-19T04:30:00.000Z");
    expect(defaultEffectiveDate("America/Los_Angeles", instant)).toBe("2026-09-18");
    expect(defaultEffectiveDate("Europe/London", instant)).toBe("2026-09-19");
  });

  it("falls back to the reader's own zone where the account's will not resolve", () => {
    const instant = Date.parse("2026-09-19T12:00:00.000Z");
    expect(isCivilDate(defaultEffectiveDate("Not/AZone", instant))).toBe(true);
  });

  it("finds the server's own words for one refused field, and nothing where it named none", () => {
    const problem = {
      status: 422,
      errors: [{ path: "payee", code: "required", detail: "A payee is required." }],
    };
    expect(fieldRefusal(problem, "payee")).toBe("A payee is required.");
    expect(fieldRefusal(problem, "amountMinor")).toBeUndefined();
    expect(fieldRefusal(null, "payee")).toBeUndefined();
  });
});

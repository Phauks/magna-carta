/*
 * What the unclaimed-funds panels put on the wire, and what they refuse before they send anything.
 *
 * These assert the REQUEST, not the resolution. A call that resolves proves the stub answered; it
 * proves nothing about what went out, and on this path what goes out is the firm's account of what
 * it did to find the owner of money it is holding. Three things are worth more here than the
 * resolution:
 *
 *   - EVERY WRITE CARRIES ITS IDEMPOTENCY KEY. These routes refuse a call without one outright, so
 *     a missing header is not a degraded write but no write at all — and an attempt recorded twice
 *     is a diligence record claiming two letters where one went out.
 *   - A FIELD THE CHOSEN KIND DOES NOT TAKE IS DROPPED, never sent. Somebody types an address, then
 *     changes the channel to a review of the firm's own records; the file must record the attempt
 *     they ended on rather than the one they started composing. The same holds for the movement a
 *     closure names when the outcome stops being a distribution.
 *   - NOTHING HERE MOVES MONEY. A closure carries an outcome, an identifier and a note: no amount,
 *     no payee, no day, no method. A body growing any of those is the defect these pin against.
 */
import { describe, expect, it } from "vitest";
import {
  closeTrustUnclaimedFundsReview,
  openTrustUnclaimedFundsReview,
  readDormantTrustBalances,
  recordTrustContactAttempt,
  type TrustDormantBalance,
} from "../src/lib/trust/trust-api.ts";
import {
  contactUsedIsRequired,
  dormantBalancesInOrder,
  readTrustContactAttemptEntry,
  readTrustUnclaimedFundsClosure,
  readTrustUnclaimedFundsReviewOpening,
  trustMovementIsRequired,
} from "../src/lib/trust/unclaimed-funds-requests.ts";
import { IDEMPOTENCY_HEADER, recordRequests } from "./time-request-recorder.ts";

const ACCOUNT = "trust_bay";
const MATTER = "matter_pemberton";
const REVIEW = "trust_unclaimed_review_7";

const OPENING = {
  trustAccountId: ACCOUNT,
  matterId: MATTER,
  observedBalanceMinor: 412_000,
  observedEarliestReceiptDate: "2019-03-04",
  observedLastActivityDate: "2021-11-30",
  note: "  Client's last known address returned undeliverable.  ",
};

const ATTEMPT = {
  channel: "certified_mail" as const,
  attemptedOn: "2026-09-18",
  contactUsed: "  14 Windermere Road, Oakland CA 94610  ",
  outcome: "undeliverable" as const,
  note: "  Returned by the carrier.  ",
};

const CLOSURE = {
  outcome: "distributed_to_owner" as const,
  trustMovementId: "  trust_movement_44  ",
  note: "  Paid on the authorized disbursement.  ",
};

/** A quiet ledger as the read serves one, with only the fields a case actually varies named over it. */
function dormant(fields: Partial<TrustDormantBalance>): TrustDormantBalance {
  return {
    trustLedgerNodeId: "node_1",
    matterId: MATTER,
    clientEntityId: "entity_1",
    balanceMinor: 100_000,
    currency: "USD",
    earliestReceiptDate: "2020-01-01",
    lastActivityDate: "2020-06-01",
    openReviewId: null,
    ...fields,
  };
}

describe("the order the quiet ledgers are worked in", () => {
  it("puts the oldest receipt first, because the rules' clocks run from receipt", () => {
    const ordered = dormantBalancesInOrder([
      dormant({ trustLedgerNodeId: "later", earliestReceiptDate: "2022-05-09" }),
      dormant({ trustLedgerNodeId: "oldest", earliestReceiptDate: "2017-01-30" }),
      dormant({ trustLedgerNodeId: "middle", earliestReceiptDate: "2019-08-02" }),
    ]);
    expect(ordered.map((balance) => balance.trustLedgerNodeId)).toEqual([
      "oldest",
      "middle",
      "later",
    ]);
  });

  it("puts a ledger with no receipt date last rather than first", () => {
    // It cannot be placed on the clock at all, and at the top it would read as the most urgent
    // thing on the list.
    const ordered = dormantBalancesInOrder([
      dormant({ trustLedgerNodeId: "unknown", earliestReceiptDate: null }),
      dormant({ trustLedgerNodeId: "dated", earliestReceiptDate: "2023-02-02" }),
    ]);
    expect(ordered.map((balance) => balance.trustLedgerNodeId)).toEqual(["dated", "unknown"]);
  });

  it("breaks a tie on the larger balance, and then on the node, so the order is stable", () => {
    const ordered = dormantBalancesInOrder([
      dormant({ trustLedgerNodeId: "b", balanceMinor: 5_000 }),
      dormant({ trustLedgerNodeId: "a", balanceMinor: 5_000 }),
      dormant({ trustLedgerNodeId: "c", balanceMinor: 90_000 }),
    ]);
    expect(ordered.map((balance) => balance.trustLedgerNodeId)).toEqual(["c", "a", "b"]);
  });

  it("leaves what it was given alone", () => {
    const given = [
      dormant({ trustLedgerNodeId: "b", earliestReceiptDate: "2024-01-01" }),
      dormant({ trustLedgerNodeId: "a", earliestReceiptDate: "2018-01-01" }),
    ];
    dormantBalancesInOrder(given);
    expect(given.map((balance) => balance.trustLedgerNodeId)).toEqual(["b", "a"]);
  });
});

describe("the body opening a file composes", () => {
  it("sends the observation exactly as the read served it, and trims the note", () => {
    expect(readTrustUnclaimedFundsReviewOpening(OPENING)).toEqual({
      kind: "request",
      request: {
        trustAccountId: ACCOUNT,
        matterId: MATTER,
        observedBalanceMinor: 412_000,
        observedEarliestReceiptDate: "2019-03-04",
        observedLastActivityDate: "2021-11-30",
        note: "Client's last known address returned undeliverable.",
      },
    });
  });

  it("sends a note nobody wrote as null rather than as an empty string", () => {
    const reading = readTrustUnclaimedFundsReviewOpening({ ...OPENING, note: "   " });
    expect(reading.kind === "request" && reading.request.note).toBeNull();
  });

  it("carries a date the read did not hold through as null rather than inventing one", () => {
    const reading = readTrustUnclaimedFundsReviewOpening({
      ...OPENING,
      observedEarliestReceiptDate: null,
      observedLastActivityDate: null,
    });
    expect(reading.kind === "request" && reading.request.observedEarliestReceiptDate).toBeNull();
    expect(reading.kind === "request" && reading.request.observedLastActivityDate).toBeNull();
  });

  it("refuses a ledger holding nothing, in words that say why there is nothing to do", () => {
    expect(readTrustUnclaimedFundsReviewOpening({ ...OPENING, observedBalanceMinor: 0 })).toEqual({
      kind: "refused",
      reason: "This ledger holds nothing, so there is nothing to look for an owner for.",
    });
  });

  it("refuses when no ledger is chosen", () => {
    expect(readTrustUnclaimedFundsReviewOpening({ ...OPENING, matterId: "" })).toEqual({
      kind: "refused",
      reason: "Choose the ledger this file is opened over.",
    });
  });

  it("carries its idempotency key to the reviews route", async () => {
    const recorder = recordRequests({ trustUnclaimedFundsReviewId: REVIEW });
    const reading = readTrustUnclaimedFundsReviewOpening(OPENING);
    if (reading.kind !== "request") throw new Error("the opening was refused");
    await openTrustUnclaimedFundsReview(recorder.fetch, reading.request, "key-open");
    const call = recorder.onlyCall();
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/api/v1/trust/unclaimed-funds/reviews");
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-open");
    expect(call.body).toEqual(reading.request);
  });
});

describe("the body one attempt composes", () => {
  it("names the channel, the day, what was used and what came of it", () => {
    expect(readTrustContactAttemptEntry(ATTEMPT)).toEqual({
      kind: "request",
      request: {
        channel: "certified_mail",
        attemptedOn: "2026-09-18",
        contactUsed: "14 Windermere Road, Oakland CA 94610",
        outcome: "undeliverable",
        note: "Returned by the carrier.",
      },
    });
  });

  it("asks for a contact on every channel but a review of the firm's own records", () => {
    expect(contactUsedIsRequired("regular_mail")).toBe(true);
    expect(contactUsedIsRequired("certified_mail")).toBe(true);
    expect(contactUsedIsRequired("telephone")).toBe(true);
    expect(contactUsedIsRequired("email")).toBe(true);
    expect(contactUsedIsRequired("other")).toBe(true);
    expect(contactUsedIsRequired("record_review")).toBe(false);
  });

  it("refuses an attempt with nothing to say what it used", () => {
    expect(readTrustContactAttemptEntry({ ...ATTEMPT, contactUsed: "  " })).toEqual({
      kind: "refused",
      reason: "Say the address or the number the attempt used.",
    });
  });

  it("drops a contact typed before the channel became a review of the firm's own records", () => {
    const reading = readTrustContactAttemptEntry({ ...ATTEMPT, channel: "record_review" });
    expect(reading.kind === "request" && reading.request.contactUsed).toBeNull();
  });

  it("refuses an attempt with no day", () => {
    expect(readTrustContactAttemptEntry({ ...ATTEMPT, attemptedOn: "" })).toEqual({
      kind: "refused",
      reason: "Say which day the attempt was made.",
    });
  });

  it("carries its idempotency key to the file's own contact-attempts route", async () => {
    const recorder = recordRequests({ trustUnclaimedFundsContactAttemptId: "attempt_1" });
    const reading = readTrustContactAttemptEntry(ATTEMPT);
    if (reading.kind !== "request") throw new Error("the attempt was refused");
    await recordTrustContactAttempt(recorder.fetch, REVIEW, reading.request, "key-attempt");
    const call = recorder.onlyCall();
    expect(call.method).toBe("POST");
    expect(call.path).toBe(`/api/v1/trust/unclaimed-funds/reviews/${REVIEW}/contact-attempts`);
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-attempt");
    expect(call.body).toEqual(reading.request);
  });
});

describe("the body closing a round composes", () => {
  it("attaches a payment that already posted, and carries no amount, payee, day or method", () => {
    const reading = readTrustUnclaimedFundsClosure(CLOSURE);
    expect(reading).toEqual({
      kind: "request",
      request: {
        outcome: "distributed_to_owner",
        trustMovementId: "trust_movement_44",
        note: "Paid on the authorized disbursement.",
      },
    });
    if (reading.kind !== "request") throw new Error("the closure was refused");
    expect(Object.keys(reading.request).sort()).toEqual(["note", "outcome", "trustMovementId"]);
  });

  it("asks for a movement on a distribution and on nothing else", () => {
    expect(trustMovementIsRequired("distributed_to_owner")).toBe(true);
    expect(trustMovementIsRequired("resolved_without_distribution")).toBe(false);
    expect(trustMovementIsRequired("not_dormant")).toBe(false);
    expect(trustMovementIsRequired("search_continues")).toBe(false);
  });

  it("refuses a distribution that names no movement, and says what closing does not do", () => {
    expect(readTrustUnclaimedFundsClosure({ ...CLOSURE, trustMovementId: " " })).toEqual({
      kind: "refused",
      reason:
        "Choose the trust movement that paid the owner. Closing attaches a payment that already posted; it moves nothing.",
    });
  });

  it("drops a movement typed before the outcome stopped being a distribution", () => {
    const reading = readTrustUnclaimedFundsClosure({ ...CLOSURE, outcome: "not_dormant" });
    expect(reading.kind === "request" && reading.request.trustMovementId).toBeNull();
  });

  it("carries its idempotency key to the file's own closure route", async () => {
    const recorder = recordRequests({
      trustUnclaimedFundsReviewClosureId: "closure_1",
      outcome: "distributed_to_owner",
    });
    const reading = readTrustUnclaimedFundsClosure(CLOSURE);
    if (reading.kind !== "request") throw new Error("the closure was refused");
    await closeTrustUnclaimedFundsReview(recorder.fetch, REVIEW, reading.request, "key-close");
    const call = recorder.onlyCall();
    expect(call.method).toBe("POST");
    expect(call.path).toBe(`/api/v1/trust/unclaimed-funds/reviews/${REVIEW}/closure`);
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-close");
    expect(call.body).toEqual(reading.request);
  });
});

describe("the read the section makes", () => {
  it("names the account and the day the reader stated, and nothing else", async () => {
    // There is no default period on this path: the day in the query is always one somebody chose.
    const recorder = recordRequests({ quietOnOrBefore: "2024-09-01", balances: [] });
    await readDormantTrustBalances(recorder.fetch, ACCOUNT, "2024-09-01");
    const call = recorder.onlyCall();
    expect(call.method).toBe("GET");
    expect(call.path).toBe(
      `/api/v1/trust/unclaimed-funds/dormant-balances?trustAccountId=${ACCOUNT}&quietOnOrBefore=2024-09-01`,
    );
  });
});

/*
 * The judgments the firm's Trust screen makes, and the bodies its cushion panels compose. Each one
 * asserted here is worth a test for a reason that has consequences for a client's money rather than
 * for a layout.
 *
 *   - THE POSTURE SENTENCE IS THE FIRM'S OWN RULE, READ BACK. It is assembled from three fields,
 *     and a reader who has to assemble them has been handed a puzzle instead of an answer. Both
 *     clauses are asserted for all three policies, because the pair is independent: a firm can
 *     require a second person who is anybody, and a firm can require one qualified person and no
 *     second pair of eyes.
 *   - NOBODY SETTLES THEIR OWN PROPOSAL. A member who could approve their own payment out is a firm
 *     with no second person on any payment, however its posture reads. The verbs a reader is
 *     offered therefore depend on who raised the request, and the capability changes only the
 *     REFUSAL — a control that vanished would teach nobody that the capability exists.
 *   - A RECONCILIATION KNOWS ITS STATEMENT BY IDENTIFIER AND A READER KNOWS IT BY ITS PERIOD. The
 *     two reads are independent, so the join can come up empty, and an empty join is a fact rather
 *     than a failure: the row says so instead of printing a handle at somebody.
 *   - A ZERO AND AN ABSENCE ARE DIFFERENT FACTS ABOUT A TRUST ACCOUNT. Five of the position's
 *     figures are always answerable and read as money or as a count; the firm's own cushion is
 *     absent on an account that never opened one, and printing it as nothing would say the firm
 *     keeps money there that it does not.
 *   - A CUSHION REQUEST IS REFUSED ON THIS SIDE WHERE IT CANNOT SUCCEED, AND ONLY THERE. The
 *     fields the panels can judge are judged here, with the sentence a reader gets; the one
 *     refusal that is NOT here is the charge that exceeds the cushion, which is the server's
 *     because the balance moves under the reader.
 */
import { describe, expect, it } from "vitest";
import type {
  TrustAccountPosition,
  TrustAuthorizationPolicyVersion,
  TrustBankStatement,
  TrustPendingRequest,
  TrustReconciliation,
} from "../src/lib/trust/trust-api.ts";
import {
  accountsMatching,
  positionReading,
  postureSentence,
  postureVersionText,
  queueInOrder,
  reconciliationRows,
  requestActions,
  requestMatterText,
  statementsInOrder,
} from "../src/lib/trust/firm-trust-model.ts";
import {
  DEFAULT_CUSHION_NODE_NAME,
  readTrustBankChargeRequest,
  readTrustCushionDepositRequest,
  readTrustCushionOpening,
} from "../src/lib/trust/firm-cushion-requests.ts";
import { trustMoneyText } from "../src/lib/trust/firm-trust-vocabulary.ts";
import type { TrustAccountListing } from "../src/lib/trust/trust-api.ts";

function version(
  overrides: Partial<TrustAuthorizationPolicyVersion> = {},
): TrustAuthorizationPolicyVersion {
  return {
    id: "trustAuthorizationPolicy_one",
    version: 3,
    policy: "off",
    thresholdAmountMinor: null,
    requireAuthorizedApprover: false,
    setBy: "user_one",
    setAt: "2026-09-01T09:00:00.000Z",
    ...overrides,
  };
}

function request(overrides: Partial<TrustPendingRequest> = {}): TrustPendingRequest {
  return {
    id: "trustDisbursementRequest_one",
    kind: "disbursement",
    trustLedgerNodeId: "trustLedgerNode_one",
    amountMinor: 412_000,
    currency: "USD",
    method: "check",
    reference: null,
    payee: "Acme Title Company",
    purpose: "Closing costs",
    description: "Closing costs on the Harper sale",
    effectiveDate: "2026-09-10",
    requestedBy: "user_one",
    requestedAt: "2026-09-10T15:00:00.000Z",
    matterId: "matter_harper",
    matterNumber: "2026-00417",
    matterTitle: "Harper sale",
    ...overrides,
  };
}

function position(overrides: Partial<TrustAccountPosition> = {}): TrustAccountPosition {
  return {
    trustAccountId: "trustAccount_one",
    currency: "USD",
    asOfDate: "2026-09-19",
    bookBalanceMinor: 1_250_00,
    clientLedgerTotalMinor: 1_200_00,
    heldMinor: 300_00,
    firmFundsMinor: 50_00,
    matterLedgerCount: 12,
    pendingRequestCount: 2,
    ...overrides,
  };
}

/** The screen's own money wording, so the figures are asserted as a reader reads them. */
const money = (amountMinor: number): string => trustMoneyText(amountMinor, "USD");

function statement(overrides: Partial<TrustBankStatement> = {}): TrustBankStatement {
  return {
    id: "trustBankStatement_one",
    trustAccountId: "trustAccount_one",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    openingBalanceMinor: 1_000_00,
    closingBalanceMinor: 1_250_00,
    currency: "USD",
    statementReference: "AUG-2026",
    source: "entered",
    supersedesStatementId: null,
    recordedBy: "user_two",
    recordedAt: "2026-09-02T10:00:00.000Z",
    ...overrides,
  };
}

function reconciliation(overrides: Partial<TrustReconciliation> = {}): TrustReconciliation {
  return {
    id: "trustReconciliation_one",
    trustAccountId: "trustAccount_one",
    statementId: "trustBankStatement_one",
    status: "closed",
    openedBy: "user_two",
    openedAt: "2026-09-02T11:00:00.000Z",
    closedBy: "user_two",
    closedAt: "2026-09-02T12:00:00.000Z",
    frozenProof: null,
    supersedesReconciliationId: null,
    note: null,
    ...overrides,
  };
}

function account(overrides: Partial<TrustAccountListing> = {}): TrustAccountListing {
  return {
    id: "trustAccount_one",
    name: "Operating Trust",
    locationId: "location_one",
    jurisdiction: "NY",
    bankName: "First National",
    accountNumberLastFour: "4417",
    currency: "USD",
    iolta: true,
    status: "open",
    openedOn: "2026-01-05",
    closedAt: null,
    timeZone: "America/New_York",
    ...overrides,
  };
}

describe("the firm's authorization posture, read back as a sentence", () => {
  it("says a second person is never needed", () => {
    expect(postureSentence(version({ policy: "off" }), "USD")).toBe(
      "Money leaving a client ledger never takes a second person; the person who releases it doesn't need the authority.",
    );
  });

  it("names the amount above which a second person is needed", () => {
    const sentence = postureSentence(
      version({ policy: "threshold", thresholdAmountMinor: 500_000 }),
      "USD",
    );
    expect(sentence).toContain("takes a second person above $5,000.00");
    expect(sentence.endsWith("doesn't need the authority.")).toBe(true);
  });

  it("says a second person is always needed, and carries the authority clause on its own", () => {
    expect(
      postureSentence(version({ policy: "always", requireAuthorizedApprover: true }), "USD"),
    ).toBe(
      "Money leaving a client ledger always takes a second person; the person who releases it must have the authority.",
    );
  });

  it("states a threshold version that names no amount rather than printing a figure of nothing", () => {
    // A zero here would read as "a second person above nothing", which is the `always` posture said
    // in the wrong words — and the firm did not set that.
    expect(postureSentence(version({ policy: "threshold" }), "USD")).toContain(
      "above an amount this version does not state",
    );
  });

  it("marks the shipped default as the shipped default, because nobody set it", () => {
    expect(postureVersionText(version({ id: null, version: 1 }))).toBe(
      "Version 1, the shipped default",
    );
    expect(postureVersionText(version({ version: 4 }))).toBe("Version 4");
  });
});

describe("what a reader may do to a waiting request", () => {
  const holder = { sessionUserId: "user_two", permissions: ["trust:manage"] };

  it("offers the proposer their own withdrawal and nothing else", () => {
    const actions = requestActions(request({ requestedBy: "user_two" }), holder);
    expect(actions.map((action) => action.verb)).toEqual(["withdraw"]);
    expect(actions[0]?.refusal).toBeUndefined();
  });

  it("offers everybody else the two decisions", () => {
    const actions = requestActions(request({ requestedBy: "user_one" }), holder);
    expect(actions.map((action) => action.verb)).toEqual(["approve", "reject"]);
    expect(actions.every((action) => action.refusal === undefined)).toBe(true);
  });

  it("keeps the verbs and refuses them where the account does not hold the capability", () => {
    const actions = requestActions(request({ requestedBy: "user_one" }), {
      sessionUserId: "user_two",
      permissions: [],
    });
    expect(actions.map((action) => action.verb)).toEqual(["approve", "reject"]);
    expect(actions[0]?.refusal).toBe(
      "Approving a trust request needs the trust:manage permission, which this account does not hold.",
    );
    expect(actions[1]?.refusal).toContain("Rejecting a trust request");
  });

  it("refuses while the session is still being read, rather than guessing either way", () => {
    const actions = requestActions(request(), { sessionUserId: null, permissions: null });
    expect(actions.map((action) => action.verb)).toEqual(["approve", "reject"]);
    expect(actions[0]?.refusal).toBe("Reading your session.");
  });

  it("reads the queue oldest first: the longest wait is the one somebody owes an answer", () => {
    const ordered = queueInOrder([
      request({ id: "second", requestedAt: "2026-09-11T09:00:00.000Z" }),
      request({ id: "first", requestedAt: "2026-09-10T09:00:00.000Z" }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(["first", "second"]);
  });
});

describe("joining a reconciliation to the period it was run against", () => {
  it("carries the statement, so a reader sees a period rather than a handle", () => {
    const rows = reconciliationRows([reconciliation()], [statement()]);
    expect(rows[0]?.statement?.periodEnd).toBe("2026-08-31");
  });

  it("says so when the statement is not among the ones read, rather than failing", () => {
    // A superseded statement can leave a closed reconciliation pointing at a period the current
    // listing no longer carries. That is a fact about the record, not a broken read.
    const rows = reconciliationRows(
      [reconciliation({ statementId: "trustBankStatement_gone" })],
      [statement()],
    );
    expect(rows[0]?.statement).toBeNull();
  });

  it("reads most recently opened first", () => {
    const rows = reconciliationRows(
      [
        reconciliation({ id: "older", openedAt: "2026-07-02T11:00:00.000Z" }),
        reconciliation({ id: "newer", openedAt: "2026-09-02T11:00:00.000Z" }),
      ],
      [],
    );
    expect(rows.map((row) => row.reconciliation.id)).toEqual(["newer", "older"]);
  });

  it("reads statements most recent period first", () => {
    const ordered = statementsInOrder([
      statement({ id: "july", periodStart: "2026-07-01", periodEnd: "2026-07-31" }),
      statement({ id: "august" }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(["august", "july"]);
  });
});

describe("narrowing the roster in the browser", () => {
  it("reaches the name, the bank, the last four and the jurisdiction", () => {
    const roster = [
      account(),
      account({
        id: "two",
        name: "IOLTA Pooled",
        bankName: "Second State",
        accountNumberLastFour: "9082",
        jurisdiction: "NJ",
      }),
    ];
    expect(accountsMatching(roster, "first").map((entry) => entry.id)).toEqual([
      "trustAccount_one",
    ]);
    expect(accountsMatching(roster, "4417").map((entry) => entry.id)).toEqual(["trustAccount_one"]);
    expect(accountsMatching(roster, "nj").map((entry) => entry.id)).toEqual(["two"]);
    expect(accountsMatching(roster, "pooled").map((entry) => entry.id)).toEqual(["two"]);
  });

  it("answers with the whole roster where nothing was typed", () => {
    const roster = [account()];
    expect(accountsMatching(roster, "   ")).toEqual(roster);
  });
});

describe("what an account holds today", () => {
  it("reads the five figures every account can answer, in reading order", () => {
    const reading = positionReading(position(), money);
    expect(reading.figures).toEqual([
      { label: "Book Balance", text: "$1,250.00" },
      { label: "Client Ledgers", text: "$1,200.00" },
      { label: "Held", text: "$300.00" },
      { label: "Matter Ledgers", text: "12" },
      { label: "Awaiting", text: "2" },
    ]);
    expect(reading.asOfDate).toBe("2026-09-19");
  });

  it("states a figure of nothing rather than leaving it empty: a zero is an answer", () => {
    const reading = positionReading(
      position({ bookBalanceMinor: 0, clientLedgerTotalMinor: 0, heldMinor: 0 }),
      money,
    );
    expect(reading.figures.map((figure) => figure.text)).toEqual([
      "$0.00",
      "$0.00",
      "$0.00",
      "12",
      "2",
    ]);
  });

  it("carries the cushion where one is open", () => {
    expect(positionReading(position(), money).firmFundsText).toBe("$50.00");
  });

  it("answers with no cushion figure at all where the carve-out was never opened", () => {
    // A balance of nothing would say the firm keeps its own money there. It does not: there is no
    // carve-out on this account, which the section states in the row rather than as a zero.
    expect(positionReading(position({ firmFundsMinor: null }), money).firmFundsText).toBeNull();
  });

  it("states a cushion the firm has drawn down to nothing, which is not the same as none", () => {
    expect(positionReading(position({ firmFundsMinor: 0 }), money).firmFundsText).toBe("$0.00");
  });
});

describe("the matter behind a queued request", () => {
  it("reads as the number first, then the title", () => {
    expect(requestMatterText(request())).toBe("2026-00417 · Harper sale");
  });

  it("reads as whichever of the two the queue served", () => {
    expect(requestMatterText(request({ matterTitle: null }))).toBe("2026-00417");
    expect(requestMatterText(request({ matterNumber: null }))).toBe("Harper sale");
  });

  it("still names something to press where the queue served neither", () => {
    // The row is the way through to the matter's own ledger, so it keeps a label rather than
    // printing the ledger node's handle at somebody.
    expect(requestMatterText(request({ matterNumber: null, matterTitle: null }))).toBe(
      "The matter",
    );
  });
});

describe("opening the bank-charge cushion", () => {
  it("sends the account and the name the firm gave the carve-out", () => {
    const reading = readTrustCushionOpening({
      trustAccountId: "trustAccount_one",
      nodeName: DEFAULT_CUSHION_NODE_NAME,
    });
    expect(reading).toEqual({
      kind: "request",
      request: { trustAccountId: "trustAccount_one", nodeName: "Bank-charge cushion" },
    });
  });

  it("refuses a name cleared to nothing, and trims what is left", () => {
    expect(
      readTrustCushionOpening({ trustAccountId: "trustAccount_one", nodeName: "   " }),
    ).toEqual({
      kind: "refused",
      reason: "Name the cushion, so the ledger reads as something.",
    });
    const reading = readTrustCushionOpening({
      trustAccountId: "trustAccount_one",
      nodeName: "  Charges  ",
    });
    expect(reading.kind === "request" && reading.request.nodeName).toBe("Charges");
  });

  it("refuses when no account has been chosen", () => {
    expect(readTrustCushionOpening({ trustAccountId: "", nodeName: "Charges" })).toEqual({
      kind: "refused",
      reason: "Choose the account the cushion is opened on.",
    });
  });
});

describe("the firm's own money going into the cushion", () => {
  const entry = {
    trustAccountId: "trustAccount_one",
    amountText: "250.00",
    effectiveDate: "2026-09-19",
    method: "wire" as const,
    reference: " WIRE-4417 ",
    description: "  Quarterly top-up  ",
  };

  it("sends whole cents, the day, the method and the trimmed line", () => {
    expect(readTrustCushionDepositRequest(entry)).toEqual({
      kind: "request",
      request: {
        trustAccountId: "trustAccount_one",
        amountMinor: 25_000,
        currency: "USD",
        effectiveDate: "2026-09-19",
        description: "Quarterly top-up",
        reference: "WIRE-4417",
        method: "wire",
      },
    });
  });

  it("sends no reference at all where the box was left empty", () => {
    const reading = readTrustCushionDepositRequest({ ...entry, reference: "  " });
    expect(reading.kind === "request" && reading.request.reference).toBeNull();
  });

  it("refuses an amount of nothing, which moves nothing", () => {
    expect(readTrustCushionDepositRequest({ ...entry, amountText: "0" })).toEqual({
      kind: "refused",
      reason: "An amount of nothing moves nothing. Enter what moved.",
    });
  });

  it("refuses an empty amount, an unanswered day and an unwritten line, each in its own words", () => {
    expect(readTrustCushionDepositRequest({ ...entry, amountText: "" })).toEqual({
      kind: "refused",
      reason: "Say how much money moved.",
    });
    expect(readTrustCushionDepositRequest({ ...entry, effectiveDate: "" })).toEqual({
      kind: "refused",
      reason: "Say which day the money reached the account.",
    });
    expect(readTrustCushionDepositRequest({ ...entry, description: " " })).toEqual({
      kind: "refused",
      reason: "Say why the firm's own money is going in.",
    });
  });
});

describe("a service charge the institution took", () => {
  const entry = {
    trustAccountId: "trustAccount_one",
    amountText: "12.50",
    effectiveDate: "2026-09-19",
    reference: "",
    description: "Monthly account fee",
  };

  it("sends whole cents, the day and the line, and no method at all", () => {
    expect(readTrustBankChargeRequest(entry)).toEqual({
      kind: "request",
      request: {
        trustAccountId: "trustAccount_one",
        amountMinor: 1_250,
        currency: "USD",
        effectiveDate: "2026-09-19",
        description: "Monthly account fee",
        reference: null,
      },
    });
  });

  it("refuses an unanswered day and an unwritten line in the charge's own words", () => {
    expect(readTrustBankChargeRequest({ ...entry, effectiveDate: "" })).toEqual({
      kind: "refused",
      reason: "Say which day the institution took the charge.",
    });
    expect(readTrustBankChargeRequest({ ...entry, description: "" })).toEqual({
      kind: "refused",
      reason: "Say what the institution charged for.",
    });
  });

  it("does not refuse a charge larger than the cushion: that is the server's, with the remedy", () => {
    // The cushion moves under the reader, so a ceiling worked out here would refuse a charge the
    // account can bear or admit one it cannot. The panel prints the server's own words instead.
    const reading = readTrustBankChargeRequest({ ...entry, amountText: "9000000" });
    expect(reading.kind).toBe("request");
  });
});

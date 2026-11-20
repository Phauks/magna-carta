import { describe, expect, it } from "vitest";

import { draftProblems, type SigningRequestState } from "../src/request.ts";
import {
  checkOf,
  DEFAULT_SIGNER_CHECK_CHOICE,
  maskedNumber,
  offeredChecks,
  startingCheck,
  textableNumber,
} from "../src/signer-checks.ts";

const ready = { textService: true, identityService: false };
const notReady = { textService: false, identityService: false };

describe("the checks a firm offers", () => {
  it("offers the email link and the email code to a firm that never chose", () => {
    expect(offeredChecks(DEFAULT_SIGNER_CHECK_CHOICE, ready)).toEqual(["email-link", "email-code"]);
    expect(startingCheck(DEFAULT_SIGNER_CHECK_CHOICE, ready)).toBe("email-code");
  });

  it("always offers the email link, even with everything else turned off", () => {
    const choice = {
      emailCode: false,
      textCode: false,
      identityCheck: false,
      startWith: "email-code" as const,
    };
    expect(offeredChecks(choice, ready)).toEqual(["email-link"]);
    expect(startingCheck(choice, ready)).toBe("email-link");
  });

  it("leaves text codes out until the text service is ready", () => {
    const choice = {
      ...DEFAULT_SIGNER_CHECK_CHOICE,
      textCode: true,
      startWith: "text-code" as const,
    };
    expect(offeredChecks(choice, notReady)).toEqual(["email-link", "email-code"]);
    expect(startingCheck(choice, notReady)).toBe("email-link");
    expect(offeredChecks(choice, ready)).toEqual(["email-link", "email-code", "text-code"]);
    expect(startingCheck(choice, ready)).toBe("text-code");
  });

  it("leaves the identity check out until a service is connected", () => {
    const choice = { ...DEFAULT_SIGNER_CHECK_CHOICE, identityCheck: true };
    expect(offeredChecks(choice, ready)).not.toContain("identity-check");
    expect(offeredChecks(choice, { ...ready, identityService: true })).toContain("identity-check");
  });

  it("reads a stored signer back to its check", () => {
    expect(checkOf("email-link", null)).toBe("email-link");
    expect(checkOf("access-code", null)).toBe("email-code");
    expect(checkOf("access-code", "email")).toBe("email-code");
    expect(checkOf("access-code", "text")).toBe("text-code");
    expect(checkOf("firm-authenticated", null)).toBeNull();
  });
});

describe("a number a code can be texted to", () => {
  it("reads a North American number written the usual ways", () => {
    expect(textableNumber("(702) 555-0147")).toBe("+17025550147");
    expect(textableNumber("702.555.0147")).toBe("+17025550147");
    expect(textableNumber("1 702 555 0147")).toBe("+17025550147");
    expect(textableNumber("+1 702 555 0147")).toBe("+17025550147");
  });

  it("takes an international number written with a plus", () => {
    expect(textableNumber("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("refuses what it would have to guess at", () => {
    expect(textableNumber("555-0147")).toBeNull();
    expect(textableNumber("020 7946 0958")).toBeNull();
    expect(textableNumber("call me")).toBeNull();
    expect(textableNumber("+0 123 456 789")).toBeNull();
    expect(textableNumber("")).toBeNull();
  });

  it("is shown back with only its last four digits", () => {
    expect(maskedNumber("+17025550147")).toBe("(•••)\u00a0•••-0147");
  });
});

describe("a draft with a text code", () => {
  const request = (mobileNumber?: string): SigningRequestState => ({
    status: "draft",
    order: "in-order",
    signers: [
      {
        id: "a",
        position: 1,
        name: "Ana",
        email: "ana@example.com",
        attribution: "access-code",
        codeChannel: "text",
        ...(mobileNumber === undefined ? {} : { mobileNumber }),
        status: "waiting",
      },
    ],
    fields: [
      {
        id: "f",
        signerId: "a",
        kind: "signature",
        page: 1,
        rect: [72, 170, 252, 200],
        required: true,
      },
    ],
    expiresAt: "2026-12-13T00:00:00Z",
  });

  it("needs a mobile number", () => {
    expect(draftProblems(request(), 1)).toEqual(["Ana needs a mobile number to text the code to."]);
    expect(draftProblems(request("+17025550147"), 1)).toEqual([]);
  });

  it("cannot be sent once the firm stops offering text codes", () => {
    expect(draftProblems(request("+17025550147"), 1, ["email-link", "email-code"])).toEqual([
      "Text Code is not offered by the firm now. Choose another way for Ana to prove who they are.",
    ]);
  });
});

/*
 * The bot check's plumbing: the solution travels in its header only when there is one, and a
 * refusal is recognised as the bot check's own by its problem type, whichever client carried it.
 */
import { describe, expect, it } from "vitest";
import { problemOutcome } from "../src/lib/api/request.ts";
import {
  HUMAN_CHECK_FAILED,
  HUMAN_VERIFICATION_REQUIRED_PROBLEM_TYPE,
  HUMAN_VERIFICATION_TOKEN_HEADER,
  humanVerificationHeaders,
  isHumanCheckRefusal,
} from "../src/lib/auth/human-check.ts";
import { redeemInvitation, startRegistration } from "../src/lib/auth/joining-api.ts";
import {
  REDEMPTION_REFUSED,
  joiningErrorMessage,
} from "../src/routes/register/joining-messages.ts";

function recordingFetch(): { fetchImplementation: typeof fetch; headers: Headers[] } {
  const headers: Headers[] = [];
  const fetchImplementation = (async (_input: string | URL, init?: RequestInit) => {
    headers.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ next: "checkEmail" }), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImplementation, headers };
}

describe("the solution header", () => {
  it("is sent only when there is a solution", () => {
    expect(humanVerificationHeaders(null)).toEqual({});
    expect(humanVerificationHeaders("solved")).toEqual({
      [HUMAN_VERIFICATION_TOKEN_HEADER]: "solved",
    });
  });

  it("rides the registration and redemption posts", async () => {
    const { fetchImplementation, headers } = recordingFetch();
    await startRegistration(fetchImplementation, { email: "a@example.com" }, "first");
    await redeemInvitation(
      fetchImplementation,
      { code: "MC1", lastName: "Duarte", dateOfBirth: "1980-01-01" },
      "second",
    );
    await startRegistration(fetchImplementation, { email: "a@example.com" });
    expect(headers[0]?.get(HUMAN_VERIFICATION_TOKEN_HEADER)).toBe("first");
    expect(headers[1]?.get(HUMAN_VERIFICATION_TOKEN_HEADER)).toBe("second");
    expect(headers[2]?.has(HUMAN_VERIFICATION_TOKEN_HEADER)).toBe(false);
  });
});

describe("recognising the bot check's refusal", () => {
  it("matches on the problem type, never on the status alone", () => {
    expect(isHumanCheckRefusal({ type: HUMAN_VERIFICATION_REQUIRED_PROBLEM_TYPE })).toBe(true);
    // Better Auth answers an unverified email address with its own 403, which is not ours.
    expect(isHumanCheckRefusal({ status: 403, code: "EMAIL_NOT_VERIFIED" })).toBe(false);
    expect(isHumanCheckRefusal(null)).toBe(false);
  });

  it("gives an invitation refused by the bot check its own sentence, not the code refusal", () => {
    const outcome = problemOutcome<unknown>(
      { status: 403, type: HUMAN_VERIFICATION_REQUIRED_PROBLEM_TYPE },
      "POST /api/v1/invitations/redemptions",
    );
    expect(joiningErrorMessage(outcome, REDEMPTION_REFUSED)).toBe(HUMAN_CHECK_FAILED);
  });
});

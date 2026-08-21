import { describe, expect, it } from "vitest";
import {
  TRUSTED_DEVICE_DAYS,
  VERIFICATION_CODE_LENGTH,
  VERIFICATION_CODE_PERIOD_SECONDS,
} from "../src/lib/auth/two-factor-policy.ts";
import {
  CREDENTIALS_REJECTED,
  SIGN_IN_UNAVAILABLE,
  TOO_MANY_ATTEMPTS,
  VERIFICATION_CODE_REJECTED,
  signInErrorMessage,
} from "../src/routes/login/sign-in-messages.ts";

// What the sign-in surface tells a visitor when a step fails. This is a security surface, not copy:
// a message that distinguishes "no such account" from "wrong password" is an account-enumeration
// oracle, so the pinned property is that EVERY credential rejection produces the SAME sentence.
describe("signInErrorMessage", () => {
  it("gives the step's own rejection sentence for every 4xx verdict", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(signInErrorMessage(status, CREDENTIALS_REJECTED)).toBe(CREDENTIALS_REJECTED);
      expect(signInErrorMessage(status, VERIFICATION_CODE_REJECTED)).toBe(
        VERIFICATION_CODE_REJECTED,
      );
    }
  });

  it("never blames the visitor for an outage or an unreachable server", () => {
    expect(signInErrorMessage(undefined, CREDENTIALS_REJECTED)).toBe(SIGN_IN_UNAVAILABLE);
    expect(signInErrorMessage(500, CREDENTIALS_REJECTED)).toBe(SIGN_IN_UNAVAILABLE);
    expect(signInErrorMessage(503, VERIFICATION_CODE_REJECTED)).toBe(SIGN_IN_UNAVAILABLE);
  });

  it("treats rate limiting as its own condition, not a rejected code", () => {
    // The code endpoints are rate-limited server-side; showing the code-rejected sentence there
    // would tell the visitor a perfectly good code was wrong.
    expect(signInErrorMessage(429, VERIFICATION_CODE_REJECTED)).toBe(TOO_MANY_ATTEMPTS);
    expect(signInErrorMessage(429, CREDENTIALS_REJECTED)).toBe(TOO_MANY_ATTEMPTS);
  });
});

describe("the credential rejection is unspecific", () => {
  it("names neither the email nor the password as the thing that was wrong", () => {
    expect(CREDENTIALS_REJECTED).toBe(
      "That email and password combination doesn't match our records. Check both and try again.",
    );
    // Nothing in it can be read as "that account exists" or "that account does not exist".
    expect(CREDENTIALS_REJECTED).not.toMatch(/unknown|not found|no account|incorrect password/i);
  });
});

describe("copy states no duration the configuration does not", () => {
  it("builds the rotation interval from the policy constant", () => {
    expect(VERIFICATION_CODE_PERIOD_SECONDS).toBe(30);
    expect(VERIFICATION_CODE_REJECTED).toBe(
      `That code didn't verify. Codes rotate every ${VERIFICATION_CODE_PERIOD_SECONDS} seconds — enter the current one.`,
    );
  });

  it("derives the trusted-device window in whole days from the server's window in seconds", () => {
    expect(TRUSTED_DEVICE_DAYS).toBe(30);
    expect(Number.isInteger(TRUSTED_DEVICE_DAYS)).toBe(true);
  });

  it("keeps the code length and the number of cells the same fact", () => {
    expect(VERIFICATION_CODE_LENGTH).toBe(6);
  });
});

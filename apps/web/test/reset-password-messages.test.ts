/*
 * The reset-password surface's wording — a security property, like the sign-in wording it sits
 * beside, so it is asserted rather than eyeballed. The properties under test: an outage never
 * reads as a verdict on the link or the password; a rate limit never reads as a verdict; and the
 * two real verdicts (a dead token, a refused password) name different remedies.
 */
import { describe, expect, it } from "vitest";
import {
  MINIMUM_PASSWORD_LENGTH,
  PASSWORD_REFUSED,
  RESET_TOKEN_REFUSED,
  requestResetErrorMessage,
  resetPasswordErrorMessage,
} from "../src/routes/login/reset-password/reset-password-messages.ts";
import { SIGN_IN_UNAVAILABLE, TOO_MANY_ATTEMPTS } from "../src/routes/login/sign-in-messages.ts";

describe("resetPasswordErrorMessage", () => {
  it("reads a dead token as a dead token, whatever flavour of dead it was", () => {
    // Unknown, expired and already-used all arrive as INVALID_TOKEN; one sentence covers them.
    expect(resetPasswordErrorMessage(400, "INVALID_TOKEN")).toBe(RESET_TOKEN_REFUSED);
    expect(resetPasswordErrorMessage(400, undefined)).toBe(RESET_TOKEN_REFUSED);
  });

  it("names the password remedy when the password was the problem", () => {
    expect(resetPasswordErrorMessage(400, "PASSWORD_TOO_SHORT")).toBe(PASSWORD_REFUSED);
    expect(resetPasswordErrorMessage(400, "PASSWORD_TOO_LONG")).toBe(PASSWORD_REFUSED);
    expect(PASSWORD_REFUSED).toContain(String(MINIMUM_PASSWORD_LENGTH));
  });

  it("does not treat an outage or a rate limit as a verdict", () => {
    expect(resetPasswordErrorMessage(500, undefined)).toBe(SIGN_IN_UNAVAILABLE);
    expect(resetPasswordErrorMessage(undefined, undefined)).toBe(SIGN_IN_UNAVAILABLE);
    expect(resetPasswordErrorMessage(429, undefined)).toBe(TOO_MANY_ATTEMPTS);
  });
});

describe("requestResetErrorMessage", () => {
  it("never issues a verdict on the address, whatever failed", () => {
    // The endpoint answers a taken and a free address identically, so the only failures a visitor
    // can be told about are the outage and the rate limit.
    expect(requestResetErrorMessage(500)).toBe(SIGN_IN_UNAVAILABLE);
    expect(requestResetErrorMessage(undefined)).toBe(SIGN_IN_UNAVAILABLE);
    expect(requestResetErrorMessage(429)).toBe(TOO_MANY_ATTEMPTS);
    expect(requestResetErrorMessage(404)).toBe(SIGN_IN_UNAVAILABLE);
  });
});

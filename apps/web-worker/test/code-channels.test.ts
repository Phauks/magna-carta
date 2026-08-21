import { describe, expect, it } from "vitest";
import {
  type CodeChannel,
  codeChannelShape,
  codeShapeDescription,
  maskedPhoneNumber,
} from "../src/lib/auth/code-channels.ts";
import { VERIFICATION_CODE_LENGTH } from "../src/lib/auth/two-factor-policy.ts";

const CHANNELS: readonly CodeChannel[] = ["authenticator", "text", "call", "email"];

// A code field must match its issuer. The bug this pins out is the one that looks like a wrong
// code: a numeric-only field silently rejecting an alphanumeric code this platform itself sent.
describe("codeChannelShape", () => {
  it("keeps the six-digit channels numeric, and in step with the policy constant", () => {
    for (const channel of ["authenticator", "call"] as const) {
      expect(codeChannelShape(channel).charset).toBe("numeric");
      expect(codeChannelShape(channel).length).toBe(VERIFICATION_CODE_LENGTH);
    }
  });

  it("accepts letters on every channel this platform generates the code for", () => {
    for (const channel of ["text", "email"] as const) {
      expect(codeChannelShape(channel).charset).toBe("alphanumeric");
    }
  });

  it("offers a resend only where a code can actually be sent again", () => {
    // An authenticator issues its own codes on a clock; there is nothing for us to resend.
    expect(codeChannelShape("authenticator").resendable).toBe(false);
    for (const channel of ["text", "call", "email"] as const) {
      expect(codeChannelShape(channel).resendable).toBe(true);
    }
  });

  it("only tells the authenticator's holder about rotation, since only its codes rotate", () => {
    expect(codeChannelShape("authenticator").rejection).toMatch(/change every/);
    for (const channel of ["text", "call", "email"] as const) {
      expect(codeChannelShape(channel).rejection).not.toMatch(/rotate|change every/);
      expect(codeChannelShape(channel).rejection).toMatch(/most recent/);
    }
  });

  it("gives every channel its own origin line and rejection sentence", () => {
    const origins = new Set(CHANNELS.map((channel) => codeChannelShape(channel).origin));
    const rejections = new Set(CHANNELS.map((channel) => codeChannelShape(channel).rejection));
    expect(origins.size).toBe(CHANNELS.length);
    expect(rejections.size).toBe(CHANNELS.length);
  });
});

describe("codeShapeDescription", () => {
  it("spells the length out, because it is read once under stress", () => {
    expect(codeShapeDescription("authenticator")).toBe("six digits");
    expect(codeShapeDescription("email")).toBe("eight characters");
  });
});

describe("maskedPhoneNumber", () => {
  it("shows the country code and the last four, and nothing between", () => {
    expect(maskedPhoneNumber("+1", "1284")).toBe("+1 (···) ···-1284");
  });

  it("never discloses the area code, which would disclose rough geography", () => {
    // For a law firm's client, which jurisdiction they are dealing with can itself be the
    // sensitive fact — so the mask stays tight even though more digits would aid recognition.
    expect(maskedPhoneNumber("+1", "1284")).not.toContain("702");
  });
});

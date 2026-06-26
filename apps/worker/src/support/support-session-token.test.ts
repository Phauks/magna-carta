import { describe, expect, it } from "vitest";
import {
  mintSupportSessionToken,
  verifySupportSessionToken,
  type SupportSessionTokenPayload,
} from "./support-session-token.ts";

const SECRET = "test-secret-value";
const payload: SupportSessionTokenPayload = {
  grantId: "supportGrant_1" as never,
  principalId: "platformStaff_1" as never,
  firmId: "firm_1" as never,
  requesterUserId: "user_1" as never,
  tier: "diagnostic",
  exp: 2_000_000_000,
};

describe("support-session token", () => {
  it("round-trips a valid token", async () => {
    const token = await mintSupportSessionToken(SECRET, payload);
    const verified = await verifySupportSessionToken(SECRET, token, 1_000_000_000);
    expect(verified).toEqual(payload);
  });

  it("rejects an expired token", async () => {
    const token = await mintSupportSessionToken(SECRET, payload);
    expect(await verifySupportSessionToken(SECRET, token, 2_000_000_001)).toBeNull();
  });

  it("rejects a wrong-secret signature", async () => {
    const token = await mintSupportSessionToken(SECRET, payload);
    expect(await verifySupportSessionToken("other-secret", token, 1_000_000_000)).toBeNull();
  });

  it("rejects a tampered body", async () => {
    const token = await mintSupportSessionToken(SECRET, payload);
    const tampered = `x${token}`;
    expect(await verifySupportSessionToken(SECRET, tampered, 1_000_000_000)).toBeNull();
  });

  it("rejects a malformed token", async () => {
    expect(await verifySupportSessionToken(SECRET, "no-dot", 1_000_000_000)).toBeNull();
  });
});

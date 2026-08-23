import { describe, expect, it } from "vitest";
import {
  mintSupportSessionToken,
  verifySupportSessionToken,
  type SupportSessionTokenPayload,
} from "./support-session-token.ts";

const SECRET = "test-secret-value";

// mint input — typ is not passed; mint injects it.
const mintInput: Omit<SupportSessionTokenPayload, "typ"> = {
  grantId: "supportGrant_1" as never,
  principalId: "platformStaff_1" as never,
  firmId: "firm_1" as never,
  requesterUserId: "user_1" as never,
  tier: "diagnostic",
  exp: 2_000_000_000,
};

// Manually produce a signed token for a raw body object so tests can craft tokens with wrong/absent typ.
async function signBody(bodyObj: Record<string, unknown>): Promise<string> {
  const encoder = new TextEncoder();
  const bodyBytes = encoder.encode(JSON.stringify(bodyObj));
  let binary = "";
  for (const byte of bodyBytes) binary += String.fromCharCode(byte);
  const body = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  let sigBinary = "";
  for (const byte of new Uint8Array(sig)) sigBinary += String.fromCharCode(byte);
  return `${body}.${btoa(sigBinary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

describe("support-session token", () => {
  it("round-trips a valid token and the verified payload includes typ: support-session", async () => {
    const token = await mintSupportSessionToken(SECRET, mintInput);
    const verified = await verifySupportSessionToken(SECRET, token, 1_000_000_000);
    // The verified payload must include the typ discriminator that mint injects.
    expect(verified).toEqual({ ...mintInput, typ: "support-session" });
    expect(verified?.typ).toBe("support-session");
  });

  it("rejects an expired token", async () => {
    const token = await mintSupportSessionToken(SECRET, mintInput);
    expect(await verifySupportSessionToken(SECRET, token, 2_000_000_001)).toBeNull();
  });

  it("rejects a wrong-secret signature", async () => {
    const token = await mintSupportSessionToken(SECRET, mintInput);
    expect(await verifySupportSessionToken("other-secret", token, 1_000_000_000)).toBeNull();
  });

  it("rejects a tampered body", async () => {
    const token = await mintSupportSessionToken(SECRET, mintInput);
    const tampered = `x${token}`;
    expect(await verifySupportSessionToken(SECRET, tampered, 1_000_000_000)).toBeNull();
  });

  it("rejects a malformed token", async () => {
    expect(await verifySupportSessionToken(SECRET, "no-dot", 1_000_000_000)).toBeNull();
  });

  it("rejects a validly-signed token whose body lacks the typ field", async () => {
    // A token with a valid HMAC but no typ discriminator must be rejected — this simulates a
    // token minted before the discriminator was added (or a different token type sharing the
    // same secret and wire format).
    const token = await signBody({ ...mintInput });
    expect(await verifySupportSessionToken(SECRET, token, 1_000_000_000)).toBeNull();
  });

  it("rejects a validly-signed token with a wrong typ value (e.g. preview)", async () => {
    // A preview-file token shares AUTH_SECRET and the same wire format — the typ check must
    // prevent it from being accepted as a support-session token.
    const token = await signBody({ ...mintInput, typ: "preview" });
    expect(await verifySupportSessionToken(SECRET, token, 1_000_000_000)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { mintEditToken, verifyEditToken, WopiTokenError } from "../../src/editing/wopi-token.ts";

// AUTH_SECRET is the only input the token signer needs (the per-firm signing key is derived from it).
const env = { AUTH_SECRET: "test-auth-secret-value-not-for-production" };

const baseInput = {
  firmId: "firm_aaa",
  matterId: "matter_bbb",
  fileId: "file_ccc",
  versionId: "fileVersion_ddd",
  memberId: "usr_eee",
  capability: "edit" as const,
  sessionId: "wopiSession_fff",
};

const oneHourFromNow = () => Date.now() + 60 * 60 * 1000;

// base64url helpers matching the wire format, for tamper construction in the tests.
const b64urlDecode = (s: string): string =>
  atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
const b64urlEncode = (s: string): string =>
  btoa(s)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

describe("WOPI edit token", () => {
  it("mints a token that verifies back to the original claims", async () => {
    const exp = oneHourFromNow();
    const token = await mintEditToken({ ...baseInput, exp }, env);

    const claims = await verifyEditToken(token, env);
    expect(claims.firmId).toBe("firm_aaa");
    expect(claims.matterId).toBe("matter_bbb");
    expect(claims.fileId).toBe("file_ccc");
    expect(claims.versionId).toBe("fileVersion_ddd");
    expect(claims.memberId).toBe("usr_eee");
    expect(claims.capability).toBe("edit");
    expect(claims.sessionId).toBe("wopiSession_fff");
    expect(claims.exp).toBe(exp);
    expect(typeof claims.jti).toBe("string");
    expect(claims.jti.length).toBeGreaterThan(0);
  });

  it("rejects a tampered payload — the signature is checked before any claim is trusted", async () => {
    const token = await mintEditToken({ ...baseInput, exp: oneHourFromNow() }, env);
    const [header, payload, mac] = token.split(".");
    const claims = JSON.parse(b64urlDecode(payload));
    claims.capability = "view"; // privilege change attempt
    const tampered = `${header}.${b64urlEncode(JSON.stringify(claims))}.${mac}`;

    await expect(verifyEditToken(tampered, env)).rejects.toMatchObject({ code: "bad-signature" });
  });

  it("rejects a firm-A token re-pointed at firm-B (the signing key is per-firm)", async () => {
    const token = await mintEditToken({ ...baseInput, firmId: "firm_aaa", exp: oneHourFromNow() }, env);
    const [header, payload, mac] = token.split(".");
    const claims = JSON.parse(b64urlDecode(payload));
    claims.firmId = "firm_zzz"; // cross-firm replay attempt
    const swapped = `${header}.${b64urlEncode(JSON.stringify(claims))}.${mac}`;

    await expect(verifyEditToken(swapped, env)).rejects.toMatchObject({ code: "bad-signature" });
  });

  it("rejects a correctly-signed but expired token", async () => {
    const token = await mintEditToken({ ...baseInput, exp: Date.now() - 60_000 }, env);
    await expect(verifyEditToken(token, env)).rejects.toMatchObject({ code: "expired" });
  });

  it("rejects a malformed token", async () => {
    await expect(verifyEditToken("not-a-token", env)).rejects.toMatchObject({ code: "malformed" });
    await expect(verifyEditToken("only.two", env)).rejects.toMatchObject({ code: "malformed" });
  });

  it("never echoes the token in the error message", async () => {
    const token = await mintEditToken({ ...baseInput, exp: oneHourFromNow() }, env);
    const corruptedMac = `${token.slice(0, token.lastIndexOf(".") + 1)}AAAAAAAA`;

    await expect(verifyEditToken(corruptedMac, env)).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof WopiTokenError)) return false;
      return !error.message.includes(token) && !error.message.includes(corruptedMac);
    });
  });
});

/*
 * What setting up two-factor says and shows (src/lib/account/two-factor.ts) — pure, node, no
 * browser.
 *
 * Pinned here: the refusal wording, the secret a person types when they cannot scan, and the file
 * the recovery codes are saved as. NOT pinned: the calls themselves, which are Better Auth's
 * endpoints and are exercised against a real Worker rather than described by a mock of them.
 */
import { describe, expect, it } from "vitest";
import {
  TWO_FACTOR_REFUSED_UNKNOWN,
  groupedSecret,
  recoveryCodesDocument,
  secretFromAuthenticatorUri,
  twoFactorRefusal,
} from "../src/lib/account/two-factor.ts";

describe("what a refused two-factor step says", () => {
  it("names a wrong password as the password", () => {
    expect(twoFactorRefusal("INVALID_PASSWORD")).toContain("not your password");
  });

  // The remedy for a code that rotated out while it was typed is the next code, and the sentence
  // has to say so — "invalid code" alone sends somebody looking for a fault in their app.
  it("tells a rejected code to use the one the app is showing now", () => {
    const sentence = twoFactorRefusal("INVALID_CODE");
    expect(sentence).toContain("30 seconds");
    expect(sentence).toContain("shows now");
  });

  it("tells an expired setup to start again", () => {
    expect(twoFactorRefusal("TOTP_NOT_ENABLED")).toContain("start again");
  });

  it("falls back to nothing-changed for a code it has no sentence for, or none at all", () => {
    expect(twoFactorRefusal("SOMETHING_NEW_IN_A_LATER_RELEASE")).toBe(TWO_FACTOR_REFUSED_UNKNOWN);
    expect(twoFactorRefusal(undefined)).toBe(TWO_FACTOR_REFUSED_UNKNOWN);
    expect(TWO_FACTOR_REFUSED_UNKNOWN).toContain("nothing changed");
  });
});

describe("the secret, for somebody typing it in", () => {
  const uri =
    "otpauth://totp/Magna%20Carta:joan%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Magna%20Carta&digits=6&period=30";

  it("reads the secret out of the URI the server returned", () => {
    expect(secretFromAuthenticatorUri(uri)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("reads nothing out of a URI that carries no secret, rather than inventing one", () => {
    expect(secretFromAuthenticatorUri("otpauth://totp/Magna%20Carta:joan")).toBeNull();
    expect(secretFromAuthenticatorUri("otpauth://totp/x?secret=&issuer=y")).toBeNull();
  });

  it("groups it in fours, the way a manual-entry field is read off a screen", () => {
    expect(groupedSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
    expect(groupedSecret("ABCDEF")).toBe("ABCD EF");
    expect(groupedSecret("")).toBe("");
  });
});

describe("the saved recovery-code file", () => {
  const codes = ["MCABCDEFGHJK", "MCMNPQRSTUVW"];

  // A text file found in a downloads folder a year later has to say what it is and whose it is.
  it("says what the codes are and whose account they open", () => {
    const document = recoveryCodesDocument("joan@example.test", codes);
    expect(document.split("\n")[0]).toBe("Magna Carta recovery codes for joan@example.test");
    expect(document).toContain("signs you in once");
  });

  it("carries every code on a line of its own", () => {
    const lines = recoveryCodesDocument(null, codes).split("\n");
    for (const code of codes) expect(lines).toContain(code);
  });

  it("still explains itself when the account's address is not known", () => {
    expect(recoveryCodesDocument(null, codes).split("\n")[0]).toBe("Magna Carta recovery codes");
  });
});

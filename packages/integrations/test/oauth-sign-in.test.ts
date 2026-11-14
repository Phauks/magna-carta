import { describe, expect, it } from "vitest";
import { codeChallengeFor, codeVerifierFrom } from "../src/oauth-sign-in.ts";

describe("the proof key", () => {
  it("encodes 32 random bytes as a 43-character verifier in the unreserved alphabet", () => {
    const verifier = codeVerifierFrom(new Uint8Array(32).fill(251));
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuses fewer random bytes than the shortest verifier needs", () => {
    expect(() => codeVerifierFrom(new Uint8Array(16))).toThrow(RangeError);
  });

  it("derives the challenge the proof-key standard's own example gives", async () => {
    // RFC 7636, appendix B.
    expect(await codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

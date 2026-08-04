import { describe, expect, it } from "vitest";

import {
  assembleCertificateOfCompletion,
  certificateDefects,
  renderCertificateOfCompletion,
} from "../src/certificate.ts";
import type { SignerCompletion } from "../src/esign.ts";

const HASH = "a".repeat(64);

const signer: SignerCompletion = {
  intent: { signerId: "usr_alice", adoption: "drawn", affirmedAt: "2026-07-18T12:00:00Z" },
  consent: { disclosureVersion: "v1", consentedAt: "2026-07-18T11:59:00Z" },
  attribution: { level: "portal-authenticated", observedIp: "198.51.100.7" },
};

describe("assembleCertificateOfCompletion", () => {
  it("lowercases the hash and returns a sound certificate", () => {
    const certificate = assembleCertificateOfCompletion({
      documentHashSha256: HASH.toUpperCase(),
      sealedAt: "2026-07-18T12:00:01Z",
      signers: [signer],
    });
    expect(certificate.documentHashSha256).toBe(HASH);
    expect(certificateDefects(certificate)).toEqual([]);
  });

  it("refuses to assemble an incomplete record", () => {
    expect(() =>
      assembleCertificateOfCompletion({ documentHashSha256: HASH, sealedAt: "now", signers: [] }),
    ).toThrow(/no-signers/);
    expect(() =>
      assembleCertificateOfCompletion({
        documentHashSha256: "not-a-hash",
        sealedAt: "now",
        signers: [signer],
      }),
    ).toThrow(/malformed-document-hash/);
  });
});

describe("renderCertificateOfCompletion", () => {
  it("renders a stable, human-readable record with each ESIGN/UETA element", () => {
    const certificate = assembleCertificateOfCompletion({
      documentHashSha256: HASH,
      sealedAt: "2026-07-18T12:00:01Z",
      signers: [signer],
    });
    const text = renderCertificateOfCompletion(certificate);

    expect(text).toContain("CERTIFICATE OF COMPLETION");
    expect(text).toContain(`Document hash (SHA-256): ${HASH}`);
    expect(text).toContain("Signer 1 — usr_alice");
    expect(text).toContain("Attribution: Authenticated client-portal signer");
    expect(text).toContain("Observed IP: 198.51.100.7");
    expect(text).toContain("Signature adopted: drawn");
    expect(text).toContain(
      "Consent to transact electronically: 2026-07-18T11:59:00Z (disclosure v1)",
    );

    // Deterministic: the same certificate always renders identically.
    expect(renderCertificateOfCompletion(certificate)).toBe(text);
  });
});

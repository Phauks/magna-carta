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

describe("the audit log", () => {
  const named: SignerCompletion = {
    intent: { ...signer.intent, name: "Alice Example", email: "alice@example.test" },
    consent: signer.consent,
    attribution: { ...signer.attribution, userAgent: "ExampleBrowser/1.0" },
  };

  it("always holds each signer's consent and signature and the seal, oldest first", () => {
    const certificate = assembleCertificateOfCompletion({
      documentHashSha256: HASH,
      sealedAt: "2026-07-18T12:00:01Z",
      signers: [named],
    });
    expect(certificate.events).toEqual([
      {
        kind: "consented",
        at: "2026-07-18T11:59:00Z",
        actor: "Alice Example",
        observedIp: "198.51.100.7",
        userAgent: "ExampleBrowser/1.0",
        detail: "Disclosure v1",
      },
      {
        kind: "signed",
        at: "2026-07-18T12:00:00Z",
        actor: "Alice Example",
        observedIp: "198.51.100.7",
        userAgent: "ExampleBrowser/1.0",
        detail: "Signature drawn",
      },
      { kind: "sealed", at: "2026-07-18T12:00:01Z" },
    ]);
  });

  it("places the steps a signing request observed among them, and lists a repeated step once", () => {
    const certificate = assembleCertificateOfCompletion({
      documentHashSha256: HASH,
      sealedAt: "2026-07-18T12:00:01Z",
      signers: [named],
      envelope: { id: "env_0001", title: "Engagement letter.pdf", pageCount: 3 },
      events: [
        { kind: "completed", at: "2026-07-18T12:00:00Z" },
        { kind: "viewed", at: "2026-07-18T11:58:00.500Z", actor: "Alice Example" },
        { kind: "sent", at: "2026-07-18T11:50:00Z", actor: "Bob Sender" },
        { kind: "signed", at: "2026-07-18T12:00:00Z", actor: "Alice Example" },
      ],
    });
    expect(certificate.events?.map((event) => event.kind)).toEqual([
      "sent",
      "viewed",
      "consented",
      "signed",
      "completed",
      "sealed",
    ]);

    const text = renderCertificateOfCompletion(certificate);
    expect(text).toContain("Reference: env_0001");
    expect(text).toContain("Document: Engagement letter.pdf");
    expect(text).toContain("Pages: 3");
    expect(text).toContain("Name: Alice Example");
    expect(text).toContain("2026-07-18T11:50:00Z Sent for signature by Bob Sender");
    expect(text).toContain("2026-07-18T12:00:00Z Signed by Alice Example");
  });

  it("refuses an envelope with no reference", () => {
    expect(() =>
      assembleCertificateOfCompletion({
        documentHashSha256: HASH,
        sealedAt: "2026-07-18T12:00:01Z",
        signers: [signer],
        envelope: { id: " " },
      }),
    ).toThrow(/missing-envelope-id/);
  });
});

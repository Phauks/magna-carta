// The Certificate of Completion — the ESIGN/UETA defensibility artifact stored alongside a sealed
// document. It is assembled from the authoritative, server-observed audit trail (never
// client-self-reported) and renders to a stable, human-readable record that travels with the seal.
//
// This is the pure model + renderer; the workflow that captures the signing acts and persists the
// audit trail feeds it (as the seal engine feeds sealDocument). Keeping it pure means the record is
// reproducible and testable without the Worker or the data-access layer.

import type { AttributionLevel, CertificateOfCompletion, SignerCompletion } from "./esign.ts";

/** Human-readable labels for each attribution level, strongest claim first in the wording. */
const ATTRIBUTION_LABEL: Record<AttributionLevel, string> = {
  "firm-authenticated": "Authenticated firm user",
  "portal-authenticated": "Authenticated client-portal signer",
  "id-verified": "Identity-verified signer (ID / knowledge-based)",
  "access-code": "Email/SMS one-time access code",
  "email-link": "Tokenized email link (possession)",
};

/** How the assembled certificate is malformed, if it is. */
export type CertificateDefect = "no-signers" | "malformed-document-hash" | "missing-sealed-at";

/** Validate the assembled certificate. Returns the defects found (empty when the record is sound). */
export function certificateDefects(certificate: CertificateOfCompletion): CertificateDefect[] {
  const defects: CertificateDefect[] = [];
  if (certificate.signers.length === 0) defects.push("no-signers");
  if (!/^[0-9a-f]{64}$/.test(certificate.documentHashSha256)) {
    defects.push("malformed-document-hash");
  }
  if (certificate.sealedAt.trim() === "") defects.push("missing-sealed-at");
  return defects;
}

/**
 * Assemble a Certificate of Completion from the sealed document's hash, the seal time, and the
 * server-observed signer records. Throws if the inputs cannot form a sound certificate (no signers,
 * a non-SHA-256 hash, or a missing seal time) — a defensibility record must not be emitted incomplete.
 */
export function assembleCertificateOfCompletion(input: {
  documentHashSha256: string;
  sealedAt: string;
  signers: readonly SignerCompletion[];
}): CertificateOfCompletion {
  const certificate: CertificateOfCompletion = {
    documentHashSha256: input.documentHashSha256.toLowerCase(),
    sealedAt: input.sealedAt,
    signers: input.signers,
  };
  const defects = certificateDefects(certificate);
  if (defects.length > 0) {
    throw new Error(`certificate of completion is incomplete: ${defects.join(", ")}`);
  }
  return certificate;
}

/**
 * Render a Certificate of Completion to a stable plain-text record — the artifact stored with the
 * sealed document. Deterministic for a given certificate, so the same signing history always yields
 * the same record.
 */
export function renderCertificateOfCompletion(certificate: CertificateOfCompletion): string {
  const lines: string[] = [
    "CERTIFICATE OF COMPLETION",
    "",
    `Document hash (SHA-256): ${certificate.documentHashSha256}`,
    `Sealed at: ${certificate.sealedAt}`,
    `Signers: ${certificate.signers.length}`,
  ];

  certificate.signers.forEach((signer, index) => {
    lines.push("", `Signer ${index + 1} — ${signer.intent.signerId}`);
    lines.push(`  Attribution: ${ATTRIBUTION_LABEL[signer.attribution.level]}`);
    if (signer.attribution.observedIp !== undefined) {
      lines.push(`  Observed IP: ${signer.attribution.observedIp}`);
    }
    if (signer.attribution.proofReference !== undefined) {
      lines.push(`  Identity proof: ${signer.attribution.proofReference}`);
    }
    lines.push(`  Signature adopted: ${signer.intent.adoption}`);
    lines.push(`  Intent affirmed: ${signer.intent.affirmedAt}`);
    lines.push(
      `  Consent to transact electronically: ${signer.consent.consentedAt}` +
        ` (disclosure ${signer.consent.disclosureVersion})`,
    );
  });

  return `${lines.join("\n")}\n`;
}

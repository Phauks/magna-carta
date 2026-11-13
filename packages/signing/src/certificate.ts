// The Certificate of Completion — the ESIGN/UETA defensibility artifact stored alongside a sealed
// document. It is assembled from the authoritative, server-observed audit trail (never
// client-self-reported) and renders to a stable, human-readable record that travels with the seal.
//
// This is the pure model + renderer; the workflow that captures the signing acts and persists the
// audit trail feeds it (as the seal engine feeds sealDocument). Keeping it pure means the record is
// reproducible and testable without the Worker or the data-access layer.

import {
  SIGNING_EVENT_KINDS,
  type AttributionLevel,
  type CertificateOfCompletion,
  type SignatureAdoption,
  type SignerCompletion,
  type SigningEnvelope,
  type SigningEvent,
  type SigningEventKind,
} from "./esign.ts";

/** Human-readable labels for each attribution level, strongest claim first in the wording. */
export const ATTRIBUTION_LABEL: Record<AttributionLevel, string> = {
  "firm-authenticated": "Authenticated firm user",
  "portal-authenticated": "Authenticated client-portal signer",
  "id-verified": "Identity-verified signer (ID / knowledge-based)",
  "access-code": "Email/SMS one-time access code",
  "email-link": "Tokenized email link (possession)",
};

/**
 * The certificate's number as a person reads it: `MC-` and the first twelve characters of the
 * document hash in three groups. An internal identifier is long and means nothing read aloud; this
 * one is short, is the same for the same sealed bytes, and leads back to the record by the hash.
 */
export function certificateReference(documentHashSha256: string): string {
  const head = documentHashSha256.slice(0, 12).toUpperCase();
  return `MC-${head.slice(0, 4)}-${head.slice(4, 8)}-${head.slice(8, 12)}`;
}

/** What each step of the audit log is called on the certificate. */
export const SIGNING_EVENT_LABEL: Record<SigningEventKind, string> = {
  created: "Request Created",
  sent: "Sent for Signature",
  delivered: "Delivered",
  reminded: "Reminder Sent",
  viewed: "Viewed",
  "identity-verified": "Identity Verified",
  consented: "Agreed to Sign Electronically",
  signed: "Signed",
  declined: "Declined",
  reassigned: "Reassigned",
  voided: "Voided",
  completed: "Completed",
  sealed: "Sealed",
};

/** How a signer made their signature, as the certificate says it. */
export const ADOPTION_LABEL: Record<SignatureAdoption, string> = {
  typed: "Typed",
  drawn: "Drawn",
  uploaded: "Uploaded image",
};

/** How the assembled certificate is malformed, if it is. */
export type CertificateDefect =
  | "no-signers"
  | "malformed-document-hash"
  | "missing-sealed-at"
  | "missing-envelope-id";

/** The name a signer goes by on the certificate: the name, else the address, else the identifier. */
export function signerDisplayName(signer: SignerCompletion): string {
  return signer.intent.name ?? signer.intent.email ?? signer.intent.signerId;
}

/**
 * The audit log of a certificate: each signer's consent and signature and the seal, which the signer
 * records already prove, together with the steps only a signing request observes. A step the request
 * reports that the signer records also yield is listed once. Oldest first; steps recorded at the same
 * instant keep the order a signing runs in.
 */
function auditLog(input: {
  sealedAt: string;
  signers: readonly SignerCompletion[];
  events: readonly SigningEvent[];
}): SigningEvent[] {
  const derived: SigningEvent[] = [];
  for (const signer of input.signers) {
    const observed = {
      actor: signerDisplayName(signer),
      ...(signer.attribution.observedIp !== undefined
        ? { observedIp: signer.attribution.observedIp }
        : {}),
      ...(signer.attribution.userAgent !== undefined
        ? { userAgent: signer.attribution.userAgent }
        : {}),
    };
    derived.push(
      {
        kind: "consented",
        at: signer.consent.consentedAt,
        ...observed,
        detail: `Disclosure ${signer.consent.disclosureVersion}`,
      },
      {
        kind: "signed",
        at: signer.intent.affirmedAt,
        ...observed,
        detail: `Signature ${ADOPTION_LABEL[signer.intent.adoption].toLowerCase()}`,
      },
    );
  }
  derived.push({ kind: "sealed", at: input.sealedAt, detail: "Platform certificate" });

  const seen = new Set(input.events.map((event) => `${event.kind}|${event.at}|${event.actor}`));
  const all = [
    ...input.events,
    ...derived.filter((event) => !seen.has(`${event.kind}|${event.at}|${event.actor}`)),
  ];
  const position = new Map(all.map((event, index) => [event, index]));
  return all.toSorted((left, right) => {
    const byTime = Date.parse(left.at) - Date.parse(right.at);
    if (Number.isFinite(byTime) && byTime !== 0) return byTime;
    const byKind = SIGNING_EVENT_KINDS.indexOf(left.kind) - SIGNING_EVENT_KINDS.indexOf(right.kind);
    if (byKind !== 0) return byKind;
    return (position.get(left) ?? 0) - (position.get(right) ?? 0);
  });
}

/** Validate the assembled certificate. Returns the defects found (empty when the record is sound). */
export function certificateDefects(certificate: CertificateOfCompletion): CertificateDefect[] {
  const defects: CertificateDefect[] = [];
  if (certificate.signers.length === 0) defects.push("no-signers");
  if (!/^[0-9a-f]{64}$/.test(certificate.documentHashSha256)) {
    defects.push("malformed-document-hash");
  }
  if (certificate.sealedAt.trim() === "") defects.push("missing-sealed-at");
  if (certificate.envelope !== undefined && certificate.envelope.id.trim() === "") {
    defects.push("missing-envelope-id");
  }
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
  /** What was sent for signature, when the seal closes a signing request. */
  envelope?: SigningEnvelope;
  /** The steps the signing request observed. Consent, signature and seal are added from the rest. */
  events?: readonly SigningEvent[];
}): CertificateOfCompletion {
  const certificate: CertificateOfCompletion = {
    documentHashSha256: input.documentHashSha256.toLowerCase(),
    reference: certificateReference(input.documentHashSha256),
    sealedAt: input.sealedAt,
    signers: input.signers,
    ...(input.envelope !== undefined ? { envelope: input.envelope } : {}),
    events: auditLog({
      sealedAt: input.sealedAt,
      signers: input.signers,
      events: input.events ?? [],
    }),
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
    `Reference: ${certificate.reference}`,
    `Document hash (SHA-256): ${certificate.documentHashSha256}`,
    `Sealed at: ${certificate.sealedAt}`,
    `Signers: ${certificate.signers.length}`,
  ];
  const envelope = certificate.envelope;
  if (envelope !== undefined) {
    lines.push(`Record: ${envelope.id}`);
    if (envelope.title !== undefined) lines.push(`Document: ${envelope.title}`);
    if (envelope.pageCount !== undefined) lines.push(`Pages: ${envelope.pageCount}`);
    if (envelope.sender !== undefined) lines.push(`Sent by: ${partyLine(envelope.sender)}`);
    if (envelope.createdAt !== undefined) lines.push(`Created: ${envelope.createdAt}`);
  }

  certificate.signers.forEach((signer, index) => {
    lines.push("", `Signer ${index + 1} — ${signer.intent.signerId}`);
    if (signer.intent.name !== undefined) lines.push(`  Name: ${signer.intent.name}`);
    if (signer.intent.email !== undefined) lines.push(`  Email: ${signer.intent.email}`);
    lines.push(`  Attribution: ${ATTRIBUTION_LABEL[signer.attribution.level]}`);
    if (signer.attribution.observedIp !== undefined) {
      lines.push(`  Observed IP: ${signer.attribution.observedIp}`);
    }
    if (signer.attribution.userAgent !== undefined) {
      lines.push(`  Browser: ${signer.attribution.userAgent}`);
    }
    if (signer.attribution.proofReference !== undefined) {
      lines.push(`  Identity proof: ${signer.attribution.proofReference}`);
    }
    lines.push(`  Signature adopted: ${signer.intent.adoption}`);
    lines.push(`  Signatures: ${signer.intent.signatureCount ?? 1}`);
    lines.push(`  Initials: ${signer.intent.initialCount ?? 0}`);
    lines.push(`  Intent affirmed: ${signer.intent.affirmedAt}`);
    lines.push(
      `  Consent to transact electronically: ${signer.consent.consentedAt}` +
        ` (disclosure ${signer.consent.disclosureVersion})`,
    );
  });

  const events = certificate.events ?? [];
  if (events.length > 0) {
    lines.push("", "Audit log (times are Coordinated Universal Time)");
    for (const event of events) {
      const parts = [event.at, SIGNING_EVENT_LABEL[event.kind]];
      if (event.actor !== undefined) parts.push(`by ${event.actor}`);
      if (event.observedIp !== undefined) parts.push(`from ${event.observedIp}`);
      if (event.detail !== undefined) parts.push(`(${event.detail})`);
      lines.push(`  ${parts.join(" ")}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function partyLine(party: { readonly name: string; readonly email?: string }): string {
  return party.email === undefined ? party.name : `${party.name} <${party.email}>`;
}

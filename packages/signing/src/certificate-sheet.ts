// The Certificate of Completion as a document to print: the confirmation sheet and audit log a
// signing platform files beside a signed document. It is plain data in the shape the PDF composer
// (packages/pdf-compose) accepts, so this package stays free of the composer's WebAssembly and the
// sheet is testable as a value. The service that holds the composer turns it into pages.
//
// Every instant is printed in Coordinated Universal Time, to the second, because a certificate is
// read by people in more than one zone and a converted time invites the question of whose clock it
// was. The record and its plain text keep each instant exactly as it was stored.

import { ATTRIBUTION_LABEL, SIGNING_EVENT_LABEL, signerDisplayName } from "./certificate.ts";
import type { CertificateOfCompletion, SignatureAdoption, SigningParty } from "./esign.ts";

interface SheetField {
  readonly label: string;
  readonly value: string;
}

/** The blocks the sheet uses, a subset of the composer's own. */
export type CertificateSheetBlock =
  | { readonly type: "title"; readonly text: string }
  | { readonly type: "heading"; readonly level: 1 | 2; readonly text: string }
  | { readonly type: "paragraph"; readonly text: string }
  | { readonly type: "fields"; readonly fields: readonly SheetField[] }
  | {
      readonly type: "table";
      readonly columns: readonly { readonly heading: string; readonly weight: number }[];
      readonly rows: readonly (readonly string[])[];
    }
  | { readonly type: "rule" };

/** A document the PDF composer accepts as it stands. */
export interface CertificateSheet {
  readonly title: string;
  readonly subject: string;
  readonly language: string;
  readonly created?: {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
  };
  readonly page: { readonly paper: "letter" };
  readonly footer: { readonly left: string; readonly right: string };
  readonly blocks: readonly CertificateSheetBlock[];
}

const ADOPTION_LABEL: Record<SignatureAdoption, string> = {
  typed: "Typed",
  drawn: "Drawn",
  uploaded: "Uploaded image",
};

function party(value: SigningParty): string {
  return value.email === undefined ? value.name : `${value.name} (${value.email})`;
}

/** The hash in two rows of 32, so it fits a column and still reads as one value. */
function hashRows(hash: string): string {
  return `${hash.slice(0, 32)} ${hash.slice(32)}`;
}

/** `2026-07-18 12:00:01`: an instant to the second, in Coordinated Universal Time. */
function clock(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function stamp(instant: string): string {
  const read = clock(instant);
  return read === instant ? instant : `${read} UTC`;
}

function createdOn(instant: string): CertificateSheet["created"] {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return undefined;
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

/**
 * Lay a Certificate of Completion out as a sheet: what was signed, who signed it and how each was
 * identified, then the audit log. Deterministic for a given certificate.
 */
export function certificateSheet(certificate: CertificateOfCompletion): CertificateSheet {
  const envelope = certificate.envelope;

  const summary: SheetField[] = [];
  if (envelope !== undefined) {
    summary.push({ label: "Reference", value: envelope.id });
    if (envelope.title !== undefined) summary.push({ label: "Document", value: envelope.title });
    if (envelope.pageCount !== undefined) {
      summary.push({ label: "Pages", value: String(envelope.pageCount) });
    }
    if (envelope.sender !== undefined) {
      summary.push({ label: "Sent by", value: party(envelope.sender) });
    }
    if (envelope.createdAt !== undefined) {
      summary.push({ label: "Created", value: stamp(envelope.createdAt) });
    }
  }
  summary.push(
    { label: "Status", value: "Completed" },
    { label: "Signers", value: String(certificate.signers.length) },
    { label: "Sealed", value: stamp(certificate.sealedAt) },
    { label: "Document hash (SHA-256)", value: hashRows(certificate.documentHashSha256) },
    { label: "Times", value: "Coordinated Universal Time (UTC), as the server observed them" },
  );

  const blocks: CertificateSheetBlock[] = [
    { type: "title", text: "Certificate of Completion" },
    { type: "fields", fields: summary },
    { type: "heading", level: 1, text: "Signers" },
  ];

  for (const signer of certificate.signers) {
    const fields: SheetField[] = [];
    if (signer.intent.email !== undefined && signer.intent.name !== undefined) {
      fields.push({ label: "Email", value: signer.intent.email });
    }
    if (signerDisplayName(signer) !== signer.intent.signerId) {
      fields.push({ label: "Signer reference", value: signer.intent.signerId });
    }
    fields.push({ label: "Identified by", value: ATTRIBUTION_LABEL[signer.attribution.level] });
    if (signer.attribution.proofReference !== undefined) {
      fields.push({ label: "Identity proof", value: signer.attribution.proofReference });
    }
    fields.push(
      {
        label: "Agreed to sign electronically",
        value: `${stamp(signer.consent.consentedAt)} (disclosure ${signer.consent.disclosureVersion})`,
      },
      { label: "Signature", value: ADOPTION_LABEL[signer.intent.adoption] },
      { label: "Signed", value: stamp(signer.intent.affirmedAt) },
    );
    if (signer.attribution.observedIp !== undefined) {
      fields.push({ label: "IP address", value: signer.attribution.observedIp });
    }
    if (signer.attribution.userAgent !== undefined) {
      fields.push({ label: "Browser", value: signer.attribution.userAgent });
    }
    blocks.push(
      { type: "heading", level: 2, text: signerDisplayName(signer) },
      { type: "fields", fields },
    );
  }

  blocks.push(
    { type: "heading", level: 1, text: "Audit log" },
    {
      type: "table",
      columns: [
        { heading: "Time (UTC)", weight: 23 },
        { heading: "Event", weight: 22 },
        { heading: "By", weight: 20 },
        { heading: "IP address", weight: 15 },
        { heading: "Details", weight: 20 },
      ],
      rows: (certificate.events ?? []).map((event) => [
        clock(event.at),
        SIGNING_EVENT_LABEL[event.kind],
        event.actor ?? "System",
        event.observedIp ?? "",
        event.detail ?? "",
      ]),
    },
    { type: "rule" },
    {
      type: "paragraph",
      text:
        "The document hash is the SHA-256 digest of the bytes the platform seal covers in the " +
        "signed document. A copy whose sealed bytes give a different digest is not the document " +
        "this certificate describes. This certificate carries the same platform seal, so a change " +
        "to it after it was issued shows in any PDF reader that checks signatures.",
    },
  );

  return {
    title: "Certificate of Completion",
    subject:
      envelope?.title === undefined
        ? "Electronic signature record"
        : `Electronic signature record for ${envelope.title}`,
    language: "en-US",
    ...(createdOn(certificate.sealedAt) !== undefined
      ? { created: createdOn(certificate.sealedAt) }
      : {}),
    page: { paper: "letter" },
    footer: {
      left: envelope === undefined ? "Certificate of Completion" : `Reference ${envelope.id}`,
      right: "Page {page} of {pages}",
    },
    blocks,
  };
}

// The Certificate of Completion as a document to print: the confirmation sheet and audit log a
// signing platform files beside a signed document. It is plain data in the shape the PDF composer
// (packages/pdf-compose) accepts, so this package stays free of the composer's WebAssembly and the
// sheet is testable as a value. The service that holds the composer turns it into pages.
//
// Every instant is printed in Coordinated Universal Time, to the second, because a certificate is
// read by people in more than one zone and a converted time invites the question of whose clock it
// was. The record and its plain text keep each instant exactly as it was stored.

import { brandLockupPng } from "./brand-lockup.ts";
import {
  ADOPTION_LABEL,
  ATTRIBUTION_LABEL,
  SIGNING_EVENT_LABEL,
  signerDisplayName,
} from "./certificate.ts";
import type { CertificateOfCompletion, SigningContact } from "./esign.ts";

interface SheetField {
  readonly label: string;
  readonly value: string;
}

/** The blocks the sheet uses, a subset of the composer's own. */
export type CertificateSheetBlock =
  | { readonly type: "title"; readonly text: string }
  | { readonly type: "image"; readonly image: number; readonly width: number }
  | { readonly type: "space"; readonly height: number }
  | { readonly type: "pageBreak" }
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
  /** The colour of the title, the headings and the rules: red, green and blue. */
  readonly accent: readonly [number, number, number];
  readonly footer: { readonly left: string; readonly right: string };
  readonly blocks: readonly CertificateSheetBlock[];
}

/**
 * The dark gold the application uses for an accent on a light ground (`accent-700` in
 * packages/design-tokens), as the red, green and blue a printed page needs.
 */
const ACCENT = [98, 72, 0] as const;

/** The lockup's drawn width in points; it is 163 by 40 at its natural size. */
const LOCKUP_WIDTH = 130;

/**
 * The pictures the sheet's image blocks name by position. Passed to the composer beside the sheet.
 */
export function certificateSheetImages(): Uint8Array[] {
  return [brandLockupPng()];
}

/** Who to ask about the document, on one line: the name, then each way to reach them. */
function contactLine(contact: SigningContact): string {
  const ways = [contact.email, contact.phone].filter((way) => way !== undefined);
  const reach = ways.length === 0 ? "" : ` at ${ways.join(" or ")}`;
  return `Questions about this document? Contact ${contact.name}${reach}.`;
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

  const summary: SheetField[] = [{ label: "Reference", value: certificate.reference }];
  if (envelope !== undefined) {
    if (envelope.title !== undefined) summary.push({ label: "Document", value: envelope.title });
    if (envelope.pageCount !== undefined) {
      summary.push({ label: "Pages", value: String(envelope.pageCount) });
    }
    if (envelope.sender !== undefined) {
      summary.push({ label: "Sent By", value: envelope.sender.name });
      if (envelope.sender.email !== undefined) {
        summary.push({ label: "Sender Email", value: envelope.sender.email });
      }
    }
    if (envelope.createdAt !== undefined) {
      summary.push({ label: "Created", value: stamp(envelope.createdAt) });
    }
  }
  summary.push(
    { label: "Status", value: "Completed" },
    { label: "Signers", value: String(certificate.signers.length) },
    { label: "Sealed", value: stamp(certificate.sealedAt) },
    { label: "Document Hash (SHA-256)", value: hashRows(certificate.documentHashSha256) },
    { label: "Times", value: "Coordinated Universal Time (UTC)" },
  );

  const blocks: CertificateSheetBlock[] = [
    { type: "image", image: 0, width: LOCKUP_WIDTH },
    { type: "space", height: 10 },
    { type: "title", text: "Certificate of Completion" },
    { type: "rule" },
    { type: "fields", fields: summary },
  ];
  const contact = envelope?.contact ?? envelope?.sender;
  if (contact !== undefined) {
    blocks.push({ type: "rule" }, { type: "paragraph", text: contactLine(contact) });
  }
  blocks.push({ type: "pageBreak" }, { type: "heading", level: 1, text: "Signers" });

  for (const signer of certificate.signers) {
    const fields: SheetField[] = [];
    if (signer.intent.email !== undefined && signer.intent.name !== undefined) {
      fields.push({ label: "Email", value: signer.intent.email });
    }
    fields.push({ label: "Identified By", value: ATTRIBUTION_LABEL[signer.attribution.level] });
    if (signer.attribution.proofReference !== undefined) {
      fields.push({ label: "Identity Proof", value: signer.attribution.proofReference });
    }
    fields.push(
      {
        label: "Agreed to Sign Electronically",
        value: `${stamp(signer.consent.consentedAt)} (disclosure ${signer.consent.disclosureVersion})`,
      },
      { label: "Signature", value: ADOPTION_LABEL[signer.intent.adoption] },
      { label: "Signed", value: stamp(signer.intent.affirmedAt) },
    );
    if (signer.attribution.observedIp !== undefined) {
      fields.push({ label: "IP Address", value: signer.attribution.observedIp });
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
    { type: "pageBreak" },
    { type: "heading", level: 1, text: "Audit Log" },
    {
      type: "table",
      columns: [
        { heading: "Time (UTC)", weight: 21 },
        { heading: "Event", weight: 20 },
        { heading: "By", weight: 17 },
        { heading: "IP Address", weight: 14 },
        { heading: "Details", weight: 28 },
      ],
      rows: (certificate.events ?? []).map((event) => [
        clock(event.at),
        SIGNING_EVENT_LABEL[event.kind],
        event.actor ?? "System",
        event.observedIp ?? "",
        event.detail ?? "",
      ]),
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
    accent: ACCENT,
    footer: {
      left: `Certificate ${certificate.reference}`,
      right: "Page {page} of {pages}",
    },
    blocks,
  };
}

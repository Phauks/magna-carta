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
import type { CertificateOfCompletion, SignerCompletion, SigningContact } from "./esign.ts";

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
  | {
      readonly type: "paragraph";
      readonly spans: readonly { readonly text: string; readonly bold?: boolean }[];
      readonly small: true;
    }
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
  readonly page: {
    readonly paper: "letter";
    readonly marginTop: number;
    readonly marginBottom: number;
  };
  /** The colour of the title, the headings and the rules: red, green and blue. */
  readonly accent: readonly [number, number, number];
  /** Rows set closer together, so the first page holds the summary, eight signers and the contacts. */
  readonly compact: true;
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

/** What the sheet is told that the record does not hold. */
export interface CertificateSheetOptions {
  /**
   * Who answers for the certificate itself, as distinct from the document: the platform's own
   * support contact. Without one the sheet names the platform and gives no address.
   */
  readonly issuerContact?: SigningContact;
}

/** The platform's name, where no issuer contact says otherwise. */
const ISSUER_NAME = "Magna Carta";

/**
 * The space above and below the page's content, in points: three quarters of an inch. The
 * composer's own inch leaves the first page short of eight signers, and a certificate that runs its
 * summary onto a second sheet is one a reader has to staple.
 */
const PAGE_MARGIN_VERTICAL = 54;

/**
 * How many signers' full records one page holds. A record is never run across two pages: a reader
 * checking one person's consent and signature should not have to turn the sheet. Two is what a
 * letter page takes with room for a browser string that wraps.
 */
const SIGNERS_PER_PAGE = 2;

/** How many audit log rows one page holds, with room for rows whose details wrap. */
const EVENTS_PER_PAGE = 20;

/** `Signer Details (1 of 3)`: a section's heading on each of its pages, plain where it has one. */
function pageHeading(section: string, page: number, pages: number): string {
  return pages > 1 ? `${section} (${page + 1} of ${pages})` : section;
}

/** A contact as one small line: what it answers for, then who and how to reach them. */
function contactLine(about: string, contact: SigningContact): CertificateSheetBlock {
  const reach = [contact.name, contact.email, contact.phone].filter(
    (part): part is string => part !== undefined && part !== "",
  );
  return {
    type: "paragraph",
    small: true,
    spans: [{ text: `${about}: `, bold: true }, { text: reach.join(", ") }],
  };
}

/** The signature blocks a signer completed: one, the signing act itself, where none is counted. */
function signatureCount(signer: SignerCompletion): number {
  return signer.intent.signatureCount ?? 1;
}

function initialCount(signer: SignerCompletion): number {
  return signer.intent.initialCount ?? 0;
}

/**
 * The hash as two lines of 32 characters, each set in groups of six, so a reader comparing it
 * against another copy keeps their place. The last group of a line is the two characters left over.
 */
function hashRows(hash: string): string {
  const lines = hash.match(/.{1,32}/g) ?? [hash];
  return lines.map((line) => (line.match(/.{1,6}/g) ?? [line]).join(" ")).join("\n");
}

/** `2026-07-18 12:00:01`: an instant to the second, in Coordinated Universal Time. */
function clock(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * An instant as two rows, `Label: Date` and `Label: Time`. One that does not read as an instant is
 * a single row holding what was recorded.
 */
function instantFields(label: string, instant: string): SheetField[] {
  const read = clock(instant);
  if (read === instant) return [{ label, value: instant }];
  return [
    { label: `${label}: Date`, value: read.slice(0, 10) },
    { label: `${label}: Time`, value: `${read.slice(11)} UTC` },
  ];
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
 * Lay a Certificate of Completion out as a sheet: what was signed and by whom on the first page,
 * each signer in full on the pages after it, two to a page, then the audit log. Every page of a
 * section carries its heading. Deterministic for a given certificate.
 */
export function certificateSheet(
  certificate: CertificateOfCompletion,
  options: CertificateSheetOptions = {},
): CertificateSheet {
  const envelope = certificate.envelope;
  const signers = certificate.signers;
  const total = (count: (signer: SignerCompletion) => number) =>
    String(signers.reduce((sum, signer) => sum + count(signer), 0));

  const summary: SheetField[] = [{ label: "Reference", value: certificate.reference }];
  if (envelope !== undefined) {
    if (envelope.title !== undefined) summary.push({ label: "Document", value: envelope.title });
    if (envelope.pageCount !== undefined) {
      summary.push({ label: "Pages", value: String(envelope.pageCount) });
    }
    if (envelope.sender !== undefined) {
      summary.push({ label: "Sender: Name", value: envelope.sender.name });
      if (envelope.sender.email !== undefined) {
        summary.push({ label: "Sender: Email", value: envelope.sender.email });
      }
    }
    if (envelope.createdAt !== undefined) {
      summary.push(...instantFields("Created", envelope.createdAt));
    }
  }
  summary.push(
    { label: "Status", value: "Completed" },
    ...instantFields("Sealed", certificate.sealedAt),
    { label: "Signers", value: String(signers.length) },
    { label: "Signatures", value: total(signatureCount) },
    { label: "Initials", value: total(initialCount) },
    { label: "Document Hash (SHA-256)", value: hashRows(certificate.documentHashSha256) },
    { label: "Time Zone", value: "Coordinated Universal Time (UTC)" },
  );

  const documentContact = envelope?.contact ?? envelope?.sender;
  const blocks: CertificateSheetBlock[] = [
    { type: "image", image: 0, width: LOCKUP_WIDTH },
    { type: "title", text: "Certificate of Completion" },
    { type: "rule" },
    { type: "fields", fields: summary },
    { type: "heading", level: 1, text: "Signers" },
    {
      type: "table",
      columns: [
        { heading: "Name", weight: 21 },
        { heading: "Email", weight: 34 },
        { heading: "Signed (UTC)", weight: 22 },
        { heading: "Signatures", weight: 13 },
        { heading: "Initials", weight: 10 },
      ],
      rows: signers.map((signer) => [
        signerDisplayName(signer),
        signer.intent.name === undefined ? "" : (signer.intent.email ?? ""),
        clock(signer.intent.affirmedAt),
        String(signatureCount(signer)),
        String(initialCount(signer)),
      ]),
    },
    { type: "heading", level: 2, text: "Contact" },
    ...(documentContact === undefined ? [] : [contactLine("Document", documentContact)]),
    contactLine("Certificate of Completion", options.issuerContact ?? { name: ISSUER_NAME }),
  ];

  const detailPages = Math.ceil(signers.length / SIGNERS_PER_PAGE);
  for (const [index, signer] of signers.entries()) {
    if (index % SIGNERS_PER_PAGE === 0) {
      blocks.push(
        { type: "pageBreak" },
        {
          type: "heading",
          level: 1,
          text: pageHeading("Signer Details", index / SIGNERS_PER_PAGE, detailPages),
        },
      );
    }
    const fields: SheetField[] = [];
    if (signer.intent.email !== undefined && signer.intent.name !== undefined) {
      fields.push({ label: "Email", value: signer.intent.email });
    }
    fields.push({ label: "Identified By", value: ATTRIBUTION_LABEL[signer.attribution.level] });
    if (signer.attribution.proofReference !== undefined) {
      fields.push({ label: "Identity Proof", value: signer.attribution.proofReference });
    }
    fields.push(
      ...instantFields("Consent", signer.consent.consentedAt),
      { label: "Consent: Disclosure", value: signer.consent.disclosureVersion },
      { label: "Signature", value: ADOPTION_LABEL[signer.intent.adoption] },
      ...instantFields("Signed", signer.intent.affirmedAt),
      { label: "Signatures", value: String(signatureCount(signer)) },
      { label: "Initials", value: String(initialCount(signer)) },
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

  const events = certificate.events ?? [];
  const logPages = Math.max(1, Math.ceil(events.length / EVENTS_PER_PAGE));
  for (let page = 0; page < logPages; page += 1) {
    blocks.push(
      { type: "pageBreak" },
      { type: "heading", level: 1, text: pageHeading("Audit Log", page, logPages) },
      {
        type: "table",
        columns: [
          { heading: "Time (UTC)", weight: 21 },
          { heading: "Event", weight: 20 },
          { heading: "By", weight: 19 },
          { heading: "IP Address", weight: 16 },
          { heading: "Details", weight: 24 },
        ],
        rows: events
          .slice(page * EVENTS_PER_PAGE, (page + 1) * EVENTS_PER_PAGE)
          .map((event) => [
            clock(event.at),
            SIGNING_EVENT_LABEL[event.kind],
            event.actor ?? "System",
            event.observedIp ?? "",
            event.detail ?? "",
          ]),
      },
    );
  }

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
    page: {
      paper: "letter",
      marginTop: PAGE_MARGIN_VERTICAL,
      marginBottom: PAGE_MARGIN_VERTICAL,
    },
    accent: ACCENT,
    compact: true,
    footer: {
      left: `Certificate ${certificate.reference}`,
      right: "Page {page} of {pages}",
    },
    blocks,
  };
}

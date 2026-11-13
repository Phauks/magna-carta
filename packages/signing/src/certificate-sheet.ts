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
  /** The value's words set in columns of one width, so its lines stand under one another. */
  readonly grid?: true;
}

/** The blocks the sheet uses, a subset of the composer's own. */
export type CertificateSheetBlock =
  | { readonly type: "pageBreak" }
  | { readonly type: "rule" }
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
      readonly banded: true;
    };

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
  /** What heads every page: the lockup, the certificate's name and its reference. */
  readonly letterhead: {
    readonly image: number;
    readonly title: string;
    readonly label: string;
    readonly detail: string;
  };
  /** The family the sheet is set in. */
  readonly typeface: CertificateTypeface;
  readonly footer: { readonly center: string };
  readonly blocks: readonly CertificateSheetBlock[];
}

/**
 * The dark gold the application uses for an accent on a light ground (`accent-700` in
 * packages/design-tokens), as the red, green and blue a printed page needs.
 */
const ACCENT = [98, 72, 0] as const;

/**
 * The pictures the sheet names by position: the lockup its letterhead draws. Passed to the composer beside the sheet.
 */
export function certificateSheetImages(): Uint8Array[] {
  return [brandLockupPng()];
}

/**
 * The families the composer carries. Atkinson Hyperlegible, the application's own reading face,
 * draws Latin only; Liberation Sans also draws Greek and Cyrillic.
 */
export type CertificateTypeface = "atkinsonHyperlegible" | "liberationSans";

/** What the sheet is told that the record does not hold. */
export interface CertificateSheetOptions {
  /**
   * Who answers for the certificate itself, as distinct from the document: the platform's own
   * support contact. Without one the sheet names the platform and gives no address.
   */
  readonly issuerContact?: SigningContact;
  /**
   * The family to set the sheet in: Atkinson Hyperlegible unless told otherwise. The service that
   * composes it asks for Liberation Sans when a name on the certificate is in a script Atkinson
   * cannot draw.
   */
  readonly typeface?: CertificateTypeface;
}

/** The platform's name, where no issuer contact says otherwise. */
const ISSUER_NAME = "Magna Carta";

/**
 * The page's top margin, in points: the room the composer's letterhead takes and half an inch of
 * paper above it that a desktop printer can reach.
 */
const PAGE_MARGIN_TOP = 92;

/**
 * The page's bottom margin, in points: three quarters of an inch. The composer's own inch leaves
 * the first page short of eight signers, and a certificate that runs its summary onto a second
 * sheet is one a reader has to staple.
 */
const PAGE_MARGIN_BOTTOM = 54;

/**
 * How many signers' full records one page holds. A record is never run across two pages: a reader
 * checking one person's consent and signature should not have to turn the sheet. Two is what a
 * letter page takes with room for a browser string that wraps.
 */
const SIGNERS_PER_PAGE = 2;

/** The audit log's columns. The weights share the page's width out of a hundred. */
const AUDIT_COLUMNS = [
  { heading: "Time (UTC)", weight: 21 },
  { heading: "Event", weight: 20 },
  { heading: "By", weight: 19 },
  { heading: "IP Address", weight: 16 },
  { heading: "Details", weight: 24 },
] as const;

/**
 * The room one page gives the audit log's rows, in points: a letter page inside the sheet's
 * margins, less the section heading and the table's own heading row, less a margin for the
 * estimate below being an estimate.
 */
const AUDIT_ROWS_HEIGHT = 552;

/** The composer's compact row: a line of cell text, and the space above and below a row. */
const ROW_LINE_HEIGHT = 13;
const ROW_PADDING = 3;

/**
 * How many characters of cell text fit a column one percent of the page wide. The composer
 * measures real glyphs; this sheet cannot, so it assumes text a little wider than it usually is.
 * The time column is left out of the estimate because an instant is sized to fit it.
 */
const CHARACTERS_PER_WEIGHT = 0.92;

/** The lines a row is expected to take: its most-wrapped cell. */
function estimatedLines(row: readonly string[]): number {
  let lines = 1;
  for (const [index, cell] of row.entries()) {
    const column = AUDIT_COLUMNS[index];
    if (index === 0 || column === undefined) continue;
    const capacity = Math.floor(column.weight * CHARACTERS_PER_WEIGHT);
    lines = Math.max(lines, Math.ceil(cell.length / capacity));
  }
  return lines;
}

/**
 * The audit log's rows a page at a time. A page is filled by the height its rows are expected to
 * take, so a log of short rows runs well down the page and one of long rows still breaks where the
 * next heading can be printed above what follows.
 */
function auditPages(rows: readonly string[][]): string[][][] {
  const pages: string[][][] = [[]];
  let used = 0;
  for (const row of rows) {
    const height = estimatedLines(row) * ROW_LINE_HEIGHT + ROW_PADDING;
    const page = pages.at(-1);
    if (page === undefined || (used + height > AUDIT_ROWS_HEIGHT && page.length > 0)) {
      pages.push([row]);
      used = height;
    } else {
      page.push(row);
      used += height;
    }
  }
  return pages;
}

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
 * The hash as two lines of 32 characters, each set in eight groups of four, the grouping the
 * reference uses, so a reader comparing it against another copy keeps their place.
 */
function hashRows(hash: string): string {
  const lines = hash.match(/.{1,32}/g) ?? [hash];
  return lines.map((line) => (line.match(/.{1,4}/g) ?? [line]).join(" ")).join("\n");
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

  // The reference is in the letterhead of every page, so the summary does not repeat it.
  const summary: SheetField[] = [];
  if (envelope !== undefined) {
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
  );

  // What was signed. One document today; the section is where a second would be listed.
  const signed: SheetField[] = [];
  if (envelope?.title !== undefined) signed.push({ label: "Document", value: envelope.title });
  if (envelope?.pageCount !== undefined) {
    signed.push({ label: "Pages", value: String(envelope.pageCount) });
  }
  signed.push({
    label: "Hash (SHA-256)",
    value: hashRows(certificate.documentHashSha256),
    grid: true,
  });

  const documentContact = envelope?.contact ?? envelope?.sender;
  const blocks: CertificateSheetBlock[] = [
    { type: "heading", level: 1, text: "Summary" },
    { type: "fields", fields: summary },
    { type: "heading", level: 1, text: "Documents" },
    { type: "fields", fields: signed },
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
      banded: true,
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
    } else {
      // A line between the signers who share a page.
      blocks.push({ type: "rule" });
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
    if (signer.attribution.location !== undefined) {
      fields.push({ label: "Location (by IP Address)", value: signer.attribution.location });
    }
    if (signer.attribution.userAgent !== undefined) {
      fields.push({ label: "Browser", value: signer.attribution.userAgent });
    }
    blocks.push(
      { type: "heading", level: 2, text: signerDisplayName(signer) },
      { type: "fields", fields },
    );
  }

  const logPages = auditPages(
    (certificate.events ?? []).map((event) => [
      clock(event.at),
      SIGNING_EVENT_LABEL[event.kind],
      event.actor ?? "System",
      event.observedIp ?? "",
      event.detail ?? "",
    ]),
  );
  for (const [page, rows] of logPages.entries()) {
    blocks.push(
      { type: "pageBreak" },
      { type: "heading", level: 1, text: pageHeading("Audit Log", page, logPages.length) },
      { type: "table", columns: AUDIT_COLUMNS, rows, banded: true },
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
      marginTop: PAGE_MARGIN_TOP,
      marginBottom: PAGE_MARGIN_BOTTOM,
    },
    accent: ACCENT,
    compact: true,
    typeface: options.typeface ?? "atkinsonHyperlegible",
    letterhead: {
      image: 0,
      title: "Certificate of Completion",
      label: "Reference",
      detail: certificate.reference,
    },
    footer: { center: "Page {page} of {pages}" },
    blocks,
  };
}

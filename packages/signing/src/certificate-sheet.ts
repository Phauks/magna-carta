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
import type { SignatureImage } from "./port.ts";

interface SheetField {
  readonly label: string;
  readonly value: string;
  /** The value's words set in columns of one width, so its lines stand under one another. */
  readonly grid?: true;
}

/** The blocks the sheet uses, a subset of the composer's own. */
export type CertificateSheetBlock =
  | { readonly type: "pageBreak" }
  | { readonly type: "cardStart"; readonly title?: string }
  | { readonly type: "cardEnd" }
  | { readonly type: "heading"; readonly level: 1 | 2; readonly text: string }
  | { readonly type: "paragraph"; readonly text: string }
  | {
      readonly type: "paragraph";
      readonly spans: readonly { readonly text: string; readonly bold?: boolean }[];
      readonly small: true;
    }
  | {
      readonly type: "fields";
      readonly fields: readonly SheetField[];
      /** Two columns side by side, read down the first and then the second. */
      readonly twoUp?: true;
    }
  | {
      readonly type: "table";
      readonly columns: readonly { readonly heading: string; readonly weight: number }[];
      readonly rows: readonly (readonly string[])[];
    }
  /** A picture named by its position in the list passed to the composer beside the sheet. */
  | { readonly type: "image"; readonly image: number; readonly width: number };

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
    readonly paper: CertificatePaper;
    readonly marginTop: number;
    readonly marginRight: number;
    readonly marginBottom: number;
    readonly marginLeft: number;
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
 * The pictures the sheet names by position: the lockup its letterhead draws, then each signer's
 * signature in the order given. Passed to the composer beside the sheet, with the same signatures
 * the sheet was laid out with.
 */
export function certificateSheetImages(
  signatureImages: readonly SignatureImage[] = [],
): Uint8Array[] {
  return [brandLockupPng(), ...signatureImages.map((signature) => signature.image)];
}

/**
 * The families the composer carries. Atkinson Hyperlegible, the application's own reading face,
 * draws Latin only; Liberation Sans also draws Greek and Cyrillic.
 */
export type CertificateTypeface = "atkinsonHyperlegible" | "liberationSans";

/** The paper the sheet is laid out for: US Letter unless told otherwise. */
export type CertificatePaper = "letter" | "a4";

/** Each paper's width and height in points, as the composer has them. */
const PAPER_SIZE: Record<CertificatePaper, { width: number; height: number }> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
};

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
  /**
   * The paper to lay the sheet out for. The margins are the same on either; the audit log's
   * pages are filled for the height and width the paper has.
   */
  readonly paper?: CertificatePaper;
  /**
   * The signers' signatures as pictures, each printed on its signer's record. A signer without
   * one is recorded by how they adopted their signature alone.
   */
  readonly signatureImages?: readonly SignatureImage[];
}

/**
 * How large a signature is printed, in points: as tall as three lines of the record, and no wider
 * than a signature line. A long name signed small and a short one signed large then print at the
 * same height.
 */
const SIGNATURE_HEIGHT = 36;
const SIGNATURE_WIDTH = 200;

/**
 * The width to print a signature at. A PNG says its size in its first chunk, and that gives the
 * width its height allows; any other picture is printed at the width of a short signature.
 */
function signatureWidth(image: Uint8Array): number {
  const isPng = image.length >= 24 && image[0] === 0x89 && image[1] === 0x50;
  if (!isPng) return SIGNATURE_WIDTH / 2;
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const [width, height] = [view.getUint32(16), view.getUint32(20)];
  if (width === 0 || height === 0) return SIGNATURE_WIDTH / 2;
  return Math.min(SIGNATURE_WIDTH, Math.round((SIGNATURE_HEIGHT * width) / height));
}

/** The platform's name, where no issuer contact says otherwise. */
const ISSUER_NAME = "Magna Carta";

/**
 * How far every edge of the printed sheet stays from the edge of the paper, in points: half an
 * inch on all four sides. The letterhead's bar starts there, the page number sits there, and the
 * cards run from one side margin to the other. Half an inch is inside what a desktop printer
 * reaches on Letter and on A4.
 */
const PAGE_EDGE = 36;

/** The top margin: the edge, then the room the composer's letterhead takes above the content. */
const PAGE_MARGIN_TOP = PAGE_EDGE + 60;

/** The bottom margin: the edge, then the room the composer's footer takes below the content. */
const PAGE_MARGIN_BOTTOM = PAGE_EDGE + 28;

/** What the composer's card takes above what it holds: the bar its title sits in. */
const CARD_TITLE_HEIGHT = 27;

/**
 * How many signers' full records one page holds. A record is never run across two pages: a reader
 * checking one person's consent and signature should not have to turn the sheet. Two is what a
 * letter page takes with room for a browser string that wraps.
 */
const SIGNERS_PER_PAGE = 2;

/** The audit log's columns. The weights share the page's width out of a hundred. */
const AUDIT_COLUMNS = [
  { heading: "Time (UTC)", weight: 21 },
  { heading: "Event", weight: 18 },
  { heading: "By", weight: 24 },
  { heading: "IP Address", weight: 15 },
  { heading: "Details", weight: 22 },
] as const;

/**
 * The room one page gives the audit log's rows, in points: the paper inside the sheet's margins,
 * less the card around the table and its title, less the table's own heading row, less a margin
 * for the estimate below being an estimate.
 */
function auditRowsHeight(paper: CertificatePaper): number {
  const content = PAPER_SIZE[paper].height - PAGE_MARGIN_TOP - PAGE_MARGIN_BOTTOM;
  return content - CARD_TITLE_HEIGHT - (ROW_LINE_HEIGHT + ROW_PADDING) - 20;
}

/** The composer's compact row: a line of cell text, and the space above and below a row. */
const ROW_LINE_HEIGHT = 13;
const ROW_PADDING = 3;

/**
 * How many characters of cell text fit a column one percent of the table wide, for each point of
 * the table's width. The composer measures real glyphs; this sheet cannot, so it assumes text a
 * little wider than it usually is. The time column is left out of the estimate because an instant
 * is sized to fit it.
 */
const CHARACTERS_PER_WEIGHT_POINT = 0.92 / 468;

/** The lines a row is expected to take in a table `width` points wide: its most-wrapped cell. */
function estimatedLines(row: readonly string[], width: number): number {
  let lines = 1;
  for (const [index, cell] of row.entries()) {
    const column = AUDIT_COLUMNS[index];
    if (index === 0 || column === undefined) continue;
    const capacity = Math.max(1, Math.floor(column.weight * CHARACTERS_PER_WEIGHT_POINT * width));
    lines = Math.max(lines, Math.ceil(cell.length / capacity));
  }
  return lines;
}

/**
 * The audit log's rows a page at a time. A page is filled by the height its rows are expected to
 * take, so a log of short rows runs well down the page and one of long rows still breaks where the
 * next heading can be printed above what follows.
 */
function auditPages(rows: readonly string[][], paper: CertificatePaper): string[][][] {
  const pages: string[][][] = [[]];
  const width = PAPER_SIZE[paper].width - 2 * PAGE_EDGE;
  const room = auditRowsHeight(paper);
  let used = 0;
  for (const row of rows) {
    const height = estimatedLines(row, width) * ROW_LINE_HEIGHT + ROW_PADDING;
    const page = pages.at(-1);
    if (page === undefined || (used + height > room && page.length > 0)) {
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
    { label: "Total Signatures", value: total(signatureCount) },
    { label: "Total Initials", value: total(initialCount) },
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
  const paper = options.paper ?? "letter";
  const blocks: CertificateSheetBlock[] = [
    { type: "cardStart", title: "Request Details" },
    { type: "fields", fields: summary, twoUp: true },
    { type: "cardEnd" },
    { type: "cardStart", title: "Documents" },
    { type: "fields", fields: signed },
    { type: "cardEnd" },
    { type: "cardStart", title: "Signers" },
    {
      type: "table",
      columns: [
        { heading: "Name", weight: 24 },
        { heading: "Email", weight: 31 },
        { heading: "Signed (UTC)", weight: 20 },
        { heading: "Signatures", weight: 14 },
        { heading: "Initials", weight: 11 },
      ],
      rows: signers.map((signer) => [
        signerDisplayName(signer),
        signer.intent.name === undefined ? "" : (signer.intent.email ?? ""),
        clock(signer.intent.affirmedAt),
        String(signatureCount(signer)),
        String(initialCount(signer)),
      ]),
    },
    { type: "cardEnd" },
    { type: "cardStart", title: "Contact" },
    ...(documentContact === undefined ? [] : [contactLine("Document", documentContact)]),
    contactLine("Certificate of Completion", options.issuerContact ?? { name: ISSUER_NAME }),
    { type: "cardEnd" },
  ];

  // Where each signer's signature sits in the pictures passed beside the sheet: after the lockup.
  const signatures = new Map(
    (options.signatureImages ?? []).map((signature, index) => [
      signature.signerId,
      { image: index + 1, width: signatureWidth(signature.image) },
    ]),
  );
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
    if (signer.attribution.codeDestination !== undefined) {
      fields.push({ label: "Code Sent To", value: signer.attribution.codeDestination });
    }
    fields.push(
      ...instantFields("Consent", signer.consent.consentedAt),
      { label: "Consent: Disclosure", value: signer.consent.disclosureVersion },
      { label: "Signature Type", value: ADOPTION_LABEL[signer.intent.adoption] },
      ...instantFields("Signed", signer.intent.affirmedAt),
      { label: "Signatures", value: String(signatureCount(signer)) },
      { label: "Initials", value: String(initialCount(signer)) },
    );
    // Where the signing act was observed from. These are the long values, set the full width.
    const observed: SheetField[] = [];
    if (signer.attribution.observedIp !== undefined) {
      observed.push({ label: "IP Address", value: signer.attribution.observedIp });
    }
    if (signer.attribution.location !== undefined) {
      observed.push({ label: "Location (by IP Address)", value: signer.attribution.location });
    }
    if (signer.attribution.userAgent !== undefined) {
      observed.push({ label: "Browser", value: signer.attribution.userAgent });
    }
    // Each signer is a card of their own, which is what parts the two who share a page. The
    // short facts are set in two columns; where they signed from takes the full width;
    // the signature, where there is a picture of it, closes the record.
    blocks.push(
      { type: "cardStart", title: signerDisplayName(signer) },
      { type: "fields", fields, twoUp: true },
    );
    if (observed.length > 0) blocks.push({ type: "fields", fields: observed });
    const signature = signatures.get(signer.intent.signerId);
    if (signature !== undefined) {
      blocks.push(
        { type: "paragraph", small: true, spans: [{ text: "Signature", bold: true }] },
        { type: "image", image: signature.image, width: signature.width },
      );
    }
    blocks.push({ type: "cardEnd" });
  }

  const logPages = auditPages(
    (certificate.events ?? []).map((event) => [
      clock(event.at),
      SIGNING_EVENT_LABEL[event.kind],
      event.actor ?? "System",
      event.observedIp ?? "",
      event.detail ?? "",
    ]),
    paper,
  );
  for (const [page, rows] of logPages.entries()) {
    blocks.push(
      { type: "pageBreak" },
      { type: "cardStart", title: pageHeading("Audit Log", page, logPages.length) },
      { type: "table", columns: AUDIT_COLUMNS, rows },
      { type: "cardEnd" },
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
      paper,
      marginTop: PAGE_MARGIN_TOP,
      marginRight: PAGE_EDGE,
      marginBottom: PAGE_MARGIN_BOTTOM,
      marginLeft: PAGE_EDGE,
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

// The Certificate of Completion as a document to print: the confirmation sheet and audit log a
// signing platform files beside a signed document. It is plain data in the shape the PDF composer
// (packages/pdf-compose) accepts, so this package stays free of the composer's WebAssembly and the
// sheet is testable as a value. The service that holds the composer turns it into pages.
//
// Every instant is printed in Coordinated Universal Time, to the second, because a certificate is
// read by people in more than one zone and a converted time invites the question of whose clock it
// was. The record and its plain text keep each instant exactly as it was stored.

import {
  card,
  clock,
  groupedCode,
  houseDocument,
  housePictures,
  instantFields,
  noteLine,
  pagedTable,
  pageHeading,
  pageList,
  pictureWidth,
  type HouseBlock,
  type HouseDocument,
  type HouseField,
  type HouseLetterhead,
  type HousePaper,
  type HouseTypeface,
} from "@magna-carta/house-document";

import {
  ADOPTION_LABEL,
  ATTRIBUTION_LABEL,
  SIGNING_EVENT_LABEL,
  signerDisplayName,
} from "./certificate.ts";
import type { CertificateOfCompletion, SignerCompletion, SigningContact } from "./esign.ts";
import type { SignatureImage } from "./port.ts";

/** The blocks the sheet uses: the house document's. */
export type CertificateSheetBlock = HouseBlock;

/** A house document with a letterhead on every page. */
export type CertificateSheet = HouseDocument & { readonly letterhead: HouseLetterhead };

/**
 * The pictures the sheet names by position: the lockup its letterhead draws, then each signer's
 * signature in the order given. Passed to the composer beside the sheet, with the same signatures
 * the sheet was laid out with.
 */
export function certificateSheetImages(
  signatureImages: readonly SignatureImage[] = [],
  initialsImages: readonly SignatureImage[] = [],
): Uint8Array[] {
  return housePictures([
    ...signatureImages.map((signature) => signature.image),
    ...initialsImages.map((initials) => initials.image),
  ]);
}

export type CertificateTypeface = HouseTypeface;
export type CertificatePaper = HousePaper;

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
  /** The signers' initials as pictures, each printed beside its signer's signature. */
  readonly initialsImages?: readonly SignatureImage[];
}

/**
 * How large a signature is printed, in points: as tall as three lines of the record, and no wider
 * than a signature line. A long name signed small and a short one signed large then print at the
 * same height.
 */
const SIGNATURE_HEIGHT = 36;
const SIGNATURE_WIDTH = 200;

function signatureWidth(image: Uint8Array, widest = SIGNATURE_WIDTH): number {
  return pictureWidth(image, SIGNATURE_HEIGHT, widest);
}

/** The platform's name, where no issuer contact says otherwise. */
const ISSUER_NAME = "Magna Carta";

/**
 * How many lines of signature pictures one page of signer details has room for, two pictures to a
 * line, beside two full records.
 */
const PICTURE_LINES_PER_PAGE = 3;

/**
 * The signers set out a page at a time: two to a page, and one alone where the two would carry
 * more signature pictures than a page has room for under their records.
 */
function signerPages(
  signers: readonly SignerCompletion[],
  pictureCount: (signer: SignerCompletion) => number,
): SignerCompletion[][] {
  const pages: SignerCompletion[][] = [];
  let lines = 0;
  for (const signer of signers) {
    const own = Math.ceil(pictureCount(signer) / 2);
    const page = pages.at(-1);
    if (
      page === undefined ||
      page.length >= SIGNERS_PER_PAGE ||
      lines + own > PICTURE_LINES_PER_PAGE
    ) {
      pages.push([signer]);
      lines = own;
    } else {
      page.push(signer);
      lines += own;
    }
  }
  return pages;
}

/**
 * What a signature picture is: "Signature" alone, its place among the signer's when they used
 * more than one, and the pages it was placed on when the signing flow gave them.
 */
function pictureLabel(
  what: string,
  place: number,
  count: number,
  pages: readonly number[] | undefined,
): string {
  const name = count > 1 ? `${what} ${place + 1} of ${count}` : what;
  return pages === undefined || pages.length === 0 ? name : `${name} (${pageList(pages)})`;
}

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

/** A contact as one small line: what it answers for, then who and how to reach them. */
function contactLine(about: string, contact: SigningContact): CertificateSheetBlock {
  return noteLine(about, [contact.name, contact.email, contact.phone]);
}

/** The signature blocks a signer completed: one, the signing act itself, where none is counted. */
function signatureCount(signer: SignerCompletion): number {
  return signer.intent.signatureCount ?? 1;
}

function initialCount(signer: SignerCompletion): number {
  return signer.intent.initialCount ?? 0;
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
  const summary: HouseField[] = [];
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
  const signed: HouseField[] = [];
  if (envelope?.title !== undefined) signed.push({ label: "Document", value: envelope.title });
  if (envelope?.pageCount !== undefined) {
    signed.push({ label: "Pages", value: String(envelope.pageCount) });
  }
  signed.push({
    label: "Hash (SHA-256)",
    value: groupedCode(certificate.documentHashSha256),
    grid: true,
  });

  const documentContact = envelope?.contact ?? envelope?.sender;
  const paper = options.paper ?? "letter";
  const blocks: CertificateSheetBlock[] = [
    ...card("Request Details", { type: "fields", fields: summary, twoUp: true }),
    ...card("Documents", { type: "fields", fields: signed }),
    ...card("Signers", {
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
    }),
    ...card(
      "Contact",
      ...(documentContact === undefined ? [] : [contactLine("Document", documentContact)]),
      contactLine("Certificate of Completion", options.issuerContact ?? { name: ISSUER_NAME }),
    ),
  ];

  // Where each signature sits in the pictures passed beside the sheet: after the lockup, in the
  // order given. Initials follow every signature; they are a few letters, so half the width.
  const signatureImages = options.signatureImages ?? [];
  const pictures = [
    ...signatureImages.map((picture, index) => ({
      picture,
      what: "Signature",
      image: 1 + index,
      width: signatureWidth(picture.image),
    })),
    ...(options.initialsImages ?? []).map((picture, index) => ({
      picture,
      what: "Initials",
      image: 1 + signatureImages.length + index,
      width: signatureWidth(picture.image, SIGNATURE_WIDTH / 2),
    })),
  ];
  const picturesOf = (signer: SignerCompletion) =>
    pictures.filter((entry) => entry.picture.signerId === signer.intent.signerId);
  const detailPagesOf = signerPages(signers, (signer) => picturesOf(signer).length);
  for (const [index, signer] of detailPagesOf.flatMap((page, number) =>
    page.map((signer, place) => [place === 0 ? number : -1, signer] as const),
  )) {
    if (index >= 0) {
      blocks.push(
        { type: "pageBreak" },
        {
          type: "heading",
          level: 1,
          text: pageHeading("Signer Details", index, detailPagesOf.length),
        },
      );
    }
    const fields: HouseField[] = [];
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
    const observed: HouseField[] = [];
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
    // the signature and the initials, where there are pictures of them, close the record.
    blocks.push(
      { type: "cardStart", title: signerDisplayName(signer) },
      { type: "fields", fields, twoUp: true },
    );
    if (observed.length > 0) blocks.push({ type: "fields", fields: observed });
    // Two pictures to a line: every signature the signer used, then every set of initials, each
    // under a label that says which it is and the pages it was placed on.
    const own = picturesOf(signer);
    for (const [place, entry] of own.entries()) {
      const alike = own.filter((other) => other.what === entry.what);
      blocks.push({
        type: "image",
        label: pictureLabel(entry.what, alike.indexOf(entry), alike.length, entry.picture.pages),
        image: entry.image,
        width: entry.width,
        ...(place % 2 === 1 ? { beside: true as const } : {}),
      });
    }
    blocks.push({ type: "cardEnd" });
  }

  blocks.push(
    ...pagedTable(
      "Audit Log",
      AUDIT_COLUMNS,
      (certificate.events ?? []).map((event) => [
        clock(event.at),
        SIGNING_EVENT_LABEL[event.kind],
        event.actor ?? "System",
        event.observedIp ?? "",
        event.detail ?? "",
      ]),
      // An instant is sized to fit the time column, so it never wraps.
      { paper, fittedColumns: [0] },
    ),
  );

  return houseDocument({
    name: "Certificate of Completion",
    subject:
      envelope?.title === undefined
        ? "Electronic signature record"
        : `Electronic signature record for ${envelope.title}`,
    created: certificate.sealedAt,
    paper,
    ...(options.typeface !== undefined ? { typeface: options.typeface } : {}),
    reference: { label: "Reference", value: certificate.reference },
    blocks,
  });
}

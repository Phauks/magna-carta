/*
 * Reading a file's real type from its first bytes, here in the browser.
 *
 * This is a PROVISIONAL reading. The authoritative identification is the Magika-backed container
 * behind `POST /api/v1/file-type/identify`, which reads the whole file and reports a confidence;
 * this reads a prefix against a signature table and reports what it saw. Both produce the same
 * `FileTypeReport` shape and the same label vocabulary (@magna-carta/file-type's labels), so the
 * panel is already written against what the server will send and swapping the source is one call.
 *
 * A provisional answer is worth having because the question this workbench exists to answer first
 * is "what is this, really" — and a file named `.pdf` whose bytes read `MZ` is worth saying so
 * about immediately, without a round trip. What it must never do is claim the server's certainty:
 * `provenance` carries which reading a panel is showing.
 *
 * The table is deliberately short and only holds signatures that are unambiguous at a fixed offset.
 * A type this cannot name comes back `unverifiable`, never a guess and never a false mismatch.
 */
import {
  canonicalExtensions,
  claimedExtensionOf,
  humanLabel,
  type ExtensionMatch,
  type FileTypeReport,
} from "@magna-carta/file-type";

/** How many leading bytes an identification needs. Enough for the OOXML part names in a ZIP. */
export const IDENTIFY_PREFIX_BYTES = 4096;

/** Which reading a report came from, so a panel never presents a prefix sniff as the last word. */
export type IdentifyProvenance = "prefix-scan" | "content-service";

export interface ProvisionalFileType {
  readonly report: FileTypeReport;
  readonly provenance: IdentifyProvenance;
  /** The leading bytes as hex, which is the evidence for whatever the report claims. */
  readonly magicBytes: string;
}

interface Signature {
  /** Byte values at `offset`; null matches any byte in that position. */
  readonly bytes: readonly (number | null)[];
  readonly offset: number;
  /** A @magna-carta/file-type label, so humanLabel and canonicalExtensions already know it. */
  readonly label: string;
  readonly group: string;
}

const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

// Longest and most specific first: the first match wins, and a ZIP container must lose to nothing
// because the OOXML kinds are decided by looking inside it, below.
const SIGNATURES: readonly Signature[] = [
  { offset: 0, bytes: ascii("%PDF-"), label: "pdf", group: "document" },
  {
    offset: 0,
    bytes: [0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a],
    label: "png",
    group: "image",
  },
  { offset: 0, bytes: [0xff, 0xd8, 0xff], label: "jpeg", group: "image" },
  { offset: 0, bytes: ascii("GIF8"), label: "gif", group: "image" },
  { offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00], label: "tiff", group: "image" },
  { offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a], label: "tiff", group: "image" },
  { offset: 0, bytes: [0x42, 0x4d], label: "bmp", group: "image" },
  { offset: 8, bytes: ascii("WEBP"), label: "webp", group: "image" },
  { offset: 4, bytes: [...ascii("ftyp"), null, null, null, null], label: "heif", group: "image" },
  {
    offset: 0,
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    label: "doc",
    group: "document",
  },
  { offset: 0, bytes: ascii("{\\rtf"), label: "rtf", group: "document" },
  { offset: 0, bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], label: "rar", group: "archive" },
  { offset: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], label: "sevenzip", group: "archive" },
  { offset: 0, bytes: [0x1f, 0x8b], label: "gzip", group: "archive" },
  { offset: 0, bytes: [0x4d, 0x5a], label: "pe", group: "executable" },
  { offset: 0, bytes: [0x7f, ...ascii("ELF")], label: "elf", group: "executable" },
];

// Inside a ZIP container the first local file header names a part, and the OOXML kinds put a
// telltale directory first. Checked against the decoded prefix, not the whole archive.
const OOXML_PARTS: readonly { readonly marker: string; readonly label: string }[] = [
  { marker: "word/", label: "docx" },
  { marker: "xl/", label: "xlsx" },
  { marker: "ppt/", label: "pptx" },
];

// An RFC 5322 message is text that opens on a header field. Any one of these at the very start is
// a strong enough reading to say "email" rather than "plain text".
const EMAIL_OPENERS: readonly string[] = [
  "Return-Path:",
  "Received:",
  "From:",
  "Delivered-To:",
  "MIME-Version:",
  "Message-ID:",
  "X-",
];

function matches(prefix: Uint8Array, signature: Signature): boolean {
  const end = signature.offset + signature.bytes.length;
  if (prefix.length < end) return false;
  return signature.bytes.every(
    (byte, index) => byte === null || prefix[signature.offset + index] === byte,
  );
}

/** The first bytes as spaced uppercase hex, which is what a reader checks a signature against. */
export function toMagicBytes(prefix: Uint8Array, count = 8): string {
  // Array.from, not a spread and not Uint8Array.map: a typed array's own map returns another typed
  // array, so mapping bytes to hex strings inside it does not type-check.
  return Array.from(prefix.slice(0, count), (byte) =>
    byte.toString(16).padStart(2, "0").toUpperCase(),
  ).join(" ");
}

function decodeAscii(prefix: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(prefix);
}

// Text, or bytes that only look like text? A NUL byte in the prefix settles it as binary, which is
// what separates a plain-text file from a container we have no signature for.
function looksLikeText(prefix: Uint8Array): boolean {
  return prefix.length > 0 && !prefix.includes(0x00);
}

/*
 * A reading is PRECISE when a signature named the format outright, and IMPRECISE when all the
 * prefix could establish is that the bytes are text. Plain text, CSV, JSON, XML, Markdown and a
 * dozen source formats are all the same bytes to a signature table, so an imprecise reading must
 * never contradict the extension: a `.csv` read as "text" is a file whose name is probably right,
 * not a file whose name disagrees. Reporting that as a mismatch would cry wolf on every CSV a firm
 * owns, and the mismatch warning is only worth anything if it is rare.
 */
interface Reading {
  readonly label: string;
  readonly group: string;
  readonly precise: boolean;
}

/** The label the prefix reads as, or null when nothing in the table matches confidently. */
function labelFor(prefix: Uint8Array): Reading | null {
  const zipHeader = matches(prefix, {
    offset: 0,
    bytes: [0x50, 0x4b, 0x03, 0x04],
    label: "zip",
    group: "archive",
  });
  if (zipHeader) {
    const text = decodeAscii(prefix);
    const part = OOXML_PARTS.find((candidate) => text.includes(candidate.marker));
    return part
      ? { label: part.label, group: "document", precise: true }
      : { label: "zip", group: "archive", precise: true };
  }

  const signature = SIGNATURES.find((candidate) => matches(prefix, candidate));
  if (signature) return { label: signature.label, group: signature.group, precise: true };

  if (looksLikeText(prefix)) {
    const text = decodeAscii(prefix);
    if (EMAIL_OPENERS.some((opener) => text.startsWith(opener))) {
      return { label: "email", group: "document", precise: true };
    }
    const trimmed = text.trimStart();
    if (trimmed.startsWith("<?xml")) return { label: "xml", group: "text", precise: false };
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return { label: "json", group: "text", precise: false };
    }
    return { label: "txt", group: "text", precise: false };
  }

  return null;
}

/**
 * The extension comparison, in the same vocabulary the server's report uses. An extension we hold
 * no canonical list for is `unverifiable`, never a mismatch: not knowing is not disagreement.
 */
function compareExtension(
  claimed: string | null,
  recommended: readonly string[],
  precise: boolean,
): ExtensionMatch {
  if (claimed === null) return "no-extension";
  if (recommended.length === 0) return "unverifiable";
  if (recommended.includes(claimed)) return "match";
  // An imprecise reading disagrees with nothing. It only established that the bytes are text, and
  // every text format is text.
  return precise ? "mismatch" : "unverifiable";
}

function noteFor(
  match: ExtensionMatch,
  detectedLabel: string,
  claimed: string | null,
  recommended: readonly string[],
  precise: boolean,
): string {
  switch (match) {
    case "match":
      return `The extension ".${claimed}" matches the content.`;
    case "mismatch":
      return `Named ".${claimed}", and the bytes read as ${detectedLabel}. The usual extension is ".${recommended[0]}".`;
    case "no-extension":
      return recommended.length > 0
        ? `The name carries no extension. The bytes read as ${detectedLabel}, usually named ".${recommended[0]}".`
        : `The name carries no extension. The bytes read as ${detectedLabel}.`;
    case "unverifiable":
      return precise
        ? `The bytes read as ${detectedLabel}, and there is no canonical extension to check the name against.`
        : `The file is plain text, so its type can't be confirmed from its contents.`;
  }
}

/** Identify a file from its leading bytes and its name. Deterministic; reads no more than it is given. */
export function identifyFromPrefix(prefix: Uint8Array, filename: string): ProvisionalFileType {
  const claimedExtension = claimedExtensionOf(filename);
  const magicBytes = toMagicBytes(prefix);
  const reading = labelFor(prefix);

  if (reading === null) {
    return {
      provenance: "prefix-scan",
      magicBytes,
      report: {
        detected: null,
        detectedLabel: "Unrecognized",
        group: "unknown",
        confidence: 0,
        claimedExtension,
        extensionMatch: "unverifiable",
        recommendedExtensions: [],
        note: "The leading bytes match no signature this reading knows, so the extension cannot be checked against them.",
      },
    };
  }

  const detectedLabel = humanLabel(reading.label);
  const recommendedExtensions = canonicalExtensions(reading.label);
  const extensionMatch = compareExtension(claimedExtension, recommendedExtensions, reading.precise);

  return {
    provenance: "prefix-scan",
    magicBytes,
    report: {
      detected: reading.label,
      detectedLabel,
      group: reading.group,
      // A signature match is certain about what it matched; a text reading is only certain that
      // the bytes are text. The content service reports a real model confidence in this field.
      confidence: reading.precise ? 1 : 0.5,
      claimedExtension,
      extensionMatch,
      recommendedExtensions,
      note: noteFor(
        extensionMatch,
        detectedLabel,
        claimedExtension,
        recommendedExtensions,
        reading.precise,
      ),
    },
  };
}

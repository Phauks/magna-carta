// What a capture entrance can tell about a payload before anything heavy touches it: is this an email
// at all, and is it small enough to accept? Both entrances answer those two questions the same way,
// which is why the answers live here rather than in either one.
//
// This is a cheap structural sniff, not a parse. It exists so the authenticated file-to-matter API can
// refuse a PDF at the door with a clear 4xx instead of accepting it, staging bytes, and letting the
// capture consumer discover the problem where the only outcomes left are a retry loop and a
// dead-letter. The real parse still happens off the request path.

/** The largest message any capture entrance accepts.
 *
 * Cloudflare Email Routing will not deliver a message much past this, so the forward/CC entrance is
 * bounded by it whatever a firm configures; the authenticated API entrance takes the smaller of this
 * and the firm's own inspectable-size cap, so the two entrances cannot disagree about what "too large
 * to file" means. A message over the ceiling is refused with a reason, never silently dropped. */
export const MAX_CAPTURED_MESSAGE_BYTES = 40 * 1024 * 1024;

/** The media types the ingest chokepoint's upload policy already names for the two mail formats. */
export const EML_MEDIA_TYPE = "message/rfc822";
export const MSG_MEDIA_TYPE = "application/vnd.ms-outlook";

export type MessageFormat = "eml" | "msg" | "unknown";

// The compound-file (OLE2) magic every .msg export starts with. A .msg is a compound file; nothing
// else this endpoint accepts is.
const COMPOUND_FILE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

// An RFC 5322 field name: printable US-ASCII except the colon, per the grammar's ftext production.
const FIELD_NAME = /^[\x21-\x39\x3b-\x7e]+:/;

// How far in to look for the first field. A real message's first header is at byte zero; the window
// only absorbs a stray byte-order mark or leading blank line.
const SNIFF_WINDOW_BYTES = 8 * 1024;

/**
 * Name the container these bytes are in, or `unknown` when they are neither mail format. Deliberately
 * conservative: it accepts anything that opens like a header block, because a message with unusual
 * headers is still the firm's mail and must not be refused, while a document, image, or archive opens
 * nothing like one.
 */
export function sniffMessageFormat(bytes: Uint8Array): MessageFormat {
  if (bytes.length === 0) return "unknown";
  if (COMPOUND_FILE_MAGIC.every((byte, index) => bytes[index] === byte)) return "msg";

  const head = decodeHead(bytes);
  for (const line of head.split(/\r\n|\n|\r/)) {
    // Leading blank lines and a UTF-8 byte-order mark are tolerated; the first line with content
    // decides.
    const candidate = line.replace(/^﻿/, "");
    if (candidate.trim() === "") continue;
    // An mbox member, and some exports, lead with the envelope "From " line rather than a field.
    if (candidate.startsWith("From ")) return "eml";
    return FIELD_NAME.test(candidate) ? "eml" : "unknown";
  }
  return "unknown";
}

/** The media type to declare for a sniffed format, for the upload policy the ingest path applies. */
export function mediaTypeForMessageFormat(format: MessageFormat): string | null {
  if (format === "eml") return EML_MEDIA_TYPE;
  if (format === "msg") return MSG_MEDIA_TYPE;
  return null;
}

/** A conventional filename for a sniffed format, for the policy's extension check. */
export function fileNameForMessageFormat(format: MessageFormat): string {
  return format === "msg" ? "message.msg" : "message.eml";
}

function decodeHead(bytes: Uint8Array): string {
  const head = bytes.subarray(0, Math.min(bytes.length, SNIFF_WINDOW_BYTES));
  // Headers are US-ASCII by construction, so a lossy decode is exactly right here: a non-text payload
  // decodes to replacement characters, which match no field name.
  return new TextDecoder("utf-8", { fatal: false }).decode(head);
}

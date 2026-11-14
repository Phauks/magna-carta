/*
 * What the Email tab shows, decided from a parsed message without a DOM.
 *
 * The parser (`@magna-carta/email`, Rust compiled to WebAssembly) reports what the file says and
 * passes no verdict. This module only arranges that: names beside addresses, the servers a message
 * passed through in the order it passed through them, and which parts a person would call an
 * attachment. A date is the header's own text, never re-derived: the sender's clock and zone are the
 * evidence, and converting them is a reading somebody else should be able to check.
 */
import type { Address, ParsedMessage, PartDescriptor } from "@magna-carta/email";

/** "Dana Reyes <dreyes@example.com>", or whichever half the message carries. */
export function formatAddress(address: Address): string {
  const name = address.displayName?.trim() || null;
  const mailbox = address.address?.trim() || null;
  if (name !== null && mailbox !== null && name !== mailbox) return `${name} <${mailbox}>`;
  return name ?? mailbox ?? "Unnamed";
}

export function formatAddresses(addresses: readonly Address[]): string | null {
  if (addresses.length === 0) return null;
  return addresses.map(formatAddress).join(", ");
}

/** One server the message passed through. */
export interface RouteHop {
  /** The server that received it, from the header's `by` clause, or null when it names none. */
  readonly receivedBy: string | null;
  /** The server it came from, from the header's `from` clause. */
  readonly receivedFrom: string | null;
  /** Whatever follows the header's `with` clause: ESMTPS, LMTP, HTTP. */
  readonly protocol: string | null;
  /** The header's own date text, after its semicolon. */
  readonly when: string | null;
}

function clause(header: string, keyword: string): string | null {
  const match = new RegExp(`(?:^|\\s)${keyword}\\s+([^\\s;()]+)`, "i").exec(header);
  return match?.[1] ?? null;
}

/** Read one `Received:` header. Fields it cannot find are null rather than guessed. */
export function readReceivedHeader(header: string): RouteHop {
  const unfolded = header.replace(/\s+/g, " ").trim();
  const semicolon = unfolded.lastIndexOf(";");
  const when = semicolon === -1 ? null : unfolded.slice(semicolon + 1).trim() || null;
  return {
    receivedBy: clause(unfolded, "by"),
    receivedFrom: clause(unfolded, "from"),
    protocol: clause(unfolded, "with"),
    when,
  };
}

/**
 * The route, oldest hop first. Each server adds its `Received:` header above the ones already
 * there, so the headers arrive newest first and the route is that list turned round.
 */
export function routeOf(message: ParsedMessage): readonly RouteHop[] {
  return [...message.integrity.receivedChain].reverse().map(readReceivedHeader);
}

/** A part a person would call an attachment, with its position for `extractPart`. */
export interface AttachmentRow {
  readonly index: number;
  readonly name: string;
  readonly mediaType: string | null;
  readonly sizeBytes: number;
  readonly isEmbeddedMessage: boolean;
}

function nameOf(part: PartDescriptor, index: number): string {
  const filename = part.filename?.trim();
  if (filename) return filename;
  return part.isEmbeddedMessage ? `Attached message ${index + 1}.eml` : `Attachment ${index + 1}`;
}

/**
 * The attachments: every part marked as one, and any inline part that is not a body (a picture in
 * a signature is inline, and is still a file somebody may need).
 */
export function attachmentsOf(message: ParsedMessage): readonly AttachmentRow[] {
  return message.parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.disposition === "attachment" || part.filename !== null)
    .map(({ part, index }) => ({
      index,
      name: nameOf(part, index),
      mediaType: part.mediaType,
      sizeBytes: part.size,
      isEmbeddedMessage: part.isEmbeddedMessage,
    }));
}

/** Plain text of the body, from the text part, or from the HTML part with its markup taken out. */
export function bodyTextOf(message: ParsedMessage): string | null {
  const text = message.textBodies.find((body) => body.trim() !== "");
  if (text !== undefined) return text.trim();
  const html = message.htmlBodies.find((body) => body.trim() !== "");
  if (html === undefined) return null;
  return (
    html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&amp;/gi, "&")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .trim() || null
  );
}

/** What the authentication headers record, as the evidence it is: present or not, no verdict. */
export function authenticationOf(message: ParsedMessage): {
  readonly dkimSigned: boolean;
  readonly results: readonly string[];
} {
  return {
    dkimSigned: message.integrity.dkimSignatures.length > 0,
    results: message.integrity.authenticationResults,
  };
}

/*
 * An email as a printable document: the shape a message takes when it is produced as an exhibit.
 *
 * Pure data in, pure data out. The result is a `ComposeDocument` for `@magna-carta/pdf-compose`, so
 * the same layout serves the browser (the File Workbench's Email tab) and, later, a server-side
 * conversion, and the layout can be tested without either engine loaded.
 *
 * What it prints is what the file says. The date is the header's own text, an address is printed
 * as the message carries it, and nothing is summarized or judged.
 */
import type { ComposeBlock, ComposeDocument } from "@magna-carta/pdf-compose";
import type { Address, ParsedMessage } from "./index.ts";

export interface MessageDocumentOptions {
  /** Print every header the message carries, in its order, after the body. */
  readonly includeFullHeaders?: boolean;
  /** The file the message came from, printed in the running footer. */
  readonly sourceName?: string;
  readonly paper?: "letter" | "a4";
}

function formatAddress(address: Address): string {
  const name = address.displayName?.trim() || null;
  const mailbox = address.address?.trim() || null;
  if (name !== null && mailbox !== null && name !== mailbox) return `${name} <${mailbox}>`;
  return name ?? mailbox ?? "Unnamed";
}

function addressLine(addresses: readonly Address[]): string | null {
  return addresses.length === 0 ? null : addresses.map(formatAddress).join(", ");
}

/** The body as paragraphs: the text part, or the HTML part with its markup removed. */
function bodyParagraphs(message: ParsedMessage): string[] {
  const text =
    message.textBodies.find((body) => body.trim() !== "") ??
    htmlToText(message.htmlBodies.find((body) => body.trim() !== "") ?? "");
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ");
}

/** A reader's name for a media type: "Word document", not the registered type. */
const KIND_NAMES: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "application/msword": "Word document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word document",
  "application/vnd.ms-excel": "Excel workbook",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel workbook",
  "application/vnd.ms-powerpoint": "PowerPoint presentation",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PowerPoint presentation",
  "application/zip": "Zip archive",
  "message/rfc822": "Email message",
  "application/vnd.ms-outlook": "Email message",
  "text/plain": "Text",
  "text/html": "Web page",
  "text/calendar": "Calendar invitation",
};

function kindOf(mediaType: string | null): string {
  if (mediaType === null) return "Unknown";
  const bare = mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
  const named = KIND_NAMES[bare];
  if (named !== undefined) return named;
  if (bare.startsWith("image/")) return `${bare.slice(6).toUpperCase()} picture`;
  if (bare.startsWith("audio/")) return "Audio";
  if (bare.startsWith("video/")) return "Video";
  return bare === "" ? "Unknown" : bare;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Lay a parsed message out as a printable document. */
export function messageDocument(
  message: ParsedMessage,
  options: MessageDocumentOptions = {},
): ComposeDocument {
  const subject = message.subject?.trim() || "(No Subject)";
  const fields: { label: string; value: string }[] = [];
  const push = (label: string, value: string | null): void => {
    if (value !== null && value.trim() !== "") fields.push({ label, value });
  };
  push("From", addressLine(message.from));
  push("Sent", message.dateRaw);
  push("To", addressLine(message.to));
  push("Cc", addressLine(message.cc));
  push("Bcc", addressLine(message.bcc));
  push("Subject", subject);

  const blocks: ComposeBlock[] = [
    { type: "title", text: subject },
    { type: "fields", fields },
  ];
  blocks.push({ type: "rule" });

  const paragraphs = bodyParagraphs(message);
  if (paragraphs.length === 0) {
    blocks.push({ type: "paragraph", text: "This message has no text body.", small: true });
  } else {
    for (const paragraph of paragraphs) blocks.push({ type: "paragraph", text: paragraph });
  }

  const attachments = message.parts.filter(
    (part) => part.disposition === "attachment" || part.filename !== null,
  );
  if (attachments.length > 0) {
    blocks.push({ type: "heading", level: 2, text: "Attachments" });
    blocks.push({
      type: "table",
      columns: [
        { heading: "Name", weight: 3 },
        { heading: "Type", weight: 2 },
        { heading: "Size", weight: 1, alignment: "end" },
      ],
      rows: attachments.map((part, position) => [
        part.filename?.trim() || `Attachment ${position + 1}`,
        kindOf(part.mediaType),
        formatSize(part.size),
      ]),
    });
  }

  if (options.includeFullHeaders === true && message.rawHeaders.length > 0) {
    blocks.push({ type: "pageBreak" });
    blocks.push({ type: "heading", level: 2, text: "Full Headers" });
    blocks.push({
      type: "table",
      columns: [
        { heading: "Header", weight: 1 },
        { heading: "Value", weight: 3 },
      ],
      rows: message.rawHeaders.map((header) => [
        header.name,
        header.value.replace(/\s+/g, " ").trim(),
      ]),
    });
  }

  const footerLeft = options.sourceName === undefined ? undefined : options.sourceName;
  return {
    title: subject,
    subject: "Email message",
    page: { paper: options.paper ?? "letter" },
    footer: { left: footerLeft, right: "Page {page} of {pages}" },
    blocks,
  };
}

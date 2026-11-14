import { describe, expect, it } from "vitest";
import type { ParsedMessage } from "../src/index.ts";
import { messageDocument } from "../src/message-document.ts";

function message(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    messageIdentifier: { value: "a@example.test", provenance: "header" },
    inReplyTo: null,
    references: [],
    subject: "Settlement terms",
    dateRaw: "Tue, 4 Nov 2026 16:12:03 -0500",
    from: [{ displayName: "Dana Reyes", address: "dana@example.test" }],
    to: [{ displayName: null, address: "jordan@example.test" }],
    cc: [],
    bcc: [],
    rawHeaders: [
      { name: "From", value: "Dana Reyes <dana@example.test>" },
      { name: "Received", value: "from a\r\n by b; Tue, 4 Nov 2026" },
    ],
    textBodies: ["Jordan,\n\nAttached is v3.\n\nDana"],
    htmlBodies: [],
    rtfBody: null,
    parts: [
      {
        filename: "Term Sheet.docx",
        mediaType: "application/octet-stream",
        contentIdentifier: null,
        disposition: "attachment",
        size: 38_912,
        locator: { kind: "inputRange", start: 0, end: 1 },
        isEmbeddedMessage: false,
      },
      {
        filename: "Photo.JPG",
        mediaType: "image/jpeg; name=Photo.JPG",
        contentIdentifier: null,
        disposition: "attachment",
        size: 1_258_291,
        locator: { kind: "inputRange", start: 1, end: 2 },
        isEmbeddedMessage: false,
      },
    ],
    integrity: { dkimSignatures: [], authenticationResults: [], receivedChain: [] },
    sourceFormat: "eml",
    referencesRemoteContent: false,
    ...overrides,
  };
}

describe("messageDocument", () => {
  it("prints the headers a reader needs, the body by paragraph, and the attachments", () => {
    const document = messageDocument(message(), { sourceName: "terms.eml" });
    expect(document.blocks[0]).toEqual({ type: "title", text: "Settlement terms" });
    expect(document.blocks[1]).toEqual({
      type: "fields",
      fields: [
        { label: "From", value: "Dana Reyes <dana@example.test>" },
        { label: "Sent", value: "Tue, 4 Nov 2026 16:12:03 -0500" },
        { label: "To", value: "jordan@example.test" },
        { label: "Subject", value: "Settlement terms" },
      ],
    });
    const paragraphs = document.blocks.filter((block) => block.type === "paragraph");
    expect(paragraphs.map((block) => block.type === "paragraph" && block.text)).toEqual([
      "Jordan,",
      "Attached is v3.",
      "Dana",
    ]);
    const table = document.blocks.find((block) => block.type === "table");
    expect(table?.type === "table" && table.rows).toEqual([
      ["Term Sheet.docx", "application/octet-stream", "38 KB"],
      ["Photo.JPG", "JPEG picture", "1.2 MB"],
    ]);
    expect(document.footer).toEqual({ left: "terms.eml", right: "Page {page} of {pages}" });
  });

  it("adds every header on its own page only when asked", () => {
    expect(messageDocument(message()).blocks.some((block) => block.type === "pageBreak")).toBe(
      false,
    );
    const withHeaders = messageDocument(message(), { includeFullHeaders: true });
    const last = withHeaders.blocks.at(-1);
    expect(last?.type === "table" && last.rows[1]).toEqual([
      "Received",
      "from a by b; Tue, 4 Nov 2026",
    ]);
  });

  it("says so when there is no body, and names an untitled message", () => {
    const document = messageDocument(message({ subject: null, textBodies: [], parts: [] }));
    expect(document.blocks[0]).toEqual({ type: "title", text: "(No Subject)" });
    expect(document.blocks).toContainEqual({
      type: "paragraph",
      text: "This message has no text body.",
      small: true,
    });
  });
});

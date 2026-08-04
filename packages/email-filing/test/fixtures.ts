import type { ParsedMessage } from "@magna-carta/email";

// Build a ParsedMessage directly for the pure unit tests — dedup/thread/record take the typed record,
// not bytes, so these tests never touch the WASM parser.
export function makeParsedMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    messageIdentifier: { value: "<a@example.com>", provenance: "header" },
    inReplyTo: null,
    references: [],
    subject: "Re: matter update",
    dateRaw: "Wed, 15 Jul 2026 09:00:00 +0000",
    from: [{ displayName: "Alice Adams", address: "alice@example.com" }],
    to: [{ displayName: "Bob Barr", address: "bob@firm.example" }],
    cc: [],
    bcc: [],
    rawHeaders: [],
    textBodies: ["Hello Bob, here is the update."],
    htmlBodies: [],
    rtfBody: null,
    parts: [],
    integrity: { dkimSignatures: [], authenticationResults: [], receivedChain: [] },
    sourceFormat: "eml",
    referencesRemoteContent: false,
    ...overrides,
  };
}

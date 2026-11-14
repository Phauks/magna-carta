import { describe, expect, it } from "vitest";
import type { ParsedMessage } from "@magna-carta/email";
import {
  attachmentsOf,
  bodyTextOf,
  formatAddress,
  readReceivedHeader,
  routeOf,
} from "../src/lib/tools/file-workbench/email-reading.ts";

function message(overrides: Partial<ParsedMessage>): ParsedMessage {
  return {
    messageIdentifier: { value: "a@example.test", provenance: "header" },
    inReplyTo: null,
    references: [],
    subject: "Retainer",
    dateRaw: "Tue, 4 Nov 2026 16:12:03 -0500",
    from: [],
    to: [],
    cc: [],
    bcc: [],
    rawHeaders: [],
    textBodies: [],
    htmlBodies: [],
    rtfBody: null,
    parts: [],
    integrity: { dkimSignatures: [], authenticationResults: [], receivedChain: [] },
    sourceFormat: "eml",
    referencesRemoteContent: false,
    ...overrides,
  };
}

describe("formatAddress", () => {
  it("puts the name beside the mailbox, or whichever half there is", () => {
    expect(formatAddress({ displayName: "Dana Reyes", address: "dana@example.test" })).toBe(
      "Dana Reyes <dana@example.test>",
    );
    expect(formatAddress({ displayName: null, address: "dana@example.test" })).toBe(
      "dana@example.test",
    );
    expect(formatAddress({ displayName: " ", address: null })).toBe("Unnamed");
  });
});

describe("routeOf", () => {
  it("reads the Received headers oldest first", () => {
    const route = routeOf(
      message({
        integrity: {
          dkimSignatures: [],
          authenticationResults: [],
          receivedChain: [
            "from relay.example.test (relay.example.test [192.0.2.1]) by mx.firm.test with ESMTPS; Tue, 4 Nov 2026 16:12:08 -0500",
            "from client by mail.sender.test with ESMTPSA; Tue, 4 Nov 2026 16:12:03 -0500",
          ],
        },
      }),
    );
    expect(route.map((hop) => hop.receivedBy)).toEqual(["mail.sender.test", "mx.firm.test"]);
    expect(route[1]).toMatchObject({
      receivedFrom: "relay.example.test",
      protocol: "ESMTPS",
      when: "Tue, 4 Nov 2026 16:12:08 -0500",
    });
  });

  it("leaves a field it cannot find empty rather than guessing", () => {
    expect(readReceivedHeader("garbled header")).toEqual({
      receivedBy: null,
      receivedFrom: null,
      protocol: null,
      when: null,
    });
  });
});

describe("attachmentsOf", () => {
  it("lists attachments and named inline parts, keeping each part's index", () => {
    const rows = attachmentsOf(
      message({
        parts: [
          {
            filename: null,
            mediaType: "text/plain",
            contentIdentifier: null,
            disposition: "inline",
            size: 10,
            locator: { kind: "inputRange", start: 0, end: 10 },
            isEmbeddedMessage: false,
          },
          {
            filename: "Term Sheet.docx",
            mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            contentIdentifier: null,
            disposition: "attachment",
            size: 38_000,
            locator: { kind: "inputRange", start: 10, end: 20 },
            isEmbeddedMessage: false,
          },
          {
            filename: null,
            mediaType: "message/rfc822",
            contentIdentifier: null,
            disposition: "attachment",
            size: 500,
            locator: { kind: "mapiStream", name: "x" },
            isEmbeddedMessage: true,
          },
        ],
      }),
    );
    expect(rows.map((row) => [row.index, row.name])).toEqual([
      [1, "Term Sheet.docx"],
      [2, "Attached message 3.eml"],
    ]);
  });
});

describe("bodyTextOf", () => {
  it("prefers the text body", () => {
    expect(bodyTextOf(message({ textBodies: ["  Hello  "], htmlBodies: ["<p>Other</p>"] }))).toBe(
      "Hello",
    );
  });

  it("takes the markup out of an HTML-only body, scripts included", () => {
    expect(
      bodyTextOf(
        message({
          htmlBodies: ["<p>Jordan,</p><script>alert(1)</script><p>Terms &amp; conditions</p>"],
        }),
      ),
    ).toBe("Jordan,\n Terms & conditions");
  });

  it("is null when there is no body", () => {
    expect(bodyTextOf(message({}))).toBeNull();
  });
});

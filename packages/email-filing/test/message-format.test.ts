import { describe, expect, it } from "vitest";
import {
  fileNameForMessageFormat,
  mediaTypeForMessageFormat,
  sniffMessageFormat,
} from "../src/message-format.ts";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("sniffMessageFormat", () => {
  it("recognizes an RFC 5322 message by its first header field", () => {
    expect(sniffMessageFormat(encode("From: a@example.test\r\n\r\nBody.\r\n"))).toBe("eml");
  });

  it("recognizes a .msg export by its compound-file magic", () => {
    const bytes = new Uint8Array(16);
    bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(sniffMessageFormat(bytes)).toBe("msg");
  });

  it("recognizes an mbox-style envelope line", () => {
    expect(
      sniffMessageFormat(encode("From alice@example.test Mon Jan 1\r\nFrom: a\r\n\r\nx")),
    ).toBe("eml");
  });

  it("tolerates leading blank lines", () => {
    expect(sniffMessageFormat(encode("\r\n\r\nSubject: Late start\r\n\r\nBody"))).toBe("eml");
  });

  // The refusals that matter: a document posted to the capture endpoint must be told apart from mail
  // at the door, not accepted and discovered in the consumer where the only outcomes are a retry loop
  // and a dead letter.
  it("refuses a PDF", () => {
    expect(sniffMessageFormat(encode("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"))).toBe("unknown");
  });

  it("refuses a ZIP-family document", () => {
    expect(sniffMessageFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBe(
      "unknown",
    );
  });

  it("refuses plain prose with no header field", () => {
    expect(sniffMessageFormat(encode("Dear Bob,\r\n\r\nplease see attached.\r\n"))).toBe("unknown");
  });

  it("refuses empty bytes", () => {
    expect(sniffMessageFormat(new Uint8Array())).toBe("unknown");
  });
});

describe("media type and file name for a format", () => {
  it("names the two types the ingest policy already allows, and nothing for unknown", () => {
    expect(mediaTypeForMessageFormat("eml")).toBe("message/rfc822");
    expect(mediaTypeForMessageFormat("msg")).toBe("application/vnd.ms-outlook");
    expect(mediaTypeForMessageFormat("unknown")).toBeNull();
  });

  it("gives each format the extension the policy's blocklist checks against", () => {
    expect(fileNameForMessageFormat("eml")).toBe("message.eml");
    expect(fileNameForMessageFormat("msg")).toBe("message.msg");
  });
});

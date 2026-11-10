import { describe, expect, it } from "vitest";

import { certificateSheet } from "../src/certificate-sheet.ts";
import { assembleCertificateOfCompletion } from "../src/certificate.ts";

const HASH = "0123456789abcdef".repeat(4);

function certificate() {
  return assembleCertificateOfCompletion({
    documentHashSha256: HASH,
    sealedAt: "2026-07-18T12:00:01Z",
    signers: [
      {
        intent: {
          signerId: "sgn_1",
          name: "Alice Example",
          email: "alice@example.test",
          adoption: "drawn",
          affirmedAt: "2026-07-18T12:00:00Z",
        },
        consent: { disclosureVersion: "v1", consentedAt: "2026-07-18T11:59:00Z" },
        attribution: {
          level: "access-code",
          observedIp: "198.51.100.7",
          userAgent: "ExampleBrowser/1.0",
          proofReference: "code_42",
        },
      },
    ],
    envelope: {
      id: "env_0001",
      title: "Engagement letter.pdf",
      pageCount: 3,
      sender: { name: "Bob Sender", email: "bob@example.test" },
      createdAt: "2026-07-18T11:49:00Z",
    },
    events: [{ kind: "sent", at: "2026-07-18T11:50:00Z", actor: "Bob Sender" }],
  });
}

describe("certificateSheet", () => {
  it("prints what was signed, who signed and how each was identified", () => {
    const sheet = certificateSheet(certificate());
    const fields = sheet.blocks.flatMap((block) => (block.type === "fields" ? block.fields : []));
    const value = (label: string) => fields.find((field) => field.label === label)?.value;

    expect(sheet.blocks[0]).toEqual({ type: "title", text: "Certificate of Completion" });
    expect(value("Reference")).toBe("env_0001");
    expect(value("Document")).toBe("Engagement letter.pdf");
    expect(value("Pages")).toBe("3");
    expect(value("Sent by")).toBe("Bob Sender (bob@example.test)");
    expect(value("Document hash (SHA-256)")?.replace(" ", "")).toBe(HASH);
    expect(value("Email")).toBe("alice@example.test");
    expect(value("Identified by")).toBe("Email/SMS one-time access code");
    expect(value("Identity proof")).toBe("code_42");
    expect(value("Sealed")).toBe("2026-07-18 12:00:01 UTC");
    expect(value("Agreed to sign electronically")).toBe("2026-07-18 11:59:00 UTC (disclosure v1)");
    expect(value("IP address")).toBe("198.51.100.7");
    expect(value("Browser")).toBe("ExampleBrowser/1.0");
    expect(sheet.footer).toEqual({ left: "Reference env_0001", right: "Page {page} of {pages}" });
    expect(sheet.created).toEqual({
      year: 2026,
      month: 7,
      day: 18,
      hour: 12,
      minute: 0,
      second: 1,
    });
  });

  it("lists the audit log one row to a step, oldest first", () => {
    const table = certificateSheet(certificate()).blocks.find((block) => block.type === "table");
    expect(table?.type === "table" ? table.rows : []).toEqual([
      ["2026-07-18 11:50:00", "Sent for signature", "Bob Sender", "", ""],
      [
        "2026-07-18 11:59:00",
        "Agreed to sign electronically",
        "Alice Example",
        "198.51.100.7",
        "Disclosure v1",
      ],
      ["2026-07-18 12:00:00", "Signed", "Alice Example", "198.51.100.7", "Signature drawn"],
      ["2026-07-18 12:00:01", "Sealed with the platform certificate", "System", "", ""],
    ]);
  });

  it("is the same sheet for the same certificate", () => {
    expect(certificateSheet(certificate())).toEqual(certificateSheet(certificate()));
  });
});

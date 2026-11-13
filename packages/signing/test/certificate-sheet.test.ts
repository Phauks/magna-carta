import { describe, expect, it } from "vitest";

import { certificateSheet, certificateSheetImages } from "../src/certificate-sheet.ts";
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

    expect(sheet.blocks[0]).toEqual({ type: "image", image: 0, width: 130 });
    expect(sheet.blocks[2]).toEqual({ type: "title", text: "Certificate of Completion" });
    // A number a person can read out, never the request's internal identifier.
    expect(value("Reference")).toBe("MC-0123-4567-89AB");
    expect(JSON.stringify(sheet)).not.toContain("env_0001");
    expect(JSON.stringify(sheet)).not.toContain("sgn_1");
    expect(value("Document")).toBe("Engagement letter.pdf");
    expect(value("Pages")).toBe("3");
    expect(value("Sent By")).toBe("Bob Sender");
    expect(value("Sender Email")).toBe("bob@example.test");
    expect(value("Times")).toBe("Coordinated Universal Time (UTC)");
    expect(value("Document Hash (SHA-256)")?.replace(" ", "")).toBe(HASH);
    expect(value("Email")).toBe("alice@example.test");
    expect(value("Identified By")).toBe("Email/SMS one-time access code");
    expect(value("Identity Proof")).toBe("code_42");
    expect(value("Sealed")).toBe("2026-07-18 12:00:01 UTC");
    expect(value("Agreed to Sign Electronically")).toBe("2026-07-18 11:59:00 UTC (disclosure v1)");
    expect(value("IP Address")).toBe("198.51.100.7");
    expect(value("Browser")).toBe("ExampleBrowser/1.0");
    expect(sheet.footer).toEqual({
      left: "Certificate MC-0123-4567-89AB",
      right: "Page {page} of {pages}",
    });
    expect(sheet.accent).toEqual([98, 72, 0]);
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
      ["2026-07-18 11:50:00", "Sent for Signature", "Bob Sender", "", ""],
      [
        "2026-07-18 11:59:00",
        "Agreed to Sign Electronically",
        "Alice Example",
        "198.51.100.7",
        "Disclosure v1",
      ],
      ["2026-07-18 12:00:00", "Signed", "Alice Example", "198.51.100.7", "Signature drawn"],
      ["2026-07-18 12:00:01", "Sealed", "System", "", "Platform certificate"],
    ]);
  });

  it("starts the signers and the audit log each on a page of their own", () => {
    const blocks = certificateSheet(certificate()).blocks;
    const before = (text: string) =>
      blocks[blocks.findIndex((block) => block.type === "heading" && block.text === text) - 1];
    expect(before("Signers")).toEqual({ type: "pageBreak" });
    expect(before("Audit Log")).toEqual({ type: "pageBreak" });
  });

  it("says who to ask about the document: the named contact, else the sender", () => {
    const paragraphs = (sheet: ReturnType<typeof certificateSheet>) =>
      sheet.blocks.flatMap((block) => (block.type === "paragraph" ? [block.text] : []));
    expect(paragraphs(certificateSheet(certificate()))).toEqual([
      "Questions about this document? Contact Bob Sender at bob@example.test.",
    ]);
    const record = certificate();
    const named = certificateSheet({
      ...record,
      envelope: {
        id: "env_0001",
        contact: { name: "Example Law Firm", email: "office@example.test", phone: "555-0100" },
      },
    });
    expect(paragraphs(named)).toEqual([
      "Questions about this document? Contact Example Law Firm at office@example.test or 555-0100.",
    ]);
  });

  it("carries the lockup as a picture the composer can read", () => {
    const [lockup] = certificateSheetImages();
    expect(Array.from(lockup ?? []).slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("is the same sheet for the same certificate", () => {
    expect(certificateSheet(certificate())).toEqual(certificateSheet(certificate()));
  });
});

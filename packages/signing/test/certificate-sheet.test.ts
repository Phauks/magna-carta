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
          signatureCount: 2,
          initialCount: 5,
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
    expect(sheet.blocks[1]).toEqual({ type: "title", text: "Certificate of Completion" });
    // A number a person can read out, never the request's internal identifier.
    expect(value("Reference")).toBe("MC-0123-4567-89AB");
    expect(JSON.stringify(sheet)).not.toContain("env_0001");
    expect(JSON.stringify(sheet)).not.toContain("sgn_1");
    expect(value("Document")).toBe("Engagement letter.pdf");
    expect(value("Pages")).toBe("3");
    expect(value("Sender: Name")).toBe("Bob Sender");
    expect(value("Sender: Email")).toBe("bob@example.test");
    expect(value("Time Zone")).toBe("Coordinated Universal Time (UTC)");
    expect(value("Created: Date")).toBe("2026-07-18");
    expect(value("Created: Time")).toBe("11:49:00 UTC");
    expect(value("Signed: Date")).toBe("2026-07-18");
    expect(value("Signed: Time")).toBe("12:00:00 UTC");
    expect(value("Signers")).toBe("1");
    expect(value("Signatures")).toBe("2");
    expect(value("Initials")).toBe("5");
    // Two lines of 32 characters, each in eight groups of four.
    const printedHash = value("Document Hash (SHA-256)") ?? "";
    expect(printedHash.replaceAll(/\s/g, "")).toBe(HASH);
    expect(
      printedHash.split("\n").map((line) => line.split(" ").map((group) => group.length)),
    ).toEqual([
      [4, 4, 4, 4, 4, 4, 4, 4],
      [4, 4, 4, 4, 4, 4, 4, 4],
    ]);
    expect(value("Email")).toBe("alice@example.test");
    expect(value("Identified By")).toBe("Email/SMS one-time access code");
    expect(value("Identity Proof")).toBe("code_42");
    expect(value("Sealed: Date")).toBe("2026-07-18");
    expect(value("Sealed: Time")).toBe("12:00:01 UTC");
    expect(value("Consent: Time")).toBe("11:59:00 UTC");
    expect(value("Consent: Disclosure")).toBe("v1");
    expect(value("IP Address")).toBe("198.51.100.7");
    expect(value("Browser")).toBe("ExampleBrowser/1.0");
    expect(sheet.footer).toEqual({
      left: "Certificate MC-0123-4567-89AB",
      right: "Page {page} of {pages}",
    });
    expect(sheet.accent).toEqual([98, 72, 0]);
    // Close rows and three-quarter-inch margins are what let the first page hold eight signers.
    expect(sheet.compact).toBe(true);
    expect(sheet.page).toEqual({ paper: "letter", marginTop: 54, marginBottom: 54 });
    expect(sheet.created).toEqual({
      year: 2026,
      month: 7,
      day: 18,
      hour: 12,
      minute: 0,
      second: 1,
    });
  });

  it("summarizes every signer on the first page, with the blocks each completed", () => {
    const blocks = certificateSheet(certificate()).blocks;
    const firstPage = blocks.slice(
      0,
      blocks.findIndex((block) => block.type === "pageBreak"),
    );
    const table = firstPage.find((block) => block.type === "table");
    expect(table?.type === "table" ? table.columns.map((column) => column.heading) : []).toEqual([
      "Name",
      "Email",
      "Signed (UTC)",
      "Signatures",
      "Initials",
    ]);
    expect(table?.type === "table" ? table.rows : []).toEqual([
      ["Alice Example", "alice@example.test", "2026-07-18 12:00:00", "2", "5"],
    ]);
  });

  it("counts one signature and no initials for a signer whose blocks were not counted", () => {
    const record = certificate();
    const [first] = record.signers;
    if (first === undefined) throw new Error("the fixture has a signer");
    const { signatureCount: _signatures, initialCount: _initials, ...intent } = first.intent;
    const sheet = certificateSheet({ ...record, signers: [{ ...first, intent }] });
    const fields = sheet.blocks.flatMap((block) => (block.type === "fields" ? block.fields : []));
    expect(fields.find((field) => field.label === "Signatures")?.value).toBe("1");
    expect(fields.find((field) => field.label === "Initials")?.value).toBe("0");
  });

  it("lists the audit log one row to a step, oldest first", () => {
    const table = certificateSheet(certificate()).blocks.findLast(
      (block) => block.type === "table",
    );
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

  it("starts the signer details and the audit log each on a page of their own", () => {
    const blocks = certificateSheet(certificate()).blocks;
    const before = (text: string) =>
      blocks[blocks.findIndex((block) => block.type === "heading" && block.text === text) - 1];
    expect(before("Signer Details")).toEqual({ type: "pageBreak" });
    expect(before("Audit Log")).toEqual({ type: "pageBreak" });
  });

  it("keeps two signers to a page and heads every page of a section with its place", () => {
    const base = certificate();
    const [first] = base.signers;
    if (first === undefined) throw new Error("the fixture has a signer");
    const sheet = certificateSheet({
      ...base,
      signers: Array.from({ length: 5 }, (_, index) => ({
        ...first,
        intent: { ...first.intent, name: `Signer ${index + 1}` },
      })),
      // Eighty one-line rows, then twenty whose details wrap onto a second line.
      events: Array.from({ length: 100 }, (_, index) => ({
        kind: "viewed" as const,
        at: "2026-07-18T11:58:00Z",
        ...(index >= 80 ? { detail: "A note that wraps to a second line" } : {}),
      })),
    });

    // Each section page: a page break, its heading, then what the page holds.
    const pages: { heading: string; signers: string[]; rows: number }[] = [];
    for (const [index, block] of sheet.blocks.entries()) {
      if (block.type === "heading" && block.level === 1 && index > 0) {
        if (sheet.blocks[index - 1]?.type !== "pageBreak") continue;
        pages.push({ heading: block.text, signers: [], rows: 0 });
      } else if (block.type === "heading" && block.level === 2) {
        pages.at(-1)?.signers.push(block.text);
      } else if (block.type === "table" && pages.length > 0) {
        const page = pages.at(-1);
        if (page !== undefined) page.rows += block.rows.length;
      }
    }
    expect(pages).toEqual([
      { heading: "Signer Details (1 of 3)", signers: ["Signer 1", "Signer 2"], rows: 0 },
      { heading: "Signer Details (2 of 3)", signers: ["Signer 3", "Signer 4"], rows: 0 },
      { heading: "Signer Details (3 of 3)", signers: ["Signer 5"], rows: 0 },
      // A page takes as many rows as their expected height allows: 36 short ones, or fewer long.
      { heading: "Audit Log (1 of 4)", signers: [], rows: 36 },
      { heading: "Audit Log (2 of 4)", signers: [], rows: 36 },
      { heading: "Audit Log (3 of 4)", signers: [], rows: 23 },
      { heading: "Audit Log (4 of 4)", signers: [], rows: 5 },
    ]);
  });

  it("says who to ask: the firm about the document, the platform about the certificate", () => {
    const contact = (sheet: ReturnType<typeof certificateSheet>) =>
      sheet.blocks.flatMap((block) =>
        block.type === "paragraph" && "spans" in block
          ? [block.spans.map((span) => span.text).join("")]
          : [],
      );
    // With no firm contact the sender answers for the document, and the platform is named.
    const plain = certificateSheet(certificate());
    expect(plain.blocks).toContainEqual({ type: "heading", level: 2, text: "Contact" });
    expect(contact(plain)).toEqual([
      "Document: Bob Sender, bob@example.test",
      "Certificate of Completion: Magna Carta",
    ]);
    const named = certificateSheet(
      {
        ...certificate(),
        envelope: {
          id: "env_0001",
          contact: { name: "Example Law Firm", email: "office@example.test", phone: "555-0100" },
        },
      },
      { issuerContact: { name: "Magna Carta", email: "help@example.test" } },
    );
    expect(contact(named)).toEqual([
      "Document: Example Law Firm, office@example.test, 555-0100",
      "Certificate of Completion: Magna Carta, help@example.test",
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

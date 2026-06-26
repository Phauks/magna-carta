import { describe, expect, it } from "vitest";
import { buildReceipt, renderReceiptText, type ReceiptInput } from "../src/receipt.ts";

const HASHES = {
  md5: "900150983cd24fb0d6963f7d28e17f72",
  sha1: "a9993e364706816aba3e25717850c26c9cd0d89d",
  sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  sha384:
    "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
  sha512:
    "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
  sizeBytes: 3,
};

const VERIFY_INPUT: ReceiptInput = {
  tool: { name: "File Hash & Integrity", version: "1" },
  firmName: "Example Firm",
  file: { name: "complaint.pdf", fileId: "file_abc", versionId: "fileVersion_def" },
  hashes: HASHES,
  verification: {
    baselineSha256: HASHES.sha256,
    comparison: "match",
    verifiedBy: "user_ghi",
    auditLogId: "auditLog_jkl",
  },
  computedAt: "2026-06-23T12:00:00.000Z",
};

describe("buildReceipt", () => {
  it("returns the structured payload unchanged", () => {
    expect(buildReceipt(VERIFY_INPUT)).toEqual(VERIFY_INPUT);
  });
});

describe("renderReceiptText", () => {
  it("renders a verify receipt with every digest, the result, and the audit correlation", () => {
    const text = renderReceiptText(buildReceipt(VERIFY_INPUT));
    expect(text).toContain("File Hash & Integrity");
    expect(text).toContain("complaint.pdf");
    expect(text).toContain(`SHA-256  ${HASHES.sha256}`);
    expect(text).toContain(`MD5      ${HASHES.md5}`);
    expect(text).toContain("Baseline match: MATCH");
    expect(text).toContain("Audit record: auditLog_jkl");
    expect(text).toContain("2026-06-23T12:00:00.000Z");
  });

  it("omits verification lines for a standalone receipt", () => {
    const text = renderReceiptText(
      buildReceipt({
        ...VERIFY_INPUT,
        file: { name: "dropped.bin", fileId: null, versionId: null },
        verification: null,
      }),
    );
    expect(text).toContain("dropped.bin");
    expect(text).not.toContain("Baseline match");
    expect(text).not.toContain("Audit record");
  });
});

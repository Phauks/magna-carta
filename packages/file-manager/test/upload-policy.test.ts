import { describe, expect, it } from "vitest";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import {
  inspectableSizeCapDefinition,
  archiveCapsDefinition,
  liveMaxFileCountDefinition,
  liveMaxTotalBytesDefinition,
  scanEngineVersionDefinition,
  readScanEngineVersion,
  checkUploadPolicy,
  DEFAULT_UPLOAD_POLICY,
} from "../src/upload-policy.ts";
import { freshDatabase } from "./support.ts";

describe("scan caps", () => {
  it("defaults the inspectable-size cap to 2 GiB", () => {
    expect(inspectableSizeCapDefinition.defaultValue).toBe(2 * 1024 * 1024 * 1024);
  });
  it("defaults the archive caps to safe limits", () => {
    expect(archiveCapsDefinition.defaultValue).toEqual({
      maxDepth: 16,
      maxEntries: 10000,
      maxUncompressedBytes: 4 * 1024 * 1024 * 1024,
      maxExpansionRatio: 100,
    });
  });
});

describe("scan engine version setting", () => {
  it("defaults to null (unset firm) and reads back a configured value", async () => {
    const database = freshDatabase();
    expect(scanEngineVersionDefinition.defaultValue).toBeNull();
    expect(await readScanEngineVersion(database)).toBeNull();
    await database.batch([
      writeFirmSettingStatement(
        database,
        scanEngineVersionDefinition,
        "clamav/1.0+heuristics/1",
        "2026-06-22T00:00:00.000Z",
      ),
    ]);
    expect(await readScanEngineVersion(database)).toBe("clamav/1.0+heuristics/1");
  });
});

describe("live-vs-async bulk-download thresholds", () => {
  it("defaults the live max file count to 1000", () => {
    expect(liveMaxFileCountDefinition.defaultValue).toBe(1000);
  });
  it("defaults the live max total bytes to 2 GiB", () => {
    expect(liveMaxTotalBytesDefinition.defaultValue).toBe(2 * 1024 * 1024 * 1024);
  });
});

describe("content-type allow-list matching (DEFAULT_UPLOAD_POLICY)", () => {
  const allow = (contentType: string, fileName: string) =>
    checkUploadPolicy(DEFAULT_UPLOAD_POLICY, { sizeBytes: 1000, contentType, fileName });

  // The regression guard: the dotted-prefix OOXML/OpenDocument wildcards must actually match. A
  // `/*`-only matcher silently rejected every Word/Excel/PowerPoint/OpenDocument upload.
  it("allows OOXML documents (docx / xlsx / pptx) via the dotted-prefix wildcard", () => {
    expect(() =>
      allow(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "brief.docx",
      ),
    ).not.toThrow();
    expect(() =>
      allow("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "ledger.xlsx"),
    ).not.toThrow();
    expect(() =>
      allow(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "deck.pptx",
      ),
    ).not.toThrow();
  });

  it("allows OpenDocument types via the dotted-prefix wildcard", () => {
    expect(() => allow("application/vnd.oasis.opendocument.text", "memo.odt")).not.toThrow();
  });

  it("allows exact and MIME type/* matches (pdf, text/plain)", () => {
    expect(() => allow("application/pdf", "contract.pdf")).not.toThrow();
    expect(() => allow("text/plain", "notes.txt")).not.toThrow();
  });

  it("rejects a content type outside the allow-list", () => {
    expect(() => allow("application/x-msdownload", "evil.exe")).toThrow();
  });
});

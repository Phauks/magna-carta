import { describe, expect, it } from "vitest";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import {
  IN_MEMORY_INSPECTION_CEILING_BYTES,
  inspectableSizeCapDefinition,
  readInspectableSizeCap,
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
  // The cap decides what the ingest gate holds whole in a 128 MB Worker isolate, so its default is the
  // in-memory ceiling — tens of MiB — and never the multi-gigabyte figure that sent every long meeting
  // recording out of memory.
  it("defaults the inspectable-size cap to the 40 MiB in-memory ceiling", () => {
    expect(IN_MEMORY_INSPECTION_CEILING_BYTES).toBe(40 * 1024 * 1024);
    expect(inspectableSizeCapDefinition.defaultValue).toBe(IN_MEMORY_INSPECTION_CEILING_BYTES);
  });
  it("reads an unset firm's cap as the ceiling", async () => {
    expect(await readInspectableSizeCap(freshDatabase())).toBe(IN_MEMORY_INSPECTION_CEILING_BYTES);
  });
  it("lets a firm tighten the cap below the ceiling", async () => {
    const database = freshDatabase();
    await database.batch([
      writeFirmSettingStatement(
        database,
        inspectableSizeCapDefinition,
        1024 * 1024,
        "2026-10-02T00:00:00.000Z",
      ),
    ]);
    expect(await readInspectableSizeCap(database)).toBe(1024 * 1024);
  });
  it("never reads a stored cap above the ceiling as anything but the ceiling", async () => {
    const database = freshDatabase();
    await database.batch([
      writeFirmSettingStatement(
        database,
        inspectableSizeCapDefinition,
        2 * 1024 * 1024 * 1024,
        "2026-10-02T00:00:00.000Z",
      ),
    ]);
    expect(await readInspectableSizeCap(database)).toBe(IN_MEMORY_INSPECTION_CEILING_BYTES);
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

  it("allows the Windows-declared zip aliases beside application/zip", () => {
    // Windows browsers declare a .zip as application/x-zip-compressed; a policy that only names
    // application/zip refuses every zip uploaded from Windows at initiate.
    expect(() => allow("application/zip", "bundle.zip")).not.toThrow();
    expect(() => allow("application/x-zip-compressed", "bundle.zip")).not.toThrow();
    expect(() => allow("application/x-compressed", "bundle.zip")).not.toThrow();
  });

  it("rejects a content type outside the allow-list", () => {
    expect(() => allow("application/x-msdownload", "evil.exe")).toThrow();
  });
});

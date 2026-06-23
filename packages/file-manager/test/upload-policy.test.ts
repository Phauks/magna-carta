import { describe, expect, it } from "vitest";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import {
  inspectableSizeCapDefinition,
  archiveCapsDefinition,
  liveMaxFileCountDefinition,
  liveMaxTotalBytesDefinition,
  scanEngineVersionDefinition,
  readScanEngineVersion,
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

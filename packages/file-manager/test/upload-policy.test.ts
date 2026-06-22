import { describe, expect, it } from "vitest";
import {
  inspectableSizeCapDefinition,
  archiveCapsDefinition,
  liveMaxFileCountDefinition,
  liveMaxTotalBytesDefinition,
} from "../src/upload-policy.ts";

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

describe("live-vs-async bulk-download thresholds", () => {
  it("defaults the live max file count to 1000", () => {
    expect(liveMaxFileCountDefinition.defaultValue).toBe(1000);
  });
  it("defaults the live max total bytes to 2 GiB", () => {
    expect(liveMaxTotalBytesDefinition.defaultValue).toBe(2 * 1024 * 1024 * 1024);
  });
});

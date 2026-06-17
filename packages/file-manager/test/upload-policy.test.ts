import { describe, expect, it } from "vitest";
import { inspectableSizeCapDefinition, archiveCapsDefinition } from "../src/upload-policy.ts";

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

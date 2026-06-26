import { describe, expect, it } from "vitest";
import { DEFAULT_BUNDLE_OPTIONS } from "../src/bundle-options.ts";
import { capabilitiesFor, validateOptionsForFormat } from "../src/bundle-formats.ts";

describe("bundle-formats", () => {
  it("zip cannot encrypt file names; 7z can", () => {
    expect(capabilitiesFor("zip").supportsHeaderEncryption).toBe(false);
    expect(capabilitiesFor("sevenZip").supportsHeaderEncryption).toBe(true);
  });

  it("accepts default plain-zip options", () => {
    expect(validateOptionsForFormat(DEFAULT_BUNDLE_OPTIONS)).toEqual([]);
  });

  it("rejects zip + encryptFileNames", () => {
    const errors = validateOptionsForFormat({
      ...DEFAULT_BUNDLE_OPTIONS,
      format: "zip",
      encryption: { algorithm: "aes-256", encryptFileNames: true },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/file name/i);
  });

  it("allows 7z + encryptFileNames + split", () => {
    expect(
      validateOptionsForFormat({
        ...DEFAULT_BUNDLE_OPTIONS,
        format: "sevenZip",
        encryption: { algorithm: "aes-256", encryptFileNames: true },
        split: { maxPartBytes: 20_000_000 },
      }),
    ).toEqual([]);
  });
});

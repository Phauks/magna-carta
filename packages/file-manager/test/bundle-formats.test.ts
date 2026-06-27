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

  it("allows 7z + encryptFileNames (no split)", () => {
    expect(
      validateOptionsForFormat({
        ...DEFAULT_BUNDLE_OPTIONS,
        format: "sevenZip",
        encryption: { algorithm: "aes-256", encryptFileNames: true },
      }),
    ).toEqual([]);
  });

  it("allows 7z + split (no encryption)", () => {
    expect(
      validateOptionsForFormat({
        ...DEFAULT_BUNDLE_OPTIONS,
        format: "sevenZip",
        split: { maxPartBytes: 20_000_000 },
      }),
    ).toEqual([]);
  });

  it("rejects encryption + split: an encrypted bundle is a single streamed file", () => {
    const errors = validateOptionsForFormat({
      ...DEFAULT_BUNDLE_OPTIONS,
      format: "sevenZip",
      encryption: { algorithm: "aes-256", encryptFileNames: false },
      split: { maxPartBytes: 20_000_000 },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/encrypted bundle cannot be split/i);
  });

  it("split is 7z-only: zip cannot split (no Rust crate writes spanned ZIP)", () => {
    expect(capabilitiesFor("zip").supportsSplit).toBe(false);
    expect(capabilitiesFor("sevenZip").supportsSplit).toBe(true);
    const errors = validateOptionsForFormat({
      ...DEFAULT_BUNDLE_OPTIONS,
      format: "zip",
      split: { maxPartBytes: 20_000_000 },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/split/i);
  });
});

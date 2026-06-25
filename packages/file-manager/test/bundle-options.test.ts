import { describe, expect, it } from "vitest";
import {
  bundleOptionsSchema,
  DEFAULT_BUNDLE_OPTIONS,
  parseBundleOptions,
} from "../src/bundle-options.ts";

describe("bundle-options", () => {
  it("defaults to a plain zip with no compression, encryption, or split", () => {
    expect(DEFAULT_BUNDLE_OPTIONS).toEqual({
      format: "zip",
      compression: "store",
      encryption: null,
      split: null,
      outputName: "bundle.zip",
      wrapperFolder: null,
      layout: "preserveTree",
      manifest: false,
    });
  });

  it("parses a fully specified option set", () => {
    const parsed = parseBundleOptions({
      format: "sevenZip",
      compression: "maximum",
      encryption: { algorithm: "aes-256", encryptFileNames: true },
      split: { maxPartBytes: 20_000_000 },
      outputName: "smith.7z",
      wrapperFolder: { name: "Smith v Jones" },
      layout: "flatten",
      manifest: true,
    });
    expect(parsed).toEqual({
      format: "sevenZip",
      compression: "maximum",
      encryption: { algorithm: "aes-256", encryptFileNames: true },
      split: { maxPartBytes: 20_000_000 },
      outputName: "smith.7z",
      wrapperFolder: { name: "Smith v Jones" },
      layout: "flatten",
      manifest: true,
    });
  });

  it("rejects a non-positive split size", () => {
    expect(() =>
      parseBundleOptions({ ...DEFAULT_BUNDLE_OPTIONS, split: { maxPartBytes: 0 } }),
    ).toThrow();
  });

  it("rejects an unknown format", () => {
    expect(
      bundleOptionsSchema.safeParse({ ...DEFAULT_BUNDLE_OPTIONS, format: "rar" }).success,
    ).toBe(false);
  });
});

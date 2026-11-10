// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import type { BundleOptions } from "@magna-carta/file-manager/bundle-options";
import { selectBundleLane, type BundleLane } from "../src/downloads/bundle-lane.ts";

// Pure unit tests for selectBundleLane — no Miniflare, no bindings. Tests cover every branch.

// A minimal valid BundleOptions with all plain-ZIP defaults.
const plainZip: BundleOptions = {
  format: "zip",
  compression: "store",
  encryption: null,
  split: null,
  outputName: "bundle.zip",
  wrapperFolder: null,
  layout: "preserveTree",
  manifest: false,
};

// Helper to build options variants on top of plainZip.
function opts(overrides: Partial<BundleOptions>): BundleOptions {
  return { ...plainZip, ...overrides };
}

describe("selectBundleLane", () => {
  describe("plain lane", () => {
    it("returns plain when options are undefined (legacy path)", () => {
      const lane: BundleLane = selectBundleLane(undefined);
      expect(lane).toBe("plain");
    });

    it("returns plain for the canonical plain-ZIP defaults", () => {
      expect(selectBundleLane(plainZip)).toBe("plain");
    });

    it("returns plain even when non-lane fields differ (outputName, layout, manifest, wrapperFolder)", () => {
      // Non-lane fields do not affect routing — only format, compression, encryption, split do.
      expect(
        selectBundleLane(
          opts({
            outputName: "custom.zip",
            wrapperFolder: { name: "MyDocs" },
            layout: "flatten",
            manifest: true,
          }),
        ),
      ).toBe("plain");
    });
  });

  describe("heavyAsync lane", () => {
    it("returns heavyAsync when compression is not store (zip + normal)", () => {
      expect(selectBundleLane(opts({ compression: "normal" }))).toBe("heavyAsync");
    });

    it("returns heavyAsync when compression is maximum (zip + maximum)", () => {
      expect(selectBundleLane(opts({ compression: "maximum" }))).toBe("heavyAsync");
    });

    it("returns heavyAsync when format is sevenZip with no encryption", () => {
      expect(
        selectBundleLane(
          opts({ format: "sevenZip", compression: "normal", encryption: null, split: null }),
        ),
      ).toBe("heavyAsync");
    });

    it("returns heavyAsync when format is sevenZip even with store compression and no encryption", () => {
      // sevenZip format alone (regardless of other fields) is not a zip-plain combination.
      expect(
        selectBundleLane(
          opts({ format: "sevenZip", compression: "store", encryption: null, split: null }),
        ),
      ).toBe("heavyAsync");
    });

    it("returns heavyAsync when split is present and encryption is null (zip)", () => {
      // validateOptionsForFormat catches zip+split as invalid, but the lane selector is format-agnostic
      // about capabilities — it routes on the structural properties only.
      expect(
        selectBundleLane(opts({ split: { maxPartBytes: 10_485_760 }, encryption: null })),
      ).toBe("heavyAsync");
    });

    it("returns heavyAsync for sevenZip with split and no encryption", () => {
      expect(
        selectBundleLane(
          opts({
            format: "sevenZip",
            compression: "maximum",
            split: { maxPartBytes: 104_857_600 },
            encryption: null,
          }),
        ),
      ).toBe("heavyAsync");
    });
  });

  describe("encryptedStream lane", () => {
    it("returns encryptedStream when encryption is non-null (zip, no header encryption)", () => {
      expect(
        selectBundleLane(opts({ encryption: { algorithm: "aes-256", encryptFileNames: false } })),
      ).toBe("encryptedStream");
    });

    it("returns encryptedStream when encryption is non-null (sevenZip, with header encryption)", () => {
      expect(
        selectBundleLane(
          opts({
            format: "sevenZip",
            encryption: { algorithm: "aes-256", encryptFileNames: true },
            split: null,
          }),
        ),
      ).toBe("encryptedStream");
    });

    it("encryption takes priority over format and compression (returns encryptedStream, not heavyAsync)", () => {
      // When encryption is present, the lane is encryptedStream regardless of format/compression.
      expect(
        selectBundleLane(
          opts({
            format: "sevenZip",
            compression: "maximum",
            encryption: { algorithm: "aes-256", encryptFileNames: true },
          }),
        ),
      ).toBe("encryptedStream");
    });
  });
});

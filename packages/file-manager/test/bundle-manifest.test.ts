import { describe, expect, it } from "vitest";
import type { FileId, FileVersionId } from "@magna-carta/identifiers/types";
import type { ResolvedZip, ZipEntry } from "../src/zip-composition.ts";
import type { ManifestEntry } from "../src/contents-manifest.ts";
import { buildContentsManifest } from "../src/contents-manifest.ts";
import { buildBundleManifest } from "../src/bundle-manifest.ts";
import type { BundleOptions } from "../src/bundle-options.ts";

const entry = (path: string, id: string, r2Key: string, size: number): ZipEntry => ({
  path,
  fileId: id as FileId,
  versionId: `${id}-v` as FileVersionId,
  r2Key,
  sizeBytes: size,
  exportCopy: { exportCopyState: null, exportR2Key: null, exportSizeBytes: null },
});

const resolved = (entries: ZipEntry[]): ResolvedZip => ({
  entries,
  fileCount: entries.length,
  totalBytes: entries.reduce((sum, e) => sum + e.sizeBytes, 0),
});

const baseOptions: BundleOptions = {
  format: "zip",
  compression: "store",
  encryption: null,
  split: null,
  outputName: "bundle.zip",
  wrapperFolder: null,
  layout: "preserveTree",
  manifest: false,
};

// Decodes a base64 string to a UTF-8 string (matches the inverse of the implementation's textToBase64).
function decodeBase64ToString(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

describe("buildBundleManifest", () => {
  it("maps r2 file entries with correct archivePath, r2Key, and mtime", () => {
    const entries = [
      entry("Pleadings/a.pdf", "f1", "files/f1/v1", 100),
      entry("b.pdf", "f2", "files/f2/v2", 200),
    ];
    const mtimeByR2Key = new Map<string, number | null>([
      ["files/f1/v1", 1_700_000_000],
      ["files/f2/v2", null],
    ]);

    const result = buildBundleManifest({
      jobId: "job-001",
      resolved: resolved(entries),
      options: baseOptions,
      password: null,
      manifestEntries: [],
      outputKeyPrefix: "bundles/abc",
      mtimeByR2Key,
    });

    expect(result.jobId).toBe("job-001");
    expect(result.format).toBe("zip");
    expect(result.compression).toBe("store");
    expect(result.encryption).toBeNull();
    expect(result.split).toBeNull();
    expect(result.outputKeyPrefix).toBe("bundles/abc");
    expect(result.entries).toHaveLength(2);

    const first = result.entries.find((e) => e.archivePath === "Pleadings/a.pdf");
    expect(first).toBeDefined();
    expect(first!.source).toBe("r2");
    if (first!.source === "r2") expect(first!.r2Key).toBe("files/f1/v1");
    expect(first!.mtimeEpochSecs).toBe(1_700_000_000);

    const second = result.entries.find((e) => e.archivePath === "b.pdf");
    expect(second).toBeDefined();
    expect(second!.source).toBe("r2");
    if (second!.source === "r2") expect(second!.r2Key).toBe("files/f2/v2");
    expect(second!.mtimeEpochSecs).toBeNull();
  });

  it("applies wrapper layout so archivePaths include the wrapper folder prefix", () => {
    const entries = [entry("a.pdf", "f1", "files/f1/v1", 10)];

    const result = buildBundleManifest({
      jobId: "job-002",
      resolved: resolved(entries),
      options: { ...baseOptions, wrapperFolder: { name: "Smith v Jones" } },
      password: null,
      manifestEntries: [],
      outputKeyPrefix: "bundles/xyz",
      mtimeByR2Key: new Map(),
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.archivePath).toBe("Smith v Jones/a.pdf");
    expect(result.entries[0]!.source).toBe("r2");
    if (result.entries[0]!.source === "r2") {
      expect(result.entries[0]!.r2Key).toBe("files/f1/v1");
    }
  });

  it("applies flatten layout so archivePaths are base names without folder segments", () => {
    const entries = [
      entry("Pleadings/a.pdf", "f1", "files/f1/v1", 10),
      entry("Drafts/b.pdf", "f2", "files/f2/v2", 20),
    ];

    const result = buildBundleManifest({
      jobId: "job-003",
      resolved: resolved(entries),
      options: { ...baseOptions, layout: "flatten" },
      password: null,
      manifestEntries: [],
      outputKeyPrefix: "bundles/xyz",
      mtimeByR2Key: new Map(),
    });

    const paths = result.entries.map((e) => e.archivePath);
    expect(paths).toContain("a.pdf");
    expect(paths).toContain("b.pdf");
    for (const path of paths) {
      expect(path).not.toContain("/");
    }
  });

  it("appends an inline CONTENTS.txt entry that decodes to the buildContentsManifest text", () => {
    const entries = [entry("a.pdf", "f1", "files/f1/v1", 100)];
    const manifestEntries: ManifestEntry[] = [
      { path: "a.pdf", sizeBytes: 100, sha256: "abcdef1234" },
    ];

    const result = buildBundleManifest({
      jobId: "job-004",
      resolved: resolved(entries),
      options: { ...baseOptions, manifest: true },
      password: null,
      manifestEntries,
      outputKeyPrefix: "bundles/xyz",
      mtimeByR2Key: new Map([["files/f1/v1", 12_345]]),
    });

    // File entries come first; CONTENTS.txt is last.
    expect(result.entries).toHaveLength(2);
    const fileEntry = result.entries[0];
    expect(fileEntry!.source).toBe("r2");

    const contentsEntry = result.entries[result.entries.length - 1];
    expect(contentsEntry!.archivePath).toBe("CONTENTS.txt");
    expect(contentsEntry!.source).toBe("inline");

    if (contentsEntry!.source === "inline") {
      const decoded = decodeBase64ToString(contentsEntry!.bytesBase64);
      expect(decoded).toBe(buildContentsManifest(manifestEntries));
    }
  });

  it("does not append CONTENTS.txt when manifest option is false", () => {
    const result = buildBundleManifest({
      jobId: "job-005",
      resolved: resolved([entry("a.pdf", "f1", "files/f1/v1", 100)]),
      options: { ...baseOptions, manifest: false },
      password: null,
      manifestEntries: [{ path: "a.pdf", sizeBytes: 100, sha256: "abcdef" }],
      outputKeyPrefix: "bundles/xyz",
      mtimeByR2Key: new Map(),
    });

    expect(result.entries.every((e) => e.archivePath !== "CONTENTS.txt")).toBe(true);
    expect(result.entries).toHaveLength(1);
  });

  it("sets encryption to null when options.encryption is null", () => {
    const result = buildBundleManifest({
      jobId: "job-006",
      resolved: resolved([]),
      options: { ...baseOptions, encryption: null },
      password: "ignored-because-null-encryption",
      manifestEntries: [],
      outputKeyPrefix: "bundles/xyz",
      mtimeByR2Key: new Map(),
    });

    expect(result.encryption).toBeNull();
  });

  it("populates encryption with the passed password and encryptFileNames when encryption option is set", () => {
    const result = buildBundleManifest({
      jobId: "job-007",
      resolved: resolved([]),
      options: { ...baseOptions, encryption: { algorithm: "aes-256", encryptFileNames: true } },
      password: "s3cr3t-p4ssw0rd",
      manifestEntries: [],
      outputKeyPrefix: "bundles/xyz",
      mtimeByR2Key: new Map(),
    });

    expect(result.encryption).toEqual({ password: "s3cr3t-p4ssw0rd", encryptFileNames: true });
  });

  it("sets split to null when options.split is null", () => {
    const result = buildBundleManifest({
      jobId: "job-008",
      resolved: resolved([]),
      options: { ...baseOptions, split: null },
      password: null,
      manifestEntries: [],
      outputKeyPrefix: "bundles/xyz",
      mtimeByR2Key: new Map(),
    });

    expect(result.split).toBeNull();
  });

  it("sets split.maxPartBytes when options.split is set", () => {
    const result = buildBundleManifest({
      jobId: "job-009",
      resolved: resolved([]),
      options: { ...baseOptions, split: { maxPartBytes: 50_000_000 } },
      password: null,
      manifestEntries: [],
      outputKeyPrefix: "bundles/xyz",
      mtimeByR2Key: new Map(),
    });

    expect(result.split).toEqual({ maxPartBytes: 50_000_000 });
  });

  it("mtime falls back to null for r2Keys absent from the map", () => {
    const entries = [entry("doc.pdf", "f1", "files/f1/v1", 50)];

    const result = buildBundleManifest({
      jobId: "job-010",
      resolved: resolved(entries),
      options: baseOptions,
      password: null,
      manifestEntries: [],
      outputKeyPrefix: "bundles/xyz",
      mtimeByR2Key: new Map(), // empty — key absent
    });

    expect(result.entries[0]!.mtimeEpochSecs).toBeNull();
  });

  it("encodes non-ASCII paths in CONTENTS.txt bytes correctly", () => {
    const manifestEntries: ManifestEntry[] = [
      { path: "résumé.pdf", sizeBytes: 42, sha256: "cafe" },
    ];

    const result = buildBundleManifest({
      jobId: "job-011",
      resolved: resolved([entry("résumé.pdf", "f1", "files/f1/v1", 42)]),
      options: { ...baseOptions, manifest: true },
      password: null,
      manifestEntries,
      outputKeyPrefix: "bundles/xyz",
      mtimeByR2Key: new Map([["files/f1/v1", null]]),
    });

    const last = result.entries[result.entries.length - 1];
    expect(last!.archivePath).toBe("CONTENTS.txt");
    if (last!.source === "inline") {
      expect(decodeBase64ToString(last!.bytesBase64)).toBe(buildContentsManifest(manifestEntries));
    }
  });

  it("throws when encryption is requested but no password is supplied", () => {
    expect(() =>
      buildBundleManifest({
        jobId: "job-012",
        resolved: resolved([entry("a.pdf", "f1", "files/f1/v1", 10)]),
        options: { ...baseOptions, encryption: { algorithm: "aes-256", encryptFileNames: false } },
        password: null,
        manifestEntries: [],
        outputKeyPrefix: "bundles/xyz",
        mtimeByR2Key: new Map(),
      }),
    ).toThrow(/password is required/i);
  });
});

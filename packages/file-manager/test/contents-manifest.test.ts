import { describe, expect, it } from "vitest";
import { buildContentsManifest } from "../src/contents-manifest.ts";

describe("buildContentsManifest", () => {
  it("lists entries sorted by path with size and sha256, plus a summary footer", () => {
    const text = buildContentsManifest([
      { path: "b.pdf", sizeBytes: 20, sha256: "bb" },
      { path: "a.pdf", sizeBytes: 10, sha256: "aa" },
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toBe("path\tsize_bytes\tsha256");
    expect(lines[1]).toBe("a.pdf\t10\taa");
    expect(lines[2]).toBe("b.pdf\t20\tbb");
    expect(lines).toContain("# 2 files, 30 bytes");
  });

  it("handles an empty selection", () => {
    expect(buildContentsManifest([])).toBe("path\tsize_bytes\tsha256\n# 0 files, 0 bytes\n");
  });
});

import { describe, expect, it } from "vitest";
import { claimedExtensionOf } from "../src/filename.ts";

describe("claimedExtensionOf", () => {
  it("returns the lowercased extension", () => {
    expect(claimedExtensionOf("Contract.PDF")).toBe("pdf");
  });

  it("uses the last segment for multi-dot names", () => {
    expect(claimedExtensionOf("archive.tar.gz")).toBe("gz");
  });

  it("returns null when there is no extension", () => {
    expect(claimedExtensionOf("README")).toBeNull();
  });

  it("returns null for a dotfile with no extension", () => {
    expect(claimedExtensionOf(".gitignore")).toBeNull();
  });

  it("returns null for a trailing dot", () => {
    expect(claimedExtensionOf("weird.")).toBeNull();
  });
});

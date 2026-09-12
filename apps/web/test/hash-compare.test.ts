import { describe, expect, it } from "vitest";
import {
  algorithmOfDigest,
  extractDigest,
  readExpectedDigest,
} from "../src/lib/file-manager/hash-compare.ts";
import type { DigestSet } from "../src/lib/file-manager/matter-file-api.ts";

const computed: DigestSet = {
  md5: "d".repeat(32),
  sha1: "e".repeat(40),
  sha256: "a".repeat(64),
  sha384: "b".repeat(96),
  sha512: "c".repeat(128),
};

describe("a digest somebody was given, read against the computed ones", () => {
  it("tells the algorithm from the digest's length, whatever else was pasted with it", () => {
    // A sha256sum line: the digest, two spaces, a file name. Uppercase, with a label before it.
    expect(extractDigest(`SHA256: ${"A".repeat(64)}  brief.pdf`)).toBe("a".repeat(64));
    expect(algorithmOfDigest("a".repeat(64))).toBe("sha256");
    expect(algorithmOfDigest("a".repeat(128))).toBe("sha512");
    expect(algorithmOfDigest("a".repeat(96))).toBe("sha384");
    expect(algorithmOfDigest("a".repeat(40))).toBe("sha1");
    expect(algorithmOfDigest("a".repeat(32))).toBe("md5");
    expect(algorithmOfDigest("a".repeat(50))).toBeNull();
  });

  it("says match, mismatch, or that it is waiting on the computation", () => {
    expect(readExpectedDigest("", computed)).toEqual({ kind: "empty" });
    expect(readExpectedDigest("not a digest", computed)).toEqual({ kind: "unrecognised" });
    expect(readExpectedDigest("a".repeat(64), null)).toEqual({
      kind: "waiting",
      algorithm: "sha256",
    });
    expect(readExpectedDigest("a".repeat(64), computed)).toEqual({
      kind: "match",
      algorithm: "sha256",
    });
    expect(readExpectedDigest("f".repeat(40), computed)).toEqual({
      kind: "mismatch",
      algorithm: "sha1",
    });
  });
});

import { describe, expect, it } from "vitest";
import { ALGORITHM_RESULT_KEY, HASH_ALGORITHMS } from "../src/types.ts";

describe("algorithm metadata", () => {
  it("lists the five algorithms in a fixed order", () => {
    expect(HASH_ALGORITHMS).toEqual(["MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512"]);
  });

  it("maps each algorithm to its lowercase result key", () => {
    expect(HASH_ALGORITHMS.map((algorithm) => ALGORITHM_RESULT_KEY[algorithm])).toEqual([
      "md5",
      "sha1",
      "sha256",
      "sha384",
      "sha512",
    ]);
  });
});

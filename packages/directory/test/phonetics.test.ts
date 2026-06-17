import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { phoneticCodes } from "../src/phonetics.js";

test("returns scheme-keyed primary + secondary Double Metaphone codes", () => {
  const codes = phoneticCodes("Catherine");
  expect(codes).toEqual([
    { scheme: "double_metaphone_primary", code: expect.any(String) },
    { scheme: "double_metaphone_secondary", code: expect.any(String) },
  ]);
});

test("sound-alikes share a primary code (the blocking guarantee)", () => {
  const a = phoneticCodes("Smith").find((c) => c.scheme === "double_metaphone_primary")!.code;
  const b = phoneticCodes("Smyth").find((c) => c.scheme === "double_metaphone_primary")!.code;
  expect(a).toBe(b);
});

test("is deterministic", () => {
  expect(phoneticCodes("Nguyen")).toEqual(phoneticCodes("Nguyen"));
});

describe("double-metaphone seam boundary", () => {
  test("only src/phonetics.ts imports double-metaphone", async () => {
    const sourceDirectory = join(import.meta.dirname, "..", "src");
    const files = (await readdir(sourceDirectory)).filter((f) => f.endsWith(".ts"));
    const offenders: string[] = [];
    for (const file of files) {
      if (file === "phonetics.ts") continue;
      const text = await readFile(join(sourceDirectory, file), "utf8");
      if (/from\s+["']double-metaphone/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

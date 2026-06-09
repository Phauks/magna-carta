import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKEN_ALPHABET } from "../src/nanoid.ts";

const SRC = join(import.meta.dirname, "..", "src");

describe("nanoid seam boundary", () => {
  it("only src/nanoid.ts imports nanoid", async () => {
    const files = (await readdir(SRC)).filter((file) => file.endsWith(".ts"));
    const offenders: string[] = [];
    for (const file of files) {
      if (file === "nanoid.ts") continue;
      const text = await readFile(join(SRC, file), "utf8");
      if (/from\s+["']nanoid/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the seam's alphabet stays within the URL-safe class the validator assumes", () => {
    // validate.ts hardcodes [A-Za-z0-9_-] for the token; this guards against the seam's alphabet drifting
    // out of that set, which would make valid generated ids fail validation.
    expect(TOKEN_ALPHABET).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

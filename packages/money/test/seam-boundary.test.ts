import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

describe("Dinero seam boundary", () => {
  it("only src/dinero.ts imports dinero.js", async () => {
    const files = (await readdir(SRC)).filter((f) => f.endsWith(".ts"));
    const offenders: string[] = [];
    for (const file of files) {
      if (file === "dinero.ts") continue;
      const text = await readFile(join(SRC, file), "utf8");
      if (/from\s+["']dinero(\.js)?/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

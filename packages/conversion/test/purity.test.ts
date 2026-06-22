// packages/conversion/test/purity.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The conversion core stays pure: no D1/Hono/env/network/UI. wasm-vips is the one allowed runtime
// dependency, and only inside the libvips adapter.
const FORBIDDEN = [/from\s+["']hono["']/, /\benv\b\s*[.:]/, /from\s+["']svelte/, /\bD1Database\b/];

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? tsFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

describe("purity", () => {
  it("source imports nothing impure", () => {
    for (const file of tsFiles(join(import.meta.dirname, "..", "src"))) {
      const source = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(source), `${file} matches ${pattern}`).toBe(false);
      }
    }
  });

  it("only the libvips adapter imports wasm-vips", () => {
    for (const file of tsFiles(join(import.meta.dirname, "..", "src"))) {
      if (readFileSync(file, "utf8").includes("wasm-vips")) {
        expect(file.replaceAll("\\", "/")).toContain("adapters/libvips");
      }
    }
  });
});

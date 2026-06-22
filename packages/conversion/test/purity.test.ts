// packages/conversion/test/purity.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The conversion core stays pure: every import must be a relative path OR `wasm-vips`, and
// `wasm-vips` is only allowed inside files whose path contains `adapters/libvips`.
const importPattern = /import[^"']*["']([^"']+)["']/g;

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? tsFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

function importSpecifiers(filePath: string): string[] {
  const text = readFileSync(filePath, "utf8");
  const specifiers: string[] = [];
  for (const match of text.matchAll(importPattern)) specifiers.push(match[1]!);
  return specifiers;
}

const srcDir = join(import.meta.dirname, "..", "src");

describe("purity (fitness)", () => {
  it("actually inspects at least one source file", () => {
    expect(tsFiles(srcDir).length).toBeGreaterThanOrEqual(1);
  });

  it("every import is relative or the one allowed external (wasm-vips in adapters/libvips)", () => {
    for (const file of tsFiles(srcDir)) {
      const normalizedFile = file.replaceAll("\\", "/");
      for (const specifier of importSpecifiers(file)) {
        const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
        const isAllowedExternal =
          specifier === "wasm-vips" && normalizedFile.includes("adapters/libvips");
        expect(
          isRelative || isAllowedExternal,
          `${normalizedFile} imports disallowed specifier: "${specifier}"`,
        ).toBe(true);
      }
    }
  });

  it("wasm-vips is only imported in files under adapters/libvips", () => {
    for (const file of tsFiles(srcDir)) {
      const normalizedFile = file.replaceAll("\\", "/");
      for (const specifier of importSpecifiers(file)) {
        if (specifier === "wasm-vips") {
          expect(
            normalizedFile,
            `wasm-vips imported outside adapters/libvips: ${normalizedFile}`,
          ).toContain("adapters/libvips");
        }
      }
    }
  });
});

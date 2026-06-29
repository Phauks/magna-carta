import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The core stays pure: every import is a relative path OR one of the allowed workspace packages
// (themselves pure; runtime value imports permitted).
// No D1, Hono, env, Svelte, network, or vendor SDK ever enters this package.
const importPattern = /\b(?:import|from)\b\s*["']([^"']+)["']/g;
const allowedPackages = new Set([
  "@magna-carta/integrations/dispatch",
  "@magna-carta/integrations/problem",
  "@magna-carta/integrations/port",
  "@magna-carta/integrations/manifest",
  "@magna-carta/identifiers/types",
]);

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

  it("every import is relative or an allowed workspace type package", () => {
    for (const file of tsFiles(srcDir)) {
      const normalizedFile = file.replaceAll("\\", "/");
      for (const specifier of importSpecifiers(file)) {
        const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
        const allowed = isRelative || allowedPackages.has(specifier);
        expect(allowed, `${normalizedFile} imports disallowed specifier: "${specifier}"`).toBe(
          true,
        );
      }
    }
  });
});

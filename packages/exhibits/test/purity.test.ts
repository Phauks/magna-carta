import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceDirectory = join(import.meta.dirname, "..", "src");

function importsOf(file: string): string[] {
  const text = readFileSync(join(sourceDirectory, file), "utf8");
  return [...text.matchAll(/^\s*(?:import|export)[^"']*from\s+["']([^"']+)["']/gm)].map(
    (match) => match[1] ?? "",
  );
}

describe("the package's purity", () => {
  it("keeps the label function and the scheme free of every dependency", () => {
    expect(importsOf("scheme.ts")).toEqual([]);
    expect(importsOf("label.ts")).toEqual(["./scheme.ts"]);
  });

  it("holds no binding, no Hono and no clock anywhere in its source", () => {
    for (const file of readdirSync(sourceDirectory)) {
      const text = readFileSync(join(sourceDirectory, file), "utf8");
      expect(text, file).not.toMatch(/from\s+["']hono/);
      expect(text, file).not.toMatch(/\bnew Date\(|Date\.now\(/);
      expect(text, file).not.toMatch(/\benv\.[A-Z_]+/);
    }
  });
});

describe("the label column", () => {
  it("is written by the issue batch and by nothing else", () => {
    const writers = readdirSync(sourceDirectory).filter((file) => {
      const text = readFileSync(join(sourceDirectory, file), "utf8");
      return /\blabel\s*=\s*\(?\s*SELECT|SET[^`]*\blabel\s*=/.test(text);
    });
    expect(writers).toEqual(["issue-service.ts"]);
  });

  it("is never named by the correction or withdrawal paths, which cannot renumber", () => {
    for (const file of ["correction-service.ts", "withdrawal-service.ts"]) {
      const text = readFileSync(join(sourceDirectory, file), "utf8");
      const sql = [...text.matchAll(/`([^`]*)`/g)].map((match) => match[1]).join(" ");
      expect(sql, file).not.toMatch(/\blabel\b|\bposition\b/);
    }
  });
});

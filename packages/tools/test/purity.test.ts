import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceDir = join(import.meta.dirname, "..", "src");
const importPattern = /import[^"']*["']([^"']+)["']/g;
const allowedPackage = "@magna-carta/access-control/registry";

function importSpecifiers(filePath: string): string[] {
  const text = readFileSync(filePath, "utf8");
  const specifiers: string[] = [];
  for (const match of text.matchAll(importPattern)) specifiers.push(match[1]!);
  return specifiers;
}

// The catalog is a presentation/IA layer above the tool packages, never below them: it must not
// import a tool-logic package (property-links, government-links, shipping) or any UI. Keeping it pure
// is what lets both surfaces read it without dragging credentials or vendor code into the catalog.
describe("the tools catalog stays a pure presentation layer (fitness)", () => {
  it("imports only relative modules and the access-control registry", () => {
    for (const name of readdirSync(sourceDir)) {
      if (!name.endsWith(".ts")) continue;
      for (const specifier of importSpecifiers(join(sourceDir, name))) {
        const allowed =
          specifier.startsWith("./") || specifier.startsWith("../") || specifier === allowedPackage;
        expect(allowed, `${name} imports ${specifier}`).toBe(true);
      }
    }
  });
});

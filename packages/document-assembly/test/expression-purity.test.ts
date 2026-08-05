import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A source scan over the expression language's own folder. Seven properties make the claim that a
// template can never become an execution surface, and the first, the third, and the sixth are checkable
// by reading the source — so they are read rather than trusted.
//
// The claim these make together: a bug in the evaluator is a WRONG NUMBER IN A DOCUMENT, which is
// serious, and cannot be A FOOTHOLD IN A WORKER, which would be catastrophic. The two failure classes
// are separated by the grammar, not by our care.

const expressionDirectory = join(import.meta.dirname, "..", "src", "expression");

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = join(directory, name);
    return statSync(full).isDirectory()
      ? typescriptFiles(full)
      : full.endsWith(".ts")
        ? [full]
        : [];
  });
}

// Each entry is a construct that would put a dynamic code path, ambient authority, or a regular
// expression built from template text inside the language.
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\beval\s*\(/, why: "eval is a dynamic code path" },
  { pattern: /\bnew\s+Function\b/, why: "new Function is a dynamic code path" },
  { pattern: /\bimport\s*\(/, why: "a dynamic import is a dynamic code path" },
  { pattern: /\bwith\s*\(/, why: "`with` reintroduces scope walking" },
  { pattern: /\bReflect\./, why: "Reflect reaches the host object graph" },
  {
    pattern: /\bnew\s+RegExp\b/,
    why: "a regular expression built at runtime could come from template text, which is also a denial-of-service surface",
  },
  { pattern: /\bDate\.now\b/, why: "the evaluator has no clock" },
  { pattern: /\bnew\s+Date\b/, why: "the evaluator has no clock and no time zone of its own" },
  { pattern: /\bMath\.random\b/, why: "the evaluator has no randomness" },
  {
    pattern: /\bIntl\./,
    why: "the evaluator has no locale beyond the time zone the merge context carries",
  },
  { pattern: /\bfetch\s*\(/, why: "the evaluator has no network" },
  { pattern: /\bprocess\./, why: "the evaluator has no environment" },
  { pattern: /\bglobalThis\b/, why: "the evaluator has no ambient authority" },
  { pattern: /\bObject\.assign\b/, why: "a merged object is a prototype-bearing one" },
  // A `throw` STATEMENT, not the word in a comment explaining why there are none.
  {
    pattern: /\bthrow\s+(?:new\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*[({]/,
    why: "nothing in this folder throws — every outcome is a tagged result",
  },
];

// Floating-point arithmetic in a folder that computes money. Every value is an exact integer with a
// declared scale, so a lone division or a Math call that could produce a fraction is a defect.
const FLOAT_RISKS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /Math\.round\b/, why: "rounding goes through the money package's named helpers" },
  { pattern: /Math\.ceil\b/, why: "rounding goes through the money package's named helpers" },
  { pattern: /parseFloat\b/, why: "a float is never how a number enters this language" },
  { pattern: /\btoFixed\b/, why: "toFixed is float formatting" },
];

describe("the expression language cannot become an execution surface (fitness)", () => {
  it("actually inspects the folder", () => {
    expect(typescriptFiles(expressionDirectory).length).toBeGreaterThanOrEqual(6);
  });

  it("carries no dynamic code path and no ambient authority", () => {
    for (const file of typescriptFiles(expressionDirectory)) {
      const source = readFileSync(file, "utf8");
      for (const { pattern, why } of FORBIDDEN) {
        expect(pattern.test(source), `${file} matches ${pattern}: ${why}`).toBe(false);
      }
    }
  });

  it("carries no floating-point arithmetic", () => {
    for (const file of typescriptFiles(expressionDirectory)) {
      const source = readFileSync(file, "utf8");
      for (const { pattern, why } of FLOAT_RISKS) {
        expect(pattern.test(source), `${file} matches ${pattern}: ${why}`).toBe(false);
      }
    }
  });

  it("imports nothing from src/ooxml, so the checker stays runnable in a browser", () => {
    // Not tidiness: the checker is the thing an authoring surface wants to run as the author types, and
    // an OOXML-free module is the cheap version of that seam, taken now rather than retrofitted.
    for (const file of typescriptFiles(expressionDirectory)) {
      const source = readFileSync(file, "utf8");
      expect(source.includes("ooxml"), `${file} reaches into the OOXML layer`).toBe(false);
      expect(source.includes("fflate"), `${file} reaches into the zip layer`).toBe(false);
      expect(source.includes("fast-xml-parser"), `${file} reaches into the XML layer`).toBe(false);
    }
  });
});

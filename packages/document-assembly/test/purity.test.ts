import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The assembly core stays a pure domain package: no Hono, no Cloudflare runtime, no D1 binding, no
// Svelte, no network. It composes statements against a caller-supplied firm-scoped database handle and
// returns typed results; everything that knows about a request, an env, or a queue lives in the worker.
// Matches a module specifier at a real import or re-export site — `… from "x"` and the bare
// `import "x"` — rather than any quoted string that happens to follow the letters "import". A looser
// pattern reads an apostrophe in a comment as a module specifier and reports a violation nobody wrote.
const importPattern =
  /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

// The externals this package is allowed to reach: its two OOXML substrate libraries and the platform's
// own pure packages. Anything else is a layering violation.
const ALLOWED_EXTERNALS: ReadonlySet<string> = new Set([
  "fflate",
  "fast-xml-parser",
  "@magna-carta/data-access/audit-statements",
  "@magna-carta/data-access/effect-batch",
  "@magna-carta/data-access/idempotency-statements",
  // The template catalogue's search escapes what a reader typed before it reaches a `LIKE`, and
  // that is a correctness rule rather than a formatting preference: `%` and `_` are wildcards to
  // SQLite and ordinary characters to a person, so a template named `100%_final` searched for
  // unescaped returns rows nobody asked for. That module exists BECAUSE the rule had been written
  // twice and agreed by luck; a third copy here would be the very thing it was made to end, and
  // would be the copy that missed the next correction. It is pure string work — no handle, no
  // runtime, no imports of its own.
  "@magna-carta/data-access/like-search",
  // A protected merge field resolves through the protected-field chokepoint's own permission gate and
  // its own decrypt-audit row, so the refusal this package turns into an absence is that module's
  // ProtectedReadForbiddenError, caught by identity. Restating the gate here instead would be a second
  // copy of the rule that decides who may read a client's sealed details, free to drift from the one
  // that actually guards the column.
  "@magna-carta/data-access/protected-fields",
  // The catalogue of sealed identifier types, so the protected merge keys are a total mapping over it:
  // a type the Directory gains cannot quietly end up with no merge binding and no decision behind it.
  "@magna-carta/directory/types",
  // The firm's own fields enter the dictionary through the custom-fields engine's OWN value model —
  // what a stored integer means is its kind plus its scale, and restating that rule here rather than
  // reusing it is how a value renders a power of ten wrong and looks entirely plausible.
  "@magna-carta/custom-fields/number-scale",
  "@magna-carta/custom-fields/types",
  "@magna-carta/identifiers/generate",
  "@magna-carta/identifiers/random",
  "@magna-carta/identifiers/types",
  "@magna-carta/money/money",
  "@magna-carta/money/format",
  // The expression language's rounding and splitting go through the money package rather than through a
  // second implementation of half-to-even or of a largest-remainder split.
  "@magna-carta/money/rounding",
  "@magna-carta/money/allocate",
  // A tabular export composes into the platform's ONE renderable document model, the same shape the
  // export printer reads, so a report and a merge document print through the same printer. Restating
  // the model here would be a second document shape for the printer to learn.
  "@magna-carta/export-document/renderable",
  // A document renders dates in the MATTER'S OFFICE'S zone, and which day an instant fell on in a
  // place is one question with one answer — the same projection a deadline and an overdue comparison
  // use. A second one here is how a merged filing date and a due date come to disagree about a day.
  "@magna-carta/civil-time/civil-date",
  "@magna-carta/civil-time/time-zone",
]);

// Specifiers that would mean the package had stopped being pure, listed by the thing they drag in.
const FORBIDDEN_SUBSTRINGS: readonly string[] = [
  "hono",
  "cloudflare:",
  "@cloudflare/",
  "svelte",
  "wrangler",
  "node:fs",
  "node:net",
];

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

function importSpecifiers(filePath: string): string[] {
  const text = readFileSync(filePath, "utf8");
  const specifiers: string[] = [];
  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return specifiers;
}

const sourceDirectory = join(import.meta.dirname, "..", "src");

describe("purity (fitness)", () => {
  it("actually inspects the source tree", () => {
    expect(typescriptFiles(sourceDirectory).length).toBeGreaterThanOrEqual(10);
  });

  it("every import is relative or one of the declared allowed externals", () => {
    for (const file of typescriptFiles(sourceDirectory)) {
      const normalized = file.replaceAll("\\", "/");
      for (const specifier of importSpecifiers(file)) {
        const relative = specifier.startsWith("./") || specifier.startsWith("../");
        expect(
          relative || ALLOWED_EXTERNALS.has(specifier),
          `${normalized} imports disallowed specifier: "${specifier}"`,
        ).toBe(true);
      }
    }
  });

  it("nothing reaches a runtime, a framework, or the filesystem", () => {
    for (const file of typescriptFiles(sourceDirectory)) {
      const normalized = file.replaceAll("\\", "/");
      for (const specifier of importSpecifiers(file)) {
        for (const forbidden of FORBIDDEN_SUBSTRINGS) {
          expect(
            specifier.toLowerCase().includes(forbidden),
            `${normalized} imports "${specifier}", which pulls in ${forbidden}`,
          ).toBe(false);
        }
      }
    }
  });
});

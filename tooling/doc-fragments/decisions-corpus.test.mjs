import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAdrFile, registerLineFor, validateAdrRecord } from "./adr-file.mjs";

// The register in docs/Decision-Log.md is generated from these files and has no other store, so a
// malformed one is not caught by any type or schema — only by reading the rendered bullet. This
// walks the real corpus the way `pnpm run lint:decisions` does, so the repository can never carry a
// decision file the assembler would refuse or render blank.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DECISIONS_DIR = join(ROOT, "docs/decisions");
const PENDING_DIR = join(DECISIONS_DIR, "pending");

function read(directory, relativePath, matches) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter(matches)
    .map((name) => ({
      context: `${relativePath}/${name}`,
      markdown: readFileSync(join(directory, name), "utf8"),
    }));
}

const numbered = read(DECISIONS_DIR, "docs/decisions", (name) => /^\d{4}-.+\.md$/.test(name));
const pending = read(
  PENDING_DIR,
  "docs/decisions/pending",
  (name) => name.endsWith(".md") && name !== "README.md",
);

describe("the decision corpus", () => {
  it("has numbered files to check", () => {
    expect(numbered.length).toBeGreaterThan(0);
  });

  it.each([...numbered, ...pending])("$context parses and validates", ({ context, markdown }) => {
    expect(validateAdrRecord(parseAdrFile(markdown, context), context)).toEqual([]);
  });

  it("renders every numbered file as a complete register bullet", () => {
    const blank = numbered
      .map(({ context, markdown }) => ({ context, line: registerLineFor(parseAdrFile(markdown)) }))
      // An empty status or area collapses to consecutive separators, and a body title leaks a `#`
      // into the decision text — the two shapes of the degradation this guard replaced.
      .filter(({ line }) => / · +· /.test(line) || / — #/.test(line) || / · +—/.test(line))
      .map(({ context }) => context);
    expect(blank).toEqual([]);
  });
});

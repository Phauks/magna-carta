/*
 * Absence is said ONE way. This pins the marker and its spoken form, then sweeps the tool's source
 * for any other way of saying a measurement is missing — the guard that stops N/A, the old sentence,
 * or an em dash from creeping back into a value slot.
 *
 * The sweep scans RENDERED source only: comments are stripped first. Em dashes are this codebase's
 * house style for prose (they fill the explanatory comments in every file here), so banning them
 * outright would fight that convention for no gain. What must never regress is an em dash — or N/A,
 * or the old sentence — reaching a value slot the reader sees, and that is what stripping comments
 * before scanning pins.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ABSENT_DESCRIPTION, ABSENT_MARKER } from "../src/lib/tools/speed-test/absence.ts";

const SPEED_TEST_DIR = join(import.meta.dirname, "../src/lib/tools/speed-test");
const BANNED = ["N/A", "Not measured yet", "—"]; // em dash is U+2014

// Remove comment prose so the sweep sees only rendered/exported source. Handles Svelte/HTML
// comments, block comments, and line comments; a line-comment strip that is careful not to eat a
// `://` URL or a quoted "//" — neither of which is a comment.
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

describe("absence marker", () => {
  it("is a plain hyphen, never an em dash", () => {
    expect(ABSENT_MARKER).toBe("-");
    expect(ABSENT_MARKER).not.toContain("—");
  });
  it("has a spoken form that is a word, not punctuation", () => {
    expect(ABSENT_DESCRIPTION).toBe("not measured");
  });
});

describe("the tool says 'missing' exactly one way", () => {
  const files = readdirSync(SPEED_TEST_DIR).filter(
    (name) => /\.(ts|svelte)$/.test(name) && name !== "absence.ts",
  );

  it("actually read a meaningful number of source files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)("%s renders none of the banned absence literals", (name) => {
    const rendered = stripComments(readFileSync(join(SPEED_TEST_DIR, name), "utf8"));
    for (const literal of BANNED) {
      expect(rendered, `${name} still renders ${JSON.stringify(literal)}`).not.toContain(literal);
    }
  });
});

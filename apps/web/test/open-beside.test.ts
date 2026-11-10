import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { OPEN_BESIDE_REASONS, openBeside, opensBeside } from "../src/lib/navigation/open-beside.ts";

/*
 * Opening beside the reader's work is one gated pattern, not a screen's own decision.
 *
 * The rule it holds: every `_blank` in the application goes through `$lib/navigation/open-beside`,
 * where the caller names why the destination cannot open in place from a closed set of reasons.
 * The scan below is what makes the gate a gate — without it the fifteen call sites this module
 * replaced would grow back one screen at a time, each with its own spelling of the same attribute.
 */

const SOURCE_ROOT = join(import.meta.dirname, "..", "src");
const GATE = join(SOURCE_ROOT, "lib", "navigation", "open-beside.ts");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|svelte)$/.test(entry) ? [path] : [];
  });
}

describe("where a destination opens beside the reader", () => {
  it("has a closed set of reasons, each a fact about the destination", () => {
    expect(OPEN_BESIDE_REASONS).toEqual([
      "external",
      "file",
      "session",
      "unsaved-work",
      "live-meeting",
      "requested",
    ]);
  });

  it("isolates the new page from this one, whichever way it opens", () => {
    expect(opensBeside("external")).toEqual({ target: "_blank", rel: "noopener noreferrer" });
    const opened: unknown[][] = [];
    const original = globalThis.open;
    globalThis.open = ((...arguments_: unknown[]) => {
      opened.push(arguments_);
      return null;
    }) as typeof globalThis.open;
    try {
      openBeside("https://example.test/", "file");
    } finally {
      globalThis.open = original;
    }
    expect(opened).toEqual([["https://example.test/", "_blank", "noopener,noreferrer"]]);
  });

  it("is the only place in the application that names _blank", () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((path) => path !== GATE)
      .filter((path) => readFileSync(path, "utf8").includes("_blank"))
      .map((path) => relative(SOURCE_ROOT, path));
    expect(offenders, "every new-tab opening goes through $lib/navigation/open-beside").toEqual([]);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * One picker over the directory, and no fourth copy.
 *
 * Three surfaces had each hand-built a combobox over `searchDirectory` before the design system's
 * `EntityPicker` existed, and the fourth would have arrived with the next surface that needed a
 * person. The rule this scan holds: the directory's search is called from one adapter,
 * `$lib/directory/directory-picker-source.ts`, and everything that picks a person or an
 * organization goes through the picker that adapter feeds. The one standing copy is named below
 * with the reason it stands, and the entry comes out the day that reason does.
 */

const SOURCE_ROOT = join(import.meta.dirname, "..", "src");

/** Files still calling the search themselves, each with the reason it has not been folded yet. */
const STANDING_COPIES: Readonly<Record<string, string>> = {
  "lib/custodian/owner-picker.svelte":
    "folds onto EntityPicker when the custodian-refinements stream lands; that stream rewrites this file and new-packet-dialog.svelte, and a fold here would collide with it",
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|svelte)$/.test(entry) ? [path] : [];
  });
}

describe("who may search the directory", () => {
  // The directory's own screens search their own record: the list at /directory is the search's
  // home, not a picker over it.
  const OWN_SURFACES = [join("lib", "directory"), join("routes", "(app)", "directory")];
  const callers = sourceFiles(SOURCE_ROOT)
    .filter((path) => !OWN_SURFACES.some((own) => relative(SOURCE_ROOT, path).startsWith(own)))
    .filter((path) => readFileSync(path, "utf8").includes("searchDirectory("))
    .map((path) => relative(SOURCE_ROOT, path).replaceAll("\\", "/"));

  it("is the adapter, and nothing else that is not named as a standing copy", () => {
    const unnamed = callers.filter((caller) => !(caller in STANDING_COPIES));
    expect(unnamed, "pick people through EntityPicker over directoryPickerSearch").toEqual([]);
  });

  it("names no standing copy that has already been folded", () => {
    const stale = Object.keys(STANDING_COPIES).filter((copy) => !callers.includes(copy));
    expect(stale, "an allowance that outlives its copy is deleted").toEqual([]);
  });
});

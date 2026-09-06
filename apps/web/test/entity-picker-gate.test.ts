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
 * organization goes through the picker that adapter feeds. Standing copies are named below with the
 * reason each stands, and an entry comes out the day its reason does.
 *
 * THERE ARE NONE LEFT. The last was custodian's owner picker, held open for the custodian stream to
 * rewrite; that stream did not fold it onto EntityPicker but removed its directory search outright.
 * A packet's owners are the parties to the matter it is held under, so the whole address book was
 * never the right list to offer — the directory holds opposing counsel, courts and vendors, and
 * offering all of it invites recording a will as held for the other side's attorney.
 */

const SOURCE_ROOT = join(import.meta.dirname, "..", "src");

/** Files still calling the search themselves, each with the reason it has not been folded yet. */
const STANDING_COPIES: Readonly<Record<string, string>> = {};

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

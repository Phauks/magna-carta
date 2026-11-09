// Fitness function (the source-scan pattern): the review-the-corpus display seam returns UNREVIEWED
// values by design — `describeJurisdiction` hands a surface the whole profile, citations and values
// included, marked not-verified, because a firm shown nothing has no reason to get anything
// reviewed. That makes the seam the one place an app surface could reach a compliance value without
// passing the review gate: rendering an unreviewed value beside its citation is the seam's purpose,
// but COMPUTING on one — routing money, gating a movement, filling a deadline — is exactly what the
// gate exists to refuse.
//
// A type cannot draw that line (the rendered value and the acted-on value are the same value), so
// this scan does: any source file outside this package that touches the display seam or the raw
// profile shape and then reaches a typed field's `.value` must carry an inline
// `fitness:display-only-unreviewed-value` marker immediately above the reach, asserting it renders
// and does not act. The marker is the tripwire — a future surface cannot reach `.value` without an
// engineer consciously writing that assertion, and a reviewer seeing it.
//
// Reaching the profile data around the seam entirely — importing the package's internals by file
// path or the data module directly — is refused outright, marker or none: the sanctioned doors are
// the package exports (`port`, `resolve`, `registry`, `types`), nothing else.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = join(import.meta.dirname, "..", "..", "..");
const THIS_PACKAGE_DIRECTORY = join(REPOSITORY_ROOT, "packages", "trust-jurisdictions");
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".svelte"];
const ALLOW_MARKER = "fitness:display-only-unreviewed-value";

function sourceFilesUnder(directory: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      collected.push(...sourceFilesUnder(path));
      continue;
    }
    if (SCANNED_EXTENSIONS.some((extension) => entry.endsWith(extension))) collected.push(path);
  }
  return collected;
}

// Every app and package source tree except this package's own (the resolver may read `.value`
// freely — it IS the gate).
function scannedSourceFiles(): string[] {
  const roots: string[] = [];
  for (const workspace of ["apps", "packages"]) {
    const workspaceDirectory = join(REPOSITORY_ROOT, workspace);
    for (const entry of readdirSync(workspaceDirectory)) {
      const packageDirectory = join(workspaceDirectory, entry);
      if (packageDirectory === THIS_PACKAGE_DIRECTORY) continue;
      const sourceDirectory = join(packageDirectory, "src");
      let isDirectory = false;
      try {
        isDirectory = statSync(sourceDirectory).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) roots.push(sourceDirectory);
    }
  }
  return roots.flatMap((root) => sourceFilesUnder(root));
}

function stripComments(source: string): string {
  // Block comments then line comments, EXCEPT a comment carrying the allow marker — the marker
  // lives in a comment by design, so stripping it would revoke every allowance. String contents are
  // left alone (a false positive there surfaces as a named offender to inspect, which is the safe
  // direction for a guard).
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => (comment.includes(ALLOW_MARKER) ? comment : ""))
    .replace(/(^|[^:])\/\/[^\n]*/gm, (line, prefix: string) =>
      line.includes(ALLOW_MARKER) ? line : prefix,
    );
}

// The seam and the shapes it hands out. A file that never mentions any of these cannot be reaching
// an unreviewed value, whatever `.value` tokens it contains (form inputs, refs, and so on).
const SEAM_TOKENS = /describeJurisdiction|findJurisdictionProfile|JurisdictionProfile\b/;
// A typed field reached to its `.value`, directly or through a short chain.
const VALUE_REACH = /\.typed\b[^;\n]{0,120}?\.value\b|\btyped\.\w+\.value\b/g;
// The unsanctioned doors: the data module, or any by-path import into this package's src.
const BYPASS_IMPORT = /@magna-carta\/trust-jurisdictions\/(?:data|src)|trust-jurisdictions\/src\//;

interface Offender {
  readonly file: string;
  readonly reason: string;
}

function offendersIn(file: string, rawSource: string): Offender[] {
  const source = stripComments(rawSource);
  const found: Offender[] = [];
  if (BYPASS_IMPORT.test(source)) {
    found.push({
      file,
      reason: "imports trust-jurisdictions internals by path — use the package exports",
    });
  }
  if (!SEAM_TOKENS.test(source)) return found;
  for (const match of source.matchAll(VALUE_REACH)) {
    const preceding = source.slice(Math.max(0, match.index - 240), match.index);
    if (preceding.includes(ALLOW_MARKER)) continue;
    found.push({
      file,
      reason: `reaches an unreviewed typed value (${match[0].slice(0, 60)}) without the ${ALLOW_MARKER} marker`,
    });
  }
  return found;
}

describe("unreviewed jurisdiction values are rendered, never acted on", () => {
  it("no source outside this package reaches a typed .value through the display seam unmarked", () => {
    const files = scannedSourceFiles();
    // Non-vacuity floor: the walk actually saw the app surface most likely to grow a consumer.
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.endsWith(join("routes", "trust", "trust.ts")))).toBe(true);

    const offenders = files.flatMap((file) => offendersIn(file, readFileSync(file, "utf8")));
    expect(
      offenders,
      offenders.map((offender) => `${offender.file}: ${offender.reason}`).join("\n"),
    ).toEqual([]);
  });

  // The detector proven against synthetic sources, so a silent regex regression cannot let the
  // scan pass by matching nothing. (No live offender exists today — the port is not yet bound to
  // any surface — so without this the guard would be vacuously green.)
  it("the detector fires on the shapes it exists to catch, and respects the marker", () => {
    const acting = `import { describeJurisdiction } from "@magna-carta/trust-jurisdictions/resolve";
      const described = describeJurisdiction("US-NV");
      const years = described.profile?.typed.recordsRetention.value.years;`;
    expect(offendersIn("synthetic.ts", acting)).toHaveLength(1);

    // The marker lives in a comment; comment-stripping preserves exactly the comments that carry
    // it, so the allowance survives. Prove the marked form passes.
    const marked = `import { describeJurisdiction } from "@magna-carta/trust-jurisdictions/resolve";
      const described = describeJurisdiction("US-NV");
      /* fitness:display-only-unreviewed-value — rendered beside its citation, never computed on */
      const shown = described.profile?.typed.recordsRetention.value.years;`;
    expect(offendersIn("synthetic.ts", marked)).toHaveLength(0);

    const bypass = `import { NEVADA_PROFILE } from "@magna-carta/trust-jurisdictions/data/nevada";`;
    expect(offendersIn("synthetic.ts", bypass)).toHaveLength(1);

    const innocent = `const input = document.querySelector("input"); const text = input.value;`;
    expect(offendersIn("synthetic.ts", innocent)).toHaveLength(0);
  });
});

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findBareExemptions,
  findCallSites,
  findInconsistentGuards,
  findLocalInterleaveHelpers,
  findUncheckedInterleaves,
  findUnwrappedGuardShaped,
  readStatementBuilders,
} from "./rules.mjs";

// Fitness function: guarded writes stay guarded, and the harness that proves they work is used in
// the shape that cannot pass vacuously.
//
// A guarded write is an UPDATE or DELETE whose WHERE repeats the precondition its caller read, so a
// caller working from a stale read matches no row. Marking it `guarded()` is what turns matching no
// row into a refused batch instead of a silent success — the whole point being that the precondition
// read is advisory and the WHERE clause is not. What this checks is the part a person forgets: that
// the marking is applied consistently, and that the tests written to prove a guard works are shaped
// so they could fail.
//
// It does NOT require every guard-shaped statement to be marked. Seventy-odd exist and the set has
// never been triaged; failing on all of them would make the gate something to switch off rather than
// something to satisfy. The count is printed on a passing run so the backlog stays visible, and each
// one becomes a hard failure the moment anybody marks it anywhere — which is rule 1.
//
// Escape hatch: `fitness:unguarded-write — <reason>` above a call site. A bare marker fails (rule 2).
//
// Run: `pnpm run lint:guarded-writes`.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE_ROOTS = ["packages", "apps"];

function walk(directory, keep, found = []) {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === ".tsbuild" || entry.startsWith(".")) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, keep, found);
    else if (keep(path)) found.push(path);
  }
  return found;
}

function readSources(root, subdirectory) {
  const files = [];
  for (const group of SOURCE_ROOTS) {
    const base = join(root, group);
    for (const member of readdirSync(base)) {
      const directory = join(base, member, subdirectory);
      try {
        if (!statSync(directory).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const path of walk(directory, (one) => one.endsWith(".ts"))) {
        files.push({ file: relative(root, path), source: readFileSync(path, "utf8") });
      }
    }
  }
  return files;
}

function main() {
  const sourceFiles = readSources(ROOT, "src");
  const testFiles = readSources(ROOT, "test");
  const allFiles = [...sourceFiles, ...testFiles];

  const builders = sourceFiles.flatMap(({ file, source }) =>
    readStatementBuilders(source).map((builder) => ({ ...builder, file })),
  );

  // Call sites are counted in `src` ONLY. A statement-level test calls the builder and runs it on its
  // own to assert what the SQL does — that is the test that proves the WHERE clause bites at all, and
  // wrapping it in guarded() would test the wrapper instead. The rule is about production composition:
  // where an effect is assembled, every caller of a guarded builder agrees it is guarded.
  const callSitesByName = new Map();
  for (const builder of builders) {
    const sites = [];
    for (const { file, source } of sourceFiles) {
      if (file === builder.file && !source.includes(`${builder.name}(`)) continue;
      sites.push(...findCallSites(source, builder.name, file));
    }
    callSitesByName.set(
      builder.name,
      sites.filter((one) => !(one.file === builder.file && one.line === builder.line)),
    );
  }

  const exempted = new Set(
    allFiles.flatMap(({ file, source }) =>
      source
        .split("\n")
        .map((line, index) =>
          /fitness:unguarded-write/.test(line) ? `${file}:${index + 2}` : null,
        )
        .filter((one) => one !== null),
    ),
  );

  const problems = [
    ...findInconsistentGuards(builders, callSitesByName).filter(
      (problem) => !exempted.has(`${problem.file}:${problem.line}`),
    ),
    ...findBareExemptions(allFiles),
    ...findUncheckedInterleaves(testFiles),
    ...findLocalInterleaveHelpers(testFiles),
  ];

  if (problems.length > 0) {
    console.error(
      "\nGuarded writes, and the harness that proves them, are not being used as meant:\n",
    );
    for (const problem of problems) {
      console.error(
        `  ${problem.file}:${problem.line}  [${problem.rule}]\n      ${problem.detail}`,
      );
    }
    console.error(
      `\n${String(problems.length)} problem(s).` +
        "\nThe rule and the reasoning: docs/conventions/testing.md — Concurrency: choose the interleaving, and prove it happened.",
    );
    process.exit(1);
  }

  const wrapped = builders.filter((builder) =>
    (callSitesByName.get(builder.name) ?? []).some((site) => site.guarded),
  );
  const backlog = findUnwrappedGuardShaped(builders, callSitesByName);
  console.log(
    `Guarded writes consistent (${String(wrapped.length)} builder(s) marked guarded(), every call site of each one wrapped;` +
      ` no test reaches for interleaveAt without checking it fired, and none re-implements the harness).`,
  );
  console.log(
    `Backlog: ${String(backlog.length)} guard-shaped builder(s) not yet marked — each becomes a hard failure the moment one call site is.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

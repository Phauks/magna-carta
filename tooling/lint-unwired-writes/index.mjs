import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWLIST, DEFINITION_PATTERN, SELF_TEST, findUnwiredWrites } from "./rules.mjs";

// Fitness function: every exported WRITE in the workspace can be reached from the product.
//
// A write-shaped function nobody calls is a capability nobody can perform. The read side goes on
// working and goes on returning the default, so nothing fails and nothing looks wrong — which is why
// two subsystems shipped inert and were found by hand rather than by a suite. The reasoning, the
// measurements, and the two widenings that were tried and rejected are in rules.mjs.
//
// It is deliberately quiet: one rule, the narrowest form of the question, plus a per-name allowlist
// whose entries each carry a written reason. On the tree it was built against it reports nothing —
// every standing exception is on the list, and a list entry that stops being true is itself a failure.
//
// Run: `pnpm run lint:unwired-writes`.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// The workspace groups holding shippable code. tooling/ and tools/ are deliberately absent as
// DEFINITION roots — a build script's exports are called by a script runner rather than by the
// product — but they are read as REFERENCE roots below, so a write only a build step performs is not
// mistaken for an unreachable one.
const DEFINITION_ROOTS = ["apps", "packages"];
const REFERENCE_ROOTS = ["apps", "packages", "tooling", "tools", "plugins"];

// Directories that hold generated output or dependencies. A reference from generated code is still a
// reference, but the generators here emit clients over the HTTP contract rather than calls into these
// functions, and walking them costs more than every other directory combined.
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".tsbuild",
  ".svelte-kit",
  ".wrangler",
  ".vite",
  "dist",
  "build",
  "coverage",
  "target",
  "pkg",
]);

const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|mjs|cjs|js|svelte)$/;

// This module's own directory. The allowlist NAMES the functions it suppresses, and a name in a
// suppression list is the opposite of a call — counting it would make every entry immediately
// self-satisfying and the gate permanently silent.
const SELF_DIRECTORY = "tooling/lint-unwired-writes/";

// A test file: the whole point of the scan is that a test calling a function is not the product
// calling it. Both layouts the repository uses — a `test/` directory beside `src/`, and a
// `*.test.ts` beside the module — plus the e2e naming.
export function isTestPath(path) {
  const normalized = path.replaceAll("\\", "/");
  return (
    /(?:^|\/)(?:test|tests|__tests__|__mocks__)\//.test(normalized) ||
    /\.(?:test|spec|e2e)\.[A-Za-z]+$/.test(normalized) ||
    /\.e2e\.test\./.test(normalized)
  );
}

function walk(directory, found = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found; // a root a checkout legitimately does not have
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walk(path, found);
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

// Every non-test source file under the given roots, as absolute path -> contents. Read once: the
// scan asks the same corpus for definitions and for references, and reading it twice is the whole
// cost of the pass.
export function readSources(root, roots) {
  const sources = new Map();
  for (const group of roots) {
    for (const path of walk(join(root, group))) {
      const relativePath = relative(root, path).replaceAll("\\", "/");
      if (isTestPath(relativePath)) continue;
      if (relativePath.startsWith(SELF_DIRECTORY)) continue;
      sources.set(relativePath, readFileSync(path, "utf8"));
    }
  }
  return sources;
}

export function collectDefinitions(sources, definitionRoots) {
  const definitions = [];
  const seen = new Set();
  for (const [path, contents] of sources) {
    if (!definitionRoots.some((group) => path.startsWith(`${group}/`))) continue;
    DEFINITION_PATTERN.lastIndex = 0;
    let match;
    while ((match = DEFINITION_PATTERN.exec(contents)) !== null) {
      const name = match[1];
      if (seen.has(name)) continue; // one definition per name; a duplicate export fails typecheck first
      seen.add(name);
      definitions.push({
        name,
        file: path,
        line: contents.slice(0, match.index).split("\n").length,
      });
    }
  }
  return definitions;
}

// Every identifier-shaped token, so each file is scanned ONCE for all names rather than once per
// name. Two hundred-odd names over several thousand files is the difference between a pass that runs
// in a second and one nobody leaves in the gate.
const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

// References to each name anywhere in the non-test corpus EXCEPT the definition's own line. A
// same-file reference counts, because a statement composed into an ordered batch by a helper beside
// it is reached through that helper — see the rejected widening in rules.mjs.
export function countReferences(sources, definitions) {
  const counts = new Map(definitions.map((definition) => [definition.name, 0]));
  const definitionsByFile = new Map();
  for (const definition of definitions) {
    const inFile = definitionsByFile.get(definition.file) ?? [];
    inFile.push(definition);
    definitionsByFile.set(definition.file, inFile);
  }

  for (const [path, contents] of sources) {
    // The character ranges of this file's own definition lines, which do not count as references.
    const ownDefinitionLines = [];
    const inFile = definitionsByFile.get(path);
    if (inFile !== undefined) {
      const lineStarts = [0];
      for (let index = 0; index < contents.length; index += 1) {
        if (contents[index] === "\n") lineStarts.push(index + 1);
      }
      for (const definition of inFile) {
        const start = lineStarts[definition.line - 1] ?? 0;
        const newline = contents.indexOf("\n", start);
        ownDefinitionLines.push([start, newline === -1 ? contents.length : newline]);
      }
    }

    IDENTIFIER.lastIndex = 0;
    let match;
    while ((match = IDENTIFIER.exec(contents)) !== null) {
      const current = counts.get(match[0]);
      if (current === undefined) continue;
      if (ownDefinitionLines.some(([start, end]) => match.index >= start && match.index < end))
        continue;
      counts.set(match[0], current + 1);
    }
  }
  return counts;
}

// The gate's own rules, checked against their fixtures on every invocation, so a rule that stops
// biting fails here as well as in the suite.
export function runSelfTest() {
  const failures = [];
  for (const { name, definitions, references, allowlist, expect } of SELF_TEST) {
    const found = findUnwiredWrites(
      definitions,
      new Map(Object.entries(references)),
      new Map(Object.entries(allowlist)),
    )
      .map((problem) => problem.rule)
      .toSorted();
    const wanted = [...expect].toSorted();
    if (JSON.stringify(found) !== JSON.stringify(wanted)) {
      failures.push({ name, found, wanted });
    }
  }
  return failures;
}

function main() {
  const selfTestFailures = runSelfTest();
  if (selfTestFailures.length > 0) {
    console.error("\nlint-unwired-writes: the scan's own rule no longer does what it must.\n");
    for (const failure of selfTestFailures) {
      console.error(
        `  ${failure.name}\n` +
          `    expected: ${JSON.stringify(failure.wanted)}\n` +
          `    got:      ${JSON.stringify(failure.found)}`,
      );
    }
    process.exit(1);
  }

  const sources = readSources(ROOT, REFERENCE_ROOTS);
  const definitions = collectDefinitions(sources, DEFINITION_ROOTS);
  if (definitions.length === 0) {
    // Vacuity guard: a scan that found no definitions passes trivially, which is exactly how a
    // pattern change turns a gate into a no-op nobody notices.
    console.error(
      "\nlint-unwired-writes: found no exported writes at all — the definition pattern or the" +
        " workspace roots have drifted.\n",
    );
    process.exit(1);
  }
  const found = findUnwiredWrites(definitions, countReferences(sources, definitions));

  if (found.length > 0) {
    console.error("\nExported writes the product cannot reach:\n");
    for (const problem of found) {
      const where =
        problem.file === null
          ? "tooling/lint-unwired-writes/rules.mjs"
          : `${problem.file}:${problem.line}`;
      console.error(`  ${where}  \`${problem.name}\`  [${problem.rule}]\n      ${problem.detail}`);
    }
    console.error(
      `\n${found.length} problem(s) across ${definitions.length} exported write(s).` +
        "\nA write nobody calls is a capability nobody can perform: the read side keeps returning" +
        " the default and nothing fails." +
        "\nWire it to a route or a consumer, delete it, or add it to ALLOWLIST in" +
        " tooling/lint-unwired-writes/rules.mjs with the reason it has no caller.",
    );
    process.exit(1);
  }

  console.log(
    `Every exported write is reachable (${definitions.length} scanned across ${sources.size} file(s));` +
      ` ${ALLOWLIST.size} allowlisted, each with its reason, and every one of those still has no caller.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

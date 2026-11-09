// Fitness function: a package that already has the Workers types as GLOBALS must never also `import`
// them from "@cloudflare/workers-types".
//
// WHY THIS EXISTS. The package ships its entire surface TWICE. `index.d.ts` is a global script — no
// top-level import or export — and is what `"types": ["@cloudflare/workers-types"]` loads. `index.ts`
// is a parallel module declaring the same ~16,000 lines with `export` in front of them, and, because
// the package publishes no `types`, `main` or `exports` field to say otherwise, it is what
// `import ... from "@cloudflare/workers-types"` resolves to. A program that does both holds two
// distinct declarations of every Workers interface.
//
// They are structurally identical, so nothing fails — it just gets compared. For a non-generic
// interface that is merely wasteful. For a GENERIC one it is fatal: variance measurement over the
// mutually recursive graph hanging off `DurableObjectState<Props>` comes back "unreliable", which
// drops TypeScript into full structural recursion on every instantiation. One test file with one such
// annotation did not finish type-checking in 600 SECONDS with memory flat; deleting the import took it
// to 2 s. That is the entire cost of the redundant import, and it is invisible in review — the import
// looks like good hygiene.
//
// SCANS the packages that already have the globals, which is every one whose tsconfig chain reaches
// packages/tsconfig/worker.json. Anywhere else — packages/database is the standing example, typed
// `"types": ["node"]` because it also runs outside workerd — the import is the ONLY way to name these
// types and is correct, so those directories are not scanned at all.
//
// THE FIX IS ALWAYS THE SAME: delete the import. The global of that name is the same type, already in
// scope, and needs nothing else changed.
//
// Run: `pnpm run lint:workers-types-import`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const GROUPS = ["apps", "packages"];
const SCANNED_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);
const WORKER_PRESET = "tsconfig/worker.json";

const SKIP_DIRECTORIES = new Set([
  // .claude holds parallel-session worktrees; the rest are build output, not source.
  "node_modules",
  ".git",
  ".claude",
  ".tsbuild",
  "dist",
  "build",
  ".svelte-kit",
  ".wrangler",
  ".vite",
  "target",
  "coverage",
]);

// Matches an import/export whose specifier is the package itself or a subpath of it. `import type` is
// included on purpose: type-only is exactly the form this rule is about, and it is the one that reads
// as harmless. A `/// <reference types="...">` is NOT matched — that pulls in the global script, which
// is the thing being asked for.
const MODULE_IMPORT =
  /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']@cloudflare\/workers-types(?:\/[^"']*)?["']/;

// A bare side-effect import of the same module, which loads the second copy just as thoroughly.
const BARE_IMPORT = /^\s*import\s*["']@cloudflare\/workers-types(?:\/[^"']*)?["']/;

export function offendingLinesIn(text) {
  const found = [];
  text.split("\n").forEach((source, index) => {
    if (MODULE_IMPORT.test(source) || BARE_IMPORT.test(source)) {
      found.push({ line: index + 1, source: source.trim() });
    }
  });
  return found;
}

// The scan proves itself before it scans: a check that stops matching is indistinguishable from a
// clean tree, and this one guards a failure mode whose symptom is a build that merely takes longer.
const SELF_TEST = [
  {
    name: "a type-only named import",
    text: 'import type { DurableObjectState } from "@cloudflare/workers-types";',
    expect: [1],
  },
  {
    name: "a value import",
    text: 'import { Foo } from "@cloudflare/workers-types";',
    expect: [1],
  },
  {
    name: "a subpath import",
    text: 'import type { Bar } from "@cloudflare/workers-types/experimental";',
    expect: [1],
  },
  {
    name: "a re-export",
    text: 'export type { DurableObjectId } from "@cloudflare/workers-types";',
    expect: [1],
  },
  {
    name: "a bare side-effect import",
    text: 'import "@cloudflare/workers-types";',
    expect: [1],
  },
  {
    name: "a triple-slash reference is the SUPPORTED form and is not a finding",
    text: '/// <reference types="@cloudflare/workers-types" />',
    expect: [],
  },
  {
    name: "the name in prose or a comment is not a finding",
    text: "// @cloudflare/workers-types does not declare getSetCookie().",
    expect: [],
  },
  {
    name: "another package's import is not a finding",
    text: 'import type { Thing } from "@cloudflare/vitest-plugin";',
    expect: [],
  },
];

function runSelfTest() {
  const failures = [];
  for (const { name, text, expect } of SELF_TEST) {
    const found = offendingLinesIn(text).map((finding) => finding.line);
    if (JSON.stringify(found) !== JSON.stringify(expect)) failures.push({ name, found, expect });
  }
  return failures;
}

// A package "has the globals" when its own tsconfig.json extends the worker preset. The preset is the
// single place `"types": ["@cloudflare/workers-types"]` is set, so following `extends` one hop answers
// it for every worker app without this scan restating the list of them.
function packagesWithAmbientWorkersTypes() {
  const directories = [];
  for (const group of GROUPS) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      const tsconfigPath = join(base, entry, "tsconfig.json");
      if (!existsSync(tsconfigPath)) continue;
      const text = readFileSync(tsconfigPath, "utf8");
      const extendsMatch = /"extends"\s*:\s*"([^"]+)"/.exec(text);
      if (extendsMatch?.[1]?.endsWith(WORKER_PRESET) === true) {
        directories.push(join(base, entry));
      }
    }
  }
  return directories;
}

function walk(directory, files) {
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRECTORIES.has(name)) walk(full, files);
      continue;
    }
    files.push(full);
  }
}

function main() {
  const selfTestFailures = runSelfTest();
  if (selfTestFailures.length > 0) {
    console.error("\nlint-workers-types-import: the scan no longer sees what it must.\n");
    for (const failure of selfTestFailures) {
      console.error(
        `  ${failure.name}\n` +
          `    expected lines: ${JSON.stringify(failure.expect)}\n` +
          `    got:            ${JSON.stringify(failure.found)}`,
      );
    }
    process.exit(1);
  }

  const scanned = packagesWithAmbientWorkersTypes();
  if (scanned.length === 0) {
    console.error(
      "\nlint-workers-types-import: no package extends the worker preset — the scan would pass" +
        " vacuously. Has packages/tsconfig/worker.json moved?\n",
    );
    process.exit(1);
  }

  const offenders = [];
  for (const directory of scanned) {
    const files = [];
    walk(directory, files);
    for (const file of files) {
      const name = basename(file);
      const extension = name.slice(name.lastIndexOf("."));
      if (!SCANNED_EXTENSIONS.has(extension)) continue;
      const relativePath = relative(ROOT, file).split(sep).join("/");
      for (const finding of offendingLinesIn(readFileSync(file, "utf8"))) {
        offenders.push(`  ${relativePath}:${finding.line}  ${finding.source}`);
      }
    }
  }

  if (offenders.length > 0) {
    console.error(
      "\nThese packages already have every Workers type as a GLOBAL, and also import the module copy" +
        " of it.\n",
    );
    console.error(
      "That puts two full, distinct declarations of the same surface in one program. Comparing them" +
        "\nacross a generic type does not terminate in useful time — one such annotation cost over 600" +
        "\nseconds on a single file. Delete the import; the global of that name is the same type and is" +
        "\nalready in scope.\n",
    );
    console.error(offenders.join("\n"));
    console.error(`\n${offenders.length} redundant @cloudflare/workers-types import(s).`);
    process.exit(1);
  }
  console.log(
    `No redundant @cloudflare/workers-types imports (${scanned.length} package(s) with the globals).`,
  );
}

if (process.argv[1] === SELF) main();

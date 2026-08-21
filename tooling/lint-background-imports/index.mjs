// Fitness function: the BACKGROUND half of the API Worker must not import the composition root.
//
// The background half is the queue consumers, the Cron sweeps and the Durable Objects. The request
// half is src/app.ts and everything under src/routes/. Both halves legitimately share the middle of
// the application — the chokepoint ports, the firm-database proxy, the R2 wiring, the provisioning
// path — and that sharing is fine: those are modules neither half owns.
//
// What is not fine is a VALUE import of src/app.ts from the background half. app.ts is the
// composition root: importing it for real pulls in every route module registered inside it, and with
// them every package those routes touch. A consumer that wants one factory ends up carrying the
// whole application.
//
// This was true once and was invisible. Of the 165 imports of app.ts across the Worker, 162 were
// `import type { Bindings }` — the env type, erased at build, costing nothing. Exactly one value
// import existed outside the entry point and the routes: the firm-provisioning consumer reached for
// an auth factory, and through it every Cron sweep depended on the route tree. Counting imports made
// the two halves look inseparable; counting RUNTIME imports showed a single edge. Review does not
// catch that, because each individual import looks reasonable — hence a check.
//
// The factories both halves need live in their own `*-wiring.ts` modules (auth-wiring.ts,
// logger-wiring.ts, firm-key-provider-wiring.ts, presigner-wiring.ts). Adding one there is the fix
// when this fails; re-exporting it from app.ts is not.
//
// It lives here rather than in the Worker's own suite because that suite runs in Miniflare, which
// has no filesystem — a source scan cannot read the tree from inside it.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE_ROOT = path.join(ROOT, "apps", "api-worker", "src");
const REQUEST_HALF = new Set(["index.ts", "app.ts"]);
const REQUEST_HALF_DIRECTORY = "routes";

// A value import of app.ts, distinguished from a type-only one. `import type { X } from "./app.ts"`
// and `import { type X } from "./app.ts"` are both erased at build; `import { authForEnv } from
// "./app.ts"` is not. That distinction is the whole check, so it is made syntactically rather than
// by counting occurrences of the module specifier.
const APP_IMPORT = /import\s+(?<clause>[^;]*?)\s+from\s+["'](?:\.\.?\/)*app\.ts["']/gs;

function valueImportsOfApp(source) {
  const found = [];
  for (const match of source.matchAll(APP_IMPORT)) {
    const clause = match.groups?.clause ?? "";
    if (clause.trimStart().startsWith("type ")) continue;
    const braces = /\{(?<names>[^}]*)\}/.exec(clause);
    if (braces?.groups?.names !== undefined) {
      const names = braces.groups.names
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      if (names.length > 0 && names.every((name) => name.startsWith("type "))) continue;
    }
    found.push(match[0].replaceAll(/\s+/g, " ").trim());
  }
  return found;
}

function typescriptFilesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFilesUnder(full);
    return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
  });
}

// The negative control. A regex that matches nothing would pass the real scan silently, so the
// recognizer is exercised on known inputs before it is trusted on the tree.
const CONTROL = [
  ['import { authForEnv } from "./app.ts";', 1],
  ['import { createApp } from "../app.ts";', 1],
  ['import type { Bindings } from "./app.ts";', 0],
  ['import { type Bindings } from "./app.ts";', 0],
  ['import { type Bindings, type AppVariables } from "./app.ts";', 0],
];
for (const [source, expected] of CONTROL) {
  const actual = valueImportsOfApp(source).length;
  if (actual !== expected) {
    console.error(
      `background-imports: the recognizer is broken — ${source} gave ${actual}, expected ${expected}`,
    );
    process.exit(1);
  }
}

const background = typescriptFilesUnder(SOURCE_ROOT).filter((file) => {
  const relative = path.relative(SOURCE_ROOT, file);
  return !REQUEST_HALF.has(relative) && !relative.startsWith(REQUEST_HALF_DIRECTORY + path.sep);
});

// Vacuity guard: a walk that silently returned nothing would report success.
if (background.length < 100) {
  console.error(`background-imports: scanned only ${background.length} files — the walk is broken`);
  process.exit(1);
}

const offenders = background.flatMap((file) =>
  valueImportsOfApp(readFileSync(file, "utf8")).map(
    (statement) => `  ${path.relative(ROOT, file)}\n    ${statement}`,
  ),
);

if (offenders.length > 0) {
  console.error(
    `The background half of the API Worker imports the composition root:\n\n${offenders.join("\n")}\n\n` +
      "Move the factory into its own *-wiring.ts module beside app.ts and import it from there.\n" +
      "Re-exporting it from app.ts does not fix this: the import is the edge, not the name.\n",
  );
  process.exit(1);
}

console.log(`Background half imports no route tree (${background.length} file(s) scanned).`);

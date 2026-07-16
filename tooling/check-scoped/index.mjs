// The inner-loop quality gate: run only the checks the current diff can actually break.
//
// `pnpm check` is the FULL gate — seven serial passes over the whole monorepo (fmt + lint, tsc -b across
// the project-reference graph, the generated-config check, api-client, svelte-check for the SPA and the
// design system, and the Rust workspace). It is the wrong thing after editing three files: it takes
// minutes and, the overwhelming majority of the time, re-confirms what was already true.
//
// This runs the same checks, scoped to the diff (against the merge-base with main, plus the working
// tree): fmt + lint on the changed paths, the incremental `tsc -b` type-check (fast when warm, and the
// authoritative type pass), svelte-check only when a .svelte file changed, and the Rust gate only when
// a crate changed. Anything it skips, it says it skipped — a silent gate that quietly checks nothing is
// worse than a slow one. The pre-push hook runs this scoped gate, not the full one — fast local feedback.
//
// The whole-repo gate of record is GitHub Actions (`.github/workflows/gate.yml`, full `pnpm check` +
// `vp test` on every pull request and push to `main`), not this. This is what you run while working.
//
// Usage: pnpm check:scoped [--base <ref>]

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sh = (cmd, cmdArgs) =>
  execFileSync(cmd, cmdArgs, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  }).trim();

const argv = process.argv.slice(2);
const baseFlag = argv.indexOf("--base");
const explicitBase = baseFlag !== -1 ? argv[baseFlag + 1] : null;

/** The fork point with the trunk: everything since then is "the change". */
function mergeBase() {
  if (explicitBase) return explicitBase;
  for (const ref of ["main", "origin/main"]) {
    try {
      return sh("git", ["merge-base", "HEAD", ref]);
    } catch {
      /* ref absent in this worktree — try the next */
    }
  }
  return "HEAD~1";
}

const base = mergeBase();
const lines = (out) =>
  out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
let changed = [];
try {
  changed = [
    ...lines(sh("git", ["diff", "--name-only", `${base}...HEAD`])),
    ...lines(sh("git", ["diff", "--name-only", "HEAD"])),
    ...lines(sh("git", ["diff", "--name-only", "--cached"])),
    ...lines(sh("git", ["ls-files", "--others", "--exclude-standard"])),
  ];
} catch (error) {
  console.error("check:scoped: could not read the git diff —", error.message);
  process.exit(1);
}

// Deleted paths still show in the diff; fmt/lint can only be pointed at files that exist.
const files = [...new Set(changed)].filter((f) => existsSync(path.join(ROOT, f)));
if (files.length === 0) {
  console.log("check:scoped: no changes against " + base.slice(0, 12) + " — nothing to check");
  process.exit(0);
}

const LINTABLE = /\.(ts|tsx|mts|cts|js|mjs|cjs|svelte)$/;
const lintable = files.filter((f) => LINTABLE.test(f));
const touchedRust = files.some((f) => f.startsWith("crates/") || f.endsWith(".rs"));
const touchedSvelteApp = files.some((f) => f.endsWith(".svelte") && f.startsWith("apps/web/"));
const touchedSvelteDs = files.some(
  (f) => f.endsWith(".svelte") && f.startsWith("packages/design-system/"),
);

console.log(`check:scoped: ${files.length} changed file(s) since ${base.slice(0, 12)}\n`);

const steps = [];
// Generated wasm must exist before tsc/vitest can resolve the imports in pdf/decryption/email. A no-op
// when the artefacts are current, so it costs nothing on the common path.
steps.push({
  name: "wasm artefacts present",
  cmd: "node",
  args: ["tooling/bootstrap/index.mjs", "--check"],
});
if (lintable.length > 0) {
  steps.push({
    name: `fmt + lint (${lintable.length} file(s))`,
    cmd: "vp",
    args: ["check", ...lintable],
  });
}
// tsc -b is incremental over the project-reference graph: it re-checks only the changed projects and
// their dependents, so the whole-graph invocation IS the scoped one.
steps.push({ name: "type-check (tsc -b, incremental)", cmd: "vp", args: ["run", "typecheck"] });
if (touchedSvelteApp) {
  steps.push({
    name: "svelte-check (web)",
    cmd: "pnpm",
    args: ["--filter", "@magna-carta/web", "check"],
  });
}
if (touchedSvelteDs) {
  steps.push({
    name: "svelte-check (design-system)",
    cmd: "pnpm",
    args: ["--filter", "@magna-carta/design-system", "check"],
  });
}
if (touchedRust) {
  steps.push({ name: "rust (fmt + clippy + test)", cmd: "vp", args: ["run", "rust-check"] });
}

const skipped = [
  !touchedSvelteApp && !touchedSvelteDs ? "svelte-check (no .svelte changed)" : null,
  !touchedRust ? "rust gate (no crate changed)" : null,
  "dependency audit + license/process-ref linters (pre-push only)",
].filter(Boolean);

let failed = null;
for (const step of steps) {
  const started = Date.now();
  process.stdout.write(`--- ${step.name}\n`);
  const run = spawnSync(step.cmd, step.args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  if (run.status !== 0) {
    console.error(`\ncheck:scoped: FAILED at "${step.name}" after ${secs}s`);
    failed = step.name;
    break;
  }
  console.log(`    ok (${secs}s)\n`);
}

console.log("check:scoped: skipped — " + skipped.join("; "));
if (failed) process.exit(1);
console.log(
  "check:scoped: passed. The full `pnpm check` + `vp test` run in GitHub Actions on every push to main.",
);

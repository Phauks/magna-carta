// The inner-loop quality gate: run only the checks the current diff can actually break.
//
// `pnpm check` is the FULL gate — seven serial passes over the whole monorepo (fmt + lint, tsc -b across
// the project-reference graph, the generated-config check, api-client, svelte-check for the SPA and the
// design system, and the Rust workspace). It is the wrong thing after editing three files: it takes
// minutes and, the overwhelming majority of the time, re-confirms what was already true.
//
// This runs the same checks, scoped to the diff (against the merge-base with the trunk — see
// diff-base.mjs for which trunk ref that means — plus the working tree): fmt + lint on the changed paths, the incremental `tsc -b` type-check (fast when warm, and the
// authoritative type pass), svelte-check only when a .svelte file changed, and the Rust gate only when
// a crate changed. Anything it skips, it says it skipped — a silent gate that quietly checks nothing is
// worse than a slow one. The pre-push hook runs this scoped gate, not the full one — fast local feedback.
//
// The whole-repo gate of record is GitHub Actions (`.github/workflows/gate.yml`, full `pnpm check` +
// `vp test` on every pull request and push to `main`), not this. This is what you run while working.
//
// To APPLY the formatter and the lint autofixes to the same change set, run `pnpm fix:scoped`
// (fix.mjs) — never a bare repo-wide `vp check --fix`.
//
// Usage: pnpm check:scoped [--base <ref>]

import { spawnSync } from "node:child_process";
import {
  collectChangedFiles,
  LINT_ONLY_PATTERN,
  parseBaseFlag,
  resolveBase,
  ROOT,
  SCRIPT_PATTERN,
} from "./changed-files.mjs";
import { mentionsMissingWorkspaceModule } from "./stale-workspace-link.mjs";

const argv = process.argv.slice(2);

// A type-check failure has one famous false positive, and it has cost several afternoons. After
// merging a trunk that added a package or an export path, `tsc -b` reports
// `Cannot find module '@magna-carta/<something>'` (TS2307) against source that is perfectly correct.
// Workspace links resolve at INSTALL time, so the module really is absent from node_modules while the
// source and the reference graph are both right; the remedy is `pnpm install`, not debugging.
//
// The discriminator is the generated reference graph. A genuinely missing project reference produces
// the very same TS2307, so the errors alone prove nothing — but when tooling/tsconfig-refs reports
// every build config in sync with its package.json, nothing about the projects is stale and what is
// left is the link. BOTH halves have to hold before this says anything: a hint that also fired on
// ordinary type errors would train everyone to scroll past the one time it is right.
function staleWorkspaceLinkSuspected(output) {
  if (!mentionsMissingWorkspaceModule(output)) return false;
  const references = spawnSync("node", ["tooling/tsconfig-refs/index.mjs", "--check"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return references.status === 0;
}

// The fork point with the trunk: everything since then is "the change". Which trunk ref to believe is
// diff-base.mjs's decision — a worktree whose local `main` is frozen at clone time must not be diffed
// against it. The change set itself is changed-files.mjs, shared with `pnpm fix:scoped` so the fixer
// cannot rewrite a different set of files than this gate checks.
const base = resolveBase({ explicitBase: parseBaseFlag(argv) });
let files = [];
try {
  files = collectChangedFiles({ base });
} catch (error) {
  console.error("check:scoped: could not read the git diff —", error.message);
  process.exit(1);
}

if (files.length === 0) {
  console.log("check:scoped: no changes against " + base.slice(0, 12) + " — nothing to check");
  process.exit(0);
}

const lintable = files.filter((f) => SCRIPT_PATTERN.test(f) || LINT_ONLY_PATTERN.test(f));
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
// `capture` buffers this one step's output instead of inheriting the terminal, so a failure can be
// read before it is reported. tsc emits its diagnostics in one burst at the end regardless, so
// nothing streaming is lost.
steps.push({
  name: "type-check (tsc -b, incremental)",
  cmd: "vp",
  args: ["run", "typecheck"],
  capture: true,
});
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
    stdio: step.capture === true ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: step.capture === true ? "utf8" : undefined,
    shell: process.platform === "win32",
  });
  let output = "";
  if (step.capture === true) {
    output = (run.stdout ?? "") + (run.stderr ?? "");
    process.stdout.write(output);
  }
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  if (run.status !== 0) {
    console.error(`\ncheck:scoped: FAILED at "${step.name}" after ${secs}s`);
    if (step.capture === true && staleWorkspaceLinkSuspected(output)) {
      console.error(
        "\ncheck:scoped: those TS2307 errors name @magna-carta packages and the generated build\n" +
          "references are in sync, so this is a STALE WORKSPACE LINK rather than broken code —\n" +
          "workspace links resolve at install time. Run `pnpm install`, then re-run this gate.",
      );
    }
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

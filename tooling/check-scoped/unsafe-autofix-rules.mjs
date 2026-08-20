// Lint rules whose AUTOFIX must never run unattended, and how to suppress them for the fix pass.
//
// A lint rule has two independent jobs: telling you something, and rewriting your code. For most rules
// those agree. For the rules below they do not — the finding is worth seeing, but the rewrite is either
// invalid in part of this repo or silently changes what a reviewer reads. `pnpm fix:scoped` runs
// unattended over every file in a change, so a rewrite that is wrong even occasionally is wrong here.
//
// The suppression is FIX-PASS ONLY. Nothing in this file touches the ruleset in vite.config.ts, so
// `pnpm check:scoped`, `pnpm check` and the editor still report every one of these — they just stop
// rewriting. Seeing the finding and deciding is the point; having it applied while you look away is not.
//
// The mechanism is oxlint's `--allow` (`-A`), which `vp lint` accepts and `vp check` does not (`vp check`
// rejects unknown flags outright). That is why fix.mjs drives the lint autofix through `vp lint --fix`
// and the formatter through `vp check --fix --no-lint`, rather than one combined `vp check --fix`.
//
// Adding to this list is a deliberate act: state the rewrite that goes wrong and where, not just the
// rule name. Removing one means the rewrite became safe everywhere in the repo.

/**
 * Rules excluded from `pnpm fix:scoped`, each with the reason its autofix is not safe unattended.
 * Reported as warnings by every check path; simply never applied automatically.
 */
export const UNSAFE_AUTOFIX_RULES = [
  {
    rule: "unicorn/no-array-sort",
    reason:
      "rewrites `.sort()` to `.toSorted()`, which is ES2023. Packages compiled against `lib: ES2022` " +
      "(among them @magna-carta/fixtures) then fail to type-check with TS2550, and the callback " +
      "parameters lose their inferred types with TS7006. Whether the rewrite compiles depends on the " +
      "lib target of the package the file happens to live in, which the fixer does not consult.",
  },
  {
    rule: "typescript/no-unnecessary-boolean-literal-compare",
    reason:
      "rewrites an explicit `x === false` to `!x`. In the worker's access-control route metadata an " +
      "explicit comparison against `false` is the deliberate spelling: it distinguishes the value " +
      "`false` from a missing or undefined flag at a glance, and quietly collapsing it to a negation " +
      "changes what a reviewer of a security guard reads.",
  },
  {
    rule: "typescript/no-unnecessary-type-assertion",
    reason:
      "strips the shape assertion off `await response.json()` in the worker's route tests, and the " +
      "code then does not compile. The rule reads `.json()` as returning `any`, against which any " +
      "assertion looks like a no-op; the type-check of record resolves it to `unknown`, against " +
      "which the assertion is the only thing making the property access legal. The two disagree " +
      "about the same call, the fixer trusts its own answer, and TS2571 lands on a file that " +
      "type-checked a moment earlier.",
  },
];

/**
 * The oxlint `--allow` flags that switch the rules above off for one invocation.
 * `vp lint` passes these straight through to the linter.
 */
export function allowFlagsForFixPass(rules = UNSAFE_AUTOFIX_RULES) {
  return rules.flatMap((entry) => ["-A", entry.rule]);
}
